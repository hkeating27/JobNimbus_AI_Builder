"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Header-nav modals: "How it works" and "Pricing model".
// Both render the same Modal shell; content differs.
//
// These are the contractor's (and hackathon judges') verification entry
// points — clicking either gives a one-screen view of the methodology
// behind the quote so they can validate "build, don't buy" without
// digging into pricing.json or the source.

type ModalKind = "how-it-works" | "pricing-model" | null;

export function MethodologyNav() {
  const [open, setOpen] = useState<ModalKind>(null);

  return (
    <>
      <button onClick={() => setOpen("how-it-works")} className="hover:text-ink-900">
        How it works
      </button>
      <button onClick={() => setOpen("pricing-model")} className="hover:text-ink-900">
        Pricing model
      </button>
      <a href="#feedback" className="hover:text-ink-900">Submit actuals</a>
      <Modal kind={open} onClose={() => setOpen(null)} />
    </>
  );
}

function Modal({ kind, onClose }: { kind: ModalKind; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Lock body scroll when modal is open.
  useEffect(() => {
    if (kind) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
  }, [kind]);

  // Close on Escape.
  useEffect(() => {
    if (!kind) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [kind, onClose]);

  if (!mounted || !kind) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 backdrop-blur-sm fade-up p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="card w-full max-w-3xl max-h-[85vh] overflow-y-auto p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <div className="label-tiny mb-1">{kind === "how-it-works" ? "Methodology" : "Pricing"}</div>
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
              {kind === "how-it-works" ? "How it works" : "Pricing model"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="size-8 rounded-lg hover:bg-ink-100/60 grid place-items-center text-ink-500 hover:text-ink-900"
            aria-label="Close"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="size-4">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {kind === "how-it-works" ? <HowItWorks /> : <PricingModel />}
      </div>
    </div>,
    document.body
  );
}

function HowItWorks() {
  return (
    <div className="space-y-6 text-sm text-ink-700 leading-relaxed">
      <section>
        <h3 className="font-display text-base font-semibold text-ink-900 mb-2">Three-source measurement ensemble</h3>
        <p>
          Address goes in. We don&rsquo;t sole-source from any one provider —
          three independent measurements feed the ensemble, with disagreement
          itself surfaced as a confidence signal.
        </p>
        <ul className="mt-3 space-y-2">
          <li className="flex gap-2"><Bullet /><span><b>Google Solar API (buildingInsights)</b> — total roof area + per-segment pitch derived from elevation imagery. Highest precision when the building is well-conditioned and dominates consensus in that case.</span></li>
          <li className="flex gap-2"><Bullet /><span><b>Claude vision (Opus 4.7)</b> — independent footprint estimate, segment count, complexity classification, and per-category penetration counts (plumbing vents, exhaust vents, box vents, skylights, chimneys, satellite dishes, solar panels) — each scored high / medium / low confidence. Runs on the satellite image plus a street-view photo of the property.</span></li>
          <li className="flex gap-2"><Bullet /><span><b>OpenStreetMap (Nominatim)</b> — building polygon footprint when OSM has the address tagged. Hit-or-miss in US residential, but provides a third independent reading when present.</span></li>
        </ul>
      </section>

      <section>
        <h3 className="font-display text-base font-semibold text-ink-900 mb-2">Suspect-Solar handling</h3>
        <p>
          Solar&rsquo;s <code>findClosest</code> sometimes aggregates an attached
          duplex or shared-wall neighbor into a single building reading. We
          detect that via three signals: segment count &gt; 15, total area
          &gt; 5,000 sqft, or bimodal segment heights. When any fires, the
          ensemble shifts weights from Solar-dominant (0.85) to Solar-down-
          weighted (0.15) in favor of the independent estimators (Vision 0.60
          / OSM 0.25). The submitted number is no longer Solar&rsquo;s when
          we have specific reason to disbelieve it.
        </p>
      </section>

      <section>
        <h3 className="font-display text-base font-semibold text-ink-900 mb-2">Calibration accuracy</h3>
        <p>
          Against the 5 benchmark properties (with Reference A and Reference B
          commercial measurements published in the hackathon spec):
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="card p-3">
            <div className="label-tiny mb-1">Median absolute error</div>
            <div className="font-display text-xl font-semibold text-ink-900">0.9%</div>
          </div>
          <div className="card p-3">
            <div className="label-tiny mb-1">Worst-case absolute error</div>
            <div className="font-display text-xl font-semibold text-ink-900">7.0%</div>
          </div>
        </div>
        <p className="mt-3 text-xs text-ink-500">
          Calibration set is small (n=5) and held independent of the test
          properties we submit blind. Pipeline performs equivalently on
          Opus 4.7 vs. Sonnet 4.6 for typical cases, but Opus is materially
          better on the suspect-Solar fallback path where vision&rsquo;s
          gut estimate carries the consensus — so we ship Opus.
        </p>
      </section>

      <section>
        <h3 className="font-display text-base font-semibold text-ink-900 mb-2">Photo-upload pipeline (alternative input)</h3>
        <p>
          Contractors who don&rsquo;t want to use the address path — or who
          have their own drone footage — can upload up to 3 aerial photos
          instead. The fundamental problem is <i>scale</i>: a roof at 60 ft
          camera height looks identical to a roof at 200 ft, just zoomed
          differently. We solve it with up to three independent signals.
        </p>
        <ul className="mt-3 space-y-2">
          <li className="flex gap-2"><Bullet /><span><b>Vision-identified scale references.</b> Claude finds known-size objects in frame: sidewalk width (4–5 ft, ADA-mandated, very consistent), parking-space dimensions (9 × 18 ft), pickup truck length (19.5 ft), driveway widths, sedan length, etc. Each gets a real-world length from a server-side canonical lookup so the model can&rsquo;t bust the math by guessing wrong.</span></li>
          <li className="flex gap-2"><Bullet /><span><b>Inverse-variance-weighted voting.</b> A sidewalk (±0.5 ft of 4.5 ft = ~11% variance) outweighs a driveway (±2 ft of 10 ft = 20% variance) by ~16x in the ensemble. Vision&rsquo;s own confidence (high / medium / low) further modulates. So a single high-confidence sidewalk read can outvote three low-confidence driveway reads.</span></li>
          <li className="flex gap-2"><Bullet /><span><b>EXIF altitude → ground sample distance.</b> When the photo carries GPS altitude + 35mm-equivalent focal length, we cross-reference Google&rsquo;s Elevation API for ground level at that lat/lng, compute altitude AGL, then derive pixels-per-foot directly: <code>(36mm / focal_length) × altitude_AGL / image_pixel_width</code>. This is the strongest signal when present (typical ~5% σ vs 11–20% for visual references) and dominates the ensemble.</span></li>
        </ul>
        <p className="mt-3">
          When all three are available, they cross-validate; high agreement → high confidence. When only one is, the contractor sees that surfaced.
        </p>
      </section>

      <section>
        <h3 className="font-display text-base font-semibold text-ink-900 mb-2">Per-photo coordinate systems (multi-photo gotcha)</h3>
        <p>
          Each uploaded photo has its <i>own</i> normalized coordinate system.
          A pickup truck at 6% of photo A&rsquo;s width and 4% of photo B&rsquo;s
          width is the SAME truck — but if the cameras were at different
          altitudes, the implied pixels-per-foot differs by ~50%. Naively
          averaging references across photos produces garbage.
        </p>
        <p className="mt-2">
          So Claude tags every reference with <code>photo_index</code> and
          identifies a <code>polygon_source_photo_index</code> (which photo
          the roof outline was traced from). We compute pixels-per-foot
          <i> per photo</i>, use the polygon-source photo&rsquo;s ppf for the
          area calculation, and surface a separate <i>cross-photo agreement %</i>
          telling the contractor whether their uploads agree on camera height
          (a sanity signal independent of within-photo reference voting).
        </p>
      </section>

      <section>
        <h3 className="font-display text-base font-semibold text-ink-900 mb-2">Pitch on photo uploads</h3>
        <p>
          True nadir (top-down) photos can&rsquo;t show pitch — the roof
          looks flat. Three fallbacks, in priority order:
        </p>
        <ul className="mt-2 space-y-1.5 text-[13px]">
          <li><b>1. Contractor override.</b> Pitch dropdown in the diagnostics card lets the field rep set 4:12 / 6:12 / 8:12 / etc. directly. Re-runs the quote with the new slope multiplier.</li>
          <li><b>2. Google Solar pitch fallback.</b> If EXIF GPS or address is supplied, we fetch Solar buildingInsights at that point — pitch is authoritative when imagery quality is HIGH.</li>
          <li><b>3. Vision oblique cues.</b> If the photo is angled, vision estimates pitch from foreshortening of segments. Surface low confidence when ambiguous.</li>
        </ul>
        <p className="mt-2 text-xs text-ink-500">
          The diagnostics card shows which path was used (e.g. <i>&ldquo;Pitch source: google_solar&rdquo;</i>) so the contractor can verify before signing the bid.
        </p>
      </section>

      <section>
        <h3 className="font-display text-base font-semibold text-ink-900 mb-2">Penetration detection &amp; cost rules</h3>
        <p>
          Vision returns per-category counts with high / medium / low confidence.
          Low-confidence detections are zeroed before reaching the quote so we
          don&rsquo;t over-quote on uncertain reads.
        </p>
        <p className="mt-2">
          <b>Drives cost:</b> plumbing vents and exhaust vents (new pipe boots),
          box vents and power-attic vents (new assemblies), skylights (reflash
          kits when present).<br />
          <b>Identified but not charged:</b> chimneys (homeowner keeps the
          existing chimney), solar panels (requires solar-contractor coord),
          satellite dishes (~20 min of crew time is absorbed into site labor
          rather than tracked as a line item).
        </p>
      </section>

      <section>
        <h3 className="font-display text-base font-semibold text-ink-900 mb-2">What we tried and dropped (honest list)</h3>
        <ul className="space-y-1.5 text-[13px]">
          <li><b>Solar dataLayers raster + boundary extraction.</b> Built a Moore-neighborhood + Douglas-Peucker pipeline over Google&rsquo;s 0/1 mask raster. Worked technically but the visualization undermined credibility — the inner edges (vision-classified ridge / hip / valley) consistently floated outside the building outline. We scrapped the visual overlay; the rest of the pipeline kept the data we needed.</li>
          <li><b>Street-view-only pitch tie-breaker.</b> Ran a separate Claude pass on the gable end asking specifically for rise:12. Calibration showed it produced 0% improvement vs Solar&rsquo;s elevation-derived pitch on the 5 benchmarks while adding ~3 seconds. Removed.</li>
          <li><b>Vision model swap to Sonnet 4.6.</b> Tested for speed (was hoping ~3× faster). It came out the same speed in our pipeline AND introduced a 22.7% calibration miss on Spring TX where Solar is suspect and vision&rsquo;s gut weight is heavy. Stayed on Opus.</li>
        </ul>
      </section>

      <section>
        <h3 className="font-display text-base font-semibold text-ink-900 mb-2">Where this goes next: job tracking + true closed-loop</h3>
        <p>
          Today every quote gets a unique ID (<code className="text-[12px] bg-ink-100/60 px-1.5 py-0.5 rounded">Q-yyyymmdd-xxxxx</code>),
          but those IDs aren&rsquo;t persisted server-side — close the tab and
          the quote is gone. The <code>/api/feedback</code> endpoint accepts
          actuals back, but only one direction of the loop is real. To make the
          calibration genuinely closed, three pieces still need to land:
        </p>
        <ul className="mt-3 space-y-2">
          <li className="flex gap-2"><Bullet /><span><b>Persistent jobs.</b> Vercel Postgres (or Neon) backing a <code>Job</code> table keyed by <code>quote_id</code> + address. Status lifecycle: <code>quoted → signed → in_progress → completed</code>. Contractor dashboard at <code>/jobs</code> with search by address/date.</span></li>
          <li className="flex gap-2"><Bullet /><span><b>QuickBooks Online integration.</b> OAuth 2.0; push the accepted quote as a QBO Invoice + Customer with our <code>quote_id</code> stamped on a custom field; webhooks on <code>Bill</code>, <code>TimeActivity</code>, and <code>Invoice.paid</code> pull actuals back keyed by that same custom field. That gives us actual material cost, actual labor hours, and realized revenue per job — without the contractor double-entering anything.</span></li>
          <li className="flex gap-2"><Bullet /><span><b>Three calibration signals, not one.</b> Right now we only learn from sqft error (when someone bothers to submit it). With actuals from QBO we&rsquo;d also learn (a) <i>cost-basis variance</i> by region — drives updates to <code>pricing.json</code> labor/material multipliers; and (b) <i>vision-confidence calibration</i> — bucketing completed jobs by self-reported confidence to verify low-confidence reads actually correlate with higher post-hoc error. If they don&rsquo;t, the model is overconfident and the ensemble weights need tuning.</span></li>
        </ul>
        <p className="mt-3 text-xs text-ink-500">
          Effort estimate: ~6 hours for the persistence + dashboard spine, ~10 hours for QBO OAuth + webhooks (the load-bearing piece), ~3 hours for the calibration aggregation views. Out of scope for the hackathon submission, but the schema and join keys are already shaped for it — every quote already has the ID it would be tracked under.
        </p>
      </section>
    </div>
  );
}

function PricingModel() {
  return (
    <div className="space-y-6 text-sm text-ink-700 leading-relaxed">
      <section>
        <h3 className="font-display text-base font-semibold text-ink-900 mb-2">Cost build</h3>
        <pre className="bg-ink-100/40 rounded-lg px-4 py-3 text-[12px] leading-relaxed font-mono text-ink-900 overflow-x-auto">{`cost_basis = (Σ materials × material_multiplier)
           + (Σ labor × labor_multiplier × supervision_overhead)

quote = cost_basis / (1 - target_gross_margin)
      + dumpster + permit`}</pre>
        <p className="mt-2">
          Materials and labor tracked separately so we can tune regional margin
          and stay competitive bid-to-bid. Margin uplift uses gross-margin math
          (divide by 1−margin), not markup.
        </p>
      </section>

      <section>
        <h3 className="font-display text-base font-semibold text-ink-900 mb-2">Gross margin vs. net profit</h3>
        <p>
          The line item labeled <b>Gross margin (X%)</b> on each tier card is{" "}
          <b>gross profit margin</b>: the percent of the bid price left after
          materials and labor. It is NOT take-home profit. After typical
          roofing-industry overhead — G&amp;A, GL + workers&rsquo; comp insurance,
          office, vehicles, sales commission, marketing — net profit is roughly{" "}
          <b>gross margin − 20 percentage points</b>.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div className="card p-3">
            <div className="label-tiny">Gross margin</div>
            <div className="font-medium mt-0.5">30%</div>
            <div className="text-ink-500 mt-1">$3,000 of $10K bid</div>
          </div>
          <div className="card p-3">
            <div className="label-tiny">Overhead (typical)</div>
            <div className="font-medium mt-0.5">~20%</div>
            <div className="text-ink-500 mt-1">$2,000 of $10K bid</div>
          </div>
          <div className="card p-3 ring-1 ring-emerald-500/30">
            <div className="label-tiny">Net profit</div>
            <div className="font-medium mt-0.5">~10%</div>
            <div className="text-ink-500 mt-1">$1,000 take-home</div>
          </div>
        </div>
        <p className="mt-3 text-xs text-ink-500">
          A 30–40% gross margin is the industry-typical target for residential
          reroof — it&rsquo;s what lets a healthy roofer net 10–15% after overhead.
          Anything below ~20% gross is bidding below break-even on real-world
          overhead loads. The tier card surfaces an estimated net under each
          total so the contractor can sanity-check at a glance.
        </p>
      </section>

      <section>
        <h3 className="font-display text-base font-semibold text-ink-900 mb-2">Three-layer regional pricing</h3>
        <ul className="space-y-2">
          <li className="flex gap-2"><Bullet /><span><b>Zone</b> — 4 macro zones (low-cost competitive / mid / high-cost insurance-heavy / premium metro) keyed by state. Sets default labor multiplier, material multiplier, and target gross margin.</span></li>
          <li className="flex gap-2"><Bullet /><span><b>State labor index</b> — refines labor multiplier per state from BLS OEWS roofer wages (May 2024).</span></li>
          <li className="flex gap-2"><Bullet /><span><b>Metro overrides</b> — supersede zone+state for 19 high-variance MSAs (Bay Area, NYC, Boston, Boulder, Houston, Miami-Dade HVHZ, etc.).</span></li>
        </ul>
      </section>

      <section>
        <h3 className="font-display text-base font-semibold text-ink-900 mb-2">Three tiers, every quote</h3>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="card p-3">
            <div className="label-tiny">GOOD</div>
            <div className="font-medium mt-0.5">3-tab</div>
            <div className="text-ink-500 mt-1">25 yr · 60 mph</div>
          </div>
          <div className="card p-3 ring-1 ring-brand-500/30">
            <div className="label-tiny">BETTER</div>
            <div className="font-medium mt-0.5">Architectural</div>
            <div className="text-ink-500 mt-1">Lifetime · 130 mph</div>
          </div>
          <div className="card p-3">
            <div className="label-tiny">BEST</div>
            <div className="font-medium mt-0.5">Class 4 Impact</div>
            <div className="text-ink-500 mt-1">Lifetime · 130 mph</div>
          </div>
        </div>
      </section>

      <section>
        <h3 className="font-display text-base font-semibold text-ink-900 mb-2">Code-driven material promotions</h3>
        <ul className="space-y-1.5 text-[13px]">
          <li><b>FL HVHZ</b> (Miami-Dade, Broward, Monroe) → ring-shank stainless, 6-nail pattern, full-deck I&amp;W secondary water barrier, lead pipe boots, hurricane clips.</li>
          <li><b>CO/TX hail belt</b> → recommend Class 4 impact-resistant for the insurance discount.</li>
          <li><b>Cold climate</b> (avg Jan ≤25°F) → ice &amp; water shield extends 24″ past warm wall (IRC R905.1.2).</li>
          <li><b>CA Title 24</b> → cool-roof reflective shingles on low-slope sections.</li>
        </ul>
      </section>

      <section>
        <h3 className="font-display text-base font-semibold text-ink-900 mb-2">Sourcing</h3>
        <p>
          Every rate is cited in <code className="text-[12px] bg-ink-100/60 px-1.5 py-0.5 rounded">pricing.json</code>{" "}
          under <code className="text-[12px] bg-ink-100/60 px-1.5 py-0.5 rounded">sources</code>. Primary references: HomeGuide,
          ThisOldHouse, HomeWyse, Fixr, Angi (all 2026 cost guides), and BLS
          OEWS for labor. When two sources disagreed, we picked the median and
          retained both ends of the range so the tool can produce
          low/expected/high quotes on demand.
        </p>
      </section>
    </div>
  );
}

function Bullet() {
  return <span className="size-1.5 rounded-full bg-brand-500 mt-2 shrink-0" />;
}
