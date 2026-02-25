import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { videos, RESOLUTIONS } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Resolution info structure
interface ResolutionInfo {
  name: string;
  width: number;
  height: number;
  hlsUrl: string | null;
}

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

    // Master playlist URL (adaptive streaming)
    const hlsUrl =
      video.hlsPath != null ? `/api/stream/${videoId}/index.m3u8` : null;
    const thumbUrl =
      video.thumbPath != null ? `/api/stream/${videoId}/thumb.jpg` : null;
    const downloadUrl = `/api/video/${videoId}/download`;

    // Build available resolutions array
    const availableResolutions: ResolutionInfo[] = [];

    for (const res of RESOLUTIONS) {
      const hlsPathKey = `hlsPath${res.name}` as keyof typeof video;
      const resolutionPath = video[hlsPathKey] as string | null;

      if (resolutionPath) {
        availableResolutions.push({
          name: res.name,
          width: res.width,
          height: res.height,
          hlsUrl: `/api/stream/${videoId}/${res.name}/index.m3u8`,
        });
      }
    }

    // Sort by resolution quality (height descending)
    availableResolutions.sort((a, b) => b.height - a.height);

    return Response.json({
      videoId: video.id,
      status: video.status,
      hlsUrl, // Master playlist for adaptive streaming
      thumbUrl,
      downloadUrl,
      duration: video.duration ?? null,
      width: video.width ?? null,
      height: video.height ?? null,
      resolutions: availableResolutions, // Individual resolutions
    });
  } catch {
    return Response.json({ error: "Database error" }, { status: 500 });
  }
}
