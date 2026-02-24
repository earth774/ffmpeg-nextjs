import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@ffprobe-installer/ffprobe",
    "@ffprobe-installer/darwin-arm64",
    "@ffprobe-installer/darwin-x64",
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb",
    },
  },
};

export default nextConfig;
