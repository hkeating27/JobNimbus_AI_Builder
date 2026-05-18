# RoofIQ — JobNimbus AI Hackathon 2026 submission

**Address (or photo) in. Quote-ready estimate out. Roofer-grade reasoning in between.**

### → Live demo: [https://roof-quote-agent.vercel.app/](https://roof-quote-agent.vercel.app/)

A web app that takes a property address — *or* up to 3 user-uploaded aerial photos — measures the roof, and produces a tiered, line-itemized estimate in seconds. A contractor-facing conversational agent walks the rep through every number, real PDFs are generated server-side, and the schema is shaped so a future job-tracking + QuickBooks closed loop drops in cleanly.

> Hackathon spec: [`benchmark-measurements.md`](./benchmark-measurements.md) · [`SUBMISSION.md`](./SUBMISSION.md)
> Pricing model: [`pricing.md`](./pricing.md) · [`pricing.json`](./pricing.json)
> Web app: [`web/`](./web)
> Calibration & test outputs: [`outputs/`](./outputs)
> **Live deployment**: <https://roof-quote-agent.vercel.app/>

---

## How it works

```
  ┌──────────────────────┐    ┌──────────────────┐    ┌──────────────────┐
  │ Address    OR        │ →  │ Measurement      │ →  │ Quote (3 tiers)  │
  │ Photo upload (≤ 3)   │    │ pipeline         │    │ + agent + PDF    │
  └──────────────────────┘    └──────────────────┘    └──────────────────┘
            │                          │                          │
            ▼                          ▼                          ▼
     ┌──────────────┐          ┌─────────────────┐         ┌─────────────┐
     │ Address path:│          │ Photo path:     │         │ pricing.json│
     │ Geocode +    │          │ EXIF GPS +      │         │  (sourced   │
     │ Google Solar │          │ scale refs +    │         │   rate card)│
     │ + Vision +   │          │ EXIF altitude → │         └─────────────┘
     │ OSM ensemble │          │ GSD ensemble    │
     └──────────────┘          └─────────────────┘
```

There are two completely separate measurement front-doors that produce the same `RoofMeasurement` shape downstream — quote/agent/PDF don't care which one ran.

### Measurement pipeline A — address (the satellite path)

Three independent measurements feed an ensemble; disagreement is itself surfaced as a confidence signal.

- **Google Solar API (`buildingInsights`)** — total roof area + per-segment pitch from elevation imagery. Highest precision; dominates consensus when the building is well-conditioned.
- **Claude vision (Opus 4.7)** — independent footprint estimate, segment count, complexity classification, and per-category penetration counts (plumbing vents, exhaust vents, box vents, skylights, chimneys, satellite dishes, solar panels), each scored high / medium / low confidence.
- **OpenStreetMap (Nominatim)** — building polygon footprint when OSM has the address tagged. Hit-or-miss in US residential, but a third independent reading when present.

**Suspect-Solar handling.** Solar's `findClosest` sometimes aggregates an attached duplex / shared-wall neighbor. Detection: segment count > 15, total area > 5,000 sqft, or bimodal segment heights. When any fires, the ensemble shifts weights from Solar-dominant (0.85) to Solar-down-weighted (0.15) in favor of Vision (0.60) and OSM (0.25).

### Measurement pipeline B — photo upload (the contractor's-own-imagery path)

Contractors who don't want the address path — or who have their own drone footage — can upload up to 3 aerial photos. The fundamental challenge is **scale**: the same roof at 60 ft and 200 ft camera height looks identical, just zoomed differently. Up to three independent signals resolve it.

- **Vision-identified scale references.** Sidewalk width (4–5 ft, ADA-mandated, very consistent), parking-space dimensions (9 × 18 ft), pickup truck length (19.5 ft), driveway widths, sedan length, etc. Server-side canonical lookup overrides whatever real-world length vision claims, so the model can't bust the math by guessing wrong.
- **Inverse-variance-weighted voting.** Reference weight = (real_length / σ)² × vision_confidence_factor. A sidewalk (±0.5 ft of 4.5 ft = ~11% variance) outweighs a driveway (±2 ft of 10 ft = 20%) by ~16×. Vision's own confidence (high/medium/low) penalizes uncertain reads.
- **EXIF altitude → GSD direct calculation.** When the photo carries GPS altitude + 35mm-equivalent focal length, we cross-reference Google's Elevation API for ground level at that lat/lng, compute altitude AGL, then derive pixels-per-foot directly: `(36mm / focal_length) × altitude_AGL / image_pixel_width`. Strongest signal when present (~5% σ vs 11–20% for visual references) — dominates the ensemble.

**Per-photo coordinate systems.** Each photo has its own normalized space, so refs from different photos can't be averaged. Vision tags each ref with `photo_index` and identifies a `polygon_source_photo_index`. PPF is computed per photo; the polygon-source photo's PPF drives area math. Cross-photo agreement % surfaces whether the multiple uploads agree on camera height (independent sanity check).

**Pitch on photo uploads** (priority order):
1. **Contractor override.** Pitch dropdown in the diagnostics card — re-runs the quote with a manually-set rise.
2. **Google Solar fallback** via EXIF GPS or supplied address (authoritative when imagery quality is HIGH).
3. **Vision oblique cues.** Foreshortening from non-nadir shots; surfaces low confidence when ambiguous.

**Broken-result bail-outs.** The route returns a clean 422 with actionable guidance — instead of producing a $0 stub quote — when vision identifies a ground-level photo, the polygon area is < 1% of frame (degenerate trace), or the computed footprint is < 200 sqft (implausibly small).

**Client-side compression.** Phone photos can be 5–10 MB and would blow Vercel's 4 MB request body cap. Each upload is downscaled via canvas to 2048 px max long edge at JPEG q=0.85 — typically dropping below 1 MB. EXIF is extracted from the *original* bytes BEFORE re-encoding (canvas strips metadata) and POSTed alongside the compressed file so the EXIF GSD path still works.

### Quote (3 tiers — Good / Better / Best)

| Tier | Shingle | Wind | Warranty |
|---|---|---|---|
| Good | 3-tab asphalt | 60 mph | 25 yr ltd |
| **Better** | Architectural (GAF Timberline HDZ class) | 130 mph | Lifetime ltd |
| Best | Class 4 impact-resistant | 130 mph | Lifetime ltd |

Cost build (transparent, line-by-line):

```
  cost_basis = (Σ materials × material_multiplier)
             + (Σ labor × labor_multiplier × supervision_overhead)
  quote_subtotal = cost_basis / (1 - target_gross_margin)
  total = quote_subtotal + dumpster + permit
```

**Steep-slope premium.** Pitches ≥ 9:12 auto-apply a labor premium (`pricing.labor.install_field_shingles.steep_slope_premium_pct`).

**Gross margin vs. net profit.** The line item labeled `+ Gross margin (X%)` is gross profit margin (% of revenue after materials + labor, before overhead). The 30–40% range in our zones is industry-typical for retail residential; nets to 10–15% take-home after the typical ~20% overhead (G&A, GL + workers' comp, vehicles, marketing). Each tier card shows an `Est. net profit after ~20% overhead` line so the contractor isn't tricked into reading "30%" as take-home.

Regional zones (low-cost / mid / high / premium) tune `material_multiplier`, `labor_multiplier`, and `target_gross_margin` to keep us competitive bid-to-bid. State labor index (BLS OEWS) refines per-state; 19 metro overrides supersede zone+state for high-variance MSAs (Bay Area, NYC, Boston, Boulder, Houston, Miami-Dade HVHZ, etc.).

**Code-driven material promotions:**
- **FL HVHZ** counties → ring-shank stainless fasteners, 6-nail pattern, full-deck I&W secondary water barrier, lead pipe boots, hurricane clips.
- **CO Front Range hail belt** → recommend Class 4 impact-resistant for the insurance discount.
- **Cold climates** (avg Jan ≤ 25°F) → ice & water shield extends 24" past the warm wall (IRC R905.1.2).
- **CA Title 24** → cool-roof reflective shingles on low-slope sections.

**Regional insurance / utility incentives.** 21 grouped entries covering 28 states (TX, CO, OK, KS, NE, NM, MO, MN, IA, IL, WI, AZ, AR, UT, WY/SD/ND, TN/KY, VA, GA, FL, AL/MS/LA/SC/NC FORTIFIED, CA cool-roof). Each carries contractor-vs-customer copy + savings math + action step.

### Penetration detection & cost rules

Vision returns per-category penetration counts with high / medium / low confidence. Low-confidence detections are zeroed before reaching the quote (don't over-quote on uncertain reads).

- **Drives cost:** plumbing vents + exhaust vents (new pipe boots), box vents + power-attic vents (new assemblies), skylights (reflash kits when present).
- **Identified but not charged:** chimneys (homeowner keeps the existing chimney), solar panels (requires solar-contractor coordination), satellite dishes (~20 min absorbed into site labor).

### Real PDF generation

`POST /api/pdf` with `{ quote, tier, mode }` returns an `application/pdf` blob. Server-side render via `@react-pdf/renderer` — vector PDF, no print dialog, works the same on mobile and desktop. ~140ms for the detailed (3-page) version, ~65ms for simple (1-page).

### Conversational agent (contractor-facing)

`POST /api/agent` (streaming). Opens with a contractor-shaped narrative ("Pulled up your roof — 2,840 sqft, 6:12 pitch, complex hip with two valleys. Confidence is **medium** — Solar fell off and we're leaning on vision's gut estimate. Margin's healthy in this market. Want me to walk through pricing?") and answers contractor questions — talking points for the customer pitch, where to push for upsell, what to double-check on the property — with specific line-item rates rather than generalities.

### Closed-loop calibration (and the planned QuickBooks integration)

Today: contractors POST actual material cost, labor hours, total invoiced for a quote ID to `/api/feedback`. Stored append-only in `web/data/feedback.jsonl`. Per-zone adjustments are computed on the fly as the median ratio of actual / predicted (clamped to ±15%) and multiplied on top of base regional multipliers. Future quotes in that zone get sharper without anyone touching the rate card.

Planned (documented in the in-app "How it works" modal):

- **Persistent jobs.** Vercel Postgres backing a `Job` table keyed by `quote_id` + address. Status lifecycle: `quoted → signed → in_progress → completed`. Contractor dashboard at `/jobs` with search by address/date. The schema is already shape-correct for this — every quote already has its own ID generated.
- **QuickBooks Online.** OAuth 2.0; push the accepted quote as a QBO Customer + Invoice with our `quote_id` stamped on a custom field; webhooks on `Bill`, `TimeActivity`, and `Invoice.paid` pull actuals back keyed by that same field.
- **Three calibration signals, not one.** Right now we only learn from sqft error when someone submits it. With QBO actuals we'd add (a) cost-basis variance by region — drives `pricing.json` adjustments; and (b) vision-confidence calibration — bucket completed jobs by self-reported confidence to verify low-confidence reads correlate with higher post-hoc error.

Effort estimate is in the modal — out of scope for the hackathon submission, but the plumbing is shape-correct for it.

---

## Pricing model

We deliberately did NOT use a "loaded $/sqft" shortcut. Materials and labor are tracked separately, with **every rate sourced and cited** in [`pricing.json`](./pricing.json) (under `"sources"`).

The full material catalog is documented in [`pricing.md`](./pricing.md):

- 5 shingle tiers (3-tab, architectural, premium, Class 4 impact, designer) + metal options
- Underlayment + ice & water shield (with applied-area logic)
- 9 metal flashings (drip edge, valley, step, counter, kickout, pipe boots, skylight, chimney)
- Ventilation (continuous ridge, box, gable, power, soffit)
- Fasteners (galvanized vs HVHZ stainless ring-shank)
- Decking replacement (OSB / CDX) + hurricane clips
- Demo: dumpsters by yard, tipping fees, ground protection
- Labor: tear-off (single/double/triple layer), install, every accessory category, supervision overhead
- Regional: 4 zones × labor + material multipliers + target gross margin, plus state labor index + 19 metro overrides
- Regional incentives: 28 states with contractor/customer talking points + savings math

A worked example for benchmark property #1 (21106 Kenswick Meadows Ct, Humble, TX) lives in [`pricing.md`](./pricing.md#worked-example--benchmark-property-1).

---

## Calibration & accuracy

Two-part validation harness in [`web/scripts/`](./web/scripts):

- `calibrate.ts` — runs the full pipeline on the 5 benchmark properties, scores against Reference A and Reference B, writes `outputs/calibration.md`.
- `run-test-properties.ts` — runs on the 5 hackathon test addresses, writes per-property `measurement.json` + `quote.json` + `quote.md` to `outputs/test-properties/<slug>/`.
- `test-parallax-jump.mjs` + `test-tier-buttons.mjs` — Playwright-based regression checks for the parallax scale-jump bug fix and tier-card button overlap fix.

Run them:

```bash
cd web
npm install
cp .env.example .env.local   # fill GOOGLE_MAPS_API_KEY + ANTHROPIC_API_KEY
npm run calibrate
npm run run-tests
```

Output artifacts (PDFs / JSON / markdown) for each test property are committed under [`outputs/test-properties/`](./outputs/test-properties).

---

## Setup

See [`web/README.md`](./web/README.md) for full setup. TL;DR:

```bash
cd web
cp .env.example .env.local
# fill GOOGLE_MAPS_API_KEY (Geocoding + Solar + Static Maps + Elevation enabled)
# fill ANTHROPIC_API_KEY
npm install
npm run dev
# → http://localhost:3000
```

---

## Submitted totals for the 5 test properties

See [`SUBMISSION-NUMBERS.md`](./SUBMISSION-NUMBERS.md) for the canonical 5 sqft totals + 3-tier quotes + confidence rationale. Per-property artifacts (measurement JSON, quote JSON, quote markdown) are in [`outputs/test-properties/`](./outputs/test-properties/) and regenerate via `cd web && npm run run-tests`.

---

## Roadmap (post-hackathon)

Documented here rather than left implicit. Each is scoped — small enough to ship in a sprint, deferred only because it's not on the critical path for the May 9 deadline.

### Closed-loop calibration (the big one)
Already covered in detail in the in-app "How it works" modal:
- Persistent jobs (Postgres) keyed by `quote_id`
- QuickBooks OAuth + Customer + Invoice push, with webhooks pulling actuals back
- Three calibration signals: sqft error (existing), cost-basis variance by region, vision-confidence calibration

### Photo measurement (Tier 3)
- **DEM-based ground altitude** — replaces the single-point Google Elevation API call with a small grid for slope correction on hilly properties.
- **Ortho-rectification for oblique shots.** Vanishing-point analysis to convert angled drone photos into orthorectified ground-projected rasters before the polygon math runs.
- **Drone metadata standards.** DJI's proprietary flight metadata (flight altitude, gimbal pitch, camera intrinsics) when present is much richer than generic EXIF.
- **Multi-image fusion** of multiple overpasses into one stitched orthorectified mosaic.

### Pricing precision
- **Urban / suburban / rural axis.** Currently differentiated *implicitly* via metro overrides. Add an explicit `density_class` derived from USDA Rural-Urban Continuum Codes (county-level, free) or Census urban-area data. Rural is *not* cheaper — labor savings get eaten by trip charges and distributor distance.
- **Storm-season demand multiplier.** CO May–Sep, FL Jun–Nov, hail-belt April–Sep — material + labor spike 10–15% during peak demand. Time-of-year lookup keyed by ZIP3.
- **Insurance-vs-cash mode.** UI toggle that swings margin: cash-pay = competitive (margin – 4 pts to win bid); insurance = industry-standard scope at full retail margin.
- **Job size adjustment.** Sliding margin curve — small jobs (<$10K) need higher %, large jobs ($30K+) take lower.
- **Two-quote output.** Produce `competitive` and `fair_value` in parallel, let the contractor pick their bidding posture per-bid.

### Measurement accuracy
- **Polygon-edge classification for line items.** Today's ridge / hip / valley / rake / eave splits are heuristic ratios calibrated against the 5 benchmarks. Solar `dataLayers` returns per-segment polygons; classifying edges by adjacency would improve line-item accuracy materially.
- **Multi-building deconfliction.** When Solar's `findClosest` aggregates attached duplexes, use parcel-boundary data (county GIS, free in most states) to clip the Solar response to the legal parcel.
- **Layer detection.** Single vs double tear-off pricing is currently single-by-default. Edge-shadow analysis on Static Maps imagery can detect a second layer ~75% of the time.

### Data & calibration
- **50–100 random-address calibration set.** Stratified across 4 regional zones, scored against Google Solar as ground-truth-by-proxy.
- **BLS labor data refresh job.** Annual `npm run refresh-labor-index` that re-pulls OEWS per-state mean wages and updates `pricing.json#regional.state_labor_index`.
- **Distributor-specific material costs.** ABC Supply / SRS / Beacon publish territory-specific pricing through partner portals.

### UI / demo
- **Voice mode.** Browser STT in + Claude voice out for the agent.
