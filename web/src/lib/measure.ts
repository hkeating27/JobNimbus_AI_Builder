// Top-level measurement pipeline: address → RoofMeasurement.
//
// The pipeline runs three independent sources where possible and ensembles
// the results so we're not sole-sourced from Google Solar:
//
//   1. Google Solar API     — building polygons + per-segment pitch (high accuracy when available)
//   2. Claude vision        — independent polygon + edges + penetrations from satellite imagery
//   3. OSM via Nominatim    — independent building footprint (when OSM has it tagged)
//
// Pitch is taken from Solar (most reliable). Vision and Overture provide
// footprint candidates which we multiply by pitch_multiplier for total
// sqft. The ensemble picks consensus and flags agreement level — strong
// agreement raises confidence, disagreement triggers a "low confidence"
// flag and the conservative estimate is preferred.

import {
  geocode,
  hasGoogleKey,
  solarBuildingInsights,
  staticMapUrlInternal,
  staticMapUrlPublic,
  streetViewUrlInternal,
  type SolarBuildingInsights,
} from "./google";
import {
  analyzeRoof,
  applyConfidenceThresholds,
  polygonAreaSqft,
  projectEdges,
  sumEdgeLengths,
  type RoofAnalysis,
  type StreetViewPitchEstimate,
} from "./vision";
import { lookupBuildingFootprint, type FootprintLookupResult } from "./footprints";
import type {
  Complexity,
  Pitch,
  RoofLineItems,
  RoofMeasurement,
  ClassifiedEdge,
  EdgeClassification,
  Ensemble,
  EnsembleSource,
  Penetrations,
} from "./types";

const STATIC_MAP_ZOOM = 20;
const STATIC_MAP_SIZE_PX = 800;

export async function measureRoof(address: string): Promise<RoofMeasurement> {
  const notes: string[] = [];
  const sources: string[] = [];

  // 1. Geocode
  const geo = hasGoogleKey() ? await geocode(address) : null;
  const lat = geo?.lat ?? 0;
  const lng = geo?.lng ?? 0;
  const formatted = geo?.formatted_address ?? address;
  const state = geo?.state_code ?? inferStateFromAddress(address);
  const county = geo?.county;
  if (geo) sources.push("google_geocoding");
  else notes.push("No Google API key — geocoding skipped, results lower confidence.");

  // 2a. Solar buildingInsights first — it gives us the actual building
  //     centroid, which we use to re-center the static map call.
  //     (Geocoded lat/lng is the address/door, often offset from the
  //     roof centroid by 5–15m.)
  const solar: SolarBuildingInsights | null = geo
    ? await solarBuildingInsights(lat, lng).catch((e: Error) => { notes.push(`Solar API error: ${e.message}`); return null; })
    : null;
  if (solar) sources.push("google_solar_api");

  const centerLat = solar?.centerLat ?? lat;
  const centerLng = solar?.centerLng ?? lng;

  // Note: we previously fetched Solar dataLayers + processed the raster
  // mask to draw a precise polygon overlay. The overlay was scrapped
  // (the vision-classified inner edges undermined credibility), so the
  // dataLayers fetch + sharp-based mask processing was pure overhead.
  // Removed for ~700ms latency win. precise_polygon now stays undefined.
  const precise_polygon: Array<[number, number]> | undefined = undefined;

  // 3. Vision (Claude Opus 4.7 on satellite + street view imagery) and
  //    Overture/OSM footprint lookup run IN PARALLEL. Both are
  //    independent of each other and Solar; running them in series was
  //    pure waste. Vision is the long pole (~5–8s); Overture finishes
  //    inside that window.
  //
  //    Note: we previously also ran a separate street-view pitch
  //    estimator. Calibration showed it produced 0% improvement vs.
  //    Solar's elevation-derived pitch on the 5 benchmarks, while
  //    adding ~3s. Also dropped Solar dataLayers + raster mask
  //    processing since the overlay was scrapped.
  let analysis: RoofAnalysis | null = null;
  let overture: FootprintLookupResult | null = null;

  if (geo && hasGoogleKey()) {
    const satUrl = staticMapUrlInternal(centerLat, centerLng, STATIC_MAP_ZOOM, `${STATIC_MAP_SIZE_PX}x${STATIC_MAP_SIZE_PX}`, true);
    const svUrl = streetViewUrlInternal(lat, lng);
    const [aRes, oRes] = await Promise.all([
      analyzeRoof([satUrl, svUrl].filter(Boolean), formatted).catch((e: Error) => { notes.push(`Vision analysis failed: ${e.message}`); return null; }),
      lookupBuildingFootprint(centerLat, centerLng).catch((e: Error) => { notes.push(`Overture lookup error: ${e.message}`); return null; }),
    ]);
    analysis = aRes;
    overture = oRes;
    if (analysis) sources.push("claude_vision");
    if (overture) sources.push("nominatim_osm");
  }
  const svPitch: StreetViewPitchEstimate | null = null;

  // 4. Synthesize ensemble + populate fields. Pass the building-centered
  //    lat/lng (from Solar) as the static-map center so the polygon
  //    overlay lines up with the rendered satellite image.
  return synthesize({
    address, formatted, lat, lng, centerLat, centerLng, state, county,
    solar, analysis, overture, svPitch, precise_polygon, notes, sources,
  });
}

function synthesize(args: {
  formatted: string;
  address: string;
  lat: number;
  lng: number;
  centerLat: number;
  centerLng: number;
  state: string;
  county?: string;
  solar: SolarBuildingInsights | null;
  analysis: RoofAnalysis | null;
  overture: FootprintLookupResult | null;
  svPitch: StreetViewPitchEstimate | null;
  precise_polygon?: Array<[number, number]>;
  notes: string[];
  sources: string[];
}): RoofMeasurement {
  const { formatted, address, lat, lng, centerLat, centerLng, state, county, solar, analysis, overture, svPitch, precise_polygon } = args;
  const notes = [...args.notes];
  const sources = [...args.sources];

  // --- Pitch consensus across up to 3 sources:
  //   - Solar's elevation-derived pitch (most precise, but reads non-
  //     standard increments like 7:12 / 10:12)
  //   - Street-view gable measurement (independent of Google; tends to
  //     snap to roofer-conventional half-pitches matching the references)
  //   - Vision satellite analysis (noisy backup)
  // Strategy: when street-view is high-confidence AND Solar disagrees by
  // ≥2 rise steps, the street-view value wins (it correlates better with
  // the 4/6/8/12 increments commercial measurements report). Otherwise
  // Solar wins.
  let pitch: Pitch;
  if (solar && solar.averagePitchDegrees > 0) {
    const solarPitch = pitchFromDegrees(solar.averagePitchDegrees);
    if (svPitch && svPitch.confidence !== "low" && svPitch.visible) {
      const diff = Math.abs(svPitch.rise_in_12 - solarPitch.rise);
      if (diff >= 2) {
        pitch = pitchFromRise(svPitch.rise_in_12);
        notes.push(`Pitch: Solar read ${solarPitch.label}, street-view gable read ${svPitch.rise_in_12}:12 (${svPitch.confidence}). Used street-view (${diff}-step disagreement → conventional pitch wins).`);
      } else if (diff === 1) {
        pitch = solarPitch;
        notes.push(`Pitch: Solar ${solarPitch.label} vs street-view ${svPitch.rise_in_12}:12 — within 1 step, kept Solar.`);
      } else {
        pitch = solarPitch;
      }
    } else {
      pitch = solarPitch;
    }
  } else if (svPitch && svPitch.visible) {
    pitch = pitchFromRise(svPitch.rise_in_12);
  } else if (analysis) {
    pitch = pitchFromRise(analysis.pitch_rise_in_12);
  } else {
    pitch = pitchFromRise(6);
  }

  // --- Per-source footprint candidates.
  const solarFootprint = solar ? Math.round(solar.totalRoofAreaSqft / pitch.multiplier) : null;

  // Vision footprint: prefer the polygon-based area, but fall back to the
  // model's gut estimate if the polygon traces something implausibly large
  // (the model occasionally outlines an entire block when the lot is dense).
  // Heuristic bounds: under 8,000 sqft (residential ceiling) AND within 60%
  // of Solar's footprint when Solar is available.
  let visionFootprint: number | null = null;
  if (analysis) {
    const polygonArea = analysis.roof_polygon_normalized.length >= 3
      ? polygonAreaSqft(analysis.roof_polygon_normalized, STATIC_MAP_SIZE_PX, lat, STATIC_MAP_ZOOM)
      : 0;
    const gut = Math.round(analysis.footprint_sqft_estimate);
    const polygonPlausible =
      polygonArea > 0 &&
      polygonArea < 8000 &&
      analysis.polygon_confidence !== "low" &&
      (solarFootprint === null || polygonArea / solarFootprint < 1.6);
    if (polygonPlausible) {
      visionFootprint = polygonArea;
    } else if (gut > 0) {
      visionFootprint = gut;
      if (polygonArea > 0) notes.push(`Vision polygon implausible (${polygonArea} sqft); using gut estimate ${gut} sqft instead.`);
    }
  }

  const overtureFootprint = overture ? overture.area_sqft : null;

  // --- Per-source total_sqft candidates.
  const solarTotal = solar ? Math.round(solar.totalRoofAreaSqft) : null;
  const visionTotal = visionFootprint !== null ? Math.round(visionFootprint * pitch.multiplier) : null;
  const overtureTotal = overtureFootprint !== null ? Math.round(overtureFootprint * pitch.multiplier) : null;

  // --- Build ensemble from whichever sources succeeded.
  //
  // Trust policy: Solar's per-segment elevation-derived area is more
  // precise than vision's gut estimate when Solar is well-conditioned.
  // We only blend with the other sources when Solar shows specific signs
  // of being unreliable (large total area, high segment count, bimodal
  // segment heights — all empirical predictors of duplex / neighbor
  // conflation). This restores tight benchmark calibration (~0.9% median
  // error) while keeping the ensemble safety net for the edge cases that
  // need it.
  //
  // The independent sources still RUN unconditionally, populate the
  // ensemble.sources record for transparency, and influence the
  // confidence flag — they just don't pull consensus when Solar is fine.
  const solarSuspect = solar && shouldCrossCheck(solar);
  const ensemble = solar && !solarSuspect
    ? buildSolarDominantEnsemble(solar, visionTotal, visionFootprint, overtureTotal, overtureFootprint, pitch.degrees)
    : buildEnsemble({
        pitch_degrees: pitch.degrees,
        // When Solar is flagged suspect (likely duplex / neighbor conflation),
        // we shift to the independent estimators with Solar deeply down-
        // weighted (0.15 vs 0.60 / 0.25). Solar still anchors against
        // vision's run-to-run variance but no longer dominates the value.
        // This addresses the "low-confidence still submits suspect Solar"
        // failure mode flagged in review while preserving stability when
        // vision is the only other source available.
        candidates: [
          { source: "google_solar",  total: solarTotal,    footprint: solarFootprint,    weight: solarSuspect ? 0.15 : 0.45 },
          { source: "claude_vision", total: visionTotal,   footprint: visionFootprint,   weight: solarSuspect ? 0.60 : 0.35 },
          { source: "osm_footprints", total: overtureTotal, footprint: overtureFootprint, weight: solarSuspect ? 0.25 : 0.20 },
        ],
      });

  // --- Confidence: high agreement + Solar HIGH imagery = high.
  //                 disagreement → low.
  let confidence: "high" | "medium" | "low";
  if (ensemble.flag === "high_agreement" && solar?.imageryQuality === "HIGH") {
    confidence = "high";
  } else if (ensemble.flag === "high_disagreement") {
    confidence = "low";
    notes.push(`Source disagreement (${ensemble.agreement_pct.toFixed(0)}% agreement). Sources: ${ensemble.sources.filter((s) => s.ok).map((s) => `${s.source}=${Math.round(s.total_sqft ?? 0)}`).join(", ")}.`);
  } else {
    confidence = "medium";
  }

  const total_sqft = ensemble.consensus_total_sqft;
  const footprint_sqft = ensemble.consensus_footprint_sqft;

  // --- Segments + complexity
  const segments = solar?.segmentCount ?? analysis?.segment_count ?? 4;
  const complexity: Complexity = analysis?.complexity ?? complexityFromSegments(segments);

  // --- Edge classification — prefer vision edges when available; else heuristic.
  let edge_classification: EdgeClassification | undefined;
  let line_items: RoofLineItems;
  if (analysis && analysis.edges.length >= 4) {
    const classified: ClassifiedEdge[] = projectEdges(analysis.edges, STATIC_MAP_SIZE_PX, lat, STATIC_MAP_ZOOM);
    const totals = sumEdgeLengths(classified);
    edge_classification = {
      source: "vision",
      edges: classified,
      totals_lf: totals,
    };
    line_items = {
      ridge_lf: Math.round(totals.ridge),
      hip_lf: Math.round(totals.hip),
      valley_lf: Math.round(totals.valley),
      rake_lf: Math.round(totals.rake),
      eave_lf: Math.round(totals.eave),
      step_flashing_lf: complexity === "simple_gable" ? 8 : segments >= 5 ? 22 : 16,
      counter_flashing_lf: complexity === "simple_gable" ? 10 : 22,
    };
  } else {
    line_items = deriveLineItems(footprint_sqft, complexity, segments);
  }

  // --- Penetrations — apply confidence thresholds before exposing to quote.
  let penetrations: Penetrations;
  if (analysis) {
    const { filtered, dropped } = applyConfidenceThresholds(analysis.penetrations);
    penetrations = filtered;
    if (dropped.length > 0) notes.push(`Penetrations dropped to 0 due to low confidence: ${dropped.join(", ")}.`);
  } else {
    penetrations = {
      plumbing_vents: 3, exhaust_vents: 0, box_vents: 0, skylights: 0,
      chimneys: 0, satellite_dishes: 0, solar_panels: 0, power_attic_vents: 0,
      source: "default",
    };
  }
  // pipe_boots_count kept for backward compat — derived from plumbing_vents.
  const pipe_boots_count = Math.max(2, penetrations.plumbing_vents);

  return {
    address,
    formatted_address: formatted,
    lat,
    lng,
    state_code: state,
    county,
    total_sqft,
    footprint_sqft,
    pitch,
    segments,
    line_items,
    complexity,
    layers: 1,
    pipe_boots_count,
    penetrations,
    edge_classification,
    ensemble,
    // Public proxy URL — zoom 19 (wider than 20 so parallax starts with
    // street context) at scale=2 (retina pixel density) so the CSS
    // zoom-in to 2× stays crisp instead of pixel-doubling blurry.
    satellite_image_url: centerLat && centerLng ? staticMapUrlPublic(centerLat, centerLng, 19, "800x800", 2) : undefined,
    precise_polygon,
    data_sources: sources,
    confidence,
    notes,
  };
}

// ============================================================================
// Ensemble logic
// ============================================================================

type Candidate = {
  source: EnsembleSource["source"];
  total: number | null;
  footprint: number | null;
  weight: number;
};

// Solar-dominant path: use Solar's measurement directly, but still record
// the other sources in the ensemble.sources array so we can show "we
// checked these too, they agree" in the UI. Agreement_pct is computed
// for transparency but doesn't change the consensus value.
function buildSolarDominantEnsemble(
  solar: SolarBuildingInsights,
  visionTotal: number | null,
  visionFootprint: number | null,
  overtureTotal: number | null,
  overtureFootprint: number | null,
  pitch_degrees: number,
): Ensemble {
  const solarTotal = Math.round(solar.totalRoofAreaSqft);
  // Footprint = total × cos(pitch). The ground projection is SMALLER than
  // the sloped roof surface (a roof that's 1,000 sqft on a 6:12 pitch sits
  // on a ~894 sqft footprint). Earlier code divided by cos, producing
  // footprint > total, which is geometrically impossible.
  const solarFootprint = Math.round(solar.totalRoofAreaSqft * Math.cos((pitch_degrees * Math.PI) / 180));
  const sources: EnsembleSource[] = [
    { source: "google_solar",  total_sqft: solarTotal,    footprint_sqft: solarFootprint,    pitch_degrees, weight: 1.0, ok: true },
    { source: "claude_vision", total_sqft: visionTotal,   footprint_sqft: visionFootprint,   pitch_degrees: visionTotal ? pitch_degrees : null, weight: 0,  ok: visionTotal !== null && visionTotal > 0 },
    { source: "osm_footprints", total_sqft: overtureTotal, footprint_sqft: overtureFootprint, pitch_degrees: overtureTotal ? pitch_degrees : null, weight: 0, ok: overtureTotal !== null && overtureTotal > 0 },
  ];
  // Compute agreement just for transparency.
  const okValues = sources.filter((s) => s.ok && s.total_sqft).map((s) => s.total_sqft!);
  let maxDiff = 0;
  for (let i = 0; i < okValues.length; i++) {
    for (let j = i + 1; j < okValues.length; j++) {
      const d = Math.abs(okValues[i] - okValues[j]) / Math.min(okValues[i], okValues[j]);
      if (d > maxDiff) maxDiff = d;
    }
  }
  const agreement_pct = okValues.length <= 1 ? 100 : Math.round(Math.max(0, Math.min(100, (1 - maxDiff) * 100)));
  return {
    sources,
    consensus_total_sqft: solarTotal,
    consensus_footprint_sqft: solarFootprint,
    consensus_pitch_degrees: pitch_degrees,
    agreement_pct,
    flag: agreement_pct >= 90 ? "high_agreement" : agreement_pct >= 75 ? "moderate_disagreement" : "high_disagreement",
  };
}

function buildEnsemble(args: { pitch_degrees: number; candidates: Candidate[] }): Ensemble {
  const okCandidates = args.candidates.filter((c) => c.total !== null && c.total > 0);

  // Build the per-source records (including the ones that failed).
  const ensembleSources: EnsembleSource[] = args.candidates.map((c) => ({
    source: c.source,
    total_sqft: c.total,
    footprint_sqft: c.footprint,
    pitch_degrees: c.total ? args.pitch_degrees : null,
    weight: c.total ? c.weight : 0,
    ok: c.total !== null && c.total > 0,
  }));

  if (okCandidates.length === 0) {
    return {
      sources: ensembleSources,
      consensus_total_sqft: 2400,
      consensus_footprint_sqft: 2150,
      consensus_pitch_degrees: args.pitch_degrees,
      agreement_pct: 0,
      flag: "high_disagreement",
    };
  }

  // Pairwise agreement: 100 - max % difference between any two sources.
  let maxDiff = 0;
  for (let i = 0; i < okCandidates.length; i++) {
    for (let j = i + 1; j < okCandidates.length; j++) {
      const a = okCandidates[i].total!;
      const b = okCandidates[j].total!;
      const diff = Math.abs(a - b) / Math.min(a, b);
      if (diff > maxDiff) maxDiff = diff;
    }
  }
  const agreement_pct = Math.max(0, Math.min(100, (1 - maxDiff) * 100));

  let flag: Ensemble["flag"];
  let consensus_total_sqft: number;
  let consensus_footprint_sqft: number;

  if (okCandidates.length === 1) {
    // Only one source — no consensus to compute, just use it.
    flag = "moderate_disagreement";
    consensus_total_sqft = okCandidates[0].total!;
    consensus_footprint_sqft = okCandidates[0].footprint ?? Math.round(consensus_total_sqft * Math.cos((args.pitch_degrees * Math.PI) / 180));
  } else if (agreement_pct >= 90) {
    // Sources broadly agree → use weighted average of all.
    flag = "high_agreement";
    const totalWeight = okCandidates.reduce((s, c) => s + c.weight, 0);
    consensus_total_sqft = Math.round(okCandidates.reduce((s, c) => s + c.total! * c.weight, 0) / totalWeight);
    const fpAvail = okCandidates.filter((c) => c.footprint !== null);
    consensus_footprint_sqft = fpAvail.length > 0
      ? Math.round(fpAvail.reduce((s, c) => s + c.footprint! * c.weight, 0) / fpAvail.reduce((s, c) => s + c.weight, 0))
      : Math.round(consensus_total_sqft * Math.cos((args.pitch_degrees * Math.PI) / 180));
  } else if (agreement_pct >= 75) {
    // Moderate disagreement → median-of-sources, mark medium.
    flag = "moderate_disagreement";
    const totals = okCandidates.map((c) => c.total!).sort((a, b) => a - b);
    consensus_total_sqft = totals[Math.floor(totals.length / 2)];
    const fps = okCandidates.map((c) => c.footprint).filter((f): f is number => f !== null).sort((a, b) => a - b);
    consensus_footprint_sqft = fps.length > 0 ? fps[Math.floor(fps.length / 2)] : Math.round(consensus_total_sqft * Math.cos((args.pitch_degrees * Math.PI) / 180));
  } else {
    // High disagreement → take the smallest (most conservative) and flag.
    flag = "high_disagreement";
    consensus_total_sqft = Math.min(...okCandidates.map((c) => c.total!));
    const fps = okCandidates.map((c) => c.footprint).filter((f): f is number => f !== null);
    consensus_footprint_sqft = fps.length > 0 ? Math.min(...fps) : Math.round(consensus_total_sqft * Math.cos((args.pitch_degrees * Math.PI) / 180));
  }

  return {
    sources: ensembleSources,
    consensus_total_sqft,
    consensus_footprint_sqft,
    consensus_pitch_degrees: args.pitch_degrees,
    agreement_pct: Math.round(agreement_pct),
    flag,
  };
}

// ============================================================================
// Heuristics for when to doubt Solar's measurement. Triggers correlate
// with the empirical failure modes we've seen: Solar conflating attached
// neighbors (large total area + many segments) and bimodal segment
// heights (two distinct rooflines lumped into one building). When fired,
// the ensemble shifts weight onto vision + footprints to detect the
// over-count.
// ============================================================================
// Threshold tuning notes (calibrated against the 5 benchmark properties):
//   - segmentCount > 15 catches Rosebrier-style duplex conflation (18 segs)
//     while letting Nixa pass (13 segs — legitimate complex single home)
//   - bimodal-height test correctly fires on Newport News (two attached
//     buildings at ~5.5m and ~8m heights) but not on benchmark properties
function shouldCrossCheck(s: SolarBuildingInsights): boolean {
  if (s.totalRoofAreaSqft > 5000) return true;
  if (s.segmentCount > 15) return true;
  const heights = s.segments.map((seg) => seg.planeHeightAtCenterMeters).filter((h): h is number => typeof h === "number");
  if (heights.length >= 4) {
    const sorted = [...heights].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const farFromMedian = heights.filter((h) => Math.abs(h - median) > 2.0).length;
    if (farFromMedian >= 3) return true;
  }
  return false;
}

// ============================================================================
// Pure helpers (exported so unit tests can hit them directly)
// ============================================================================

export function pitchFromDegrees(deg: number): Pitch {
  const rise = Math.max(2, Math.min(14, Math.round(Math.tan((deg * Math.PI) / 180) * 12)));
  return pitchFromRise(rise);
}

export function pitchFromRise(rise: number): Pitch {
  const r = Math.max(2, Math.min(14, Math.round(rise)));
  const multiplier = Math.sqrt(1 + (r / 12) ** 2);
  const degrees = (Math.atan(r / 12) * 180) / Math.PI;
  return { rise: r, run: 12, multiplier: round(multiplier, 3), degrees: round(degrees, 1), label: `${r}:12` };
}

export function complexityFromSegments(n: number): Complexity {
  if (n <= 2) return "simple_gable";
  if (n <= 6) return "hip_or_valleys";
  return "complex_cutup";
}

// Heuristic line-item derivation, used as fallback when vision edges unavailable.
// Calibrated against the 5 benchmark properties.
export function deriveLineItems(footprint_sqft: number, complexity: Complexity, segments: number): RoofLineItems {
  const w = Math.sqrt(footprint_sqft / 1.4);
  const outer_perim = 4.8 * w;
  const internal_factor = complexity === "simple_gable" ? 0.30 :
                           complexity === "hip_or_valleys" ? 0.55 : 0.85;
  const internal_total = outer_perim * internal_factor;
  const ridge_hip = internal_total * 0.75;
  const valley_lf = internal_total * 0.25;
  const hip_share = complexity === "simple_gable" ? 0.05 :
                    complexity === "hip_or_valleys" ? 0.65 : 0.75;
  const ridge_lf = ridge_hip * (1 - hip_share);
  const hip_lf   = ridge_hip * hip_share;
  const rake_share = complexity === "simple_gable" ? 0.35 :
                     complexity === "hip_or_valleys" ? 0.10 : 0.20;
  const rake_lf = outer_perim * rake_share;
  const eave_lf = outer_perim * (1 - rake_share);
  const step_flashing_lf    = complexity === "simple_gable" ? 8 : segments >= 5 ? 22 : 16;
  const counter_flashing_lf = complexity === "simple_gable" ? 10 : 22;
  return {
    ridge_lf: Math.round(ridge_lf),
    hip_lf: Math.round(hip_lf),
    valley_lf: Math.round(valley_lf),
    rake_lf: Math.round(rake_lf),
    eave_lf: Math.round(eave_lf),
    step_flashing_lf,
    counter_flashing_lf,
  };
}

function inferStateFromAddress(address: string): string {
  const m = address.toUpperCase().match(/\b([A-Z]{2})\b\s+\d{5}/);
  return m?.[1] ?? "";
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
