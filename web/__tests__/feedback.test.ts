import { describe, it, expect } from "vitest";
import { applyFeedbackAdjustment, calibrationByZone, readFeedback } from "@/lib/feedback";

describe("applyFeedbackAdjustment", () => {
  it("returns identity for zones with insufficient samples", () => {
    const adj = applyFeedbackAdjustment("premium_metro");  // not in seed
    expect(adj.labor_adjust).toBe(1);
    expect(adj.material_adjust).toBe(1);
    expect(adj.sample_size).toBe(0);
  });

  it("returns valid adjustment for low_cost_competitive (3 seed entries)", () => {
    const adj = applyFeedbackAdjustment("low_cost_competitive");
    expect(adj.sample_size).toBeGreaterThanOrEqual(3);
    // Both should be within ±15% (clamped) of 1.0
    expect(adj.labor_adjust).toBeGreaterThanOrEqual(0.85);
    expect(adj.labor_adjust).toBeLessThanOrEqual(1.15);
    expect(adj.material_adjust).toBeGreaterThanOrEqual(0.85);
    expect(adj.material_adjust).toBeLessThanOrEqual(1.15);
  });

  it("returns valid adjustment for high_cost_insurance_heavy (2 seed entries)", () => {
    // Only 2 seed entries — below MIN_SAMPLES (3) → identity
    const adj = applyFeedbackAdjustment("high_cost_insurance_heavy");
    expect(adj.sample_size).toBe(2);
    expect(adj.labor_adjust).toBe(1);
    expect(adj.material_adjust).toBe(1);
  });
});

describe("readFeedback (inline seed)", () => {
  it("returns at least 6 entries from inline SEED", () => {
    const entries = readFeedback();
    expect(entries.length).toBeGreaterThanOrEqual(6);
  });

  it("seed entries are well-formed", () => {
    const entries = readFeedback();
    for (const e of entries.slice(0, 6)) {
      expect(e.quote_id).toMatch(/^Q-/);
      expect(typeof e.actual_total).toBe("number");
      expect(e.actual_total).toBeGreaterThan(0);
    }
  });
});

describe("calibrationByZone", () => {
  it("only reports zones with >=3 samples", () => {
    const summaries = calibrationByZone();
    for (const s of summaries) {
      expect(s.sample_size).toBeGreaterThanOrEqual(3);
    }
  });
});
