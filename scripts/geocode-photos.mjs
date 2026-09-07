// Cross-references each photo/video's GPS (EXIF for photos, the ISO-6709
// location tag ffmpeg embeds for videos) against Burning Man's own 2026
// city survey and camp/art listings - the same data and math the
// dustcompass project (github.com/lnorton89/dustcompass) uses - to write a
// human-readable "location" string onto each item in src/manifest.json.
//
// Preference order: a nearby named camp/art piece, then a BRC street
// address (e.g. "near 7:30 & Esplanade"), then distance/bearing from the
// city for anything shot off-playa (the drive up, etc).
//
// Requires scripts/brc-data/2026/{layout,art,camp}.json - see
// scripts/brc-data/README.md for how to (re)fetch those.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import exifr from "exifr";
import { geocode, reverseGeocode } from "./brc/geocode.ts";
import { bearingBetween, distanceBetween, metersToFeet } from "./brc/geo.ts";

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const MEDIA_DIR = path.join(ROOT, "media");
const DATA_DIR = path.join(ROOT, "scripts", "brc-data", "2026");
const MANIFEST_PATH = path.join(ROOT, "src", "manifest.json");

// Roughly a block and a half - close enough to credit a specific camp/art
// piece rather than just the nearest street corner.
const NEAR_LISTING_FEET = 250;

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compassDirection = (bearingDeg) => COMPASS[Math.round(bearingDeg / 22.5) % 16];

async function loadLayout() {
  return JSON.parse(await fs.readFile(path.join(DATA_DIR, "layout.json"), "utf8"));
}

async function loadListings(layout) {
  const listings = [];

  try {
    const art = JSON.parse(await fs.readFile(path.join(DATA_DIR, "art.json"), "utf8"));
    for (const a of art) {
      const lat = a.location?.gps_latitude;
      const lon = a.location?.gps_longitude;
      if (typeof lat === "number" && typeof lon === "number") {
        listings.push({ name: a.name, kind: "art", position: [lon, lat] });
      }
    }
  } catch (e) {
    console.warn(`  · no art listings (${e.message})`);
  }

  try {
    const camps = JSON.parse(await fs.readFile(path.join(DATA_DIR, "camp.json"), "utf8"));
    for (const c of camps) {
      if (!c.location_string || !c.name) continue;
      const result = geocode(c.location_string, layout);
      if (result) listings.push({ name: c.name, kind: "camp", position: result.position });
    }
  } catch (e) {
    console.warn(`  · no camp listings (${e.message})`);
  }

  return listings;
}

function nearestListing(position, listings) {
  let best;
  let bestFeet = Infinity;
  for (const listing of listings) {
    const feet = metersToFeet(distanceBetween(position, listing.position));
    if (feet < bestFeet) {
      bestFeet = feet;
      best = listing;
    }
  }
  return best && bestFeet <= NEAR_LISTING_FEET ? { ...best, distanceFeet: bestFeet } : undefined;
}

function describe(position, layout, listings) {
  const center = layout.center.geometry.coordinates;
  const distanceFeet = metersToFeet(distanceBetween(center, position));

  // A little past the surveyed fence is still "in the event" territory (gate
  // road queue, walk-in camping); a lot past it is a different place
  // entirely, and a BRC clock/street address for a point on a highway 80
  // miles away would be actively misleading.
  if (distanceFeet <= layout.fence_distance * 1.15) {
    const nearest = nearestListing(position, listings);
    if (nearest) {
      return nearest.kind === "camp" ? `near Camp ${nearest.name}` : `near "${nearest.name}"`;
    }
    const address = reverseGeocode(position, layout);
    return `near ${address.label}`;
  }

  const miles = distanceFeet / 5280;
  if (miles < 1) return "near Black Rock City";
  const bearing = bearingBetween(center, position);
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi ${compassDirection(bearing)} of Black Rock City`;
}

async function photoGps(filePath) {
  const gps = await exifr.gps(filePath);
  if (!gps) return undefined;
  if (Math.abs(gps.latitude) < 0.01 && Math.abs(gps.longitude) < 0.01) return undefined;
  return [gps.longitude, gps.latitude];
}

// ffmpeg/Android write an ISO 6709 string like "+40.7906-119.2094/" into the
// "location" format tag - a sign-prefixed lat immediately followed by a
// sign-prefixed lon, no separator between them.
async function videoGps(filePath) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format_tags=location",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const match = /^([+-]\d+\.?\d*)([+-]\d+\.?\d*)/.exec(stdout.trim());
  if (!match) return undefined;
  const [, lat, lon] = match;
  // "+00.0000+000.0000/" is what a phone without a GPS fix yet writes rather
  // than omitting the tag - Null Island, not a real position.
  if (Math.abs(Number(lat)) < 0.01 && Math.abs(Number(lon)) < 0.01) return undefined;
  return [Number(lon), Number(lat)];
}

async function main() {
  const layout = await loadLayout();
  const listings = await loadListings(layout);
  console.log(`Loaded layout + ${listings.length} geocoded camp/art listings`);

  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8"));
  let found = 0;
  for (const item of manifest) {
    const srcPath = path.join(MEDIA_DIR, `${item.id}${item.type === "photo" ? ".jpg" : ".mp4"}`);
    try {
      const position = item.type === "photo" ? await photoGps(srcPath) : await videoGps(srcPath);
      if (position) {
        item.location = describe(position, layout, listings);
        found++;
      } else {
        delete item.location;
      }
    } catch (e) {
      console.warn(`  ! ${item.id}: ${e.message}`);
    }
  }

  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`Wrote a location for ${found}/${manifest.length} items`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
