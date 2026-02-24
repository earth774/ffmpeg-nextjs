import { VideoUploader } from "@/components/VideoUploader";

export default function Home() {
  return (
    <main className="min-h-screen p-8 md:p-16">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Video Upload & HLS Streaming
        </h1>
        <p className="text-gray-600 mb-8">
          Upload a video to transcode to HLS and stream in the browser.
        </p>
        <VideoUploader />
      </div>
    </main>
  );
}
