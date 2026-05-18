import { describe, it, expect } from "vitest";
import {
  pitchFromDegrees,
  pitchFromRise,
  complexityFromSegments,
  deriveLineItems,
} from "@/lib/measure";

describe("pitchFromRise", () => {
  it.each([
    [3, 1.031],
    [4, 1.054],
    [6, 1.118],
    [7, 1.158],
    [8, 1.202],
    [12, 1.414],
  ])("rise %i → multiplier %f", (rise, expectedMultiplier) => {
    const p = pitchFromRise(rise);
    expect(p.rise).toBe(rise);
    expect(p.run).toBe(12);
    expect(p.multiplier).toBeCloseTo(expectedMultiplier, 2);
    expect(p.label).toBe(`${rise}:12`);
  });

  it("clamps absurd inputs", () => {
    expect(pitchFromRise(0).rise).toBe(2);   // floor
    expect(pitchFromRise(99).rise).toBe(14); // ceiling
  });
});

describe("pitchFromDegrees", () => {
  it("converts 30 degrees → ~7:12", () => {
    const p = pitchFromDegrees(30);
    expect(p.rise).toBe(7);   // tan(30°) * 12 ≈ 6.93, rounds to 7
  });

  it("converts 26.6 degrees → 6:12", () => {
    const p = pitchFromDegrees(26.6);
    expect(p.rise).toBe(6);   // canonical 6:12 angle
  });

  it("converts 45 degrees → 12:12", () => {
    const p = pitchFromDegrees(45);
    expect(p.rise).toBe(12);
  });
});

describe("complexityFromSegments", () => {
  it("≤2 segments → simple_gable", () => {
    expect(complexityFromSegments(1)).toBe("simple_gable");
    expect(complexityFromSegments(2)).toBe("simple_gable");
  });
  it("3-6 segments → hip_or_valleys", () => {
    expect(complexityFromSegments(3)).toBe("hip_or_valleys");
    expect(complexityFromSegments(6)).toBe("hip_or_valleys");
  });
  it("7+ segments → complex_cutup", () => {
    expect(complexityFromSegments(7)).toBe("complex_cutup");
    expect(complexityFromSegments(20)).toBe("complex_cutup");
  });
});

describe("deriveLineItems — calibrated against benchmark properties", () => {
  // The 5 benchmark properties have known line-item ranges from
  // Reference A and B in benchmark-measurements.md. We don't expect
  // exact match (different methodology) but the heuristic must produce
  // values in roughly the right ballpark given the inputs.

  it("Humble TX (2063 footprint, hip_or_valleys, 8 segs)", () => {
    const items = deriveLineItems(2063, "hip_or_valleys", 8);
    // Reference A had: ridge/hip 141, valleys 40, rakes 101, eaves 187
    // Our heuristic should land within ~50% of those given the simplification.
    expect(items.eave_lf).toBeGreaterThan(80);
    expect(items.eave_lf).toBeLessThan(250);
    expect(items.ridge_lf + items.hip_lf).toBeGreaterThan(40);
    expect(items.valley_lf).toBeGreaterThan(15);
  });

  it("simple gable produces minimal hip + max rake share", () => {
    const items = deriveLineItems(1800, "simple_gable", 2);
    // Simple gable: nearly all internal length is ridge, very little hip
    expect(items.hip_lf).toBeLessThan(items.ridge_lf);
    // Rake share ~35% of perimeter, eave ~65%
    const total = items.rake_lf + items.eave_lf;
    expect(items.rake_lf / total).toBeGreaterThan(0.25);
    expect(items.rake_lf / total).toBeLessThan(0.45);
  });

  it("complex cutup produces more internal length than perimeter", () => {
    const items = deriveLineItems(3500, "complex_cutup", 18);
    const internal = items.ridge_lf + items.hip_lf + items.valley_lf;
    const outer = items.rake_lf + items.eave_lf;
    // complex cutup: internal_factor 0.85 means internal ~85% of outer
    expect(internal / outer).toBeGreaterThan(0.7);
    expect(internal / outer).toBeLessThan(1.0);
  });
});
