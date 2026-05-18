"use client";

import { useState } from "react";
import type { Quote, QuoteTier } from "@/lib/types";

type Calib = { zone_key: string; sample_size: number; labor_adjust: number; material_adjust: number; median_total_error_pct: number };

export default function FeedbackForm({ quote }: { quote: Quote }) {
  const [tierKey, setTierKey] = useState<QuoteTier["key"]>(quote.recommended_tier_key);
  const [actualMaterials, setActualMaterials] = useState<string>("");
  const [actualLaborHours, setActualLaborHours] = useState<string>("");
  const [actualLaborCost, setActualLaborCost] = useState<string>("");
  const [actualTotal, setActualTotal] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ calibration: Calib[] } | null>(null);

  const tier = quote.tiers.find((t) => t.key === tierKey)!;

  async function submit() {
    setSubmitting(true);
    try {
      const r = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quote_id: quote.quote_id,
          zone_key: quote.zone_key,
          state_code: quote.measurement.state_code,
          tier_key: tierKey,
          total_sqft: quote.measurement.total_sqft,
          predicted_materials: tier.materials_regional,
          predicted_labor: tier.labor_regional,
          predicted_total: tier.total,
          actual_materials: Number(actualMaterials),
          actual_labor_hours: Number(actualLaborHours),
          actual_labor_cost: Number(actualLaborCost),
          actual_total: Number(actualTotal),
          notes,
        }),
      });
      const data = await r.json();
      setDone(data);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="size-8 rounded-full bg-emerald-50 grid place-items-center">
            <svg className="size-4 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path d="M5 12l5 5L20 7" /></svg>
          </div>
          <div className="font-display text-lg font-semibold">Recorded — calibration updated</div>
        </div>
        <p className="text-sm text-ink-500 mb-4">Future quotes in your zone will incorporate this actual.</p>
        <table className="w-full text-sm">
          <thead className="text-ink-500">
            <tr><th className="text-left pb-2">Zone</th><th className="text-right pb-2">Samples</th><th className="text-right pb-2">Labor adj</th><th className="text-right pb-2">Material adj</th><th className="text-right pb-2">Median error</th></tr>
          </thead>
          <tbody>
            {done.calibration.map((c) => (
              <tr key={c.zone_key} className="border-t border-ink-100">
                <td className="py-2">{c.zone_key.replaceAll("_", " ")}</td>
                <td className="py-2 text-right tabular-nums">{c.sample_size}</td>
                <td className="py-2 text-right tabular-nums">×{c.labor_adjust.toFixed(3)}</td>
                <td className="py-2 text-right tabular-nums">×{c.material_adjust.toFixed(3)}</td>
                <td className="py-2 text-right tabular-nums">{c.median_total_error_pct >= 0 ? "+" : ""}{c.median_total_error_pct.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="card p-6" id="feedback">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="label-tiny">Closed-loop calibration</div>
          <div className="font-display text-xl font-semibold">Submit job actuals</div>
          <p className="text-sm text-ink-500 mt-1 max-w-prose">When the job is done, drop your real numbers in. We feed them back into our regional multipliers so next quote in your market is sharper.</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Tier completed">
          <select value={tierKey} onChange={(e) => setTierKey(e.target.value as QuoteTier["key"])} className="w-full rounded-lg border border-ink-100 px-3 py-2 bg-white">
            {quote.tiers.map((t) => <option key={t.key} value={t.key}>{t.name} (predicted ${t.total.toLocaleString()})</option>)}
          </select>
        </Field>
        <Field label={`Actual material cost (predicted $${tier.materials_regional.toFixed(0)})`}>
          <Input value={actualMaterials} onChange={setActualMaterials} prefix="$" placeholder="e.g. 5800" />
        </Field>
        <Field label="Actual labor hours">
          <Input value={actualLaborHours} onChange={setActualLaborHours} placeholder="e.g. 42" />
        </Field>
        <Field label={`Actual labor cost (predicted $${tier.labor_regional.toFixed(0)})`}>
          <Input value={actualLaborCost} onChange={setActualLaborCost} prefix="$" placeholder="e.g. 6900" />
        </Field>
        <Field label={`Actual total invoiced (predicted $${tier.total.toLocaleString()})`}>
          <Input value={actualTotal} onChange={setActualTotal} prefix="$" placeholder="e.g. 18400" />
        </Field>
        <Field label="Notes (optional)">
          <Input value={notes} onChange={setNotes} placeholder="e.g. extra decking sheets, weather delay" />
        </Field>
      </div>

      <div className="mt-5 flex justify-end">
        <button onClick={submit} disabled={submitting || !actualMaterials || !actualLaborCost || !actualTotal} className="btn-primary">
          {submitting ? "Recording…" : "Submit actuals"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-ink-700 mb-1">{label}</div>
      {children}
    </div>
  );
}

function Input({ value, onChange, prefix, placeholder }: { value: string; onChange: (v: string) => void; prefix?: string; placeholder?: string }) {
  return (
    <div className="flex items-center rounded-lg border border-ink-100 bg-white focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
      {prefix && <span className="pl-3 text-ink-500">{prefix}</span>}
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="flex-1 px-3 py-2 outline-none rounded-lg" />
    </div>
  );
}
