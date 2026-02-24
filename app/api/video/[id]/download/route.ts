import { NextRequest } from "next/server";
import { createReadStream, existsSync } from "fs";
import { join } from "path";
import { Readable } from "stream";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EXT = [".mp4", ".webm", ".mov"];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: videoId } = await params;

  try {
    const rows = db.select().from(videos).where(eq(videos.id, videoId)).all();
    const video = rows[0];

    if (!video) {
      return Response.json({ error: "Video not found" }, { status: 404 });
    }

    const ext = video.originalName
      .toLowerCase()
      .slice(video.originalName.lastIndexOf("."));
    const safeExt = ALLOWED_EXT.includes(ext) ? ext : ".mp4";
    const rawPath = join(process.cwd(), "uploads", "raw", `${videoId}${safeExt}`);

    if (!existsSync(rawPath)) {
      return Response.json({ error: "File not found" }, { status: 404 });
    }

    const nodeStream = createReadStream(rawPath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    const filename = video.originalName.replace(/[^\w\s.-]/gi, "_");

    return new Response(webStream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch {
    return Response.json({ error: "Download failed" }, { status: 500 });
  }
}
