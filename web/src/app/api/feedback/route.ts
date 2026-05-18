import { NextResponse } from "next/server";
import { recordFeedback, calibrationByZone, type FeedbackEntry } from "@/lib/feedback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ZONES = new Set(["low_cost_competitive", "mid_market", "high_cost_insurance_heavy", "premium_metro", "default"]);
const VALID_TIERS = new Set(["good", "better", "best"]);

// Sane ranges. A real quote in the US is rarely below $5K or above $200K
// for a single residential roof. Sqft below 600 is a dog house; above
// 12,000 is a commercial building. Reject inputs outside these bounds
// rather than letting them poison per-zone calibration medians.
const RANGES = {
  sqft: { min: 600, max: 12000 },
  cost: { min: 500, max: 200_000 },
  hours: { min: 1, max: 400 },
} as const;

type FieldSpec = {
  key: keyof FeedbackEntry;
  type: "string" | "number" | "enum";
  range?: { min: number; max: number };
  enumValues?: Set<string>;
};

const REQUIRED_FIELDS: FieldSpec[] = [
  { key: "quote_id",            type: "string" },
  { key: "zone_key",            type: "enum",   enumValues: VALID_ZONES },
  { key: "state_code",          type: "string" },
  { key: "tier_key",            type: "enum",   enumValues: VALID_TIERS },
  { key: "total_sqft",          type: "number", range: RANGES.sqft },
  { key: "predicted_materials", type: "number", range: RANGES.cost },
  { key: "predicted_labor",     type: "number", range: RANGES.cost },
  { key: "predicted_total",     type: "number", range: RANGES.cost },
  { key: "actual_materials",    type: "number", range: RANGES.cost },
  { key: "actual_labor_hours",  type: "number", range: RANGES.hours },
  { key: "actual_labor_cost",   type: "number", range: RANGES.cost },
  { key: "actual_total",        type: "number", range: RANGES.cost },
];

function validate(body: any): { ok: true; entry: Omit<FeedbackEntry, "submitted_at"> } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  for (const f of REQUIRED_FIELDS) {
    const v = body?.[f.key];
    if (v === undefined || v === null) {
      errors.push(`${f.key}: required`);
      continue;
    }
    if (f.type === "string") {
      if (typeof v !== "string" || v.trim().length === 0) errors.push(`${f.key}: must be a non-empty string`);
      else if (v.length > 100) errors.push(`${f.key}: too long (max 100 chars)`);
    } else if (f.type === "enum") {
      if (typeof v !== "string" || !f.enumValues!.has(v)) errors.push(`${f.key}: must be one of ${[...f.enumValues!].join(", ")}`);
    } else if (f.type === "number") {
      const n = typeof v === "string" ? Number(v) : v;
      if (typeof n !== "number" || !Number.isFinite(n)) errors.push(`${f.key}: must be a finite number`);
      else if (f.range && (n < f.range.min || n > f.range.max)) errors.push(`${f.key}: out of range (${f.range.min}–${f.range.max}), got ${n}`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  // Build a clean, type-coerced entry. Strings trimmed, numbers coerced.
  const entry: Omit<FeedbackEntry, "submitted_at"> = {
    quote_id:           String(body.quote_id).trim(),
    zone_key:           body.zone_key,
    state_code:         String(body.state_code).trim().toUpperCase(),
    tier_key:           body.tier_key,
    total_sqft:         Number(body.total_sqft),
    predicted_materials:Number(body.predicted_materials),
    predicted_labor:    Number(body.predicted_labor),
    predicted_total:    Number(body.predicted_total),
    actual_materials:   Number(body.actual_materials),
    actual_labor_hours: Number(body.actual_labor_hours),
    actual_labor_cost:  Number(body.actual_labor_cost),
    actual_total:       Number(body.actual_total),
  };
  if (typeof body.contractor_id === "string" && body.contractor_id.trim().length > 0) entry.contractor_id = body.contractor_id.trim().slice(0, 60);
  if (typeof body.notes === "string") entry.notes = body.notes.slice(0, 500);
  return { ok: true, entry };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const v = validate(body);
    if (!v.ok) {
      return NextResponse.json({ error: "validation failed", details: v.errors }, { status: 400 });
    }
    const saved = recordFeedback(v.entry);
    return NextResponse.json({ ok: true, saved, calibration: calibrationByZone() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "feedback failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ calibration: calibrationByZone() });
}
