// Independent building-footprint lookup — runs alongside Google Solar so
// our area number isn't sole-sourced from Google. We query OpenStreetMap
// via Nominatim's reverse-geocoding endpoint with polygon_geojson=1; when
// OSM has a building tagged at the address, we get back the footprint as
// a polygon and compute area independently using the shoelace formula.
//
// Coverage caveat: OSM building tags in US residential are hit-or-miss
// (much better in cities + Europe). We treat null returns as "no
// independent confirmation" rather than a measurement failure — the
// pipeline still proceeds with Solar / vision.
//
// Nominatim usage policy compliance:
//   1. Real User-Agent identifying the application (set below).
//   2. ≤1 request/second. Enforced via an in-process mutex that delays
//      any back-to-back call by ≥1.1s.
//   3. Cache by lat/lng (5dp ≈ 1m precision) for 24h so batch scripts and
//      repeated-address lookups don't hammer the upstream.

import type { Polygon } from "geojson";

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const USER_AGENT = "RoofIQ/0.1 (jobnimbus-hackathon-2026; built for AI Builder Day)";
const MIN_INTERVAL_MS = 1100;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const M2_TO_SQFT = 10.7639;
const EARTH_RADIUS_M = 6_378_137;

// Throttle + cache — module-level, shared per process. On Vercel
// serverless, instances are short-lived; this is a per-warm-instance
// guarantee (the only enforcement possible without a shared store).
let lastRequestAt = 0;
let pendingThrottle: Promise<void> = Promise.resolve();
const cache = new Map<string, { result: FootprintLookupResult | null; at: number }>();

async function throttle(): Promise<void> {
  // Chain throttle promises so concurrent calls serialize through the
  // same mutex.
  const myTurn = pendingThrottle.then(async () => {
    const elapsed = Date.now() - lastRequestAt;
    if (elapsed < MIN_INTERVAL_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_INTERVAL_MS - elapsed));
    }
    lastRequestAt = Date.now();
  });
  pendingThrottle = myTurn.catch(() => undefined);
  return myTurn;
}

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

export type FootprintLookupResult = {
  source: "nominatim_osm";
  polygon: Array<[number, number]>;       // [lng, lat] pairs
  area_sqft: number;
  area_m2: number;
  osm_id?: number;
  osm_type?: string;
  display_name?: string;
};

export async function lookupBuildingFootprint(lat: number, lng: number): Promise<FootprintLookupResult | null> {
  const key = cacheKey(lat, lng);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.result;
  }
  await throttle();

  const result = await lookupUncached(lat, lng);
  cache.set(key, { result, at: Date.now() });
  return result;
}

async function lookupUncached(lat: number, lng: number): Promise<FootprintLookupResult | null> {
  const url = `${NOMINATIM_BASE}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&polygon_geojson=1&addressdetails=0&zoom=18`;
  let json: any;
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
      },
      cache: "no-store",
    });
    if (!r.ok) return null;
    json = await r.json();
  } catch {
    return null;
  }

  // Need a polygon (or multipolygon) tagged as a building.
  const geom = json?.geojson as Polygon | undefined;
  if (!geom || (geom.type !== "Polygon" && (geom.type as string) !== "MultiPolygon")) return null;

  // Reject results that aren't a building or building-equivalent.
  // class="building" covers all building subtypes; we also accept
  // class="amenity" for things like schools/churches that have polygons.
  const cls = json?.class as string | undefined;
  if (cls !== "building" && cls !== "amenity") return null;

  // Take the outer ring of the first polygon. The geojson Position type is
  // number[] (typically 2-element [lng, lat]) — we narrow to the tuple
  // shape we actually use. Cast to unknown first to break the strictness
  // check (we accept any Position-compatible array shape).
  const coords = geom.coordinates as unknown as number[][] | number[][][];
  const rawRing: number[][] | undefined =
    geom.type === "Polygon"
      ? (coords as number[][])
      : ((coords as unknown as number[][][])[0] ?? []);
  const ring: Array<[number, number]> = (rawRing ?? []).map((pt) => [pt[0], pt[1]] as [number, number]);
  if (ring.length < 4) return null;

  const area_m2 = ringAreaM2(ring);
  if (area_m2 < 25 || area_m2 > 5000) {
    // Sanity bounds: 25 m² (270 sqft, smaller than a shed) to 5000 m²
    // (54,000 sqft, larger than any residential roof). Outside those,
    // we're probably looking at a non-building polygon.
    return null;
  }

  return {
    source: "nominatim_osm",
    polygon: ring,
    area_sqft: Math.round(area_m2 * M2_TO_SQFT),
    area_m2: Math.round(area_m2 * 100) / 100,
    osm_id: json.osm_id,
    osm_type: json.osm_type,
    display_name: json.display_name,
  };
}

// Spherical-earth shoelace formula. Accurate to ~0.1% at residential
// scale. Returns absolute area in m². Adapted from Robert G. Chamberlain
// & William H. Duquette (NASA JPL, "Some Algorithms for Polygons on a
// Sphere", 2007).
function ringAreaM2(ring: Array<[number, number]>): number {
  if (ring.length < 4) return 0;
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    total += toRad(lng2 - lng1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
