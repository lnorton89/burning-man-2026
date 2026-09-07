// Re-encodes just the videos (at the CRF configured in process-media.mjs)
// without re-touching already-processed photos.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const SRC_DIR = path.join(ROOT, "media");
const OUT_DIR = path.join(ROOT, "public", "media");
const THUMB_WIDTH = 480;

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
  return { width: stream.width, height: stream.height, duration: Number(data.format?.duration ?? 0) };
}

async function main() {
  const files = (await fs.readdir(SRC_DIR)).filter((f) => /\.mp4$/i.test(f)).sort();
  let i = 0;
  for (const file of files) {
    i += 1;
    const id = path.basename(file, ".mp4");
    const srcPath = path.join(SRC_DIR, file);
    const videoPath = path.join(OUT_DIR, "video", `${id}.mp4`);
    const posterPath = path.join(OUT_DIR, "poster", `${id}.jpg`);
    process.stdout.write(`[${i}/${files.length}] ${file} ... `);
    const start = Date.now();

    const probe = await ffprobe(srcPath);
    await run("ffmpeg", [
      "-y", "-i", srcPath,
      "-map_metadata", "-1",
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

    console.log(`ok (${((Date.now() - start) / 1000).toFixed(1)}s)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
