"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface ResolutionInfo {
  name: string;
  width: number;
  height: number;
  hlsUrl: string;
}

interface VideoPlayerProps {
  hlsUrl: string; // Master playlist URL (adaptive streaming)
  thumbUrl: string | null;
  downloadUrl?: string;
  resolutions?: ResolutionInfo[]; // Individual resolution options
}

function toAbsoluteUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${typeof window !== "undefined" ? window.location.origin : ""}${url.startsWith("/") ? url : `/${url}`}`;
}

export function VideoPlayer({ hlsUrl, thumbUrl, downloadUrl, resolutions }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<{
    destroy: () => void;
    levels?: Array<{ height: number; width: number; bitrate?: number }>;
    currentLevel: number;
    loadSource: (url: string) => void;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [currentQuality, setCurrentQuality] = useState<string>("auto");
  const [availableQualities, setAvailableQualities] = useState<
    Array<{ name: string; height: number; level: number }>
  >([]);
  const [showQualityMenu, setShowQualityMenu] = useState(false);

  // Quality selection handler
  const selectQuality = useCallback(
    (quality: string) => {
      const hls = hlsRef.current;
      if (!hls) return;

      setCurrentQuality(quality);
      setShowQualityMenu(false);

      if (quality === "auto") {
        hls.currentLevel = -1; // -1 = auto quality selection
      } else {
        const qualityNum = parseInt(quality, 10);
        hls.currentLevel = qualityNum;
      }
    },
    [setCurrentQuality, setShowQualityMenu]
  );

  // Initialize HLS player
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl) return;

    setError(null);
    setIsReady(false);
    const absoluteHlsUrl = toAbsoluteUrl(hlsUrl);

    const initHls = async () => {
      const Hls = (await import("hls.js")).default;

      if (Hls.isSupported()) {
        const hlsInstance = new Hls({
          debug: false,
          enableWorker: true,
          // Enable adaptive bitrate switching
          capLevelToPlayerSize: true,
          smoothSwitching: true,
        });

        hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            const msg = data.error?.message ?? data.details ?? "โหลดวิดีโอไม่สำเร็จ";
            setError(msg);
          }
        });

        hlsInstance.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
          setError(null);
          setIsReady(true);

          // Build quality levels from manifest
          const levels = data.levels.map((level, index) => ({
            name: `${level.height}p`,
            height: level.height,
            level: index,
          }));

          setAvailableQualities(levels);
        });

        hlsInstance.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
          const level = data.level;
          if (level === -1) {
            setCurrentQuality("auto");
          } else {
            setCurrentQuality(String(level));
          }
        });

        hlsInstance.loadSource(absoluteHlsUrl);
        hlsInstance.attachMedia(video);
        hlsRef.current = hlsInstance;
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = absoluteHlsUrl;
        setIsReady(true);
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

  // Get current quality label
  const getQualityLabel = () => {
    if (currentQuality === "auto") return "Auto";
    const level = parseInt(currentQuality, 10);
    const quality = availableQualities.find((q) => q.level === level);
    return quality ? `${quality.height}p` : "Auto";
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl overflow-hidden bg-black relative">
        {error && (
          <div className="p-4 bg-red-900/50 text-red-200 text-sm">{error}</div>
        )}
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

        {/* Quality Selector Button */}
        {isReady && availableQualities.length > 1 && (
          <div className="absolute top-4 right-4 z-10">
            <div className="relative">
              <button
                onClick={() => setShowQualityMenu(!showQualityMenu)}
                className="flex items-center gap-2 px-3 py-1.5 bg-black/70 hover:bg-black/80 text-white text-sm rounded-lg backdrop-blur-sm transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
                {getQualityLabel()}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`transition-transform ${showQualityMenu ? "rotate-180" : ""}`}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {/* Quality Menu Dropdown */}
              {showQualityMenu && (
                <>
                  {/* Backdrop click to close */}
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowQualityMenu(false)}
                  />
                  <div className="absolute top-full right-0 mt-2 bg-black/90 backdrop-blur-sm rounded-lg overflow-hidden min-w-[140px] z-50 shadow-xl border border-white/10">
                    <div className="py-1">
                      {/* Auto option */}
                      <button
                        onClick={() => selectQuality("auto")}
                        className={`w-full px-4 py-2 text-left text-sm text-white hover:bg-white/10 transition-colors flex items-center justify-between ${
                          currentQuality === "auto" ? "bg-white/20" : ""
                        }`}
                      >
                        <span>Auto</span>
                        {currentQuality === "auto" && (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>

                      <div className="border-t border-white/10 my-1" />

                      {/* Resolution options - sorted from highest to lowest */}
                      {[...availableQualities]
                        .sort((a, b) => b.height - a.height)
                        .map((quality) => (
                          <button
                            key={quality.level}
                            onClick={() => selectQuality(String(quality.level))}
                            className={`w-full px-4 py-2 text-left text-sm text-white hover:bg-white/10 transition-colors flex items-center justify-between ${
                              currentQuality === String(quality.level) ? "bg-white/20" : ""
                            }`}
                          >
                            <span>{quality.name}</span>
                            {currentQuality === String(quality.level) && (
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </button>
                        ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
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
