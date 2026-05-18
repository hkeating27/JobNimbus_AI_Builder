import { loadPricing } from "./pricing";

export type ZoneKey = "low_cost_competitive" | "mid_market" | "high_cost_insurance_heavy" | "premium_metro" | "default";

const ZONE_LABEL: Record<ZoneKey, string> = {
  low_cost_competitive: "Low-cost competitive",
  mid_market: "Mid-market",
  high_cost_insurance_heavy: "High-cost / insurance-heavy",
  premium_metro: "Premium metro",
  default: "National default",
};

export type ZoneResolution = {
  key: ZoneKey;
  label: string;
  labor_multiplier: number;
  material_multiplier: number;
  target_gross_margin: number;
  state_labor_index: number;
  metro_override_label?: string;
  layers_applied: string[];
};

// Resolve the effective regional pricing for a state (and optional county).
// Three layers:
//   1. Zone defaults — labor / material / margin set by state's pricing zone.
//   2. State labor index — BLS-grounded refinement of labor multiplier.
//   3. Metro override — supersedes both for specific counties / MSAs.
export function zoneForState(state: string, county?: string): ZoneResolution {
  const pricing = loadPricing();
  const code = state.toUpperCase().trim();
  const layers: string[] = [];

  // Layer 1 — zone
  let key: ZoneKey = "default";
  let zone = pricing.regional.zones.default;
  for (const [k, z] of Object.entries(pricing.regional.zones)) {
    if (k === "default") continue;
    if (z.states?.includes(code)) {
      key = k as ZoneKey;
      zone = z;
      break;
    }
  }
  let labor_multiplier = zone.labor_multiplier;
  let material_multiplier = zone.material_multiplier;
  let target_gross_margin = zone.target_gross_margin;
  layers.push(`zone:${key}`);

  // Layer 2 — state labor index (refines labor only)
  const stateIndexRaw = pricing.regional.state_labor_index?.[code];
  const stateIndex = typeof stateIndexRaw === "number" ? stateIndexRaw : 1.0;
  if (stateIndex !== 1.0) {
    labor_multiplier *= stateIndex;
    layers.push(`state_labor_index:${code}=${stateIndex}`);
  }

  // Layer 3 — metro override (supersedes labor + material + margin)
  let metro_override_label: string | undefined;
  if (county && pricing.regional.metro_overrides) {
    const normCounty = stripCountySuffix(county).toLowerCase();
    for (const o of pricing.regional.metro_overrides) {
      if (o.match.state.toUpperCase() !== code) continue;
      if (!o.match.counties.some((c) => c.toLowerCase() === normCounty)) continue;
      labor_multiplier = o.labor_multiplier;
      material_multiplier = o.material_multiplier;
      target_gross_margin = o.target_gross_margin;
      metro_override_label = o.label;
      layers.push(`metro_override:${o.label}`);
      break;
    }
  }

  return {
    key,
    label: metro_override_label ?? ZONE_LABEL[key] ?? key,
    labor_multiplier: round(labor_multiplier, 4),
    material_multiplier: round(material_multiplier, 4),
    target_gross_margin: round(target_gross_margin, 4),
    state_labor_index: stateIndex,
    metro_override_label,
    layers_applied: layers,
  };
}

function stripCountySuffix(c: string): string {
  return c.replace(/\s+County$/i, "").trim();
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

const HAIL_BELT = new Set(["CO", "TX", "OK", "KS", "NE", "NM", "WY", "SD"]);
const COLD_CLIMATE = new Set(["MN", "WI", "MI", "NY", "ME", "VT", "NH", "ND", "SD", "MT", "ID", "AK", "MA"]);
const FL_HVHZ_COUNTIES = new Set(["miami-dade", "broward", "monroe"]);

export function codeFlags(state: string, county?: string) {
  const s = state.toUpperCase();
  const c = stripCountySuffix(county ?? "").toLowerCase();
  return {
    hail_belt: HAIL_BELT.has(s),
    fl_hvhz: s === "FL" && FL_HVHZ_COUNTIES.has(c),
    fl_general: s === "FL",
    cold_climate: COLD_CLIMATE.has(s),
    ca_title24: s === "CA",
  };
}

export function recommendedShingleTier(state: string, county?: string): "good" | "better" | "best" {
  const flags = codeFlags(state, county);
  if (flags.fl_hvhz) return "best";
  if (flags.hail_belt) return "best";
  return "better";
}
