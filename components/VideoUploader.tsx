"use client";

import { useCallback, useState } from "react";
import { VideoPlayer } from "./VideoPlayer";

const ALLOWED_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const MAX_SIZE = 500 * 1024 * 1024; // 500MB

type UploadState =
  | { phase: "idle" }
  | { phase: "uploading"; progress: number }
  | { phase: "processing" }
  | {
      phase: "ready";
      videoId: string;
      hlsUrl: string;
      thumbUrl: string | null;
      downloadUrl: string;
    }
  | { phase: "error"; message: string };

export function VideoUploader() {
  const [state, setState] = useState<UploadState>({ phase: "idle" });
  const [dragOver, setDragOver] = useState(false);

  const validateFile = useCallback((file: File): string | null => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return "Invalid file type. Allowed: mp4, webm, mov";
    }
    if (file.size > MAX_SIZE) {
      return "File too large. Max 500MB";
    }
    return null;
  }, []);

  const uploadFile = useCallback(
    (file: File) => {
      const err = validateFile(file);
      if (err) {
        setState({ phase: "error", message: err });
        return;
      }

      setState({ phase: "uploading", progress: 0 });

      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append("file", file);

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setState({ phase: "uploading", progress: pct });
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const data = JSON.parse(xhr.responseText) as {
            videoId: string;
            status: string;
          };
          setState({ phase: "processing" });
          pollStatus(data.videoId);
        } else {
          let msg = "Upload failed";
          try {
            const body = JSON.parse(xhr.responseText);
            if (body.error) msg = body.error;
          } catch {
            // ignore
          }
          setState({ phase: "error", message: msg });
        }
      });

      xhr.addEventListener("error", () => {
        setState({ phase: "error", message: "Network error" });
      });

      xhr.open("POST", "/api/video/upload");
      xhr.send(formData);
    },
    [validateFile]
  );

  const pollStatus = useCallback((videoId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/video/${videoId}/status`);
        const data = (await res.json()) as {
          status: string;
          hlsUrl: string | null;
          thumbUrl: string | null;
          downloadUrl?: string;
        };

        if (data.status === "ready" && data.hlsUrl) {
          clearInterval(interval);
          setState({
            phase: "ready",
            videoId,
            hlsUrl: data.hlsUrl,
            thumbUrl: data.thumbUrl,
            downloadUrl: data.downloadUrl ?? `/api/video/${videoId}/download`,
          });
        } else if (data.status === "error") {
          clearInterval(interval);
          setState({ phase: "error", message: "Transcoding failed" });
        }
      } catch {
        clearInterval(interval);
        setState({ phase: "error", message: "Failed to fetch status" });
      }
    }, 3000);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) uploadFile(file);
    },
    [uploadFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) uploadFile(file);
    },
    [uploadFile]
  );

  const reset = useCallback(() => {
    setState({ phase: "idle" });
  }, []);

  return (
    <div className="space-y-6">
      {state.phase === "idle" && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`
            border-2 border-dashed rounded-xl p-12 text-center cursor-pointer
            transition-colors
            ${dragOver ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-gray-400"}
          `}
          onClick={() => document.getElementById("file-input")?.click()}
        >
          <input
            id="file-input"
            type="file"
            accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
            className="hidden"
            onChange={handleChange}
          />
          <p className="text-gray-600 text-lg">
            Drag & drop a video here, or click to select
          </p>
          <p className="text-gray-400 text-sm mt-2">
            MP4, WebM, MOV — max 500MB
          </p>
        </div>
      )}

      {state.phase === "uploading" && (
        <div className="rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-700 mb-4">Uploading... {state.progress}%</p>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: `${state.progress}%` }}
            />
          </div>
        </div>
      )}

      {state.phase === "processing" && (
        <div className="rounded-xl border border-gray-200 p-8 text-center">
          <div className="animate-spin w-10 h-10 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-700">Processing video...</p>
          <p className="text-gray-400 text-sm mt-1">
            Transcoding to HLS. This may take a minute.
          </p>
        </div>
      )}

      {state.phase === "ready" && (
        <div className="space-y-4">
          <VideoPlayer
            hlsUrl={state.hlsUrl}
            thumbUrl={state.thumbUrl}
            downloadUrl={state.downloadUrl}
          />
          <button
            onClick={reset}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Upload another
          </button>
        </div>
      )}

      {state.phase === "error" && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-700 font-medium">{state.message}</p>
          <button
            onClick={reset}
            className="mt-4 px-4 py-2 text-sm bg-red-100 text-red-800 rounded-lg hover:bg-red-200"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
