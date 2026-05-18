# Submission — RoofIQ totals for the 5 test properties

### → Live demo: [https://roof-quote-agent.vercel.app/](https://roof-quote-agent.vercel.app/)

The 5 test addresses below are pre-loaded as chips on the landing page. Click any of them to reproduce the submitted sqft and quote live — same pipeline a judge gets when running `npm run run-tests` locally. The recommended-tier PDFs live alongside each property's JSON artifacts in [`outputs/test-properties/`](./outputs/test-properties).

The numbers we entered on the [hackathon submission form](./SUBMISSION.md). All are produced by the pipeline in [`web/`](./web), with full intermediate artifacts (per-property `measurement.json`, `quote.json`, `quote.md`) committed under [`outputs/test-properties/`](./outputs/test-properties).

## Submitted total sqft

| # | Address | Total sqft | Confidence |
|---|---|---:|---|
| 1 | 3561 E 102nd Ct, Thornton, CO 80229 | **2,081** | high |
| 2 | 1612 S Canton Ave, Springfield, MO 65802 | **2,757** | high |
| 3 | 6310 Laguna Bay Court, Houston, TX 77041 | **4,186** | medium |
| 4 | 3820 E Rosebrier St, Springfield, MO 65809 | **3,298** | low (Solar suspect — duplex conflation likely) |
| 5 | 1261 20th Street, Newport News, VA 23607 | **2,530** | low (Solar suspect — bimodal segment heights) |

## Tier quotes (Good / Better / Best)

| Address | Pitch | Good (3-tab) | Better (Architectural) | Best (Class 4 Impact) |
|---|---:|---:|---:|---:|
| Thornton, CO | 9:12 | $25,070 | $26,549 | **$29,297** |
| Springfield, MO (Canton) | 7:12 | $17,771 | **$19,329** | $22,222 |
| Houston, TX | 8:12 | $29,846 | $32,467 | **$37,335** |
| Springfield, MO (Rosebrier) | 6:12 | $22,842 | **$24,706** | $28,167 |
| Newport News, VA | 4:12 | $22,508 | **$24,075** | $26,984 |

The bolded number is the auto-recommended tier per property:
- **Thornton, CO** → Class 4 (CO Front Range hail belt — insurance discount typical)
- **Houston, TX** → Class 4 (TX coastal hail-prone area — TX-mandated insurance discount)
- The other three properties recommend the standard architectural tier — no hail-discount qualifier in those markets.

PDFs of each recommended-tier quote in both Simple (1 page, customer-facing) and Detailed (2 pages, with itemized materials + labor) modes are committed alongside the JSON artifacts in [`outputs/test-properties/<slug>/`](./outputs/test-properties/) — open `quote-<tier>-<mode>.pdf`.

## Calibration evidence

We validated the same pipeline against the 5 example properties (which have Reference A and Reference B trusted measurements). Result:

- **Median absolute error: 0.9%**
- **Max absolute error: 7.0%**
- All 5 within the practical-accuracy tolerance the hackathon spec calls for.

Full per-property breakdown in [`outputs/calibration.md`](./outputs/calibration.md).

## Why two are flagged "low confidence"

For **3820 E Rosebrier St** and **1261 20th Street**, Solar's response triggered our suspect-detection heuristics:

- **Rosebrier**: 18 segments — well above the 15-segment threshold that historically correlates with Solar conflating attached neighbors into a single building polygon.
- **Newport News**: bimodal segment heights — Solar reported segments at ~5.5m and ~8m elevations, suggesting two separate structures lumped into one reading.

When suspect signals fire, the pipeline shifts the ensemble weights so Solar is **deeply down-weighted** (0.15 vs Vision's 0.60 vs Footprints' 0.25). The submitted value is the weighted blend across all available independent sources, not Solar's number. For these two properties, the disagreement was high enough that the consensus rule fell back to the minimum across sources — preferring the more conservative independent reading over Solar's likely-conflated number.

This is honest accuracy management: when we have specific evidence to disbelieve Solar, we don't rebuild the quote on top of a number we're already suspicious of. Without ground truth we can't know which estimate is right; we surface the disagreement transparently in `outputs/test-properties/<slug>/measurement.json#ensemble.sources` so a contractor reviewing the quote can see all three readings.

## Reproducibility

```bash
cd web
cp .env.example .env.local   # set GOOGLE_MAPS_API_KEY + ANTHROPIC_API_KEY
npm install
npm run calibrate            # writes outputs/calibration.md
npm run run-tests            # writes outputs/test-properties/<slug>/{measurement,quote}.json + quote.md
```

Every number above is deterministic given a single run — Solar API is a stable API, the heuristic line-item derivation is pure code, and the regional pricing is read from `pricing.json`. The vision second-opinion is the only stochastic component; on Opus 4.7 it varies by ~5–10% run-to-run on the same imagery.
