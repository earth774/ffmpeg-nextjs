import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const videos = sqliteTable("videos", {
  id: text("id").primaryKey(),
  originalName: text("original_name").notNull(),
  status: text("status").default("processing"), // processing | ready | error
  // Master playlist path (hls/{videoId}/index.m3u8)
  hlsPath: text("hls_path"),
  // Individual resolution paths (for backward compatibility and direct access)
  hlsPath1080p: text("hls_path_1080p"),
  hlsPath720p: text("hls_path_720p"),
  hlsPath480p: text("hls_path_480p"),
  hlsPath360p: text("hls_path_360p"),
  hlsPath240p: text("hls_path_240p"),
  thumbPath: text("thumb_path"),
  duration: real("duration"),
  width: integer("width"),
  height: integer("height"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(unixepoch())`
  ),
});

export type Video = typeof videos.$inferSelect;
export type NewVideo = typeof videos.$inferInsert;

// Available resolutions for transcoding
export const RESOLUTIONS = [
  { name: "1080p", width: 1920, height: 1080, videoBitrate: "5000k", audioBitrate: "192k" },
  { name: "720p", width: 1280, height: 720, videoBitrate: "2500k", audioBitrate: "128k" },
  { name: "480p", width: 854, height: 480, videoBitrate: "1000k", audioBitrate: "128k" },
  { name: "360p", width: 640, height: 360, videoBitrate: "800k", audioBitrate: "96k" },
  { name: "240p", width: 426, height: 240, videoBitrate: "500k", audioBitrate: "64k" },
] as const;

export type Resolution = typeof RESOLUTIONS[number];
