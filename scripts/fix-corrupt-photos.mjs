// One-off fixup: 4 source JPEGs (panoramas) failed sharp's strict JPEG
// decoder ("Invalid SOS parameters for sequential JPEG"). They were already
// re-decoded via ffmpeg into public/media/full/<id>.jpg at full resolution
// (see the ad-hoc ffmpeg command that produced them) - this script resizes
// those into proper full/thumb pairs and returns the manifest entries to
// splice into src/manifest.json.

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "media");
const THUMB_WIDTH = 480;
const FULL_MAX_EDGE = 2200;

const ids = ["20260826_110945", "20260826_111005", "20260831_222727", "20260901_003738"];

function parseDateFromId(id) {
  const m = id.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

async function main() {
  const entries = [];
  for (const id of ids) {
    const fullPath = path.join(OUT_DIR, "full", `${id}.jpg`);
    const thumbPath = path.join(OUT_DIR, "thumb", `${id}.jpg`);
    const buf = await fs.readFile(fullPath);

    const info = await sharp(buf)
      .resize({ width: FULL_MAX_EDGE, height: FULL_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(fullPath + ".tmp");
    await fs.rename(fullPath + ".tmp", fullPath);

    await sharp(buf)
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 70, mozjpeg: true })
      .toFile(thumbPath);

    entries.push({
      id,
      type: "photo",
      date: parseDateFromId(id),
      thumb: `media/thumb/${id}.jpg`,
      full: `media/full/${id}.jpg`,
      width: info.width,
      height: info.height,
    });
    console.log(`fixed ${id}: ${info.width}x${info.height}`);
  }

  const manifestPath = path.join(ROOT, "src", "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const merged = [...manifest, ...entries].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  await fs.writeFile(manifestPath, JSON.stringify(merged, null, 2));
  console.log(`manifest now has ${merged.length} items`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
