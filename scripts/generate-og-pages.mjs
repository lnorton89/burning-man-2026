// Post-build step: writes a real static page at dist/p/<id>/index.html for
// every media item, so the URL a person actually shares (the one shown in
// the address bar once the app opens that item) is a real path GitHub
// Pages can serve - not a #hash, which never reaches the server and so
// can never carry a distinct preview for link-unfurling bots (Discord,
// Slack, iMessage, etc. don't run JS).
//
// Each page is just dist/index.html with its <!-- OG:START/END --> block
// swapped for item-specific tags; it uses the same JS/CSS bundle, and the
// app itself opens the right item on load by reading the URL path.

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const BASE_URL = "https://lnorton89.github.io/burning-man-2026/";

function escapeXml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatDateLabel(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function ogBlock({ description, image, url }) {
  const desc = escapeXml(description);
  return `<!-- OG:START -->
    <meta property="og:type" content="website" />
    <meta property="og:title" content="Burning Man 2026" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:image" content="${image}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:url" content="${url}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Burning Man 2026" />
    <meta name="twitter:description" content="${desc}" />
    <meta name="twitter:image" content="${image}" />
    <!-- OG:END -->`;
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, "src", "manifest.json"), "utf8"));
  const template = await fs.readFile(path.join(DIST, "index.html"), "utf8");
  const ogRegex = /<!-- OG:START -->[\s\S]*?<!-- OG:END -->/;

  if (!ogRegex.test(template)) {
    throw new Error("dist/index.html is missing the <!-- OG:START/END --> marker block");
  }

  let i = 0;
  for (const item of manifest) {
    i += 1;
    const dateLabel = formatDateLabel(item.date);
    const locationSuffix = item.location ? `, ${item.location}` : "";
    const html = template.replace(
      ogRegex,
      ogBlock({
        description: `A ${item.type} from my Burn — ${dateLabel || "2026"}${locationSuffix}.`,
        image: `${BASE_URL}og/${item.id}.jpg`,
        url: `${BASE_URL}p/${item.id}/`,
      }),
    );
    const pageDir = path.join(DIST, "p", item.id);
    await fs.mkdir(pageDir, { recursive: true });
    await fs.writeFile(path.join(pageDir, "index.html"), html);
    process.stdout.write(`\r[${i}/${manifest.length}] ${item.id}`);
  }
  console.log(`\nWrote ${manifest.length} per-item pages under dist/p/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
