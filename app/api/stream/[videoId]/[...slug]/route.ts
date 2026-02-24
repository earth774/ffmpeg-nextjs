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
    filePath = join(process.cwd(), "uploads", "hls", videoId, filename);
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
