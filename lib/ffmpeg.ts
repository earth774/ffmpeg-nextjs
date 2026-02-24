import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import os from "os";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";

function resolveFfmpegPath(): string | null {
  if (ffmpegStatic && existsSync(ffmpegStatic)) {
    return ffmpegStatic;
  }
  try {
    return execSync("which ffmpeg", { encoding: "utf-8" }).trim() || null;
  } catch {
    return null;
  }
}

function resolveFfprobePath(): string | null {
  try {
    if (ffprobeInstaller?.path && existsSync(ffprobeInstaller.path)) {
      return ffprobeInstaller.path;
    }
  } catch {
    // ffprobe-installer may throw on unsupported platforms
  }
  try {
    return execSync("which ffprobe", { encoding: "utf-8" }).trim() || null;
  } catch {
    return null;
  }
}

const ffmpegPath = resolveFfmpegPath();
const ffprobePath = resolveFfprobePath();

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}
if (ffprobePath) {
  ffmpeg.setFfprobePath(ffprobePath);
}

function getVideoCodec(): string {
  const platform = os.platform();
  // Use hardware acceleration on macOS (Apple Silicon/Intel)
  if (platform === "darwin") {
    return "h264_videotoolbox";
  }
  // Use hardware acceleration on Linux with VAAPI (if available)
  if (platform === "linux") {
    return "h264_vaapi";
  }
  // Fallback to software encoding
  return "libx264";
}

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
}

export function getMeta(path: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(path, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      const videoStream = metadata.streams.find((s) => s.codec_type === "video");
      const duration = metadata.format.duration ?? 0;
      const width = videoStream?.width ?? 0;
      const height = videoStream?.height ?? 0;
      resolve({ duration, width, height });
    });
  });
}

export function transcodeToHLS(
  videoId: string,
  rawPath: string
): Promise<void> {
  if (!ffmpegPath) {
    const err = new Error(
      "FFmpeg not found. Install it (e.g. brew install ffmpeg) or ensure ffmpeg-static binary exists."
    );
    db.update(videos).set({ status: "error" }).where(eq(videos.id, videoId)).run();
    return Promise.reject(err);
  }

  const uploadsDir = join(process.cwd(), "uploads");
  const hlsDir = join(uploadsDir, "hls", videoId);
  const thumbsDir = join(uploadsDir, "thumbs");
  const outputM3u8 = join(hlsDir, "index.m3u8");
  const segmentPattern = join(hlsDir, "seg_%03d.ts");
  const thumbPath = join(thumbsDir, `${videoId}.jpg`);

  mkdirSync(hlsDir, { recursive: true });

  const videoCodec = getVideoCodec();
  const isHardwareAccel = videoCodec !== "libx264";

  // Helper function to run ffmpeg with given options
  const runFfmpeg = (audioMode: "normal" | "filtered" | "aggressive" | "copy" | "none"): Promise<void> => {
    return new Promise((resolve, reject) => {
      const outputOptions = [
        `-c:v ${videoCodec}`,
        audioMode === "none" ? "-an" : audioMode === "copy" ? "-c:a copy" : "-c:a aac", // Audio handling
        ...(audioMode !== "none" && audioMode !== "copy" ? ["-b:a 128k", "-ac 2", "-ar 48000"] : []),
        "-hls_time 10",
        "-hls_list_size 0",
        `-hls_segment_filename ${segmentPattern}`,
        "-f hls",
        "-max_muxing_queue_size 1024",
        "-threads 4",
        "-y",
      ];

      // Add audio filter based on mode
      if (audioMode === "filtered") {
        // Standard audio filter for problematic audio
        outputOptions.push(
          "-af aformat=channel_layouts=stereo,pan=stereo|c0=c0|c1=c1,aresample=async=1000:min_hard_comp=0.100000:first_pts=0"
        );
      } else if (audioMode === "aggressive") {
        // Use filter_complex for more control over problematic audio
        outputOptions.push(
          "-filter_complex", "[0:a:0]pan=stereo|c0=c0|c1=c1[aout]",
          "-map", "0:v:0",
          "-map", "[aout]",
          "-c:a", "aac",
          "-b:a", "128k",
          "-ar", "48000"
        );
      }

      if (!isHardwareAccel) {
        outputOptions.push("-crf 28", "-preset superfast");
      }

      let inputOptions: string[] = [];

      if (audioMode === "normal") {
        inputOptions = ["-fflags +discardcorrupt+genpts"];
      } else if (audioMode === "filtered") {
        inputOptions = [
          "-fflags +discardcorrupt+genpts",
          "-err_detect ignore_err",
        ];
      } else if (audioMode === "aggressive") {
        // Most aggressive error recovery - don't probe audio format
        inputOptions = [
          "-fflags +discardcorrupt+genpts+igndts+nofillin",
          "-err_detect ignore_err+ignore_defer+ignore_decode",
          "-copyts",
          "-start_at_zero",
        ];
      } else if (audioMode === "copy") {
        inputOptions = ["-fflags +discardcorrupt"];
      }

      ffmpeg(rawPath)
        .inputOptions(inputOptions)
        .outputOptions(outputOptions)
        .output(outputM3u8)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });
  };

  // Helper to create thumbnail
  const createThumbnail = async (): Promise<void> => {
    return new Promise((resolve, reject) => {
      ffmpeg(rawPath)
        .seekInput(1)
        .outputOptions(["-vframes 1", "-vf scale=640:-1"])
        .output(thumbPath)
        .on("end", () => resolve())
        .on("error", (err) => {
          console.error("[FFmpeg] Thumbnail error:", err.message);
          reject(err);
        })
        .run();
    });
  };

  // Execute transcode with fallback: normal -> copy -> filtered -> aggressive -> no audio
  return new Promise((resolve, reject) => {
    const executeTranscode = async () => {
      try {
        // Try 1: Normal transcode
        try {
          console.log("[FFmpeg] Trying normal transcode...");
          await runFfmpeg("normal");
        } catch {
          // Try 2: Copy audio without re-encoding (for already encoded audio)
          console.warn("[FFmpeg] Normal failed, trying audio copy...");
          try {
            await runFfmpeg("copy");
          } catch {
            // Try 3: With audio filters for problematic audio
            console.warn("[FFmpeg] Copy failed, trying with audio filters...");
            try {
              await runFfmpeg("filtered");
            } catch {
              // Try 4: Aggressive audio recovery with filter_complex
              console.warn("[FFmpeg] Filters failed, trying aggressive recovery...");
              try {
                await runFfmpeg("aggressive");
              } catch {
                // Try 5: Video only (no audio)
                console.warn("[FFmpeg] Aggressive recovery failed, transcoding without audio...");
                await runFfmpeg("none");
              }
            }
          }
        }

        // Get metadata and create thumbnail
        const meta = await getMeta(rawPath);
        await createThumbnail();

        // Update database
        db.update(videos)
          .set({
            status: "ready",
            hlsPath: join("hls", videoId, "index.m3u8"),
            thumbPath: join("thumbs", `${videoId}.jpg`),
            duration: meta.duration,
            width: meta.width,
            height: meta.height,
          })
          .where(eq(videos.id, videoId))
          .run();
        
        resolve();
      } catch (e) {
        console.error("[FFmpeg] Final transcode error:", e);
        db.update(videos)
          .set({ status: "error" })
          .where(eq(videos.id, videoId))
          .run();
        reject(e);
      }
    };

    executeTranscode();
  });
}
