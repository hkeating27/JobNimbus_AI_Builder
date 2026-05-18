// Measure a roof from a user-uploaded aerial photo.
//
// The fundamental challenge is *scale*: a photo from 60 ft and a photo
// from 200 ft look essentially identical, just zoomed differently. We
// need pixels-per-foot to convert the visible roof polygon into real
// square footage. Two signals get us there:
//
//   1) EXIF metadata — GPS altitude + focal length + image dimensions
//      lets us compute ground sample distance directly.
//      (Tier 2 / out of scope for this MVP.)
//
//   2) Reference objects in frame — sidewalks, driveways, vehicles,
//      parking spaces. Vision identifies them and reports their pixel
//      length; we know their real-world length from a fixed lookup.
//      pixels_per_foot = pixel_length / known_length_ft. Multi-reference
//      voting via median when several are visible.
//
// In Tier 1 we use signal #2 only. EXIF and Solar/address fallback for
// pitch is layered in by the route handler.
import Anthropic from "@anthropic-ai/sdk";
import type { Penetrations } from "./types";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  _client = new Anthropic({ apiKey: key });
  return _client;
}

// Reference object types vision can identify in an aerial photo, and
// the canonical real-world length we'll use for each (in feet). The
// length convention is the LONG visible dimension — for sidewalks
// that's the WIDTH (4–5 ft, NOT the running length, which varies
// arbitrarily). For vehicles it's the bumper-to-bumper length. The
// vision prompt is explicit about which axis to measure for each type.
//
// Variance estimates inform how much we trust each reference; in Tier 1
// we just take the median, but in Tier 2 we'll weight by 1/variance.
type ReferenceType =
  | "sidewalk_width"
  | "single_driveway_width"
  | "double_driveway_width"
  | "sedan_length"
  | "pickup_truck_length"
  | "parking_space_short_axis"
  | "parking_space_long_axis"
  | "garage_door_width"
  | "shingle_course_height"
  | "trash_can_diameter"
  | "hvac_unit_side"
  | "person_shoulder_span";

const REFERENCE_LENGTHS_FT: Record<ReferenceType, { length: number; variance: number; note: string }> = {
  sidewalk_width:           { length: 4.5,  variance: 0.5, note: "ADA-mandated 4-5 ft for residential" },
  single_driveway_width:    { length: 10,   variance: 2,   note: "single-car residential typical" },
  double_driveway_width:    { length: 18,   variance: 2,   note: "two-car residential typical" },
  sedan_length:             { length: 16,   variance: 1.5, note: "average passenger sedan" },
  pickup_truck_length:      { length: 19.5, variance: 1,   note: "full-size pickup, very consistent" },
  parking_space_short_axis: { length: 9,    variance: 1,   note: "standard parking stall width" },
  parking_space_long_axis:  { length: 18,   variance: 1,   note: "standard parking stall depth" },
  garage_door_width:        { length: 8,    variance: 1,   note: "single-car residential garage door" },
  shingle_course_height:    { length: 1,    variance: 0,   note: "12-inch shingle exposure — manufactured spec" },
  trash_can_diameter:       { length: 2,    variance: 0.3, note: "standard residential roll cart, top view" },
  hvac_unit_side:           { length: 2.5,  variance: 0.3, note: "residential condenser pad, square" },
  person_shoulder_span:     { length: 1.7,  variance: 0.3, note: "adult shoulder-to-shoulder from overhead" },
};

export type NormalizedPoint = [number, number]; // [x, y] in [0..1]

export type ScaleReference = {
  type: ReferenceType;
  // Which photo (0-indexed) the reference was identified in. Critical
  // for multi-photo runs: each photo has its own normalized coordinate
  // system, so refs from different photos CANNOT be averaged into one
  // ppf — the implicit scale is different per photo.
  photo_index: number;
  from: NormalizedPoint;
  to: NormalizedPoint;
  pixel_length_normalized: number;        // computed: distance(from, to) in normalized coords
  assumed_real_length_ft: number;         // server-side canonical value
  confidence: "high" | "medium" | "low";
  vision_notes?: string;
};

export type PhotoAnalysis = {
  view_type: "nadir" | "oblique" | "ground_level" | "unknown";
  view_confidence: "high" | "medium" | "low";

  roof_polygon_normalized: NormalizedPoint[];
  polygon_confidence: "high" | "medium" | "low";
  // Which photo (0-indexed) the polygon was traced from. Required when
  // multiple photos are submitted — its ppf drives the area math.
  polygon_source_photo_index: number;

  // Vision's best-effort pitch. For nadir photos this will typically be
  // low-confidence — we'll override with Solar if available.
  pitch_rise_in_12: number;
  pitch_confidence: "high" | "medium" | "low";

  segment_count: number;
  complexity: "simple_gable" | "hip_or_valleys" | "complex_cutup";
  visible_layers: 1 | 2;

  scale_references: ScaleReference[];

  penetrations: Penetrations;

  notes: string[];
  reasoning: string;
};

const SYSTEM = `You are a senior roof estimator analyzing a SINGLE user-uploaded photograph of a residential property. Output ONLY a single JSON object — no prose, no markdown fences.

Unlike satellite imagery, this photo:
  - Has NO marker pin. Trace the primary residential building visible in the frame.
  - May be top-down (drone or aerial), oblique (angled drone), or ground-level. Identify which.
  - Has unknown camera height — we infer scale from reference objects in the frame.

CRITICAL — PER-PHOTO COORDINATE SYSTEMS:
When multiple photos are submitted, EACH PHOTO HAS ITS OWN COORDINATE SYSTEM. A pickup truck visible at 4% of photo A's width and 6% of photo B's width is the SAME truck — but if photo A was taken from a higher altitude, the photos have different scales. References from DIFFERENT photos CANNOT be averaged together. You MUST tag every scale_reference with a photo_index field (0 = first photo, 1 = second, 2 = third) so the orchestrator knows which photo's coordinate system that reference belongs to.

For the same reason, you MUST report a polygon_source_photo_index field indicating which of the submitted photos the roof polygon was traced from. Trace from the photo where the roof outline is most clearly visible — typically the truest top-down view — and identify scale references in THAT SAME photo as a priority. References in other photos are useful for cross-validation but only the polygon-source photo's references will drive the area math.

CRITICAL — IDENTIFY SCALE REFERENCES:
You must identify objects in the frame whose real-world dimensions are known and consistent. Without these we cannot convert pixels to feet. Look for, in order of preference:
  - sidewalk_width (4-5 ft, ADA-mandated, very consistent — BEST when visible)
  - parking_space_long_axis (painted line, 18 ft) or parking_space_short_axis (9 ft)
  - pickup_truck_length (19.5 ft, very common in this market)
  - sedan_length (16 ft)
  - single_driveway_width (10 ft)  or  double_driveway_width (18 ft)
  - shingle_course_height (12 inches — only if individual shingle courses are clearly visible)
  - garage_door_width (single-car: 8 ft) — only if photographed straight-on
  - hvac_unit_side, trash_can_diameter, person_shoulder_span (last-resort fallbacks)

For EACH reference you identify, return its endpoints in normalized image coordinates (0..1, top-left origin). Measure the canonical axis for that reference type:
  - sidewalk_width: across the sidewalk (perpendicular to walking direction)
  - parking_space_short_axis: across the stall (the 9-ft side)
  - parking_space_long_axis: along the stall (the 18-ft side)
  - sedan_length / pickup_truck_length: bumper to bumper (long axis)
  - driveway_width: across the driveway (perpendicular to direction of travel)

If the photo is not aerial or no scale reference is identifiable, return scale_references: [] and set notes accordingly. The orchestrator will fall back to address-based estimation.

PITCH:
For nadir (true top-down) photos, pitch is essentially invisible. Set pitch_confidence = "low" and pitch_rise_in_12 = 6 (residential typical). For oblique photos, estimate from foreshortening of the gable end and surface-area visible per segment.

Schema (every field required, even if 0 or empty):

{
  "view_type": "nadir" | "oblique" | "ground_level" | "unknown",
  "view_confidence": "high" | "medium" | "low",

  "roof_polygon_normalized": [[x,y], ...],   // primary building only, min 4 points, typically 6-14
  "polygon_confidence": "high" | "medium" | "low",
  "polygon_source_photo_index": number,      // 0-based; which submitted photo the polygon was traced from

  "pitch_rise_in_12": number,                // 4-12; default 6 if uncertain
  "pitch_confidence": "high" | "medium" | "low",

  "segment_count": number,
  "complexity": "simple_gable" | "hip_or_valleys" | "complex_cutup",
  "visible_layers": 1 | 2,

  "scale_references": [
    {
      "type": "sidewalk_width" | "single_driveway_width" | "double_driveway_width" | "sedan_length" | "pickup_truck_length" | "parking_space_short_axis" | "parking_space_long_axis" | "garage_door_width" | "shingle_course_height" | "trash_can_diameter" | "hvac_unit_side" | "person_shoulder_span",
      "photo_index": number,             // 0-based; which photo this reference is from
      "from": [x, y],                    // normalized [0..1] in THAT photo's coordinate system
      "to": [x, y],
      "confidence": "high" | "medium" | "low",
      "notes": "what specifically you're measuring (e.g. 'sidewalk in front of property')"
    }
  ],

  "penetrations": {
    "plumbing_vents":    { "count": number, "confidence": "high"|"medium"|"low" },
    "exhaust_vents":     { "count": number, "confidence": "high"|"medium"|"low" },
    "box_vents":         { "count": number, "confidence": "high"|"medium"|"low" },
    "skylights":         { "count": number, "confidence": "high"|"medium"|"low" },
    "chimneys":          { "count": number, "confidence": "high"|"medium"|"low" },
    "satellite_dishes":  { "count": number, "confidence": "high"|"medium"|"low" },
    "solar_panels":      { "count": number, "confidence": "high"|"medium"|"low" },
    "power_attic_vents": { "count": number, "confidence": "high"|"medium"|"low" }
  },

  "notes": [string, ...],
  "reasoning": "brief explanation of how you measured scale and traced the roof"
}`;

export type PhotoInput = {
  buffer: Buffer;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
};

export async function analyzePhotoForMeasurement(
  photos: PhotoInput[],
  hint?: string
): Promise<PhotoAnalysis> {
  if (photos.length === 0) throw new Error("at least one photo required");

  // Build a content array with one image block per photo. Claude
  // ingests multi-image messages natively. The text block at the end
  // tells the model these are multiple views of the SAME property and
  // it should aggregate scale references across all of them while
  // returning ONE roof polygon (best view).
  const content: Anthropic.Messages.ContentBlockParam[] = photos.map((p) => ({
    type: "image" as const,
    source: { type: "base64" as const, media_type: p.mediaType, data: p.buffer.toString("base64") },
  }));

  const photoContext = photos.length === 1
    ? "Identify the roof and at least one scale reference, then output the JSON object."
    : `These ${photos.length} photos show the SAME property from different angles or zoom levels. Aggregate scale references from ALL photos into the scale_references array, but return ONE roof polygon traced from the photo where the roof outline is most clearly visible. If different photos give conflicting reference measurements, list each one — the orchestrator handles disagreement.`;
  content.push({
    type: "text",
    text: hint
      ? `${photoContext}\n\nProperty context (for cross-reference only — measure scale from the photos themselves): ${hint}`
      : photoContext,
  });

  const resp = await getClient().messages.create({
    model: "claude-opus-4-7",
    max_tokens: 4096,
    system: SYSTEM,
    messages: [{ role: "user", content }],
  });

  const text = resp.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const raw = JSON.parse(cleaned) as Record<string, unknown>;

  // Normalize the scale_references array. Server-side override of
  // `assumed_real_length_ft` from our canonical lookup, so the model
  // can't accidentally claim "this sedan is 25 ft" and bust the math.
  const rawRefs = Array.isArray(raw.scale_references) ? raw.scale_references as Array<Record<string, unknown>> : [];
  const numPhotos = photos.length;
  const scale_references: ScaleReference[] = rawRefs
    .filter((r) => typeof r.type === "string" && r.type in REFERENCE_LENGTHS_FT)
    .map((r) => {
      const type = r.type as ReferenceType;
      const from = r.from as NormalizedPoint;
      const to = r.to as NormalizedPoint;
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      const pixel_length_normalized = Math.sqrt(dx * dx + dy * dy);
      // photo_index: clamp to valid range. If unspecified or out of
      // range, default to 0 (treat as first/primary photo) — better
      // than dropping the reference entirely.
      const rawIdx = typeof r.photo_index === "number" ? r.photo_index : 0;
      const photo_index = Math.max(0, Math.min(numPhotos - 1, Math.floor(rawIdx)));
      return {
        type,
        photo_index,
        from,
        to,
        pixel_length_normalized,
        assumed_real_length_ft: REFERENCE_LENGTHS_FT[type].length,
        confidence: (r.confidence as "high" | "medium" | "low") ?? "low",
        vision_notes: typeof r.notes === "string" ? r.notes : undefined,
      };
    })
    .filter((r) => r.pixel_length_normalized > 0.005);  // reject zero-length / noise refs

  const polygonSourceRaw = typeof raw.polygon_source_photo_index === "number"
    ? raw.polygon_source_photo_index
    : 0;
  const polygon_source_photo_index = Math.max(0, Math.min(numPhotos - 1, Math.floor(polygonSourceRaw)));

  const penetrations = flattenPenetrations(raw.penetrations);

  return {
    view_type: (raw.view_type as PhotoAnalysis["view_type"]) ?? "unknown",
    view_confidence: (raw.view_confidence as PhotoAnalysis["view_confidence"]) ?? "low",
    roof_polygon_normalized: (raw.roof_polygon_normalized as NormalizedPoint[]) ?? [],
    polygon_confidence: (raw.polygon_confidence as PhotoAnalysis["polygon_confidence"]) ?? "low",
    polygon_source_photo_index,
    pitch_rise_in_12: typeof raw.pitch_rise_in_12 === "number" ? raw.pitch_rise_in_12 : 6,
    pitch_confidence: (raw.pitch_confidence as PhotoAnalysis["pitch_confidence"]) ?? "low",
    segment_count: typeof raw.segment_count === "number" ? raw.segment_count : 1,
    complexity: (raw.complexity as PhotoAnalysis["complexity"]) ?? "hip_or_valleys",
    visible_layers: (raw.visible_layers === 2 ? 2 : 1),
    scale_references,
    penetrations,
    notes: Array.isArray(raw.notes) ? raw.notes as string[] : [],
    reasoning: typeof raw.reasoning === "string" ? raw.reasoning : "",
  };
}

// Pixels-per-foot via INVERSE-VARIANCE WEIGHTING across references.
//
// Why not plain median: median treats every reference equally, but
// our references have wildly different real-world variance — a
// sidewalk (±0.5 ft of 4.5 ft = 11% variance) is 4x more reliable
// than a single driveway (±2 ft of 10 ft = 20% variance). Plain
// median lets the high-variance references skew the result the same
// as low-variance ones.
//
// Inverse-variance weighting (the standard trick for combining
// noisy estimators) gives optimal precision: each reference's weight
// is 1/σ². Vision's stated confidence (high/medium/low) further
// modulates: low-confidence references get penalized.
//
// pixels_per_foot is expressed in NORMALIZED coords — fraction of
// the image's diagonal/width per real-world foot. Because polygons
// are in the same normalized space, area math cancels image dims.
//
// Returns the weighted estimate plus diagnostics (per-reference
// breakdown, agreement %, and which reference contributed most).
export type PpfBreakdown = {
  type: ReferenceType;
  ppf: number;            // pixels-per-foot for this reference alone
  weight: number;         // normalized to sum=1 across all refs
  variance_ft: number;    // assumed σ in feet
  confidence: "high" | "medium" | "low";
};

export type PpfResult = {
  value: number;          // weighted pixels-per-foot
  agreement_pct: number;  // 100 = all refs agreed; 0 = max disagreement
  per_ref: PpfBreakdown[];
  best_contributor: ReferenceType | null;  // highest-weight reference
};

const VISION_CONFIDENCE_FACTOR: Record<"high" | "medium" | "low", number> = {
  high:   1.0,
  medium: 0.6,
  low:    0.25,  // not zero — low-confidence still informs when nothing else is available
};

// Compute per-photo ppf, plus a primary-photo selection.
//
// Each photo has its OWN normalized coordinate system, so refs from
// different photos can't be averaged into one ppf. We compute ppf
// independently per photo, then pick the polygon-source photo's ppf
// as the one that drives the area calculation. The other photos
// become a cross-photo agreement diagnostic — telling the contractor
// whether the multiple uploads roughly agree on camera height.
export type PerPhotoPpf = {
  photo_index: number;
  ppf: PpfResult;       // within-photo agreement
};

export type MultiPhotoPpfResult = {
  primary_photo_index: number;
  primary_ppf: PpfResult;                    // the one used for area math
  per_photo: PerPhotoPpf[];                  // includes primary
  cross_photo_agreement_pct: number;         // 100 = all photos agree on ppf scale; 0 = max disagreement
};

export function computePerPhotoPpf(
  refs: ScaleReference[],
  primaryPhotoIndex: number,
): MultiPhotoPpfResult | null {
  if (refs.length === 0) return null;

  // Group references by photo.
  const byPhoto = new Map<number, ScaleReference[]>();
  for (const r of refs) {
    const arr = byPhoto.get(r.photo_index);
    if (arr) arr.push(r);
    else byPhoto.set(r.photo_index, [r]);
  }

  // Compute ppf for each photo.
  const per_photo: PerPhotoPpf[] = [];
  for (const [photo_index, photoRefs] of byPhoto.entries()) {
    const ppf = computePixelsPerFootNormalized(photoRefs);
    if (ppf) per_photo.push({ photo_index, ppf });
  }
  per_photo.sort((a, b) => a.photo_index - b.photo_index);

  if (per_photo.length === 0) return null;

  // Pick primary: the polygon-source photo if it has refs, else the
  // photo with the most references.
  let primary = per_photo.find((p) => p.photo_index === primaryPhotoIndex);
  if (!primary) {
    primary = per_photo.reduce((best, cur) =>
      cur.ppf.per_ref.length > best.ppf.per_ref.length ? cur : best
    );
  }

  // Cross-photo agreement: how close are the per-photo ppf values?
  // 100 = identical (cameras all at same altitude/zoom; or single
  // photo); 0 = maximum disagreement.
  let cross_photo_agreement_pct = 100;
  if (per_photo.length > 1) {
    const ppfs = per_photo.map((p) => p.ppf.value).sort((a, b) => a - b);
    const minVal = ppfs[0];
    const maxVal = ppfs[ppfs.length - 1];
    const median = ppfs[Math.floor(ppfs.length / 2)];
    const spread = maxVal === minVal || median === 0 ? 0 : (maxVal - minVal) / median;
    cross_photo_agreement_pct = Math.max(0, Math.min(100, Math.round((1 - spread) * 100)));
  }

  return {
    primary_photo_index: primary.photo_index,
    primary_ppf: primary.ppf,
    per_photo,
    cross_photo_agreement_pct,
  };
}

export function computePixelsPerFootNormalized(refs: ScaleReference[]): PpfResult | null {
  if (refs.length === 0) return null;

  // For each reference: ppf = pixel_length / real_length.
  // Variance of ppf = (∂ppf/∂real_length)² · σ_real² = (-pixel_length/real_length²)² · σ²
  //                 = (ppf / real_length)² · σ²
  // So σ_ppf = ppf · σ_real / real_length — i.e. fractional variance is constant.
  // We can use 1/(σ_ppf)² as the weight; the ppf-squared factor cancels
  // when we normalize, so weight ∝ (real_length / σ_real)².
  const items = refs.map((r) => {
    const meta = REFERENCE_LENGTHS_FT[r.type];
    const ppf = r.pixel_length_normalized / r.assumed_real_length_ft;
    const fractionalVariance = meta.variance / meta.length;
    // Weight = (1 / fractional_variance)² · vision_confidence_factor.
    // Special-case zero-variance refs (e.g. shingle_course): they're
    // PERFECT, so a finite huge weight rather than infinity.
    const baseWeight = fractionalVariance > 0
      ? Math.pow(1 / fractionalVariance, 2)
      : 1000;
    const weight = baseWeight * VISION_CONFIDENCE_FACTOR[r.confidence];
    return { type: r.type, ppf, rawWeight: weight, variance_ft: meta.variance, confidence: r.confidence };
  });

  const totalWeight = items.reduce((s, it) => s + it.rawWeight, 0);
  if (totalWeight <= 0) return null;

  const value = items.reduce((s, it) => s + it.ppf * it.rawWeight, 0) / totalWeight;

  // agreement_pct: 100 means all refs gave the same ppf; 0 = max
  // disagreement (spread >= the value itself). Computed on raw spread,
  // not weighted, so it reflects honest disagreement to the contractor.
  const ppfs = items.map((it) => it.ppf).sort((a, b) => a - b);
  const minVal = ppfs[0];
  const maxVal = ppfs[ppfs.length - 1];
  const spread = maxVal === minVal ? 0 : (maxVal - minVal) / value;
  const agreement_pct = Math.max(0, Math.min(100, Math.round((1 - spread) * 100)));

  const per_ref: PpfBreakdown[] = items.map((it) => ({
    type: it.type,
    ppf: it.ppf,
    weight: it.rawWeight / totalWeight,
    variance_ft: it.variance_ft,
    confidence: it.confidence,
  }));

  const best = per_ref.reduce<PpfBreakdown | null>((best, cur) => (best == null || cur.weight > best.weight ? cur : best), null);

  return { value, agreement_pct, per_ref, best_contributor: best?.type ?? null };
}

// Shoelace formula on a normalized polygon → area in normalized^2.
// To get real square feet, multiply by (1 / pixels_per_foot_normalized)^2
// because normalized_area_per_real_sqft = pixels_per_foot_normalized^2.
export function polygonAreaNormalized(poly: NormalizedPoint[]): number {
  if (poly.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

// Convert a footprint area (ground projection) to total roof surface
// area using the pitch multiplier. Mirrors the pitch math in measure.ts.
export function footprintToTotalSqft(footprintSqft: number, pitchRiseIn12: number): number {
  const slope = Math.sqrt(pitchRiseIn12 * pitchRiseIn12 + 144) / 12;  // hypotenuse / 12
  return footprintSqft * slope;
}

// EXIF altitude → ground sample distance (GSD) → pixels-per-foot in
// normalized image coordinates.
//
// The math:
//   sensor_width_mm = 36                 (35mm-equivalent reference frame)
//   field_of_view_meters = (sensor_width / focal_length_35mm_equiv) × altitude_AGL
//   GSD_meters_per_pixel = field_of_view_meters / image_pixel_width
//   ppf_normalized = 1 / (GSD_meters_per_pixel × image_pixel_width × meters_to_feet)
//                  = 1 / (real_image_width_meters × 3.28084)
//
// This produces an INDEPENDENT scale signal — it doesn't rely on
// vision identifying anything in the frame. When EXIF is present
// AND we can resolve ground elevation, this is typically the most
// reliable signal in the ensemble (variance ~5% from altitude noise,
// vs 11-20% for the most reliable visual references).
//
// Returns null if any required input is missing — callers fall back
// to vision-references-only.
const M_TO_FT = 3.28084;
const SENSOR_WIDTH_35MM = 36;  // mm

export type ExifInputs = {
  focalLength35mmEquiv?: number;     // mm; iPhones/Androids/most drones report this
  altitudeAboveSeaLevelM: number;    // EXIF GPSAltitude, meters
  imagePixelWidth: number;           // raw image width in pixels
};

export function computeGsdPpfNormalized(
  exif: ExifInputs,
  groundElevationM: number,
): { value: number; altitude_agl_m: number; sigma_pct: number } | null {
  if (!exif.focalLength35mmEquiv || exif.focalLength35mmEquiv <= 0) return null;
  if (!exif.imagePixelWidth || exif.imagePixelWidth <= 0) return null;

  const altitudeAglM = exif.altitudeAboveSeaLevelM - groundElevationM;
  // Sanity: phone selfies have AGL around 1-2m. Real aerials are ~30m+.
  if (altitudeAglM < 10) return null;

  const fovMeters = (SENSOR_WIDTH_35MM / exif.focalLength35mmEquiv) * altitudeAglM;
  const fovFeet = fovMeters * M_TO_FT;

  // Normalized space: 1.0 unit = full image width = fovFeet feet.
  // So ppf_normalized = 1.0 / fovFeet.
  const ppf = 1 / fovFeet;

  // Variance estimate. Dominated by altitude noise:
  //   - phone GPS vertical: ±5 m typical
  //   - drone barometer: ±1 m
  // For 60 m AGL, ±5 m → ~8% variance. We don't know which, so
  // assume the conservative phone case → ~8% σ.
  // Above 100 m AGL the relative error drops; below 30 m it can
  // climb above 15%. Express as σ as a fraction.
  const altitudeSigmaM = 5;
  const sigma_pct = Math.min(20, (altitudeSigmaM / altitudeAglM) * 100);

  return { value: ppf, altitude_agl_m: altitudeAglM, sigma_pct };
}

// Combine vision-references PPF with EXIF GSD PPF via inverse-variance
// weighting. The vision PpfResult is a single point estimate with its
// own variance derived from references. GSD is another point estimate
// with sigma_pct. Final estimate is the weighted average.
export function combinePpfWithGsd(
  vision: PpfResult,
  gsd: { value: number; sigma_pct: number },
): PpfResult {
  // Vision spread → effective σ. Treat agreement_pct as proxy:
  // 100% agreement → σ ~ 5% (aggregate of references, all reliable),
  // 50% agreement → σ ~ 25%, 0% → σ ~ 50%.
  const visionSigmaPct = (100 - vision.agreement_pct) * 0.5 + 5;
  const visionWeight = 1 / Math.pow(visionSigmaPct / 100, 2);
  const gsdWeight = 1 / Math.pow(gsd.sigma_pct / 100, 2);
  const totalWeight = visionWeight + gsdWeight;
  const blended = (vision.value * visionWeight + gsd.value * gsdWeight) / totalWeight;

  // Cross-validation agreement: how close are the two independent signals?
  const spread = vision.value > 0 ? Math.abs(vision.value - gsd.value) / vision.value : 1;
  const cross_agreement_pct = Math.max(0, Math.min(100, Math.round((1 - spread) * 100)));

  // Use the better of the original within-references agreement and
  // the cross-validation agreement — the latter is meaningful only
  // when we have BOTH signals.
  const agreement_pct = Math.min(vision.agreement_pct, cross_agreement_pct);

  return {
    value: blended,
    agreement_pct,
    per_ref: vision.per_ref,
    best_contributor: gsdWeight > visionWeight ? null : vision.best_contributor,
  };
}

// Reuse the same penetration-flattening logic as vision.ts (kept local
// to avoid a circular import).
function flattenPenetrations(raw: unknown): Penetrations {
  const out: Penetrations = {
    plumbing_vents: 0, exhaust_vents: 0, box_vents: 0, skylights: 0,
    chimneys: 0, satellite_dishes: 0, solar_panels: 0, power_attic_vents: 0,
    confidence: {},
    source: "vision",
  };
  if (!raw || typeof raw !== "object") return out;
  const cats: Array<keyof Penetrations> = [
    "plumbing_vents", "exhaust_vents", "box_vents", "skylights",
    "chimneys", "satellite_dishes", "solar_panels", "power_attic_vents",
  ] as const as Array<keyof Penetrations>;
  const r = raw as Record<string, unknown>;
  for (const c of cats) {
    const entry = r[c as string];
    if (entry && typeof entry === "object") {
      const e = entry as { count?: number; confidence?: "high" | "medium" | "low" };
      // Apply confidence threshold: drop "low" to 0 (consistent with
      // existing measure.ts behavior — don't charge for uncertain reads).
      const conf = e.confidence ?? "low";
      const count = typeof e.count === "number" ? e.count : 0;
      (out as unknown as Record<string, number>)[c as string] = conf === "low" ? 0 : count;
      if (out.confidence) (out.confidence as Record<string, "high" | "medium" | "low">)[c as string] = conf;
    }
  }
  return out;
}
