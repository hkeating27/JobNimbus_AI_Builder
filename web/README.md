# RoofIQ — Web app

The Next.js + TypeScript app that powers the demo. Address (or photo) in, contractor-facing agent narrates, three-tier quote out, real PDFs out, contractor closes the loop with actuals.

## Quick start

```bash
cd web
cp .env.example .env.local
# fill GOOGLE_MAPS_API_KEY (Geocoding + Solar + Static Maps + Elevation)
# fill ANTHROPIC_API_KEY
npm install
npm run dev
# → http://localhost:3000
```

## Required API keys

| Var | What it powers |
|---|---|
| `GOOGLE_MAPS_API_KEY` | Geocoding API · Solar API (`buildingInsights`) · Maps Static API · **Elevation API** (used by EXIF GSD path) |
| `ANTHROPIC_API_KEY` | Claude vision + contractor-facing agent. We pin **Opus 4.7** — Sonnet 4.6 was tested and rejected (22.7% calibration miss on Spring TX where Solar is suspect). |

Enable the four Google APIs in [Google Cloud Console](https://console.cloud.google.com/apis/library) under one key. **Solar API** is the unlock — it returns total roof area + per-segment pitch + segment polygons directly. Free tier covers ~100 requests/month.

If keys are missing the pipeline degrades gracefully: skipped Solar → Vision; skipped Vision → regional heuristics; skipped Elevation → photo path falls back to vision-references-only scale.

## Layout

```
web/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── measure/route.ts            address → RoofMeasurement (Solar + Vision + OSM)
│   │   │   ├── measure-from-photo/route.ts photos → RoofMeasurement (scale refs + EXIF GSD)
│   │   │   ├── quote/route.ts              measurement → 3-tier Quote
│   │   │   ├── agent/route.ts              Claude streaming chat (contractor-facing)
│   │   │   ├── pdf/route.tsx               render real vector PDF via @react-pdf/renderer
│   │   │   ├── feedback/route.ts           contractor actuals → calibration
│   │   │   ├── satellite/route.ts          proxy for Google Static Maps tiles (hides API key)
│   │   │   └── _diagnostic                 dev-only routes
│   │   ├── test/
│   │   │   ├── parallax/page.tsx           fixture for Playwright parallax-jump test
│   │   │   └── tiers/page.tsx              fixture for Playwright tier-button overlap test
│   │   ├── page.tsx                        hero + demo flow
│   │   └── layout.tsx
│   ├── components/
│   │   ├── AddressInput.tsx                address bar + multi-photo upload (compression + EXIF)
│   │   ├── MeasurementCard.tsx             headline numbers + parallax satellite + photo carousel
│   │   ├── ParallaxSatellite.tsx           scroll-driven zoom, click-to-focus, generalized aspect ratio
│   │   ├── PhotoMeasureDiagnostics.tsx     "How we measured this photo" + pitch override
│   │   ├── PenetrationsCard.tsx            penetration counts with confidence-filtered display
│   │   ├── TierCards.tsx                   3 tier cards + line items modal + PDF download
│   │   ├── PrintableInvoice.tsx            print-stylesheet fallback (kept around for safety)
│   │   ├── pdf/InvoicePDF.tsx              react-pdf vector layout (real PDF output)
│   │   ├── MethodologyModals.tsx           "How it works" + "Pricing model" modals
│   │   ├── AgentChat.tsx                   streaming chat UI for the contractor-facing agent
│   │   └── FeedbackForm.tsx                contractor actuals submission
│   ├── lib/
│   │   ├── pricing.ts                      typed loader for ../pricing.json
│   │   ├── regional.ts                     state → zone, code-flag detection
│   │   ├── google.ts                       Geocoding + Solar + Static Maps + Elevation wrappers
│   │   ├── vision.ts                       Claude vision (satellite path)
│   │   ├── photo-measure.ts                Claude vision (photo path) + scale-ref ensemble + GSD
│   │   ├── image-compress.ts               client-side canvas compression + EXIF preservation
│   │   ├── audio.ts                        Web Audio swoosh + edge-tick synthesis
│   │   ├── measure.ts                      address-path orchestrator (Solar + Vision + OSM ensemble)
│   │   ├── quote.ts                        cost-build → 3-tier quote generator
│   │   ├── feedback.ts                     actuals → per-zone adjustment
│   │   └── types.ts
├── scripts/
│   ├── benchmark-data.ts                   5 example properties + 5 test addresses
│   ├── calibrate.ts                        pipeline vs Reference A/B → outputs/calibration.md
│   ├── run-test-properties.ts              full pipeline on 5 hackathon test addresses
│   ├── test-parallax-jump.mjs              Playwright regression for the parallax scale-jump fix
│   └── test-tier-buttons.mjs               Playwright regression for the tier-button overlap fix
├── data/
│   └── feedback.jsonl                      seed actuals (6 entries across 3 zones for demo)
├── __fixtures__/
│   └── canton-quote.json                   fixture used by /test/tiers Playwright route
├── pricing.json (parent)                   single source of truth for all rates
└── package.json
```

## Scripts

```bash
npm run dev                 # start the Next dev server
npm run build               # production build (also typechecks)
npm run calibrate           # run pipeline on the 5 benchmark properties → outputs/calibration.md
npm run run-tests           # run on the 5 hackathon test properties → outputs/test-properties/
npm test                    # vitest unit tests (46 passing)

# Playwright regression checks (require a running dev server at :3000)
node scripts/test-parallax-jump.mjs
node scripts/test-tier-buttons.mjs
```

## How a quote is built

### Address path: `/api/measure` (POST `{ address }`)

1. **Geocode** the address (Google Geocoding API).
2. **Three-source ensemble in parallel:**
   - **Google Solar API** for total area + per-segment pitch + segment count.
   - **Claude vision (Opus 4.7)** on a Static Maps satellite tile — independent footprint estimate, segment count, complexity, penetrations with high/medium/low confidence per category.
   - **OpenStreetMap (Nominatim)** for building polygon footprint when tagged.
3. **Suspect-Solar handling.** If segment count > 15, area > 5,000 sqft, or bimodal segment heights, shift weights from Solar-dominant (0.85) to Solar-down-weighted (0.15) in favor of Vision (0.60) and OSM (0.25).
4. **Confidence filter** on penetrations — low-confidence categories are zeroed before reaching the quote.
5. **Line items** (ridge / hip / valley / rake / eave / step / counter flashing lf) derived from segment count, complexity, and footprint perimeter using ratios calibrated against the 5 benchmark properties.

### Photo path: `/api/measure-from-photo` (POST multipart, ≤3 `image` fields + optional `address` + optional `pitch_override`)

1. **Read EXIF** from each photo (`exifr`). Client supplies pre-extracted EXIF in `exif_<idx>` form fields when compression has already stripped metadata.
2. **Vision pass** (Opus 4.7) on all uploaded photos at once. Returns: roof polygon (with `polygon_source_photo_index`), scale references (each tagged with `photo_index` so refs from different photos don't get mashed into one ensemble), pitch best-effort, penetrations.
3. **Per-photo pixels-per-foot** via inverse-variance weighting. The polygon-source photo's PPF drives area math; cross-photo agreement % surfaces independently.
4. **EXIF GSD** computed when GPS altitude + 35mm-equivalent focal length + image pixel width are present, plus Google Elevation API for ground level at the photo lat/lng. AGL = altitude − ground elevation. PPF = `1 / (image_pixel_width × GSD_ft_per_pixel)`. Combined with vision-ref PPF via inverse-variance weighting (~5% σ on EXIF GSD vs 11–20% on visual refs).
5. **Pitch fallback chain.** Contractor override > Solar via EXIF GPS or address > vision oblique cues > 6:12 default.
6. **Bail-out conditions** (return clean 422 instead of producing a stub quote):
   - `view_type === "ground_level"` → "Try a top-down aerial..."
   - polygon area < 1% of frame → "Couldn't lock onto the roof outline..."
   - computed footprint < 200 sqft → "Scale references didn't pin down camera height..."
7. **Returns the same `RoofMeasurement` shape** as `/api/measure` plus `photo_diagnostics` (per-reference contributions, GSD info, primary photo index, cross-photo agreement %, pitch source).

### Quote: `/api/quote` (POST `{ measurement }`)

For each of three tiers (3-tab / architectural / Class 4 impact):

- Build raw materials list (12–14 line items: shingles, starter, ridge cap, underlayment, ice & water shield, drip edge, valley metal, step/counter flashing, pipe boots, fasteners, ridge vent, sealants).
- Build raw labor list (10 line items: tear-off, install, all flashings, cleanup) + 12% supervision overhead.
- **Steep-slope premium** when pitch ≥ 9:12 — auto-applied via `pricing.labor.install_field_shingles.steep_slope_premium_pct`.
- Apply regional `material_multiplier` and `labor_multiplier` (zone defaults + state labor index + metro override stack).
- `quote_subtotal = cost_basis / (1 - target_gross_margin)`.
- Add dumpster (sized by sqft) + flat permit.
- **Code-driven promotions:** FL HVHZ → ring-shank fasteners + lead pipe boots + full-deck I&W; CO/TX hail belt → recommend Class 4; cold climate → I&W extends 24" past warm wall; CA Title 24 → cool-roof shingles.
- **Regional incentives** attached to qualifying tiers (28 states covered).

### PDF: `/api/pdf` (POST `{ quote, tier, mode }`)

Server-side render via `@react-pdf/renderer` returns `application/pdf`. Vector output, no print dialog. ~140ms for `mode: "detailed"` (3-page), ~65ms for `mode: "simple"` (1-page).

### Agent: `/api/agent` (POST `{ measurement, quote, message }`, streaming)

Claude streams a contractor-facing opening narrative ("Pulled up your roof — 2,840 sqft, 6:12 pitch, complex hip with two valleys. Confidence is **medium** — Solar fell off and we're leaning on vision's gut estimate. Margin's healthy in this market. Want me to walk through pricing?") and answers contractor questions — talking points for the customer pitch, where to push for upsell, what to double-check on the property — with specific line-item rates and code rationale rather than generalities.

### Feedback: `/api/feedback` (POST `{ quote_id, actual_material_cost, actual_labor_hours, actual_labor_cost, actual_invoiced }`)

Stored in `data/feedback.jsonl` (append-only, seed entries shipped). Per-zone adjustment = clamped median ratio of actual / predicted across that zone's submissions, applied multiplicatively on top of base regional multipliers in subsequent quotes. The bigger Postgres + QuickBooks closed loop is documented in the in-app "How it works" modal as the planned next step.

## Audio

`AudioContext` is created lazily on user gesture (the search button click). The parallax satellite zoom drives a scroll-scrubbed wind swoosh — bandpass-filtered noise center frequency tracks scroll progress, gain tracks scroll velocity. One-and-done semantics: when the user pauses for >250ms after the swoosh played, it ends for good (no replay on subsequent scrolls within the same address mount).
