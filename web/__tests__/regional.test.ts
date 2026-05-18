import { describe, it, expect } from "vitest";
import { zoneForState, codeFlags, recommendedShingleTier } from "@/lib/regional";

describe("zoneForState", () => {
  it("TX → low_cost_competitive", () => {
    const z = zoneForState("TX");
    expect(z.key).toBe("low_cost_competitive");
    expect(z.target_gross_margin).toBe(0.30);
    // TX state labor index is 0.88, applied on top of zone 0.85 → ~0.748
    expect(z.labor_multiplier).toBeCloseTo(0.85 * 0.88, 3);
  });

  it("CO → high_cost_insurance_heavy", () => {
    const z = zoneForState("CO");
    expect(z.key).toBe("high_cost_insurance_heavy");
    expect(z.target_gross_margin).toBe(0.38);
  });

  it("VA → mid_market", () => {
    const z = zoneForState("VA");
    expect(z.key).toBe("mid_market");
    expect(z.target_gross_margin).toBe(0.35);
  });

  it("CA → premium_metro", () => {
    const z = zoneForState("CA");
    expect(z.key).toBe("premium_metro");
    expect(z.target_gross_margin).toBe(0.40);
  });

  it("unknown state → default zone", () => {
    const z = zoneForState("ZZ");
    expect(z.key).toBe("default");
    expect(z.target_gross_margin).toBe(0.35);
  });

  it("Houston metro override supersedes TX zone", () => {
    const z = zoneForState("TX", "Harris County");
    expect(z.metro_override_label).toBe("Houston metro");
    expect(z.target_gross_margin).toBe(0.32);
    expect(z.labor_multiplier).toBe(0.95);
  });

  it("Bay Area override applies to San Francisco", () => {
    const z = zoneForState("CA", "San Francisco");
    expect(z.metro_override_label).toBe("Bay Area");
    expect(z.target_gross_margin).toBe(0.42);
  });

  it("Miami-Dade HVHZ override has high-wind margin uplift", () => {
    const z = zoneForState("FL", "Miami-Dade");
    expect(z.metro_override_label).toBe("Miami-Dade HVHZ");
    expect(z.target_gross_margin).toBe(0.40);
    expect(z.material_multiplier).toBe(1.15);
  });
});

describe("codeFlags", () => {
  it("flags FL HVHZ counties", () => {
    expect(codeFlags("FL", "Miami-Dade").fl_hvhz).toBe(true);
    expect(codeFlags("FL", "Broward").fl_hvhz).toBe(true);
    expect(codeFlags("FL", "Orange").fl_hvhz).toBe(false); // not HVHZ
  });

  it("flags CO/TX hail belt", () => {
    expect(codeFlags("CO").hail_belt).toBe(true);
    expect(codeFlags("TX").hail_belt).toBe(true);
    expect(codeFlags("VA").hail_belt).toBe(false);
  });

  it("flags cold climate states", () => {
    expect(codeFlags("MN").cold_climate).toBe(true);
    expect(codeFlags("AK").cold_climate).toBe(true);
    expect(codeFlags("FL").cold_climate).toBe(false);
  });
});

describe("recommendedShingleTier", () => {
  it("FL HVHZ → best", () => {
    expect(recommendedShingleTier("FL", "Miami-Dade")).toBe("best");
  });
  it("CO hail belt → best", () => {
    expect(recommendedShingleTier("CO")).toBe("best");
  });
  it("VA mid-market → better", () => {
    expect(recommendedShingleTier("VA")).toBe("better");
  });
});
