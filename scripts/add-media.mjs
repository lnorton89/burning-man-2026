// Incrementally processes only the files in media/ that aren't in
// src/manifest.json yet, instead of re-running the full (slow, mostly
// video-transcoding) process-media.mjs pass over everything. Run
// `npm run geocode-photos` and `npm run generate-og-images` afterward to
// pick up location/OG data for whatever this adds.

import fs from "node:fs/promises";
import path from "node:path";
import { ensureDirs, processPhoto, processVideo } from "./process-media.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC_DIR = path.join(ROOT, "media");
const MANIFEST_PATH = path.join(ROOT, "src", "manifest.json");

async function main() {
  await ensureDirs();
  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8"));
  const known = new Set(manifest.map((item) => item.id));

  const files = (await fs.readdir(SRC_DIR))
    .filter((f) => /\.(jpe?g|mp4)$/i.test(f))
    .filter((f) => !known.has(path.basename(f, path.extname(f))))
    .sort();

  if (files.length === 0) {
    console.log("No new files in media/ - manifest is already up to date.");
    return;
  }

  console.log(`Found ${files.length} new file(s): ${files.join(", ")}`);
  let i = 0;
  for (const file of files) {
    i += 1;
    const ext = path.extname(file).toLowerCase();
    const id = path.basename(file, path.extname(file));
    process.stdout.write(`[${i}/${files.length}] ${file} ... `);
    const start = Date.now();
    const item = ext === ".mp4" ? await processVideo(file, id) : await processPhoto(file, id);
    manifest.push(item);
    console.log(`ok (${((Date.now() - start) / 1000).toFixed(1)}s)`);
  }

  manifest.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\nWrote ${manifest.length} total items to ${path.relative(ROOT, MANIFEST_PATH)}`);
  console.log("Next: npm run geocode-photos && npm run generate-og-images && npm run build");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
