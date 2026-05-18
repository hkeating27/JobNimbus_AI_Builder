// Pricing data is imported as JSON so Next.js bundles it directly into both
// dev and serverless builds — no fs.readFileSync, no path resolution, no
// outputFileTracing surprises on Vercel. The canonical source is the
// top-level pricing.json; web/src/data/pricing.json is kept in sync via
// the predev / prebuild npm hooks (see web/package.json).
import pricingDocument from "../data/pricing.json";

let cached: PricingDoc | null = null;

export function loadPricing(): PricingDoc {
  if (cached) return cached;
  cached = pricingDocument as unknown as PricingDoc;
  return cached;
}

export type PriceBand = { rate?: number; cost?: number; low: number; high: number; [k: string]: unknown };

export type PricingDoc = {
  version: string;
  currency: string;
  scope: string;
  materials: {
    shingles_field: Record<string, PriceBand & { wind_rating_mph?: number; warranty_yrs?: string | number; examples?: string[] }> & { default: string };
    shingles_starter: Record<string, PriceBand>;
    shingles_hip_ridge_cap: Record<string, PriceBand>;
    underlayment: Record<string, PriceBand & { applies_to?: string }>;
    flashings_metal: Record<string, PriceBand>;
    ventilation: Record<string, PriceBand>;
    fasteners: Record<string, PriceBand>;
    sealants_consumables: Record<string, PriceBand>;
    decking: Record<string, PriceBand>;
    low_slope_specialty: Record<string, PriceBand>;
  };
  labor: {
    tear_off: { single_layer_per_sqft: PriceBand; double_layer_per_sqft: PriceBand; triple_layer_per_sqft: PriceBand };
    install_field_shingles: { asphalt_per_sqft: PriceBand; metal_per_sqft: PriceBand; steep_slope_premium_pct: PriceBand; two_story_premium_pct: PriceBand };
    install_accessories_per_lf: Record<string, PriceBand>;
    install_accessories_each: Record<string, PriceBand>;
    ice_water_shield_install_per_sqft: PriceBand;
    cleanup_and_haul: { magnetic_sweep_and_site_cleanup: PriceBand };
    supervision_overhead_pct: PriceBand;
  };
  demo_disposal: {
    dumpster: Record<string, PriceBand & { fits_sqft_single_layer?: number }>;
    tipping_fee_overage_per_ton: PriceBand;
    ground_protection_plywood: PriceBand;
  };
  permits_inspections: Record<string, PriceBand>;
  regional: {
    zones: Record<
      string,
      {
        states?: string[];
        labor_multiplier: number;
        material_multiplier: number;
        target_gross_margin: number;
        _comment?: string;
      }
    >;
    state_labor_index?: Record<string, number | string>;
    metro_overrides?: Array<{
      label: string;
      match: { state: string; counties: string[] };
      labor_multiplier: number;
      material_multiplier: number;
      target_gross_margin: number;
      _comment?: string;
    }>;
  };
  code_requirements: Record<string, { applies_to: string | string[]; requires?: string[]; recommends?: string[] }>;
};

export function rate(b: PriceBand): number {
  return (b.rate ?? b.cost ?? 0) as number;
}
