import { NextRequest } from "next/server";
import { writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import formidable from "formidable";
import { Readable } from "stream";
import { IncomingMessage } from "http";
import { db } from "@/db";
import { videos } from "@/db/schema";
import { transcodeToHLS } from "@/lib/ffmpeg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EXT = [".mp4", ".webm", ".mov"];
const MAX_SIZE = 500 * 1024 * 1024; // 500MB

export async function POST(request: NextRequest) {
  const uploadsDir = join(process.cwd(), "uploads", "raw");

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return Response.json(
      { error: "Content-Type must be multipart/form-data" },
      { status: 400 }
    );
  }

  const body = request.body;
  if (!body) {
    return Response.json({ error: "No request body" }, { status: 400 });
  }

  const nodeStream = Readable.fromWeb(
    body as Parameters<typeof Readable.fromWeb>[0]
  );
  const headers: Record<string, string | string[] | undefined> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const req = Object.assign(nodeStream, {
    headers,
    url: request.url,
    method: request.method,
  }) as unknown as IncomingMessage;

  let files: formidable.Files;
  try {
    const form = formidable({
      uploadDir: uploadsDir,
      keepExtensions: true,
      maxFileSize: MAX_SIZE,
    });
    const [, parsedFiles] = await form.parse(req);
    files = parsedFiles;
  } catch (e) {
    console.error("Formidable parse error:", e);
    return Response.json({ error: "Failed to parse form" }, { status: 400 });
  }

  const file = files.file?.[0];
  if (!file) {
    return Response.json(
      { error: "No file uploaded" },
      { status: 400 }
    );
  }

  const originalName = file.originalFilename ?? "unknown";
  const ext = originalName.toLowerCase().slice(originalName.lastIndexOf("."));
  if (!ALLOWED_EXT.includes(ext)) {
    return Response.json(
      { error: "Invalid file type. Allowed: mp4, webm, mov" },
      { status: 400 }
    );
  }

  if (file.size && file.size > MAX_SIZE) {
    return Response.json(
      { error: "File too large. Max 500MB" },
      { status: 400 }
    );
  }

  const videoId = randomUUID();
  const rawPath = join(uploadsDir, `${videoId}${ext}`);

  try {
    const { readFileSync, unlinkSync } = await import("fs");
    const buffer = readFileSync(file.filepath);
    writeFileSync(rawPath, buffer);
    unlinkSync(file.filepath);
  } catch (e) {
    console.error("File save error:", e);
    return Response.json(
      { error: "Failed to save file", details: String(e) },
      { status: 500 }
    );
  }

  try {
    db.insert(videos).values({
      id: videoId,
      originalName,
      status: "processing",
    }).run();
  } catch (e) {
    console.error("Database insert error:", e);
    return Response.json(
      { error: "Failed to create record", details: String(e) },
      { status: 500 }
    );
  }

  setImmediate(() => {
    transcodeToHLS(videoId, rawPath).catch(() => {
      // Error already handled in transcodeToHLS
    });
  });

  return Response.json({
    videoId,
    status: "processing",
  });
}
