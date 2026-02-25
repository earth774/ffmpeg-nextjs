import { NextRequest } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME_TYPES: Record<string, string> = {
  ".m3u8": "application/x-mpegURL",
  ".ts": "video/MP2T",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

// Valid resolution names
const VALID_RESOLUTIONS = ["1080p", "720p", "480p", "360p", "240p"];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ videoId: string; slug: string[] }> }
) {
  const { videoId, slug } = await params;
  const filename = slug?.join("/") ?? "";

  if (!filename) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
  const mimeType = MIME_TYPES[ext];

  if (!mimeType) {
    return Response.json({ error: "Invalid file type" }, { status: 400 });
  }

  let filePath: string;
  if (filename === "thumb.jpg" || filename === "thumb.jpeg") {
    filePath = join(process.cwd(), "uploads", "thumbs", `${videoId}.jpg`);
  } else {
    // Check if the path contains a resolution subdirectory (e.g., "1080p/index.m3u8")
    const pathParts = filename.split("/");
    const hasResolutionSubdir =
      pathParts.length >= 2 && VALID_RESOLUTIONS.includes(pathParts[0]);

    if (hasResolutionSubdir) {
      // Path: hls/{videoId}/{resolution}/{file}
      filePath = join(process.cwd(), "uploads", "hls", videoId, filename);
    } else {
      // Path: hls/{videoId}/{file} (master playlist or old format)
      filePath = join(process.cwd(), "uploads", "hls", videoId, filename);
    }
  }

  if (!existsSync(filePath)) {
    return Response.json({ error: "File not found" }, { status: 404 });
  }

  const buffer = readFileSync(filePath);

  const headers: Record<string, string> = {
    "Content-Type": mimeType,
    "Content-Length": String(buffer.length),
    "Access-Control-Allow-Origin": "*",
  };

  if (ext === ".ts") {
    headers["Cache-Control"] = "public, max-age=31536000";
  }

  return new Response(buffer, { headers });
}
