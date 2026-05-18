"use client";

// Per-photo measurement diagnostics + pitch override.
//
// Shown only when the measurement came from a user-uploaded photo
// (m.photo_diagnostics is populated). Surfaces:
//   - Reference agreement % and confidence rationale
//   - Per-reference contribution table (which scale signals voted,
//     with what weight)
//   - EXIF GSD signal status (when active)
//   - Pitch source + manual override dropdown for contractor sign-off
//
// When the contractor changes the pitch dropdown and clicks
// "Recalculate," we re-POST to /api/measure-from-photo with the
// stored photo blobs + the pitch_override field, then fetch a fresh
// quote. The UI calls back to the page via `onRecalculate`.
import { useState } from "react";
import type { RoofMeasurement } from "@/lib/types";

const PITCH_OPTIONS: Array<{ rise: number; label: string }> = [
  { rise: 4,  label: "4:12 (low slope)" },
  { rise: 6,  label: "6:12 (typical residential)" },
  { rise: 7,  label: "7:12" },
  { rise: 8,  label: "8:12 (steep)" },
  { rise: 10, label: "10:12 (very steep)" },
  { rise: 12, label: "12:12 (cathedral)" },
];

export default function PhotoMeasureDiagnostics({
  measurement,
  onRecalculate,
  busy,
}: {
  measurement: RoofMeasurement;
  onRecalculate: (newPitchRise: number) => void;
  busy: boolean;
}) {
  const d = measurement.photo_diagnostics;
  const [pitchSelection, setPitchSelection] = useState<number>(measurement.pitch.rise);

  if (!d) return null;

  // Color-code the agreement % into intuitive bands.
  const agreementBand =
    d.agreement_pct >= 75 ? "text-emerald-700" :
    d.agreement_pct >= 50 ? "text-amber-600"  : "text-rose-600";

  return (
    <div className="card p-5 fade-up">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="label-tiny mb-1">Photo measurement diagnostics</div>
          <div className="font-display text-lg font-semibold text-ink-900">
            How we measured this photo
          </div>
        </div>
        <span
          className={
            measurement.confidence === "high" ? "badge-green" :
            measurement.confidence === "medium" ? "badge-amber" : "badge-gray"
          }
        >
          {measurement.confidence} confidence
        </span>
      </div>

      <div className="grid md:grid-cols-3 gap-3 mb-5 text-sm">
        <div className="rounded-lg bg-ink-100/40 px-3 py-2.5">
          <div className="label-tiny mb-0.5">Reference agreement</div>
          <div className={"text-xl font-semibold tabular-nums " + agreementBand}>
            {d.agreement_pct}%
          </div>
          <div className="text-xs text-ink-500 mt-0.5">
            {d.reference_count} ref{d.reference_count === 1 ? "" : "s"}
            {d.total_photos > 1 ? ` · primary: photo ${d.primary_photo_index + 1} of ${d.total_photos}` : ""}
          </div>
        </div>
        <div className="rounded-lg bg-ink-100/40 px-3 py-2.5">
          <div className="label-tiny mb-0.5">EXIF GSD signal</div>
          <div className="text-xl font-semibold text-ink-900">
            {d.gsd_active ? "Active" : "—"}
          </div>
          <div className="text-xs text-ink-500 mt-0.5">
            {d.gsd_active && d.altitude_agl_m
              ? `${Math.round(d.altitude_agl_m)} m AGL · ±${(d.gsd_sigma_pct ?? 0).toFixed(0)}% σ`
              : "EXIF altitude not available"}
          </div>
        </div>
        <div className="rounded-lg bg-ink-100/40 px-3 py-2.5">
          <div className="label-tiny mb-0.5">Photo type</div>
          <div className="text-xl font-semibold text-ink-900 capitalize">
            {d.view_type}
          </div>
          <div className="text-xs text-ink-500 mt-0.5">
            Pitch from {d.pitch_source.replace(/_/g, " ")}
          </div>
        </div>
      </div>

      {d.total_photos > 1 && (
        <div className="rounded-lg border border-ink-100 bg-white px-3.5 py-3 mb-5">
          <div className="flex items-center justify-between gap-3 flex-wrap text-sm">
            <div>
              <div className="label-tiny mb-0.5">Cross-photo agreement</div>
              <div className="text-ink-700">
                Do all {d.total_photos} uploaded photos agree on the camera-height-relative scale?{" "}
                <span className={
                  d.cross_photo_agreement_pct >= 75 ? "font-semibold text-emerald-700" :
                  d.cross_photo_agreement_pct >= 50 ? "font-semibold text-amber-600"  :
                  "font-semibold text-rose-600"
                }>
                  {d.cross_photo_agreement_pct}%
                </span>
              </div>
              <div className="text-xs text-ink-500 mt-1">
                {d.cross_photo_agreement_pct >= 75
                  ? "Photos look like they were shot at similar altitudes — good cross-validation."
                  : d.cross_photo_agreement_pct >= 50
                    ? "Photos disagree somewhat on scale — taken at different altitudes/zooms."
                    : "Photos disagree on scale. The polygon-source photo's measurements still drive the result, but consider re-shooting from one consistent altitude."}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Per-reference breakdown — only useful when we actually have refs. */}
      {d.per_reference.length > 0 && (
        <div className="mb-5">
          <div className="label-tiny mb-2">Reference contributions (variance-weighted)</div>
          <div className="rounded-lg border border-ink-100 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-ink-100/30">
                <tr className="text-ink-500">
                  <th className="text-left px-3 py-2 font-medium">Reference</th>
                  <th className="text-right px-3 py-2 font-medium">Variance</th>
                  <th className="text-right px-3 py-2 font-medium">Vision conf.</th>
                  <th className="text-right px-3 py-2 font-medium">Weight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100/60">
                {d.per_reference.map((r, i) => (
                  <tr key={i} className="bg-white">
                    <td className="px-3 py-2 text-ink-900">{r.type.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-600">±{r.variance_ft.toFixed(1)} ft</td>
                    <td className="px-3 py-2 text-right capitalize text-ink-600">{r.confidence}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {(r.weight * 100).toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pitch override — particularly useful when pitch_source is
          vision_default (we genuinely guessed) or when the contractor
          knows the real pitch from a site visit. */}
      <div className="rounded-lg border border-ink-100 p-3.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="label-tiny mb-0.5">Pitch override</div>
            <div className="text-sm text-ink-700">
              Currently <span className="font-medium">{measurement.pitch.label}</span>{" "}
              <span className="text-ink-500">
                · {d.pitch_source === "user_override" ? "manually set" : `from ${d.pitch_source.replace(/_/g, " ")}`}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={pitchSelection}
              onChange={(e) => setPitchSelection(parseInt(e.target.value, 10))}
              className="rounded-lg border border-ink-100 bg-white text-sm py-1.5 px-2"
              disabled={busy}
            >
              {PITCH_OPTIONS.map((opt) => (
                <option key={opt.rise} value={opt.rise}>{opt.label}</option>
              ))}
            </select>
            <button
              onClick={() => onRecalculate(pitchSelection)}
              disabled={busy || pitchSelection === measurement.pitch.rise}
              className="btn-ghost text-xs px-3 py-1.5"
            >
              {busy ? "Recalculating…" : "Recalculate"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
