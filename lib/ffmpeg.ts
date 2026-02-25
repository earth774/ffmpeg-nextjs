import { join } from "path";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import os from "os";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { videos, RESOLUTIONS, type Resolution } from "@/db/schema";

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

// Generate master playlist that includes all resolutions
function generateMasterPlaylist(
  hlsDir: string,
  availableResolutions: { resolution: Resolution; bandwidth: number }[]
): void {
  const masterPlaylistPath = join(hlsDir, "index.m3u8");

  let playlist = "#EXTM3U\n";
  playlist += "#EXT-X-VERSION:3\n\n";

  // Sort by bandwidth (resolution quality)
  const sorted = [...availableResolutions].sort((a, b) => a.bandwidth - b.bandwidth);

  for (const { resolution, bandwidth } of sorted) {
    playlist += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution.width}x${resolution.height}\n`;
    playlist += `${resolution.name}/index.m3u8\n\n`;
  }

  writeFileSync(masterPlaylistPath, playlist);
  console.log(`[FFmpeg] Master playlist created at ${masterPlaylistPath}`);
}

// Helper function to run ffmpeg for a specific resolution
async function transcodeResolution(
  rawPath: string,
  resolution: Resolution,
  outputDir: string,
  videoCodec: string,
  isHardwareAccel: boolean,
  audioMode: "normal" | "filtered" | "aggressive" | "copy" | "none"
): Promise<void> {
  return new Promise((resolve, reject) => {
    const outputM3u8 = join(outputDir, "index.m3u8");
    const segmentPattern = join(outputDir, "seg_%03d.ts");

    // Scale filter - maintain aspect ratio
    const scaleFilter = `scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease,pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2`;

    const outputOptions = [
      `-c:v ${videoCodec}`,
      // Video scaling and bitrate
      `-vf ${scaleFilter}`,
      `-b:v ${resolution.videoBitrate}`,
      `-maxrate ${resolution.videoBitrate}`,
      `-bufsize ${parseInt(resolution.videoBitrate) * 2}k`,
      // Audio handling
      audioMode === "none" ? "-an" : audioMode === "copy" ? "-c:a copy" : "-c:a aac",
      ...(audioMode !== "none" && audioMode !== "copy"
        ? [`-b:a ${resolution.audioBitrate}`, "-ac 2", "-ar 48000"]
        : []),
      // HLS options
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
      outputOptions.push(
        "-af",
        "aformat=channel_layouts=stereo,pan=stereo|c0=c0|c1=c1,aresample=async=1000:min_hard_comp=0.100000:first_pts=0"
      );
    } else if (audioMode === "aggressive") {
      outputOptions.push(
        "-filter_complex",
        "[0:a:0]pan=stereo|c0=c0|c1=c1[aout]",
        "-map",
        "0:v:0",
        "-map",
        "[aout]",
        "-c:a",
        "aac",
        "-b:a",
        resolution.audioBitrate,
        "-ar",
        "48000"
      );
    }

    // Software encoding quality settings
    if (!isHardwareAccel) {
      outputOptions.push("-crf 28", "-preset superfast");
    }

    let inputOptions: string[] = [];

    if (audioMode === "normal") {
      inputOptions = ["-fflags +discardcorrupt+genpts"];
    } else if (audioMode === "filtered") {
      inputOptions = ["-fflags +discardcorrupt+genpts", "-err_detect ignore_err"];
    } else if (audioMode === "aggressive") {
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
      .on("start", (cmd) => {
        console.log(`[FFmpeg] ${resolution.name} transcode started`);
      })
      .on("end", () => {
        console.log(`[FFmpeg] ${resolution.name} transcode completed`);
        resolve();
      })
      .on("error", (err) => {
        console.error(`[FFmpeg] ${resolution.name} transcode error:`, err.message);
        reject(err);
      })
      .run();
  });
}

// Try transcoding with different audio modes until one succeeds
async function tryTranscodeWithFallback(
  rawPath: string,
  resolution: Resolution,
  outputDir: string,
  videoCodec: string,
  isHardwareAccel: boolean
): Promise<boolean> {
  const modes: ("normal" | "copy" | "filtered" | "aggressive" | "none")[] = [
    "normal",
    "copy",
    "filtered",
    "aggressive",
    "none",
  ];

  for (const mode of modes) {
    try {
      console.log(`[FFmpeg] Trying ${resolution.name} with audio mode: ${mode}`);
      await transcodeResolution(rawPath, resolution, outputDir, videoCodec, isHardwareAccel, mode);
      return true;
    } catch (err) {
      console.warn(`[FFmpeg] ${resolution.name} ${mode} mode failed, trying next...`);
      // Continue to next mode
    }
  }

  return false;
}

export function transcodeToHLS(videoId: string, rawPath: string): Promise<void> {
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
  const thumbPath = join(thumbsDir, `${videoId}.jpg`);

  mkdirSync(hlsDir, { recursive: true });
  mkdirSync(thumbsDir, { recursive: true });

  const videoCodec = getVideoCodec();
  const isHardwareAccel = videoCodec !== "libx264";

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

  return new Promise((resolve, reject) => {
    const executeTranscode = async () => {
      try {
        // Get original video metadata
        const meta = await getMeta(rawPath);
        const originalWidth = meta.width;
        const originalHeight = meta.height;

        // Filter resolutions that are <= original resolution
        const targetResolutions = RESOLUTIONS.filter((r) => {
          // Include resolution if original is larger or equal
          return originalWidth >= r.width || originalHeight >= r.height;
        });

        // Always include at least the lowest resolution
        if (targetResolutions.length === 0) {
          targetResolutions.push(RESOLUTIONS[RESOLUTIONS.length - 1]);
        }

        console.log(
          `[FFmpeg] Transcoding to ${targetResolutions.length} resolutions:`,
          targetResolutions.map((r) => r.name).join(", ")
        );

        // Transcode each resolution
        const successfulResolutions: { resolution: Resolution; bandwidth: number }[] = [];
        const resolutionPaths: Record<string, string | null> = {};

        for (const resolution of targetResolutions) {
          const resolutionDir = join(hlsDir, resolution.name);
          mkdirSync(resolutionDir, { recursive: true });

          const success = await tryTranscodeWithFallback(
            rawPath,
            resolution,
            resolutionDir,
            videoCodec,
            isHardwareAccel
          );

          if (success) {
            // Calculate bandwidth (bits per second) - video bitrate + audio bitrate
            const videoKbps = parseInt(resolution.videoBitrate);
            const audioKbps = parseInt(resolution.audioBitrate);
            const bandwidth = (videoKbps + audioKbps) * 1000;

            successfulResolutions.push({ resolution, bandwidth });
            resolutionPaths[`hlsPath${resolution.name}`] = join("hls", videoId, resolution.name, "index.m3u8");
          } else {
            console.error(`[FFmpeg] Failed to transcode ${resolution.name}`);
            resolutionPaths[`hlsPath${resolution.name}`] = null;
          }
        }

        if (successfulResolutions.length === 0) {
          throw new Error("Failed to transcode any resolution");
        }

        // Generate master playlist
        generateMasterPlaylist(hlsDir, successfulResolutions);

        // Create thumbnail
        await createThumbnail();

        // Update database with all resolution paths
        db.update(videos)
          .set({
            status: "ready",
            hlsPath: join("hls", videoId, "index.m3u8"),
            hlsPath1080p: resolutionPaths.hlsPath1080p,
            hlsPath720p: resolutionPaths.hlsPath720p,
            hlsPath480p: resolutionPaths.hlsPath480p,
            hlsPath360p: resolutionPaths.hlsPath360p,
            hlsPath240p: resolutionPaths.hlsPath240p,
            thumbPath: join("thumbs", `${videoId}.jpg`),
            duration: meta.duration,
            width: meta.width,
            height: meta.height,
          })
          .where(eq(videos.id, videoId))
          .run();

        console.log(
          `[FFmpeg] Transcoding complete. Available resolutions:`,
          successfulResolutions.map((r) => r.resolution.name).join(", ")
        );

        resolve();
      } catch (e) {
        console.error("[FFmpeg] Final transcode error:", e);
        db.update(videos).set({ status: "error" }).where(eq(videos.id, videoId)).run();
        reject(e);
      }
    };

    executeTranscode();
  });
}
