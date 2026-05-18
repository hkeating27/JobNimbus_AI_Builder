// Contractor feedback loop: collect actuals from completed jobs and derive
// per-zone calibration adjustments that nudge our regional multipliers
// toward what real jobs are costing in that market.
//
// Runtime storage strategy:
//   - 6 SEED entries are inlined below so calibration math always has a
//     baseline (no filesystem dependency at boot).
//   - On dev (filesystem writable) new entries append to data/feedback.jsonl.
//   - On Vercel/serverless (read-only fs) new entries append to /tmp/feedback.jsonl
//     — ephemeral, but persists for the lifetime of a warm function instance,
//     which is plenty for a demo session.
//   - readFeedback() merges SEED + whatever's on disk so the demo always
//     shows the loop working from a meaningful starting point.

import { readFileSync, existsSync, appendFileSync } from "node:fs";
import path from "node:path";
import type { ZoneKey } from "./regional";

const IS_SERVERLESS =
  process.env.VERCEL === "1" ||
  process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined ||
  process.env.NETLIFY === "true";

const RUNTIME_PATH = IS_SERVERLESS
  ? "/tmp/feedback.jsonl"
  : path.resolve(process.cwd(), "data", "feedback.jsonl");

const MIN_SAMPLES = 3;
const TRUST_CAP = 0.15;

export type FeedbackEntry = {
  quote_id: string;
  zone_key: ZoneKey;
  state_code: string;
  tier_key: "good" | "better" | "best";
  total_sqft: number;
  predicted_materials: number;
  predicted_labor: number;
  predicted_total: number;
  actual_materials: number;
  actual_labor_hours: number;
  actual_labor_cost: number;
  actual_total: number;
  contractor_id?: string;
  notes?: string;
  submitted_at: string;
};

const SEED: FeedbackEntry[] = [
  { quote_id: "Q-20260301-A4F7K", zone_key: "low_cost_competitive", state_code: "TX", tier_key: "better", total_sqft: 2380, predicted_materials: 5340, predicted_labor: 6420, predicted_total: 17680, actual_materials: 5610, actual_labor_hours: 38, actual_labor_cost: 6680, actual_total: 18250, contractor_id: "demo-tx-01", notes: "Two extra pipe boots discovered on tear-off", submitted_at: "2026-03-04T18:14:22.000Z" },
  { quote_id: "Q-20260308-B91Z2", zone_key: "low_cost_competitive", state_code: "TX", tier_key: "better", total_sqft: 3120, predicted_materials: 6940, predicted_labor: 8410, predicted_total: 22980, actual_materials: 7180, actual_labor_hours: 52, actual_labor_cost: 8740, actual_total: 23510, contractor_id: "demo-tx-01", notes: "", submitted_at: "2026-03-11T22:01:09.000Z" },
  { quote_id: "Q-20260315-C2D8M", zone_key: "low_cost_competitive", state_code: "MO", tier_key: "better", total_sqft: 2210, predicted_materials: 4980, predicted_labor: 5970, predicted_total: 16380, actual_materials: 5040, actual_labor_hours: 34, actual_labor_cost: 6210, actual_total: 16720, contractor_id: "demo-mo-02", notes: "", submitted_at: "2026-03-19T15:44:00.000Z" },
  { quote_id: "Q-20260322-E8X3Q", zone_key: "high_cost_insurance_heavy", state_code: "CO", tier_key: "best", total_sqft: 2890, predicted_materials: 7220, predicted_labor: 8950, predicted_total: 26090, actual_materials: 7390, actual_labor_hours: 48, actual_labor_cost: 9050, actual_total: 26280, contractor_id: "demo-co-01", notes: "Class 4 hailstone discount", submitted_at: "2026-03-26T19:22:11.000Z" },
  { quote_id: "Q-20260329-F1J5L", zone_key: "high_cost_insurance_heavy", state_code: "CO", tier_key: "best", total_sqft: 3440, predicted_materials: 8590, predicted_labor: 10120, predicted_total: 30040, actual_materials: 8740, actual_labor_hours: 56, actual_labor_cost: 10380, actual_total: 30410, contractor_id: "demo-co-01", notes: "", submitted_at: "2026-04-02T17:33:50.000Z" },
  { quote_id: "Q-20260405-G2H7N", zone_key: "mid_market", state_code: "VA", tier_key: "better", total_sqft: 2670, predicted_materials: 6200, predicted_labor: 7480, predicted_total: 20880, actual_materials: 6080, actual_labor_hours: 40, actual_labor_cost: 7330, actual_total: 20440, contractor_id: "demo-va-01", notes: "Faster than estimated", submitted_at: "2026-04-09T20:11:30.000Z" },
];

export function recordFeedback(entry: Omit<FeedbackEntry, "submitted_at">): FeedbackEntry {
  const full: FeedbackEntry = { ...entry, submitted_at: new Date().toISOString() };
  try {
    appendFileSync(RUNTIME_PATH, JSON.stringify(full) + "\n", "utf8");
  } catch (e) {
    // Read-only filesystem (rare even on Vercel since /tmp is writable).
    // Calibration math still works for the response — we just won't
    // persist past this invocation. Acceptable for the hackathon demo.
    console.warn("feedback persistence skipped:", (e as Error).message);
  }
  return full;
}

export function readFeedback(): FeedbackEntry[] {
  const fileEntries = existsSync(RUNTIME_PATH)
    ? readFileSync(RUNTIME_PATH, "utf8")
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => {
          try { return JSON.parse(l) as FeedbackEntry; } catch { return null; }
        })
        .filter((e): e is FeedbackEntry => e !== null)
    : [];
  return [...SEED, ...fileEntries];
}

// Returns a multiplicative adjustment to apply on top of the zone's base
// labor and material multipliers. 1.0 = no adjustment; > 1.0 = our
// predictions are running low (bump up); < 1.0 = we're over-quoting.
export function applyFeedbackAdjustment(zoneKey: ZoneKey): { labor_adjust: number; material_adjust: number; sample_size: number } {
  const all = readFeedback();
  const inZone = all.filter((e) => e.zone_key === zoneKey);
  if (inZone.length < MIN_SAMPLES) {
    return { labor_adjust: 1, material_adjust: 1, sample_size: inZone.length };
  }

  const labor_ratios = inZone.map((e) => e.actual_labor_cost / Math.max(1, e.predicted_labor));
  const material_ratios = inZone.map((e) => e.actual_materials / Math.max(1, e.predicted_materials));

  const labor_adjust = clamp(median(labor_ratios), 1 - TRUST_CAP, 1 + TRUST_CAP);
  const material_adjust = clamp(median(material_ratios), 1 - TRUST_CAP, 1 + TRUST_CAP);

  return { labor_adjust, material_adjust, sample_size: inZone.length };
}

export type CalibrationSummary = {
  zone_key: ZoneKey;
  sample_size: number;
  labor_adjust: number;
  material_adjust: number;
  median_total_error_pct: number;
};

export function calibrationByZone(extraEntries: FeedbackEntry[] = []): CalibrationSummary[] {
  const all = [...readFeedback(), ...extraEntries];
  const byZone = new Map<ZoneKey, FeedbackEntry[]>();
  for (const e of all) {
    const k = e.zone_key;
    if (!byZone.has(k)) byZone.set(k, []);
    byZone.get(k)!.push(e);
  }
  const out: CalibrationSummary[] = [];
  for (const [zone_key, entries] of byZone.entries()) {
    if (entries.length < MIN_SAMPLES) continue;
    const labor_ratios = entries.map((e) => e.actual_labor_cost / Math.max(1, e.predicted_labor));
    const material_ratios = entries.map((e) => e.actual_materials / Math.max(1, e.predicted_materials));
    const errs = entries.map((e) => (e.actual_total - e.predicted_total) / Math.max(1, e.predicted_total));
    out.push({
      zone_key,
      sample_size: entries.length,
      labor_adjust: clamp(median(labor_ratios), 1 - TRUST_CAP, 1 + TRUST_CAP),
      material_adjust: clamp(median(material_ratios), 1 - TRUST_CAP, 1 + TRUST_CAP),
      median_total_error_pct: median(errs) * 100,
    });
  }
  return out;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 1;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
