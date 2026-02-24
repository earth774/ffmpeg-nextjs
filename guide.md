# คู่มือโปรเจกต์ FFmpeg Next.js - Video Upload & HLS Streaming

## ภาพรวมโปรเจกต์

แอปพลิเคชันสำหรับอัปโหลดวิดีโอ (MP4, WebM, MOV) แล้วแปลงเป็น HLS (HTTP Live Streaming) เพื่อสตรีมในเบราว์เซอร์ รองรับการดาวน์โหลดไฟล์ต้นฉบับ และสร้าง thumbnail อัตโนมัติ

### สถาปัตยกรรมหลัก

```
┌─────────────┐     POST /api/video/upload      ┌──────────────────┐
│  Browser    │ ──────────────────────────────► │  Next.js Server   │
│  (React)    │                                  │  - formidable     │
│             │     Poll /api/video/[id]/status  │  - FFmpeg         │
│             │ ◄──────────────────────────────  │  - Drizzle/SQLite │
│             │                                  └──────────────────┘
│             │     GET /api/stream/[id]/*.m3u8
│             │ ◄──────────────────────────────  (HLS segments, thumb)
└─────────────┘
```

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
- `hls.js` - เล่น HLS บนเบราว์เซอร์
- `drizzle-orm` + `better-sqlite3` - ฐานข้อมูล SQLite
- `tailwindcss` - CSS framework

### Step 3: สร้าง Schema ฐานข้อมูล (ถ้ายังไม่มี)

โปรเจกต์จะสร้างโฟลเดอร์ `uploads/` และไฟล์ `uploads/db.sqlite` อัตโนมัติเมื่อรันครั้งแรก  
ถ้าต้องการ push schema เอง:

```bash
npm run db:push
```

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
│   │   │       ├── status/route.ts  # เช็คสถานะ transcoding
│   │   │       └── download/route.ts # ดาวน์โหลดไฟล์ต้นฉบับ
│   │   └── stream/
│   │       └── [videoId]/[...slug]/route.ts  # ส่ง HLS + thumbnail
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── VideoUploader.tsx   # UI อัปโหลด + drag & drop
│   └── VideoPlayer.tsx    # เล่น HLS ด้วย hls.js
├── db/
│   ├── index.ts            # DB connection + สร้างโฟลเดอร์ uploads
│   └── schema.ts           # ตาราง videos
├── lib/
│   └── ffmpeg.ts           # ฟังก์ชัน transcode + thumbnail
├── uploads/                # สร้างอัตโนมัติ
│   ├── raw/                # ไฟล์ต้นฉบับ
│   ├── hls/                # HLS segments (.m3u8, .ts)
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
  hlsPath: text("hls_path"),
  thumbPath: text("thumb_path"),
  duration: real("duration"),
  width: integer("width"),
  height: integer("height"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(unixepoch())`
  ),
});
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

### Step 3: FFmpeg Transcode (`lib/ffmpeg.ts`)

**ฟังก์ชันหลัก:**
- `getMeta(path)` - อ่าน duration, width, height ด้วย ffprobe
- `transcodeToHLS(videoId, rawPath)` - แปลงวิดีโอเป็น HLS พร้อมระบบ fallback สำหรับ audio ที่มีปัญหา

**ระบบจัดการ Audio (5 ระดับ Fallback):**

| ระดับ | โหมด | รายละเอียด |
|-------|------|-------------|
| 1 | **normal** | Transcode ปกติด้วย AAC |
| 2 | **copy** | คัดลอก audio stream โดยไม่ re-encode |
| 3 | **filtered** | ใช้ audio filters (pan, aresample) สำหรับ audio ที่มีปัญหา |
| 4 | **aggressive** | ใช้ filter_complex + error recovery ขั้นสูง |
| 5 | **none** | ไม่มี audio (สุดท้าย) |

**พารามิเตอร์ HLS:**
- **Video:** `libx264` หรือ `h264_videotoolbox` (macOS hardware acceleration)
- **Audio:** `aac -b:a 128k -ac 2 -ar 48000`
- **Segment:** `-hls_time 10` (10 วินาที)
- **Quality:** `-crf 28 -preset superfast` (สำหรับ software encoding)

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
5. เรียก `transcodeToHLS()` แบบ async (ไม่ block response)
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
  "height": 1080
}
```

---

### Step 6: API Stream (`app/api/stream/[videoId]/[...slug]/route.ts`)

ส่งไฟล์ HLS และ thumbnail ด้วย buffered response:
- `/api/stream/{videoId}/index.m3u8` - manifest
- `/api/stream/{videoId}/seg_001.ts` - segments
- `/api/stream/{videoId}/thumb.jpg` - thumbnail

**MIME types:** `application/x-mpegURL`, `video/MP2T`, `image/jpeg`

**หมายเหตุ:** ใช้ `readFileSync` เพื่อส่งไฟล์เป็น complete buffer แทน streaming เพื่อความน่าเชื่อถือกับไฟล์ขนาดเล็ก

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
4. เมื่อ `status === "ready"` แสดง VideoPlayer

---

### Step 9: Frontend - VideoPlayer (`components/VideoPlayer.tsx`)

**Flow:**
1. ใช้ `hls.js` โหลด HLS stream ด้วย absolute URLs
2. ถ้าเบราว์เซอร์ไม่รองรับ HLS (Safari) ใช้ `video.src` โดยตรง
3. แสดง video element ภายใน container ปกติ (ไม่ใช้ `createPortal`)
4. รองรับ native video errors พร้อมแสดง error messages
5. แสดงปุ่มดาวน์โหลดเมื่อมี `downloadUrl`

**การตั้งค่า hls.js:**
- `debug: false`
- `enableWorker: true`
- Preload: `auto`

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
          Upload a video to transcode to HLS and stream in the browser.
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

### ปัญหา: Video ไม่เล่นในเบราว์เซอร์

**ตรวจสอบ:**
1. ตรวจสอบว่า HLS files ถูกสร้างใน `uploads/hls/{videoId}/`
2. ดู browser console สำหรับ error messages
3. ตรวจสอบ network tab ว่า .m3u8 และ .ts files โหลดสำเร็จ

### ปัญหา: 500 Internal Server Error

**สาเหตุที่เป็นไปได้:**
- FFmpeg ไม่ได้ติดตั้งหรือไม่สามารถเข้าถึงได้
- ไฟล์อัปโหลดเกิน 500MB
- Permission issues กับ `uploads/` folder

---

## หมายเหตุ

- **FFmpeg ต้องติดตั้งบนเครื่อง** หรือใช้ใน Docker image ที่มี FFmpeg
- ไฟล์อัปโหลดเก็บใน `uploads/` (ควรเพิ่มใน `.gitignore`)
- SQLite เก็บใน `uploads/db.sqlite`
- รองรับวิดีโอสูงสุด 500MB

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
