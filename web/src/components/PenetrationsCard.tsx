import type { Penetrations, PenetrationCategory, PenetrationConfidence } from "@/lib/types";

type CatDef = {
  key: PenetrationCategory;
  label: string;
  short: string;
  charged: boolean;
  note?: string;
};

const CATEGORIES: CatDef[] = [
  { key: "plumbing_vents",    label: "Plumbing vents",    short: "Plumbing vent", charged: true,  note: "new pipe boot per" },
  { key: "exhaust_vents",     label: "Exhaust vents",     short: "Exhaust vent",  charged: true,  note: "new vent cap per" },
  { key: "box_vents",         label: "Box vents",         short: "Box vent",      charged: true,  note: "new assembly per" },
  { key: "power_attic_vents", label: "Power attic vents", short: "Power vent",    charged: true,  note: "reseal flashing" },
  { key: "skylights",         label: "Skylights",         short: "Skylight",      charged: true,  note: "reflash kit per" },
  { key: "satellite_dishes",  label: "Satellite dishes",  short: "Satellite",     charged: false, note: "absorbed in site labor" },
  { key: "chimneys",          label: "Chimneys",          short: "Chimney",       charged: false, note: "homeowner keeps; not charged" },
  { key: "solar_panels",      label: "Solar panel arrays",short: "Solar array",   charged: false, note: "needs solar-contractor coord." },
];

export default function PenetrationsCard({ p }: { p: Penetrations }) {
  const charged = CATEGORIES.filter((c) => c.charged && p[c.key] > 0);
  const flagged = CATEGORIES.filter((c) => !c.charged && p[c.key] > 0);

  if (charged.length === 0 && flagged.length === 0) return null;

  return (
    <div className="card p-6 fade-up">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="label-tiny mb-1">Roof penetrations</div>
          <div className="font-display text-xl font-semibold text-ink-900">Detected from satellite imagery</div>
          <div className="text-xs text-ink-500 mt-1">
            Each penetration through the deck needs new flashing. Counts are filtered to drop low-confidence detections so we don&rsquo;t over-quote.
          </div>
        </div>
      </div>

      {charged.length > 0 && (
        <div className="mb-4">
          <div className="label-tiny mb-2 text-ink-500">Drives cost — new flashing required</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {charged.map((cat) => (
              <PenetrationTile
                key={cat.key}
                count={p[cat.key]}
                label={p[cat.key] === 1 ? cat.short : cat.label}
                note={cat.note}
                confidence={p.confidence?.[cat.key]}
                tone="charged"
              />
            ))}
          </div>
        </div>
      )}

      {flagged.length > 0 && (
        <div>
          <div className="label-tiny mb-2 text-ink-500">Identified — not charged</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {flagged.map((cat) => (
              <PenetrationTile
                key={cat.key}
                count={p[cat.key]}
                label={p[cat.key] === 1 ? cat.short : cat.label}
                note={cat.note}
                confidence={p.confidence?.[cat.key]}
                tone="flagged"
              />
            ))}
          </div>
        </div>
      )}

      {p.source === "vision" && (
        <div className="mt-4 text-[11px] text-ink-500">
          Source: Claude vision pass on satellite imagery · low-confidence detections excluded
        </div>
      )}
    </div>
  );
}

function PenetrationTile({
  count,
  label,
  note,
  confidence,
  tone,
}: {
  count: number;
  label: string;
  note?: string;
  confidence?: PenetrationConfidence;
  tone: "charged" | "flagged";
}) {
  const ring = tone === "flagged" ? "border-ink-100" : "border-brand-50";
  const bg = tone === "flagged" ? "bg-ink-100/30" : "bg-brand-50/40";
  return (
    <div className={`rounded-xl border ${ring} ${bg} px-3 py-2.5`}>
      <div className="flex items-center justify-between">
        <div className="text-base font-semibold text-ink-900 tabular-nums">
          {count}
        </div>
        {confidence && <ConfidenceDot c={confidence} />}
      </div>
      <div className="text-xs text-ink-700 mt-0.5 leading-tight">{label}</div>
      {note && <div className="text-[10.5px] text-ink-500 mt-0.5 leading-tight">{note}</div>}
    </div>
  );
}

function ConfidenceDot({ c }: { c: PenetrationConfidence }) {
  const color = c === "high" ? "bg-emerald-500" : c === "medium" ? "bg-amber-400" : "bg-ink-300";
  return (
    <div className="flex items-center gap-1" title={`${c} confidence`}>
      <span className={`size-1.5 rounded-full ${color}`} />
      <span className="text-[9.5px] uppercase tracking-wider text-ink-500 font-semibold">{c}</span>
    </div>
  );
}
