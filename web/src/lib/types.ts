export type Pitch = {
  rise: number;
  run: number;
  multiplier: number;
  degrees: number;
  label: string;
};

// Roof edge types — using correct technical roofing terminology.
//
//   ridge  : horizontal peak line where two opposing roof planes meet (top of a gable)
//   hip    : angled line sloping down from the ridge to a building corner (hip roofs only)
//   valley : inward-facing angled intersection where two planes drain water
//   eave   : horizontal lower edge of a roof plane (overhangs above a wall)
//   rake   : sloped lower edge along a gable end (no eave there)
export type EdgeType = "ridge" | "hip" | "valley" | "rake" | "eave";

export type ClassifiedEdge = {
  type: EdgeType;
  length_lf: number;
  // optional pixel-space coordinates from the source image (for overlay rendering)
  pixels?: { from: [number, number]; to: [number, number] };
};

export type EdgeClassification = {
  source: "vision" | "raster" | "ensemble" | "heuristic";
  edges: ClassifiedEdge[];
  totals_lf: { ridge: number; hip: number; valley: number; rake: number; eave: number };
  notes?: string[];
};

export type RoofLineItems = {
  ridge_lf: number;
  hip_lf: number;
  valley_lf: number;
  rake_lf: number;
  eave_lf: number;
  step_flashing_lf: number;
  counter_flashing_lf: number;
};

export type Complexity = "simple_gable" | "hip_or_valleys" | "complex_cutup";

// Penetrations are anything sticking through the deck. We track per-
// category counts AND per-category confidence so we can apply thresholds
// (drop low-confidence counts to 0 to avoid bogus charges).
//
// Cost rules (applied in quote.ts):
//   - plumbing_vents, exhaust_vents → REQUIRE replacement (new boots/caps)
//   - box_vents, power_attic_vents  → REQUIRE replacement (new assemblies)
//   - skylights, satellite_dishes   → OPTIONAL adders if present
//   - chimneys                      → IDENTIFIED but NOT charged
//                                     (homeowner keeps the chimney; counter-
//                                     flashing only if explicitly scoped)
//   - solar_panels                  → FLAGGED but NOT charged
//                                     (needs solar-contractor coordination)
export type PenetrationConfidence = "high" | "medium" | "low";

export type PenetrationCategory =
  | "plumbing_vents"
  | "exhaust_vents"
  | "box_vents"
  | "skylights"
  | "chimneys"
  | "satellite_dishes"
  | "solar_panels"
  | "power_attic_vents";

export type Penetrations = {
  plumbing_vents: number;     // small dark cylinders, typically 2–6 per home
  exhaust_vents: number;      // bath/kitchen mushroom-cap exhausts
  box_vents: number;          // static turtle vents (rectangular or rounded caps)
  skylights: number;          // rectangular glass panels
  chimneys: number;           // brick or metal stacks (identified, not charged)
  satellite_dishes: number;
  solar_panels: number;       // count of distinct panel arrays (flagged, not charged)
  power_attic_vents: number;  // dome-style powered ventilators
  // Per-category confidence — supports threshold logic in measure.ts.
  // Categories with "low" confidence have their counts zeroed out before
  // they reach the quote (avoid charging for things we're not sure about).
  confidence?: Partial<Record<PenetrationCategory, PenetrationConfidence>>;
  source: "vision" | "default";
  notes?: string[];
};

// Per-source measurement record. The ensemble combines these via weighted
// average; disagreement among sources is itself a confidence signal.
export type EnsembleSource = {
  source: "google_solar" | "claude_vision" | "osm_footprints" | "heuristic";
  total_sqft: number | null;
  footprint_sqft: number | null;
  pitch_degrees: number | null;
  weight: number;             // 0..1
  ok: boolean;
  notes?: string;
};

export type Ensemble = {
  sources: EnsembleSource[];
  consensus_total_sqft: number;
  consensus_footprint_sqft: number;
  consensus_pitch_degrees: number;
  agreement_pct: number;      // 100 - max pairwise % difference between non-zero sources
  flag: "high_agreement" | "moderate_disagreement" | "high_disagreement";
};

// Photo-mode-specific diagnostics. Only populated when the
// measurement came from /api/measure-from-photo. Lets the UI surface
// "why we're uncertain" — per-reference contributions, GSD info,
// pitch source — when confidence is low.
export type PhotoDiagnostics = {
  reference_count: number;
  // Within-primary-photo reference agreement. This is the meaningful
  // ensemble agreement — refs from the SAME photo's coordinate system
  // voting on a single pixels-per-foot value.
  agreement_pct: number;
  per_reference: Array<{
    type: string;          // ReferenceType, but we keep it open-ended for forward-compat
    pixels_per_foot_normalized: number;
    weight: number;
    variance_ft: number;
    confidence: "high" | "medium" | "low";
    photo_index?: number;
  }>;
  // Multi-photo bookkeeping. When a single photo was uploaded, both
  // are 0 / 100 respectively. With multiple photos, the polygon
  // (and thus the area math) comes from primary_photo_index, and
  // cross_photo_agreement_pct surfaces whether the OTHER photos
  // agree on the camera-height-relative scale.
  total_photos: number;
  primary_photo_index: number;
  cross_photo_agreement_pct: number;
  gsd_active: boolean;
  altitude_agl_m?: number;
  gsd_sigma_pct?: number;
  pitch_source: "google_solar" | "vision_oblique" | "vision_default" | "user_override";
  view_type: "nadir" | "oblique" | "ground_level" | "unknown";
};

export type RoofMeasurement = {
  address: string;
  formatted_address: string;
  lat: number;
  lng: number;
  state_code: string;
  county?: string;
  total_sqft: number;
  footprint_sqft: number;
  pitch: Pitch;
  segments: number;
  line_items: RoofLineItems;
  complexity: Complexity;
  layers: 1 | 2;
  pipe_boots_count: number;        // kept for backward compat — derived from penetrations.plumbing_vents
  penetrations: Penetrations;
  edge_classification?: EdgeClassification;  // optional — populated when vision/raster ran
  ensemble?: Ensemble;             // optional — populated when at least 2 sources succeeded
  // Precise building outline extracted from Google Solar dataLayers mask.
  // Coordinates are NORMALIZED [0..1] in the static-map image space.
  // Spatially accurate (not vision hallucination) — used to render the
  // eave outline correctly on the satellite overlay.
  precise_polygon?: Array<[number, number]>;
  satellite_image_url?: string;    // proxy URL only (no API key)
  photo_diagnostics?: PhotoDiagnostics;
  data_sources: string[];
  confidence: "high" | "medium" | "low";
  notes: string[];
};

export type LineItem = {
  description: string;
  qty: number;
  unit: string;
  unit_cost: number;
  subtotal: number;
};

export type Incentive = {
  id: string;
  label: string;
  headline: string;
  description_for_contractor: string;
  description_for_customer: string;
  savings_math_template: string;
  action_step: string;
};

export type QuoteTier = {
  key: "good" | "better" | "best";
  name: string;
  shingle_product: string;
  badge?: string;
  warranty: string;
  wind_rating_mph: number;
  materials: LineItem[];
  labor: LineItem[];
  materials_subtotal: number;
  labor_subtotal: number;
  materials_regional: number;
  labor_regional: number;
  cost_basis: number;
  target_gross_margin: number;
  quote_subtotal: number;
  dumpster: number;
  permit: number;
  total: number;
  per_sqft: number;
  incentives?: Incentive[];     // regional insurance / utility incentives this tier qualifies for
};

export type Quote = {
  measurement: RoofMeasurement;
  zone_key: string;
  zone_label: string;
  labor_multiplier: number;
  material_multiplier: number;
  target_gross_margin: number;
  tiers: QuoteTier[];
  recommended_tier_key: "good" | "better" | "best";
  generated_at: string;
  quote_id: string;
};
