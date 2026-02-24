"use client";

import { useEffect, useRef, useState } from "react";

interface VideoPlayerProps {
  hlsUrl: string;
  thumbUrl: string | null;
  downloadUrl?: string;
}

function toAbsoluteUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${typeof window !== "undefined" ? window.location.origin : ""}${url.startsWith("/") ? url : `/${url}`}`;
}

export function VideoPlayer({ hlsUrl, thumbUrl, downloadUrl }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl) return;

    setError(null);
    const absoluteHlsUrl = toAbsoluteUrl(hlsUrl);

    const initHls = async () => {
      const Hls = (await import("hls.js")).default;

      if (Hls.isSupported()) {
        const hlsInstance = new Hls({
          debug: false,
          enableWorker: true,
        });
        hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            const msg = data.error?.message ?? data.details ?? "โหลดวิดีโอไม่สำเร็จ";
            setError(msg);
          }
        });
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => setError(null));
        hlsInstance.loadSource(absoluteHlsUrl);
        hlsInstance.attachMedia(video);
        hlsRef.current = hlsInstance;
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = absoluteHlsUrl;
      } else {
        setError("เบราว์เซอร์ไม่รองรับ HLS");
      }
    };

    initHls();

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (video.src) video.removeAttribute("src");
    };
  }, [hlsUrl]);

  const videoEl = (
    <video
      ref={videoRef}
      className="w-full aspect-video bg-black"
      controls
      autoPlay={false}
      playsInline
      preload="auto"
      poster={thumbUrl ?? undefined}
      onError={(e) => {
        const target = e.currentTarget;
        const err = target.error;
        if (err) setError(err.message || "เกิดข้อผิดพลาดในการเล่นวิดีโอ");
      }}
    />
  );

  return (
    <div className="space-y-3">
      <div className="rounded-xl overflow-hidden bg-black">
        {error && (
          <div className="p-4 bg-red-900/50 text-red-200 text-sm">{error}</div>
        )}
        {videoEl}
      </div>
      {downloadUrl && (
        <a
          href={downloadUrl}
          download
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          ดาวน์โหลดวิดีโอ
        </a>
      )}
    </div>
  );
}
