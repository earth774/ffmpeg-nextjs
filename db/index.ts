import { mkdirSync } from "fs";
import { join } from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const uploadsDir = join(process.cwd(), "uploads");
const rawDir = join(uploadsDir, "raw");
const hlsDir = join(uploadsDir, "hls");
const thumbsDir = join(uploadsDir, "thumbs");

mkdirSync(rawDir, { recursive: true });
mkdirSync(hlsDir, { recursive: true });
mkdirSync(thumbsDir, { recursive: true });

const dbPath = join(uploadsDir, "db.sqlite");
const sqlite = new Database(dbPath);
export const db = drizzle(sqlite, { schema });
