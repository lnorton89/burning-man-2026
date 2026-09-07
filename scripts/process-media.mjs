// Reads raw photos/videos from media/, produces web-optimized versions in
// public/media/, and writes src/manifest.json describing the gallery.
//
// Photos: resized + recompressed with sharp, EXIF/GPS metadata stripped.
// Videos: transcoded to 720p H.264 with ffmpeg, metadata stripped; a poster
//         frame is extracted for the grid thumbnail.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const run = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC_DIR = path.join(ROOT, "media");
const OUT_DIR = path.join(ROOT, "public", "media");
const MANIFEST_PATH = path.join(ROOT, "src", "manifest.json");

const THUMB_WIDTH = 480;
const FULL_MAX_EDGE = 2200;

export function parseDateFromName(name) {
  // No anchor: most files start straight with the timestamp, but some
  // (e.g. "IMG_20260907_092224.jpg") carry a prefix in front of it.
  const m = name.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

export async function ensureDirs() {
  for (const sub of ["full", "thumb", "video", "poster"]) {
    await fs.mkdir(path.join(OUT_DIR, sub), { recursive: true });
  }
  await fs.mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
}

export async function processPhoto(file, id) {
  const srcPath = path.join(SRC_DIR, file);
  const fullPath = path.join(OUT_DIR, "full", `${id}.jpg`);
  const thumbPath = path.join(OUT_DIR, "thumb", `${id}.jpg`);

  const image = sharp(srcPath).rotate(); // auto-orient from EXIF, then strip it

  const fullInfo = await image
    .clone()
    .resize({ width: FULL_MAX_EDGE, height: FULL_MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(fullPath);

  await image
    .clone()
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 70, mozjpeg: true })
    .toFile(thumbPath);

  return {
    id,
    type: "photo",
    date: parseDateFromName(file),
    thumb: `media/thumb/${id}.jpg`,
    full: `media/full/${id}.jpg`,
    width: fullInfo.width,
    height: fullInfo.height,
  };
}

async function ffprobe(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height:format=duration",
    "-of", "json",
    file,
  ]);
  const data = JSON.parse(stdout);
  const stream = data.streams?.[0] ?? {};
  return {
    width: stream.width,
    height: stream.height,
    duration: Number(data.format?.duration ?? 0),
  };
}

export async function processVideo(file, id) {
  const srcPath = path.join(SRC_DIR, file);
  const videoPath = path.join(OUT_DIR, "video", `${id}.mp4`);
  const posterPath = path.join(OUT_DIR, "poster", `${id}.jpg`);

  const probe = await ffprobe(srcPath);

  await run("ffmpeg", [
    "-y", "-i", srcPath,
    "-map_metadata", "-1",
    // keep original resolution; just force even dimensions (required by libx264)
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:v", "libx264", "-preset", "fast", "-crf", "28",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    videoPath,
  ]);

  const posterTime = Math.min(1, Math.max(0, probe.duration * 0.1));
  await run("ffmpeg", [
    "-y", "-ss", String(posterTime), "-i", srcPath,
    "-frames:v", "1",
    "-vf", `scale=${THUMB_WIDTH}:-2`,
    "-q:v", "4",
    posterPath,
  ]);

  const outProbe = await ffprobe(videoPath);

  return {
    id,
    type: "video",
    date: parseDateFromName(file),
    poster: `media/poster/${id}.jpg`,
    video: `media/video/${id}.mp4`,
    width: outProbe.width,
    height: outProbe.height,
    duration: probe.duration,
  };
}

async function main() {
  await ensureDirs();
  const files = (await fs.readdir(SRC_DIR))
    .filter((f) => /\.(jpe?g|mp4)$/i.test(f))
    .sort();

  const items = [];
  let i = 0;
  for (const file of files) {
    i += 1;
    const ext = path.extname(file).toLowerCase();
    const id = path.basename(file, path.extname(file));
    process.stdout.write(`[${i}/${files.length}] ${file} ... `);
    const start = Date.now();
    try {
      if (ext === ".jpg" || ext === ".jpeg") {
        items.push(await processPhoto(file, id));
      } else if (ext === ".mp4") {
        items.push(await processVideo(file, id));
      }
      console.log(`ok (${((Date.now() - start) / 1000).toFixed(1)}s)`);
    } catch (err) {
      console.error(`FAILED: ${err.message}`);
    }
  }

  items.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  await fs.writeFile(MANIFEST_PATH, JSON.stringify(items, null, 2));
  console.log(`\nWrote ${items.length} items to ${path.relative(ROOT, MANIFEST_PATH)}`);
}

const isMain = path.resolve(process.argv[1] ?? "") === path.resolve(import.meta.dirname, "process-media.mjs");
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
