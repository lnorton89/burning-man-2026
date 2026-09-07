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
import { bearingBetween, clockToMinutes, distanceBetween, metersToFeet, polarToPosition } from "./brc/geo.ts";
import { parseClockFacing, parseFacing, SETBACK_FEET } from "./brc/frontage.ts";

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const MEDIA_DIR = path.join(ROOT, "media");
const DATA_DIR = path.join(ROOT, "scripts", "brc-data", "2026");
const MANIFEST_PATH = path.join(ROOT, "src", "manifest.json");

// Roughly a block and a half - close enough to credit a specific camp
// (which you'd be standing inside) rather than just the nearest corner.
// Art gets a much longer leash: installations, and especially anything
// being ceremonially burned, are meant to be viewed from well back - a
// burn night crowd can be 400-600ft from the piece itself, behind a
// safety perimeter, and still unambiguously be "at" it.
const NEAR_LISTING_FEET = { camp: 250, art: 600, landmark: 250 };

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compassDirection = (bearingDeg) => COMPASS[Math.round(bearingDeg / 22.5) % 16];

/**
 * Where a camp actually is, not just the street corner its address names.
 *
 * A camp's location_string is an intersection - "Esplanade & 10:00" - but
 * the camp itself is a whole plot behind that corner, and BRC's biggest
 * sound camps run 250-650ft deep. Left at the bare corner, a giant camp's
 * "position" can be hundreds of feet from where anyone taking a photo
 * inside it actually stands - closer, by raw distance, to a small
 * neighboring camp's own corner than to anywhere inside the big one.
 *
 * This is dustcompass's own frontagePosition() (offsets off the road, onto
 * the correct side, using the listing's "facing man/mountain" text) plus
 * one more step it doesn't do: push another half the plot's depth further
 * in, so the point lands near the middle of the footprint instead of its
 * street edge. dustcompass doesn't need that for map pins at normal zoom;
 * a "who is this GPS fix actually closest to" comparison does.
 */
function campFootprintCenter(layout, address, exactLocation, dimensions) {
  const hit = geocode(address, layout);
  if (!hit) return undefined;
  if (hit.plaza || !hit.street || hit.distanceFeet === undefined) return hit.position;

  const depthMatch = /(\d+)\s*\+?\s*x\s*(\d+)/i.exec(dimensions ?? "");
  const halfDepth = depthMatch ? Number(depthMatch[2]) / 2 : 0;

  let radiusFeet = hit.distanceFeet;
  const facing = parseFacing(exactLocation);
  if (facing) {
    const street = layout.cStreets.find((s) => s.ref === hit.street);
    if (street) {
      const offset = (street.width ?? layout.road_width) / 2 + SETBACK_FEET + halfDepth;
      radiusFeet += facing === "man" ? offset : -offset;
    }
  }

  let minutes = clockToMinutes(hit.clock);
  const facingClock = parseClockFacing(exactLocation);
  if (facingClock !== undefined && radiusFeet > 0) {
    let delta = facingClock - minutes;
    if (delta > 360) delta -= 720;
    if (delta < -360) delta += 720;
    if (delta !== 0) {
      const offset = layout.road_width / 2 + SETBACK_FEET;
      const step = ((offset / radiusFeet) * 720) / (2 * Math.PI);
      minutes += delta < 0 ? step : -step;
    }
  }

  return polarToPosition(layout, minutes, radiusFeet);
}

async function loadLayout() {
  return JSON.parse(await fs.readFile(path.join(DATA_DIR, "layout.json"), "utf8"));
}

async function loadListings(layout) {
  const listings = [];

  // Fixed civic landmarks - The Man and Center Camp Plaza - aren't in the
  // art/camp listings at all (they're the survey's own reference points,
  // not something anyone applied for a placement of), so without these a
  // photo taken right at the Man's base would silently fall through to
  // whatever registered art happens to be nearby instead.
  // GPS is typically only accurate to within 10-30ft, so a shot taken at the
  // base of the Man can easily land nominally closer to some small
  // installation a few dozen feet away than to the Man's own exact centre
  // point. "Near the Man" is the far more recognizable and almost-certainly-
  // still-correct answer, so give these two core landmarks a tie-breaking
  // edge over anything within ordinary GPS noise of them.
  const LANDMARK_PRIORITY_FEET = 60;
  listings.push({
    name: "The Man",
    kind: "landmark",
    position: layout.center.geometry.coordinates,
    priorityBias: LANDMARK_PRIORITY_FEET,
  });
  if (layout.center_camp) {
    listings.push({
      name: "Center Camp Plaza",
      kind: "landmark",
      position: polarToPosition(layout, "6:00", layout.center_camp.distance),
      priorityBias: LANDMARK_PRIORITY_FEET,
    });
  }

  // Known spots that aren't in Burning Man's own listings at all - mutant
  // vehicles and roaming sound camps don't apply for a placed address, so
  // something like Robot Heart has no official record to geocode from.
  // scripts/brc-data/custom-landmarks.json is a hand-maintained list of
  // {name, lat, lon}, sourced from a photo with real GPS taken there.
  try {
    const custom = JSON.parse(await fs.readFile(path.join(ROOT, "scripts", "brc-data", "custom-landmarks.json"), "utf8"));
    for (const c of custom) {
      listings.push({ name: c.name, kind: "landmark", position: [c.lon, c.lat], priorityBias: LANDMARK_PRIORITY_FEET });
    }
  } catch (e) {
    console.warn(`  · no custom landmarks (${e.message})`);
  }

  try {
    const landmarks = JSON.parse(await fs.readFile(path.join(DATA_DIR, "cpns.geojson"), "utf8"));
    for (const feature of landmarks.features ?? []) {
      const name = feature.properties?.NAME ?? feature.properties?.name;
      const [lon, lat] = feature.geometry?.coordinates ?? [];
      if (name && typeof lat === "number" && typeof lon === "number") {
        listings.push({ name, kind: "landmark", position: [lon, lat] });
      }
    }
  } catch (e) {
    console.warn(`  · no landmark points (${e.message})`);
  }

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
      const position = campFootprintCenter(layout, c.location_string, c.location?.exact_location, c.location?.dimensions);
      if (position) listings.push({ name: c.name, kind: "camp", position });
    }
  } catch (e) {
    console.warn(`  · no camp listings (${e.message})`);
  }

  return listings;
}

function nearestListing(position, listings) {
  let best;
  let bestFeet = Infinity;
  let bestRanked = Infinity;
  for (const listing of listings) {
    const feet = metersToFeet(distanceBetween(position, listing.position));
    const limit = NEAR_LISTING_FEET[listing.kind] ?? NEAR_LISTING_FEET.camp;
    if (feet > limit) continue;
    const ranked = feet - (listing.priorityBias ?? 0);
    if (ranked < bestRanked) {
      bestRanked = ranked;
      bestFeet = feet;
      best = listing;
    }
  }
  return best ? { ...best, distanceFeet: bestFeet } : undefined;
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
      if (nearest.kind === "landmark") return `near ${nearest.name}`;
      if (nearest.kind === "camp") {
        // Plenty of camp names already lead with "Camp" ("Camp Pendant"),
        // and some don't ("Snuggles") - don't stack a second one on top.
        return /^camp\b/i.test(nearest.name) ? `near ${nearest.name}` : `near Camp ${nearest.name}`;
      }
      return `near "${nearest.name}"`;
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

// How close in time a GPS-less shot has to be to a fixed one to borrow its
// location. Long enough to cover "phone hadn't locked on yet this trip",
// short enough that borrowing it isn't just a guess - people don't usually
// relocate across the city in under two hours of continuous shooting.
const INTERPOLATE_MAX_MINUTES = 120;

/** Fills in items with no GPS fix from the nearest-in-time item that has one. */
function interpolateMissing(manifest) {
  const withPosition = manifest
    .map((item, index) => ({ item, index, time: item.date ? new Date(item.date).getTime() : undefined }))
    .filter((entry) => entry.time !== undefined && entry.item.location);

  let interpolated = 0;
  for (const item of manifest) {
    if (item.location || !item.date) continue;
    const time = new Date(item.date).getTime();

    let nearest;
    let bestDiff = Infinity;
    for (const candidate of withPosition) {
      const diff = Math.abs(candidate.time - time);
      if (diff < bestDiff) {
        bestDiff = diff;
        nearest = candidate;
      }
    }

    if (nearest && bestDiff <= INTERPOLATE_MAX_MINUTES * 60 * 1000) {
      // The neighbour's own text already starts with "near" (or is the
      // off-playa "N mi ... of Black Rock City" form) - splice "roughly"
      // in after that lead-in rather than stacking a second one in front.
      item.location = nearest.item.location.replace(/^near /, "roughly near ");
      interpolated++;
    }
  }
  return interpolated;
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

  const interpolated = interpolateMissing(manifest);

  // Hand corrections for cases the algorithm can't reach on its own - no
  // GPS and no nearby-in-time fix to interpolate from, or ground truth
  // ("this is actually at X") that beats what the data says. Applied last
  // so it always wins, and re-running this script never clobbers it.
  let overridden = 0;
  try {
    const overrides = JSON.parse(
      await fs.readFile(path.join(ROOT, "scripts", "brc-data", "location-overrides.json"), "utf8"),
    );
    for (const item of manifest) {
      if (overrides[item.id]) {
        item.location = overrides[item.id];
        overridden++;
      }
    }
  } catch (e) {
    console.warn(`  · no location overrides (${e.message})`);
  }

  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(
    `Wrote a location for ${found}/${manifest.length} items (+${interpolated} interpolated, +${overridden} manually overridden)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
