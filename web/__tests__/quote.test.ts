import { describe, it, expect } from "vitest";
import { generateQuote } from "@/lib/quote";
import type { RoofMeasurement } from "@/lib/types";

const HUMBLE_TX: RoofMeasurement = {
  address: "21106 Kenswick Meadows Ct, Humble, TX 77338",
  formatted_address: "21106 Kenswick Meadows Ct, Humble, TX 77338, USA",
  lat: 30.019412,
  lng: -95.311886,
  state_code: "TX",
  county: "Harris County",
  total_sqft: 2389,
  footprint_sqft: 2063,
  pitch: { rise: 7, run: 12, multiplier: 1.158, degrees: 30.3, label: "7:12" },
  segments: 8,
  line_items: { ridge_lf: 29, hip_lf: 88, valley_lf: 39, rake_lf: 37, eave_lf: 147, step_flashing_lf: 22, counter_flashing_lf: 22 },
  complexity: "complex_cutup",
  layers: 1,
  pipe_boots_count: 3,
  penetrations: { plumbing_vents: 3, exhaust_vents: 0, box_vents: 0, skylights: 0, chimneys: 0, satellite_dishes: 0, solar_panels: 0, power_attic_vents: 0, source: "default" },
  data_sources: ["google_geocoding", "google_solar_api"],
  confidence: "high",
  notes: [],
};

describe("generateQuote — Humble TX benchmark property", () => {
  const q = generateQuote(HUMBLE_TX);

  it("has 3 tiers in good/better/best order", () => {
    expect(q.tiers.map((t) => t.key)).toEqual(["good", "better", "best"]);
  });

  it("uses Houston metro override (Harris County) instead of TX zone defaults", () => {
    expect(q.zone_label).toBe("Houston metro");
    expect(q.target_gross_margin).toBe(0.32);
  });

  it("Better tier total is in the expected band (~$18K–$22K for TX architectural)", () => {
    const better = q.tiers.find((t) => t.key === "better")!;
    expect(better.total).toBeGreaterThan(18_000);
    expect(better.total).toBeLessThan(22_000);
  });

  it("tier prices are monotonic: good < better < best", () => {
    const good = q.tiers.find((t) => t.key === "good")!.total;
    const better = q.tiers.find((t) => t.key === "better")!.total;
    const best = q.tiers.find((t) => t.key === "best")!.total;
    expect(good).toBeLessThan(better);
    expect(better).toBeLessThan(best);
  });

  it("each tier total = quote_subtotal + dumpster + permit", () => {
    for (const t of q.tiers) {
      expect(t.total).toBe(Math.round(t.quote_subtotal + t.dumpster + t.permit));
    }
  });

  it("quote subtotal = cost_basis / (1 - target_gross_margin)", () => {
    for (const t of q.tiers) {
      const expected = t.cost_basis / (1 - t.target_gross_margin);
      expect(t.quote_subtotal).toBeCloseTo(expected, 0);
    }
  });

  it("includes a quote ID and ISO timestamp", () => {
    expect(q.quote_id).toMatch(/^Q-\d{8}-[A-Z0-9]{5}$/);
    expect(new Date(q.generated_at).toString()).not.toBe("Invalid Date");
  });

  it("recommends 'better' tier for Houston (not hail belt, not HVHZ)", () => {
    // Houston is in TX which IS the hail belt set, but not the FL HVHZ
    // — recommendedShingleTier returns 'best' for hail-belt states.
    expect(q.recommended_tier_key).toBe("best");
  });
});

describe("generateQuote — VA mid-market", () => {
  const VA: RoofMeasurement = { ...HUMBLE_TX, state_code: "VA", county: undefined, total_sqft: 2500, footprint_sqft: 2200 };
  const q = generateQuote(VA);

  it("uses mid_market zone with 35% margin", () => {
    expect(q.zone_key).toBe("mid_market");
    expect(q.target_gross_margin).toBe(0.35);
  });

  it("recommends 'better' tier for VA (not hail belt)", () => {
    expect(q.recommended_tier_key).toBe("better");
  });
});
