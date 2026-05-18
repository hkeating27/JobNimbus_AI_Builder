// Thin wrappers around Google Maps Platform APIs.
//
// Key handling: API key is read at FUNCTION CALL TIME, not module load time.
// Module-load reads break when scripts/* call dotenv after importing
// measurement code (ESM hoists imports above runtime code).
//
// URL handling: routines that fetch from Google for SERVER-SIDE use return
// the canonical URL with the key embedded. Routines that produce URLs to
// be embedded in committed artifacts or sent to the browser MUST use the
// proxy form via /api/satellite — those never carry the key.

function getKey(): string {
  return process.env.GOOGLE_MAPS_API_KEY ?? "";
}

export function hasGoogleKey(): boolean {
  return getKey().length > 0;
}

export type GeocodeResult = {
  formatted_address: string;
  lat: number;
  lng: number;
  state_code: string;
  county?: string;
  postal_code?: string;
};

export async function geocode(address: string): Promise<GeocodeResult | null> {
  const KEY = getKey();
  if (!KEY) return null;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${KEY}`;
  const r = await fetch(url, { cache: "no-store" });
  const json: any = await r.json();
  if (json.status !== "OK" || !json.results?.length) return null;
  const top = json.results[0];
  const comp = (type: string) => top.address_components.find((c: any) => c.types.includes(type))?.short_name as string | undefined;
  return {
    formatted_address: top.formatted_address,
    lat: top.geometry.location.lat,
    lng: top.geometry.location.lng,
    state_code: comp("administrative_area_level_1") ?? "",
    county: comp("administrative_area_level_2"),
    postal_code: comp("postal_code"),
  };
}

export type SolarSegment = {
  pitchDegrees: number;
  azimuthDegrees: number;
  centerLat: number;
  centerLng: number;
  areaMeters2: number;
  planeHeightAtCenterMeters?: number;
};

export type SolarBuildingInsights = {
  totalRoofAreaSqft: number;
  averagePitchDegrees: number;
  pitchMultiplier: number;
  segments: SolarSegment[];
  segmentCount: number;
  imageryQuality: string;
  imageryDate?: string;
  // Building centroid as Solar found it. Often 5–15m offset from the
  // geocoded address point (driveway/door vs. roof centroid). Use this
  // for the static-map + dataLayers center to align the precise polygon.
  centerLat: number;
  centerLng: number;
  raw_url: string;
};

const M2_TO_SQFT = 10.7639;

export async function solarBuildingInsights(lat: number, lng: number): Promise<SolarBuildingInsights | null> {
  const KEY = getKey();
  if (!KEY) return null;
  const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=HIGH&key=${KEY}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) {
    if (r.status === 404) return null;
    return null;
  }
  const json: any = await r.json();
  const segments: SolarSegment[] = (json.solarPotential?.roofSegmentStats ?? []).map((s: any) => ({
    pitchDegrees: s.pitchDegrees ?? 0,
    azimuthDegrees: s.azimuthDegrees ?? 0,
    centerLat: s.center?.latitude ?? lat,
    centerLng: s.center?.longitude ?? lng,
    areaMeters2: s.stats?.areaMeters2 ?? 0,
    planeHeightAtCenterMeters: s.planeHeightAtCenterMeters,
  }));

  const totalAreaM2 = segments.reduce((s, x) => s + x.areaMeters2, 0);
  const avgPitch = totalAreaM2 > 0
    ? segments.reduce((s, x) => s + x.pitchDegrees * x.areaMeters2, 0) / totalAreaM2
    : 0;
  const totalRoofAreaSqft = totalAreaM2 * M2_TO_SQFT;
  const pitchRad = (avgPitch * Math.PI) / 180;
  const pitchMultiplier = 1 / Math.cos(pitchRad);
  // Solar's findClosest returns the building's center (roof centroid)
  // as a top-level `center` field. Falls back to the requested lat/lng
  // if absent — but in practice it's always present in HIGH-quality
  // responses.
  const centerLat = json?.center?.latitude ?? lat;
  const centerLng = json?.center?.longitude ?? lng;

  return {
    totalRoofAreaSqft,
    averagePitchDegrees: avgPitch,
    pitchMultiplier,
    segments,
    segmentCount: segments.length,
    imageryQuality: json.imageryQuality ?? "UNKNOWN",
    imageryDate: json.imageryDate ? `${json.imageryDate.year}-${json.imageryDate.month}-${json.imageryDate.day}` : undefined,
    centerLat,
    centerLng,
    raw_url: "redacted",
  };
}

// Internal use only: returns the Google URL with the API key embedded.
// Use ONLY for server-side fetches (e.g. piping image bytes into Claude
// vision via base64). Never put the result into a response body, log, or
// committed file.
//
// `marker=true` adds a small red pin at the target lat/lng. We pass this
// when sending imagery to Claude vision so the model can disambiguate the
// target building from neighbors in dense suburbs — without it, vision
// often traced edges on the wrong house.
export function staticMapUrlInternal(lat: number, lng: number, zoom = 20, size = "640x640", marker = false): string {
  const KEY = getKey();
  if (!KEY) return "";
  const markerParam = marker ? `&markers=color:red%7Csize:mid%7C${lat},${lng}` : "";
  return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${size}&maptype=satellite${markerParam}&key=${KEY}`;
}

// Public-safe URL — points at our /api/satellite proxy which holds the
// key server-side. Safe to put in JSON responses, committed artifacts,
// browser src attributes. Returned URLs contain no secret material.
//
// `scale=2` requests retina-density imagery (2x pixels for the same
// geographic coverage). Used by the parallax overlay so the CSS
// zoom-in stays crisp instead of pixel-doubling blurry.
export function staticMapUrlPublic(lat: number, lng: number, zoom = 20, size = "800x800", scale = 1): string {
  return `/api/satellite?lat=${lat}&lng=${lng}&zoom=${zoom}&size=${encodeURIComponent(size)}&scale=${scale}`;
}

export function streetViewUrlInternal(lat: number, lng: number, size = "640x480"): string {
  const KEY = getKey();
  if (!KEY) return "";
  return `https://maps.googleapis.com/maps/api/streetview?location=${lat},${lng}&size=${size}&key=${KEY}`;
}

// Ground elevation in meters above sea level at the given point.
// Uses Google Maps Elevation API. Used by the photo-upload pipeline
// to convert EXIF GPS altitude (which is also above sea level) into
// altitude above ground level (AGL), needed for ground-sample-distance
// math.
//
// Returns null if the API key is missing or the call fails. Callers
// gracefully degrade to vision-references-only scale.
export async function elevationMeters(lat: number, lng: number): Promise<number | null> {
  const KEY = getKey();
  if (!KEY) return null;
  const url = `https://maps.googleapis.com/maps/api/elevation/json?locations=${lat},${lng}&key=${KEY}`;
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as { status: string; results?: Array<{ elevation: number }> };
    if (j.status !== "OK" || !j.results?.length) return null;
    return j.results[0].elevation;
  } catch {
    return null;
  }
}

// Solar dataLayers: returns roof masks + per-pixel pitch/azimuth/elevation.
// We use this for the raster cross-check edge classifier.
export type DataLayersResponse = {
  imageryDate?: string;
  imageryQuality: string;
  rgbUrl?: string;
  maskUrl?: string;
  dsmUrl?: string;
  imageryProcessedDate?: string;
};

export async function solarDataLayers(lat: number, lng: number, radiusMeters = 25): Promise<DataLayersResponse | null> {
  const KEY = getKey();
  if (!KEY) return null;
  // view=FULL_LAYERS returns rgbUrl + maskUrl + dsmUrl. We only consume
  // maskUrl currently but FULL is the enum that gives it back.
  const url = `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${lat}&location.longitude=${lng}&radiusMeters=${radiusMeters}&view=FULL_LAYERS&requiredQuality=HIGH&key=${KEY}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) return null;
  const json: any = await r.json();
  return {
    imageryDate: json.imageryDate ? `${json.imageryDate.year}-${json.imageryDate.month}-${json.imageryDate.day}` : undefined,
    imageryQuality: json.imageryQuality ?? "UNKNOWN",
    rgbUrl: json.rgbUrl,
    maskUrl: json.maskUrl,
    dsmUrl: json.dsmUrl,
    imageryProcessedDate: json.imageryProcessedDate ? `${json.imageryProcessedDate.year}-${json.imageryProcessedDate.month}-${json.imageryProcessedDate.day}` : undefined,
  };
}

// Fetch a Solar dataLayer image and return the raw bytes.
// The image URL returned by dataLayers itself does NOT include our API key
// in the path, but downloading it requires appending the key. We append
// server-side and never expose the augmented URL.
export async function fetchSolarImage(url: string): Promise<Buffer | null> {
  const KEY = getKey();
  if (!KEY || !url) return null;
  const sep = url.includes("?") ? "&" : "?";
  const r = await fetch(`${url}${sep}key=${KEY}`);
  if (!r.ok) return null;
  return Buffer.from(await r.arrayBuffer());
}
