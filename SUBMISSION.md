# Submission

**Deadline:** Saturday, May 9, 2026 at **1:30 PM**

Late submissions will not be considered.

---

## RoofIQ submission links

- **Live demo:** [https://roof-quote-agent.vercel.app/](https://roof-quote-agent.vercel.app/)
- **GitHub repo:** [github.com/lessthanjake/jobnimbus-hackathon-2026](https://github.com/lessthanjake/jobnimbus-hackathon-2026)
- **Submitted sqft totals (5 test properties):** [`SUBMISSION-NUMBERS.md`](./SUBMISSION-NUMBERS.md)
- **Approach summary** (≤200 words for the form):

> RoofIQ produces quote-ready residential reroof estimates from either a property address OR up to 3 user-uploaded aerial photos. The address path runs an ensemble across Google Solar API (buildingInsights), Claude vision (Opus 4.7) on a satellite tile, and OpenStreetMap building footprints — with suspect-Solar detection (segments > 15, area > 5,000 sqft, or bimodal heights) shifting weights toward the independent estimators when Solar likely conflated attached neighbors. The photo path identifies known-size scale references in-frame (sidewalks, parking spaces, vehicles) and combines them via inverse-variance-weighted voting; when EXIF carries GPS altitude + focal length, we add a third independent signal: ground-sample-distance computed against Google Elevation API. Per-photo coordinate systems (each photo's own normalized space) prevent ensemble corruption when uploads come from different camera heights. Pricing uses gross-margin math against a fully-sourced pricing.json with 4 regional zones, BLS state labor index, 19 metro overrides, and 28-state insurance-incentive rules. A contractor-facing agent narrates the quote; real vector PDFs render server-side. Calibration: 0.9% median error, 7.0% max, on the 5 reference properties. Live: https://roof-quote-agent.vercel.app/

---

## Submission form

> **https://docs.google.com/forms/d/e/1FAIpQLSfTL58Z0rVBgfx9l81lV7GpryhF7kDEuFKCgNG5i-m1RWDyUg/viewform**

The form takes ~5 minutes to fill out. You'll need to be signed in to a Google account.

---

## What the form asks for

1. **Team name + members** (max 3 people; solo welcome)
2. **Approach summary** (≤200 words): your stack, AI/models, data sources, what's novel
3. **Phone number** — we'll text the top 5 finalists at 2:00 PM Saturday
4. **Public GitHub repo link** — your code, README, and any output artifacts
5. **Total sqft for each of the 5 test properties** — the addresses are listed in [`benchmark-measurements.md`](./benchmark-measurements.md)
6. **Optional:** best example output URL (link to a PDF or hosted page from your tool), demo video link

That's it. The form auto-collects your email.

---

## What goes in your GitHub repo

Make it **public** so judges and the AI scoring agent can inspect it. At minimum:

- `README.md` — what your tool does, how to run it, anything we should know
- Source code
- For each test property, your tool's output (PDF, screenshot, JSON — whatever your tool produces)

Optional but appreciated:

- A demo video or hosted link
- A note on your AI choices (which models, why)
- Notes on edge cases your tool handles or known limitations

---

## What happens after you submit

| Time | Phase |
|---|---|
| 1:30 PM | Submissions close |
| 1:30 – 2:00 PM | Preliminary scoring across all submissions |
| 2:00 PM | Top 5 finalists notified by text |
| 2:00 – 3:30 PM | Finalist round — each finalist demos (~5 min + Q&A; setup time built in) |
| 3:30 – 4:00 PM | Judges deliberate |
| 4:00 PM | Award ceremony, $10,000 to the winner |

---

## Important rules

- **Build, don't buy.** Your code must show how you compute measurements. Submitted numbers that match commercial measurement reports without evidence of independent computation in your repo will be flagged and disqualified.
- **Don't fabricate measurements.** Submitted numbers can be cross-checked against ground truth. If we find fabricated data, you're disqualified.
- **JN owns the IP** of submitted work — see slide 8 of the deck.
- **External engineers only.** JN employees are ineligible for the bounty.
- **You and your team must be present for judging.** Building can happen anywhere; judging happens on-site.

---

## Questions?

Find Russell Ochoa, Tyler Folkman, or any JobNimbus engineer on-site.
