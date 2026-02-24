import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    const hlsUrl =
      video.hlsPath != null ? `/api/stream/${videoId}/index.m3u8` : null;
    const thumbUrl =
      video.thumbPath != null ? `/api/stream/${videoId}/thumb.jpg` : null;
    const downloadUrl = `/api/video/${videoId}/download`;

    return Response.json({
      videoId: video.id,
      status: video.status,
      hlsUrl,
      thumbUrl,
      downloadUrl,
      duration: video.duration ?? null,
      width: video.width ?? null,
      height: video.height ?? null,
    });
  } catch {
    return Response.json({ error: "Database error" }, { status: 500 });
  }
}
