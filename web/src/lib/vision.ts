// Comprehensive Claude-vision pass over satellite (and optional streetview)
// imagery. We send all imagery + ask for a single structured response that
// includes:
//   - Total + footprint sqft + pitch (independent of Solar)
//   - Roof boundary polygon in normalized image coords (we compute area from it)
//   - Classified roof edges (ridge / hip / valley / rake / eave)
//   - Penetration counts (vents, pipes, skylights, chimneys, satellite, solar)
//
// Doing it in one round-trip keeps cost down (image tokens dominate) and
// lets the model reason holistically about the same scene.

import Anthropic from "@anthropic-ai/sdk";
import type { Penetrations, ClassifiedEdge, EdgeType, PenetrationCategory, PenetrationConfidence } from "./types";

// Lazy client init — reads process.env at call time, not module load.
// Module-load init breaks scripts that load .env.local AFTER importing
// measurement code (ESM hoists imports above runtime config).
let clientCache: Anthropic | null = null;
function getClient(): Anthropic {
  if (!clientCache) {
    clientCache = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return clientCache;
}

export type VisionPolygonPoint = [number, number];  // normalized [0..1, 0..1]
export type VisionEdgeRaw = { type: EdgeType; from: VisionPolygonPoint; to: VisionPolygonPoint };

export type RoofAnalysis = {
  // ----- area & geometry -----
  total_sqft_estimate: number;
  footprint_sqft_estimate: number;
  pitch_rise_in_12: number;
  segment_count: number;
  complexity: "simple_gable" | "hip_or_valleys" | "complex_cutup";
  visible_layers: 1 | 2;

  // ----- independent footprint via polygon -----
  // Outermost roof boundary in normalized image coords (0..1, top-left origin).
  // Multiple polygons supported for L-shaped or detached structures, but
  // typically one for a single home.
  roof_polygon_normalized: VisionPolygonPoint[];
  polygon_confidence: "high" | "medium" | "low";

  // ----- edge classification -----
  // Each edge labelled by type with normalized endpoint coords.
  edges: VisionEdgeRaw[];

  // ----- penetrations (raw shape Claude returns) -----
  // Claude returns { count, confidence } per category. We flatten it
  // into the Penetrations type below.
  penetrations: Penetrations;
  // Raw per-category response (kept for transparency / debugging).
  penetrations_raw?: Partial<Record<PenetrationCategory, { count: number; confidence: PenetrationConfidence }>>;

  // ----- meta -----
  notes: string[];
  reasoning: string;
};

// Backward-compat shape used by callers that haven't migrated.
export type VisionEstimate = {
  total_sqft_estimate: number;
  footprint_sqft_estimate: number;
  pitch_rise_in_12: number;
  segment_count: number;
  complexity: "simple_gable" | "hip_or_valleys" | "complex_cutup";
  visible_layers: 1 | 2;
  pipe_boots_visible: number;
  notes: string[];
  reasoning: string;
};

const SYSTEM = `You are a senior roof estimator analyzing top-down satellite imagery and street-level photos of a residential property. Output ONLY a single JSON object — no prose, no markdown fences.

CRITICAL — TARGET BUILDING IDENTIFICATION:
The satellite image contains a small RED MARKER PIN placed on the target building. The image is also centered on that building. There may be 4–8 neighboring houses fully or partially visible. **DO NOT trace neighbors.** The polygon, edges, and penetration counts must describe ONLY the building under the red pin. If you can't tell which building has the pin (e.g. tree obstruction), trace the building closest to the geometric center of the image.

All polygon points and all edge endpoints must lie WITHIN the target building's roof outline.

Schema (every field required, even if 0 or empty):

{
  "total_sqft_estimate": number,            // pitch-adjusted roof surface area
  "footprint_sqft_estimate": number,        // ground projection (smaller than total when pitch > 0)
  "pitch_rise_in_12": number,               // residential typical 4–9
  "segment_count": number,                  // number of distinct roof planes
  "complexity": "simple_gable" | "hip_or_valleys" | "complex_cutup",
  "visible_layers": 1 | 2,

  "roof_polygon_normalized": [[x,y], ...],  // outermost boundary, NORMALIZED 0..1, top-left origin.
                                            // Trace the visible roof outline of the PRIMARY building
                                            // only (not detached garages or neighbors). Min 4 points,
                                            // typically 6–14 for an L-shape or hip roof.
  "polygon_confidence": "high" | "medium" | "low",

  "edges": [                                // classified visible roof lines
    { "type": "ridge"|"hip"|"valley"|"rake"|"eave", "from": [x,y], "to": [x,y] }
  ],

  "penetrations": {
    "plumbing_vents":   { "count": number, "confidence": "high"|"medium"|"low" },
    "exhaust_vents":    { "count": number, "confidence": "high"|"medium"|"low" },
    "box_vents":        { "count": number, "confidence": "high"|"medium"|"low" },
    "skylights":        { "count": number, "confidence": "high"|"medium"|"low" },
    "chimneys":         { "count": number, "confidence": "high"|"medium"|"low" },
    "satellite_dishes": { "count": number, "confidence": "high"|"medium"|"low" },
    "solar_panels":     { "count": number, "confidence": "high"|"medium"|"low" },
    "power_attic_vents":{ "count": number, "confidence": "high"|"medium"|"low" }
  },

  // Penetration disambiguation guide — be deliberate here. The cost model
  // depends on accurate classification, not just "count of things sticking
  // up." Only count items you can identify; if uncertain, mark "low"
  // confidence.
  //
  // - plumbing_vents:    1–4" diameter dark cylindrical pipes, NO cap.
  //                      Typically grouped near bathrooms/kitchen. 2–6 per home.
  // - exhaust_vents:     mushroom-cap or hooded fixtures (kitchen / bath fan vents).
  // - box_vents:         rectangular or square LOW caps (turtle/static vents),
  //                      usually painted to match shingles. Often near the ridge.
  // - power_attic_vents: dome-shaped powered ventilators with visible motor housing.
  // - chimneys:          masonry or metal STACKS with significant height (>1 ft).
  //                      Often have crown/cap. NOT cylindrical pipes.
  // - skylights:         rectangular GLASS panels, flush with roof plane.
  // - satellite_dishes:  obvious dish shape on a mast.
  // - solar_panels:      dark rectangular GRIDS of panels. Count distinct arrays
  //                      (one big array on the south face = 1, not 12).
  //
  // If two categories look similar from above (e.g. a small box vent vs a
  // skylight far from the eaves), prefer the structural test: skylights are
  // glass and reflective; box vents are matte. When still uncertain, set
  // confidence to "low" — downstream code drops low-confidence counts.

  "notes": string[],                        // brief callouts (dormer, cricket, etc)
  "reasoning": string                       // 1–2 sentence rationale
}

Roofing terminology you must use correctly:
- ridge: HORIZONTAL peak line where two opposing planes meet at the top
- hip: ANGLED line sloping down from the ridge to a building corner
- valley: INWARD-FACING angled line where two planes drain water
- eave: HORIZONTAL lower edge of a roof plane (overhang above a wall)
- rake: SLOPED lower edge of a roof plane on a gable end

Calibration anchors (typical 2026 US suburban):
- Simple ranch single-story: 1,400–2,000 sqft footprint
- Two-story 4-bed: 2,200–3,200 sqft footprint
- Larger custom: 3,500–5,500 sqft footprint
- Pitches by era: pre-1960 often 4:12; 1960–2000 mostly 6:12; 2000+ often 7–9:12 in suburbs.
- Hip roofs have eaves on all four sides; gables have triangular wall ends with rakes.
- Footprint × pitch_multiplier = total roof surface (e.g. 6:12 multiplier 1.118).

Coordinate system: normalized [0..1, 0..1], top-left origin, x increases right, y increases DOWN. Use 4 decimal places of precision.`;

// Download images and inline them as base64 — Anthropic's by-URL fetch
// respects robots.txt, which blocks Google Maps Static tiles.
async function imagesAsContent(imageUrls: string[]): Promise<Anthropic.Messages.ContentBlockParam[]> {
  const out: Anthropic.Messages.ContentBlockParam[] = [];
  for (const url of imageUrls) {
    if (!url) continue;
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const ct = r.headers.get("content-type") || "image/png";
      if (!ct.startsWith("image/")) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 1024) continue;  // skip "no imagery" stubs
      out.push({
        type: "image",
        source: {
          type: "base64",
          media_type: ct as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
          data: buf.toString("base64"),
        },
      });
    } catch {
      // skip; keep going
    }
  }
  return out;
}

export async function analyzeRoof(imageUrls: string[], hint?: string): Promise<RoofAnalysis> {
  const content = await imagesAsContent(imageUrls);
  if (content.length === 0) throw new Error("no usable imagery to send to vision");
  content.push({ type: "text", text: hint ? `Address context: ${hint}` : "Analyze the imagery and return the JSON object." });

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
  const raw = JSON.parse(cleaned) as any;

  // Normalize the penetrations payload. Claude returns the {count, confidence}
  // per-category shape; we flatten to our internal Penetrations type with a
  // separate `confidence` map. Tolerate either shape (defensive).
  const penetrations = flattenPenetrations(raw.penetrations);

  const parsed: RoofAnalysis = {
    total_sqft_estimate: raw.total_sqft_estimate ?? 0,
    footprint_sqft_estimate: raw.footprint_sqft_estimate ?? 0,
    pitch_rise_in_12: raw.pitch_rise_in_12 ?? 6,
    segment_count: raw.segment_count ?? 1,
    complexity: raw.complexity ?? "hip_or_valleys",
    visible_layers: raw.visible_layers ?? 1,
    roof_polygon_normalized: raw.roof_polygon_normalized ?? [],
    polygon_confidence: raw.polygon_confidence ?? "medium",
    edges: raw.edges ?? [],
    penetrations,
    penetrations_raw: typeof raw.penetrations === "object" ? raw.penetrations : undefined,
    notes: raw.notes ?? [],
    reasoning: raw.reasoning ?? "",
  };
  return parsed;
}

const PENETRATION_CATEGORIES: PenetrationCategory[] = [
  "plumbing_vents", "exhaust_vents", "box_vents", "skylights",
  "chimneys", "satellite_dishes", "solar_panels", "power_attic_vents",
];

function flattenPenetrations(raw: any): Penetrations {
  const out: Penetrations = {
    plumbing_vents: 0, exhaust_vents: 0, box_vents: 0, skylights: 0,
    chimneys: 0, satellite_dishes: 0, solar_panels: 0, power_attic_vents: 0,
    confidence: {},
    source: "vision",
  };
  if (!raw || typeof raw !== "object") return out;

  for (const cat of PENETRATION_CATEGORIES) {
    const v = raw[cat];
    if (typeof v === "number") {
      // Old shape: just a flat number.
      out[cat] = Math.max(0, Math.round(v));
    } else if (v && typeof v === "object") {
      // New shape: { count, confidence }.
      const count = typeof v.count === "number" ? Math.max(0, Math.round(v.count)) : 0;
      const conf = (v.confidence === "high" || v.confidence === "medium" || v.confidence === "low")
        ? v.confidence as PenetrationConfidence
        : "medium";
      out[cat] = count;
      out.confidence![cat] = conf;
    }
  }
  return out;
}

// Apply confidence thresholds: zero out counts whose confidence is "low"
// and notes that the data was filtered. Keeps high/medium counts as-is.
// Run this BEFORE feeding penetrations into quote.ts so we don't charge
// for things vision wasn't sure about.
export function applyConfidenceThresholds(p: Penetrations): { filtered: Penetrations; dropped: PenetrationCategory[] } {
  const dropped: PenetrationCategory[] = [];
  const filtered: Penetrations = { ...p, confidence: { ...(p.confidence ?? {}) } };
  for (const cat of PENETRATION_CATEGORIES) {
    const conf = filtered.confidence?.[cat];
    if (conf === "low" && filtered[cat] > 0) {
      dropped.push(cat);
      filtered[cat] = 0;
    }
  }
  return { filtered, dropped };
}

// Targeted pitch estimation from a Street View image. Asks Claude to look
// at the gable end specifically (where the rise/run is directly visible
// as the triangle of the side wall) and return rise:12. Independent of
// Solar's elevation-model reading — useful as a tie-breaker when the two
// disagree.
export type StreetViewPitchEstimate = {
  rise_in_12: number;
  confidence: "high" | "medium" | "low";
  reasoning: string;
  visible: boolean;
};

const PITCH_SYSTEM = `You are a senior roofer estimating pitch from a residential street-view photo.

Look at the GABLE END of the building if visible — the triangle formed by the side wall where the roof slopes meet at the peak. Pitch is the rise (vertical) over a 12-inch run (horizontal). Standard residential pitches:
- 3:12 / 4:12 — shallow, walkable
- 5:12 / 6:12 — standard suburban
- 7:12 / 8:12 — steep, common on 2000s+ homes
- 9:12+ — very steep, harder to walk

Read pitch by mentally drawing a horizontal line at the eave, then measuring how far the peak rises across half the building width. A 6:12 pitch means the peak is 6 inches above the eave for every 12 inches of horizontal run.

Calibration anchors:
- A 30° roof angle from the horizontal ≈ 7:12
- A 26.6° angle ≈ 6:12
- A 45° angle ≈ 12:12

Return ONLY this JSON (no markdown):
{
  "rise_in_12": number,            // integer 3..14, or 0 if no gable visible
  "confidence": "high"|"medium"|"low",
  "reasoning": "1 sentence — what you saw, how you measured",
  "visible": boolean               // false if street view shows no roof / blocked / wrong angle
}`;

export async function estimatePitchFromStreetView(streetViewUrl: string, hint?: string): Promise<StreetViewPitchEstimate | null> {
  if (!streetViewUrl) return null;
  const content: Anthropic.Messages.ContentBlockParam[] = [];
  try {
    const r = await fetch(streetViewUrl);
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "image/jpeg";
    if (!ct.startsWith("image/")) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 5000) return null;  // street view "no imagery" stubs are tiny
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: ct as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
        data: buf.toString("base64"),
      },
    });
  } catch {
    return null;
  }
  content.push({ type: "text", text: hint ? `Address: ${hint}. Estimate pitch from the gable end if visible.` : "Estimate pitch from the gable end if visible." });

  const resp = await getClient().messages.create({
    model: "claude-opus-4-7",
    max_tokens: 512,
    system: PITCH_SYSTEM,
    messages: [{ role: "user", content }],
  });

  const text = resp.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as StreetViewPitchEstimate;
    if (!parsed.visible || parsed.rise_in_12 < 2 || parsed.rise_in_12 > 16) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Backward-compat thin wrapper: returns the old VisionEstimate shape.
// Used by the cross-check path in measure.ts that doesn't need the full
// polygon / edges / penetrations payload.
export async function estimateFromImagery(imageUrls: string[], hint?: string): Promise<VisionEstimate> {
  const a = await analyzeRoof(imageUrls, hint);
  return {
    total_sqft_estimate: a.total_sqft_estimate,
    footprint_sqft_estimate: a.footprint_sqft_estimate,
    pitch_rise_in_12: a.pitch_rise_in_12,
    segment_count: a.segment_count,
    complexity: a.complexity,
    visible_layers: a.visible_layers,
    pipe_boots_visible: a.penetrations.plumbing_vents,
    notes: a.notes,
    reasoning: a.reasoning,
  };
}

// ============================================================================
// Geometric helpers — convert vision's normalized-coordinate output into
// real-world measurements using the imagery's projection.
// ============================================================================

// Web-Mercator pixel size in METERS at a given zoom level + latitude.
// Standard formula used by all slippy-map providers (Google, Mapbox, OSM).
export function pixelSizeMeters(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

const M2_TO_SQFT = 10.7639;
const FT_PER_M = 3.28084;

// Shoelace formula on normalized coords scaled by image dimensions and
// pixel size. Returns area in sqft (footprint, since the image is top-down).
export function polygonAreaSqft(polygon: VisionPolygonPoint[], imageSizePx: number, lat: number, zoom: number): number {
  if (polygon.length < 3) return 0;
  // Convert normalized → pixels
  const px = polygon.map(([x, y]) => [x * imageSizePx, y * imageSizePx] as [number, number]);
  // Shoelace
  let acc = 0;
  for (let i = 0; i < px.length; i++) {
    const j = (i + 1) % px.length;
    acc += px[i][0] * px[j][1] - px[j][0] * px[i][1];
  }
  const areaPx = Math.abs(acc) / 2;
  const pxSize = pixelSizeMeters(lat, zoom);
  const areaM2 = areaPx * pxSize * pxSize;
  return Math.round(areaM2 * M2_TO_SQFT);
}

// Length of a single edge in linear feet given normalized endpoints.
export function edgeLengthLf(from: VisionPolygonPoint, to: VisionPolygonPoint, imageSizePx: number, lat: number, zoom: number): number {
  const dx = (to[0] - from[0]) * imageSizePx;
  const dy = (to[1] - from[1]) * imageSizePx;
  const distPx = Math.sqrt(dx * dx + dy * dy);
  const pxSize = pixelSizeMeters(lat, zoom);
  return distPx * pxSize * FT_PER_M;
}

// Project a list of vision-classified edges to ClassifiedEdge[] with real-world lengths.
export function projectEdges(edges: VisionEdgeRaw[], imageSizePx: number, lat: number, zoom: number): ClassifiedEdge[] {
  return edges.map((e) => ({
    type: e.type,
    length_lf: Math.round(edgeLengthLf(e.from, e.to, imageSizePx, lat, zoom)),
    pixels: {
      from: [Math.round(e.from[0] * imageSizePx), Math.round(e.from[1] * imageSizePx)] as [number, number],
      to:   [Math.round(e.to[0]   * imageSizePx), Math.round(e.to[1]   * imageSizePx)] as [number, number],
    },
  }));
}

// Sum lengths by edge type — produces the line_items totals that quote.ts consumes.
export function sumEdgeLengths(edges: ClassifiedEdge[]): { ridge: number; hip: number; valley: number; rake: number; eave: number } {
  const out = { ridge: 0, hip: 0, valley: 0, rake: 0, eave: 0 };
  for (const e of edges) out[e.type] += e.length_lf;
  return out;
}
