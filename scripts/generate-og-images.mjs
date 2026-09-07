// Generates per-item Open Graph preview images: the source photo/poster
// with a "BURNING MAN 2026" + date overlay composited on top, at standard
// OG dimensions. Runs after `npm run process-media` (via the npm
// "post<script>" convention) since it reads src/manifest.json and the
// already-processed public/media/ assets.

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const COVER_SOURCE_ID = "20260902_022857"; // playa laser-light scene, used for the site-wide cover image

function escapeXml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function overlaySvg({ heading, subheading }) {
  return `
<svg width="${OG_WIDTH}" height="${OG_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.8"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${OG_HEIGHT - 220}" width="${OG_WIDTH}" height="220" fill="url(#fade)" />
  <text x="56" y="${OG_HEIGHT - 96}" font-family="Segoe UI, Arial, sans-serif" font-size="56" font-weight="700" fill="#ffffff">${escapeXml(heading)}</text>
  <text x="56" y="${OG_HEIGHT - 52}" font-family="Segoe UI, Arial, sans-serif" font-size="30" fill="#ffb27a">${escapeXml(subheading)}</text>
</svg>`;
}

function formatDateLabel(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

async function makeOgImage({ sourcePath, outPath, heading, subheading }) {
  const svg = Buffer.from(overlaySvg({ heading, subheading }));
  await sharp(sourcePath)
    .resize(OG_WIDTH, OG_HEIGHT, { fit: "cover", position: "attention" })
    .composite([{ input: svg }])
    .jpeg({ quality: 85, mozjpeg: true })
    .toFile(outPath);
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, "src", "manifest.json"), "utf8"));
  await fs.mkdir(path.join(PUBLIC_DIR, "og"), { recursive: true });

  let i = 0;
  for (const item of manifest) {
    i += 1;
    const sourcePath = path.join(PUBLIC_DIR, item.type === "photo" ? item.full : item.poster);
    await makeOgImage({
      sourcePath,
      outPath: path.join(PUBLIC_DIR, "og", `${item.id}.jpg`),
      heading: "BURNING MAN 2026",
      subheading: formatDateLabel(item.date),
    });
    process.stdout.write(`\r[${i}/${manifest.length}] ${item.id}`);
  }
  console.log();

  await makeOgImage({
    sourcePath: path.join(PUBLIC_DIR, "media", "poster", `${COVER_SOURCE_ID}.jpg`),
    outPath: path.join(PUBLIC_DIR, "og", "cover.jpg"),
    heading: "BURNING MAN 2026",
    subheading: "Photos & videos from the playa",
  });

  console.log(`Wrote ${manifest.length} OG images, plus og/cover.jpg`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
