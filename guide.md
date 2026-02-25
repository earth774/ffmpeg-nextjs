# คู่มือโปรเจกต์ FFmpeg Next.js - Video Upload & HLS Streaming

## ภาพรวมโปรเจกต์

แอปพลิเคชันสำหรับอัปโหลดวิดีโอ (MP4, WebM, MOV) แล้วแปลงเป็น **HLS Multi-Resolution Streaming** เหมือน YouTube ผู้ใช้สามารถเลือกความละเอียดเองได้ (1080p, 720p, 480p, 360p, 240p) หรือให้ระบบปรับอัตโนมัติตามความเร็วเน็ต

### สถาปัตยกรรมหลัก

```
┌─────────────┐     POST /api/video/upload      ┌──────────────────┐
│  Browser    │ ──────────────────────────────► │  Next.js Server   │
│  (React)    │                                  │  - formidable     │
│             │     Poll /api/video/[id]/status  │  - FFmpeg         │
│             │ ◄──────────────────────────────  │  - Drizzle/SQLite │
│             │                                  └──────────────────┘
│             │     GET /api/stream/[id]/*.m3u8
│             │ ◄──────────────────────────────  (HLS multi-resolution)
└─────────────┘

HLS Structure:
├── index.m3u8 (Master Playlist - adaptive streaming)
├── 1080p/
│   ├── index.m3u8
│   └── seg_001.ts, seg_002.ts...
├── 720p/
│   └── ...
└── 480p, 360p, 240p...
```

### ฟีเจอร์หลัก

- **Multi-Resolution Transcoding** - สร้างหลายความละเอียดจากไฟล์ต้นฉบับ
- **Adaptive Bitrate Streaming** - ปรับความละเอียดอัตโนมัติตามความเร็วเน็ต
- **Quality Selector** - ผู้ใช้เลือกความละเอียดเองได้
- **Audio Fallback System** - 5 ระดับการจัดการ audio ที่มีปัญหา
- **Thumbnail Generation** - สร้าง thumbnail อัตโนมัติ
- **Original File Download** - ดาวน์โหลดไฟล์ต้นฉบับได้

---

## สิ่งที่ต้องติดตั้ง

### 1. โปรแกรมที่จำเป็น

| โปรแกรม | เวอร์ชัน | คำสั่งติดตั้ง |
|---------|----------|---------------|
| **Node.js** | 20+ | [nodejs.org](https://nodejs.org) หรือ `nvm install 20` |
| **FFmpeg** | 5.x+ | `brew install ffmpeg` (macOS) หรือ `apt install ffmpeg` (Ubuntu) |
| **npm** | 10+ | ติดมาพร้อม Node.js |
| **FFprobe** | มาพร้อม FFmpeg | ตรวจสอบ: `ffprobe -version` |

**ตัวเลือก FFmpeg (สำหรับความสามารถเพิ่มเติม):**
```bash
# macOS - ติดตั้ง FFmpeg พร้อมทุก codecs
brew install ffmpeg --with-fdk-aac

# Ubuntu/Debian
sudo apt install ffmpeg libavcodec-extra
```

### 2. ตรวจสอบการติดตั้ง

```bash
node -v    # ควรได้ v20.x หรือสูงกว่า
npm -v     # ควรได้ 10.x หรือสูงกว่า
ffmpeg -v  # ควรแสดงเวอร์ชัน FFmpeg
```

---

## ขั้นตอนการติดตั้งและรันโปรเจกต์

### Step 1: Clone หรือเข้าสู่โฟลเดอร์โปรเจกต์

```bash
cd /path/to/ffmpeg-nextjs
```

### Step 2: ติดตั้ง Dependencies

```bash
npm install
```

**แพ็กเกจหลักที่ติดตั้ง:**

- `next` - React framework
- `ffmpeg-static` - FFmpeg binary สำหรับ Node.js
- `fluent-ffmpeg` - wrapper สำหรับ FFmpeg
- `@ffprobe-installer/ffprobe` - FFprobe สำหรับอ่าน metadata
- `formidable` - parse multipart form (upload)
- `hls.js` - เล่น HLS บนเบราว์เซอร์ (รองรับ adaptive streaming)
- `drizzle-orm` + `better-sqlite3` - ฐานข้อมูล SQLite
- `tailwindcss` - CSS framework

### Step 3: สร้าง Schema ฐานข้อมูล

โปรเจกต์จะสร้างโฟลเดอร์ `uploads/` และไฟล์ `uploads/db.sqlite` อัตโนมัติเมื่อรันครั้งแรก  
ถ้าต้องการ push schema เอง:

```bash
npm run db:push
```

**หมายเหตุ:** ถ้าเปลี่ยน schema (เช่น เพิ่ม columns) ต้องลบ `uploads/db.sqlite` แล้ว push ใหม่

### Step 4: รัน Development Server

```bash
npm run dev
```

เปิดเบราว์เซอร์ที่ [http://localhost:3000](http://localhost:3000)

### Step 5: Build สำหรับ Production

```bash
npm run build
npm start
```

---

## โครงสร้างไฟล์และโค้ดแต่ละส่วน

### โครงสร้างโฟลเดอร์

```
ffmpeg-nextjs/
├── app/
│   ├── api/
│   │   ├── video/
│   │   │   ├── upload/route.ts      # อัปโหลดวิดีโอ
│   │   │   └── [id]/
│   │   │       ├── status/route.ts  # เช็คสถานะ + รายการ resolutions
│   │   │       └── download/route.ts # ดาวน์โหลดไฟล์ต้นฉบับ
│   │   └── stream/
│   │       └── [videoId]/[...slug]/route.ts  # สตรีม HLS ทุก resolution
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── VideoUploader.tsx   # UI อัปโหลด + drag & drop
│   └── VideoPlayer.tsx    # เล่น HLS พร้อม quality selector
├── db/
│   ├── index.ts            # DB connection + สร้างโฟลเดอร์ uploads
│   └── schema.ts           # ตาราง videos (รองรับ multi-resolution)
├── lib/
│   └── ffmpeg.ts           # ฟังก์ชัน transcode หลาย resolution + thumbnail
├── uploads/                # สร้างอัตโนมัติ
│   ├── raw/                # ไฟล์ต้นฉบับ
│   ├── hls/                # HLS segments แยกตาม resolution
│   │   └── {videoId}/
│   │       ├── index.m3u8              # Master playlist
│   │       ├── 1080p/index.m3u8        # 1080p playlist
│   │       ├── 1080p/seg_001.ts...     # 1080p segments
│   │       ├── 720p/...                # 720p files
│   │       ├── 480p/...                # 480p files
│   │       ├── 360p/...                # 360p files
│   │       └── 240p/...                # 240p files
│   ├── thumbs/             # ภาพ thumbnail
│   └── db.sqlite           # SQLite database
├── package.json
├── next.config.ts
├── drizzle.config.ts
└── Dockerfile
```

---

### Step 1: Database Schema (`db/schema.ts`)

```typescript
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
```

---

### Step 2: ตารางฐานข้อมูลและโฟลเดอร์ (`db/index.ts`)

```typescript
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
```

---

### Step 3: FFmpeg Multi-Resolution Transcode (`lib/ffmpeg.ts`)

**ฟังก์ชันหลัก:**
- `getMeta(path)` - อ่าน duration, width, height ด้วย ffprobe
- `transcodeToHLS(videoId, rawPath)` - แปลงวิดีโอเป็น HLS หลาย resolution พร้อมระบบ fallback สำหรับ audio

**ระบบ Multi-Resolution:**
1. ตรวจสอบความละเอียดต้นฉบับ
2. สร้างเฉพาะ resolutions ที่ <= ความละเอียดต้นฉบับ
3. Transcode แยกกันสำหรับแต่ละ resolution
4. สร้าง Master Playlist ที่รวมทุก resolution

**ระบบจัดการ Audio (5 ระดับ Fallback):**

| ระดับ | โหมด | รายละเอียด |
|-------|------|-------------|
| 1 | **normal** | Transcode ปกติด้วย AAC |
| 2 | **copy** | คัดลอก audio stream โดยไม่ re-encode |
| 3 | **filtered** | ใช้ audio filters (pan, aresample) สำหรับ audio ที่มีปัญหา |
| 4 | **aggressive** | ใช้ filter_complex + error recovery ขั้นสูง |
| 5 | **none** | ไม่มี audio (สุดท้าย) |

**พารามิเตอร์ HLS แต่ละ Resolution:**

| Resolution | Video Bitrate | Audio Bitrate | Scale Filter |
|------------|---------------|---------------|--------------|
| 1080p | 5000k | 192k | scale=1920:1080 |
| 720p | 2500k | 128k | scale=1280:720 |
| 480p | 1000k | 128k | scale=854:480 |
| 360p | 800k | 96k | scale=640:360 |
| 240p | 500k | 64k | scale=426:240 |

**Master Playlist ตัวอย่าง:**
```m3u8
#EXTM3U
#EXT-X-VERSION:3

#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080
1080p/index.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=2628000,RESOLUTION=1280x720
720p/index.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=1128000,RESOLUTION=854x480
480p/index.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=896000,RESOLUTION=640x360
360p/index.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=564000,RESOLUTION=426x240
240p/index.m3u8
```

**ปัญหา Audio ที่รองรับ:**
- Audio ที่มีหลายช่องสัญญาณ (multi-channel)
- AAC decoder errors
- Timestamp/PTS issues
- Corrupted audio packets

---

### Step 4: API Upload (`app/api/video/upload/route.ts`)

**Flow:**
1. รับไฟล์ผ่าน `formidable` (multipart/form-data)
2. ตรวจสอบนามสกุล (.mp4, .webm, .mov) และขนาด (max 500MB)
3. บันทึกไฟล์ไปที่ `uploads/raw/{videoId}.{ext}`
4. สร้าง record ใน DB สถานะ `processing`
5. เรียก `transcodeToHLS()` แบบ async (ไม่ block response) - สร้างหลาย resolution
6. คืน `{ videoId, status: "processing" }`

---

### Step 5: API Status (`app/api/video/[id]/status/route.ts`)

**Response:**
```json
{
  "videoId": "uuid",
  "status": "ready",
  "hlsUrl": "/api/stream/{id}/index.m3u8",
  "thumbUrl": "/api/stream/{id}/thumb.jpg",
  "downloadUrl": "/api/video/{id}/download",
  "duration": 120.5,
  "width": 1920,
  "height": 1080,
  "resolutions": [
    {
      "name": "1080p",
      "width": 1920,
      "height": 1080,
      "hlsUrl": "/api/stream/{id}/1080p/index.m3u8"
    },
    {
      "name": "720p",
      "width": 1280,
      "height": 720,
      "hlsUrl": "/api/stream/{id}/720p/index.m3u8"
    },
    {
      "name": "480p",
      "width": 854,
      "height": 480,
      "hlsUrl": "/api/stream/{id}/480p/index.m3u8"
    }
  ]
}
```

---

### Step 6: API Stream (`app/api/stream/[videoId]/[...slug]/route.ts`)

ส่งไฟล์ HLS และ thumbnail:
- `/api/stream/{videoId}/index.m3u8` - Master playlist
- `/api/stream/{videoId}/1080p/index.m3u8` - 1080p playlist
- `/api/stream/{videoId}/1080p/seg_001.ts` - 1080p segments
- `/api/stream/{videoId}/720p/...` - 720p files
- `/api/stream/{videoId}/thumb.jpg` - thumbnail

**MIME types:** `application/x-mpegURL`, `video/MP2T`, `image/jpeg`

---

### Step 7: API Download (`app/api/video/[id]/download/route.ts`)

ส่งไฟล์วิดีโอต้นฉบับจาก `uploads/raw/` พร้อม `Content-Disposition: attachment`

---

### Step 8: Frontend - VideoUploader (`components/VideoUploader.tsx`)

**State:** `idle` | `uploading` | `processing` | `ready` | `error`

**Flow:**
1. Drag & drop หรือคลิกเลือกไฟล์
2. POST ไปที่ `/api/video/upload` ด้วย XHR (เพื่อแสดง progress)
3. Poll `/api/video/{id}/status` ทุก 3 วินาที
4. เมื่อ `status === "ready"` แสดง VideoPlayer พร้อมข้อมูล resolutions

---

### Step 9: Frontend - VideoPlayer (`components/VideoPlayer.tsx`)

**Flow:**
1. ใช้ `hls.js` โหลด Master Playlist ด้วย absolute URLs
2. hls.js จะเลือก resolution อัตโนมัติตาม bandwidth (Adaptive Bitrate Streaming)
3. ผู้ใช้สามารถกดปุ่ม Quality Selector เพื่อเลือก resolution เองได้
4. แสดง video element ภายใน container ปกติ
5. รองรับ native video errors พร้อมแสดง error messages

**Quality Selector UI:**
- ปุ่มแสดง resolution ปัจจุบัน (เช่น "1080p", "Auto")
- Dropdown menu เลือก resolution: Auto, 1080p, 720p, 480p, 360p, 240p
- สไตล์: ดำโปร่ง + ขาว

**การตั้งค่า hls.js:**
```typescript
{
  debug: false,
  enableWorker: true,
  capLevelToPlayerSize: true,  // ปรับตามขนาด player
  smoothSwitching: true,       // เปลี่ยน resolution นุ่มนวล
}
```

---

### Step 10: หน้าแรก (`app/page.tsx`)

```tsx
import { VideoUploader } from "@/components/VideoUploader";

export default function Home() {
  return (
    <main className="min-h-screen p-8 md:p-16">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Video Upload & HLS Streaming
        </h1>
        <p className="text-gray-600 mb-8">
          Upload a video to transcode to multi-resolution HLS and stream in the browser.
        </p>
        <VideoUploader />
      </div>
    </main>
  );
}
```

---

## รันด้วย Docker

```bash
docker build -t ffmpeg-nextjs .
docker run -p 3000:3000 ffmpeg-nextjs
```

**Dockerfile:** ใช้ `node:22-bookworm-slim` + ติดตั้ง FFmpeg จาก apt

---

## สรุปคำสั่งที่ใช้บ่อย

| คำสั่ง | รายละเอียด |
|--------|-------------|
| `npm install` | ติดตั้ง dependencies |
| `npm run dev` | รัน development server |
| `npm run build` | Build สำหรับ production |
| `npm start` | รัน production server |
| `npm run db:push` | Push schema ไปยัง SQLite |
| `npm run lint` | ตรวจสอบ lint |

---

## Troubleshooting

### ปัญหา: 500 Internal Server Error (Database)

**สาเหตุ:** Database schema เก่าไม่ตรงกับ code

**แก้ไข:**
```bash
# ลบ database เก่าแล้วสร้างใหม่
rm uploads/db.sqlite
npm run db:push
# รีสตาร์ท npm run dev
```

### ปัญหา: Audio หายหลังอัปโหลดไฟล์ใหญ่

**สาเหตุ:** FFmpeg พบ errors จาก audio stream (เช่น multi-channel audio, corrupted AAC, timestamp issues)

**การแก้ไข (อัตโนมัติในโค้ด):**
1. ตรวจสอบ logs ใน terminal ระหว่าง transcoding
2. ระบบจะลองแก้ไขเองตามลำดับ: normal → copy → filtered → aggressive
3. ถ้าทั้งหมดล้มเหลว จะ transcode แค่ video โดยไม่มี audio

**คำแนะนำสำหรับไฟล์ที่มีปัญหา:**
```bash
# ตรวจสอบ audio streams ในไฟล์
ffprobe -v error -show_entries stream=codec_name,channels -of json input.mp4

# Convert audio ก่อนอัปโหลด (ถ้าจำเป็น)
ffmpeg -i input.mp4 -c:v copy -c:a aac -ac 2 -ar 48000 output.mp4
```

### ปัญหา: Video ไม่เล่นหรือค้าง

**ตรวจสอบ:**
1. ตรวจสอบว่า HLS files ถูกสร้างใน `uploads/hls/{videoId}/`
2. ตรวจสอบว่า master playlist (`index.m3u8`) มีทุก resolution
3. ดู browser console สำหรับ error messages
4. ตรวจสอบ network tab ว่า .m3u8 และ .ts files โหลดสำเร็จ

**คำสั่งตรวจสอบ:**
```bash
# ดูโครงสร้าง HLS files
ls -la uploads/hls/{videoId}/

# ดูเนื้อหา master playlist
cat uploads/hls/{videoId}/index.m3u8
```

### ปัญหา: Transcoding ช้ามาก

**สาเหตุ:** สร้างหลาย resolution ใช้เวลานาน

**แก้ไข:**
- ใช้ hardware acceleration (macOS: VideoToolbox, Linux: VAAPI)
- ลดจำนวน resolutions ใน `db/schema.ts` (RESOLUTIONS array)
- ลดค่า `-crf` สำหรับ software encoding

---

## หมายเหตุ

- **FFmpeg ต้องติดตั้งบนเครื่อง** หรือใช้ใน Docker image ที่มี FFmpeg
- ไฟล์อัปโหลดเก็บใน `uploads/` (ควรเพิ่มใน `.gitignore`)
- SQLite เก็บใน `uploads/db.sqlite`
- รองรับวิดีโอสูงสุด 500MB
- Transcoding หลาย resolution ใช้เวลาและพื้นที่มากขึ้น (ประมาณ 3-5 เท่าของไฟล์ต้นฉบับ)

### .gitignore ที่แนะนำ

```gitignore
# dependencies
node_modules/

# uploads & generated files
uploads/
*.mp4
*.webm
*.mov
*.ts
*.m3u8

# build
.next/
out/
dist/

# debug
*.log
.DS_Store

# env files
.env
.env.local
```
