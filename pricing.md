# Pricing Model

A transparent, sourced cost-build model for converting roof measurements into a quote-ready estimate. Material and labor are tracked separately so we can tune **regional margin** and stay competitive bid-to-bid. Every number is cited; the full machine-readable rate card lives in [`pricing.json`](./pricing.json).

---

## Cost build (the formula)

```
1. cost_of_materials = Σ (material_qty × material_unit_cost)
2. cost_of_labor     = Σ (labor_qty × labor_unit_rate) × (1 + supervision_overhead_pct)

3. cost_of_materials × regional.material_multiplier   →  M
   cost_of_labor     × regional.labor_multiplier      →  L

4. cost_basis = M + L

5. quote_subtotal = cost_basis / (1 - regional.target_gross_margin)

6. quote_total = quote_subtotal + dumpster + permit
```

Why `/ (1 - margin)` and not `× (1 + markup)`? Contractors quote on **gross margin**, not markup. A 30% gross margin means cost is 70% of the quote — so divide cost by 0.70. Using `× 1.30` (markup) only gets you a 23% gross margin and you bleed money.

**Regional margin philosophy.** Lower margin in competitive markets to win bids; higher margin where insurance pays at industry-standard scope. Defaults:

| Zone | Labor mult | Material mult | Target gross margin | Where |
|---|---|---|---|---|
| Low-cost competitive | 0.85 | 0.95 | **30%** | TX, MO, OK, AR, MS, AL, LA, KY, TN, WV |
| Mid-market | 1.00 | 1.00 | **35%** | VA, NC, SC, GA, IN, OH, PA, MI, WI, IA, KS, NE |
| High-cost insurance-heavy | 1.10 | 1.05 | **38%** | CO, FL, AZ, NV, IL, MN, MA, NY, NJ, MD, CT, RI |
| Premium metro | 1.25 | 1.10 | **40%** | CA, WA, OR, HI, AK |

---

## What goes into a full reroof (material taxonomy)

A complete reroof has more line items than most homeowners realize. We catalog every input separately so the tool can size each from measurements rather than guessing.

| Category | Drives quantity from | Examples |
|---|---|---|
| **Field shingles** | roof area × (1 + waste factor) | GAF Timberline HDZ, OC Duration, CT Landmark |
| **Starter strip** | eaves + rakes (lf) | GAF Pro-Start |
| **Hip/ridge cap shingles** | ridge + hip (lf) | GAF Seal-A-Ridge |
| **Synthetic underlayment** | full roof area | GAF Tiger Paw, OC ProArmor |
| **Ice & water shield** | (eaves × 3 ft) + (valleys × 3 ft) + penetrations | GAF StormGuard, Grace I&W |
| **Drip edge** | eaves + rakes (lf) | aluminum / galvanized |
| **Valley metal** | valleys (lf) | painted galvanized W-valley |
| **Step flashing** | sidewall length / shingle exposure | one piece per course |
| **Counter / wall flashing** | chimney + wall lengths (lf) | counter-flashed at masonry |
| **Pipe boots** | count of plumbing vents | rubber (standard) or lead (HVHZ) |
| **Skylight / chimney kits** | count | flashing kit per unit |
| **Ridge vent** | ridge length (lf) | continuous vent + cap shingles over |
| **Box / static vents** | required NFA / 300 sqft attic | 750 sq in NFA each |
| **Decking replacement** | bad-sheet contingency (3–8% typical) | OSB 7/16 or CDX 1/2 |
| **Fasteners** | per square + 6-nail in HVHZ | galvanized or stainless ring-shank |
| **Sealants / consumables** | per job | asphalt cement, polyurethane |
| **Demo: dumpster** | sized by sqft + layers | 20-yard fits ~2,500 sqft single layer |
| **Demo: site protection** | per job | tarps, plywood, magnetic sweep |
| **Permit + inspection** | by AHJ | flat fee or $/sqft |

Code-driven promotions baked into the tool:

- **FL HVHZ** (Miami-Dade, Broward, Monroe) → ring-shank stainless fasteners, 6-nail pattern, full-deck I&W secondary water barrier, hurricane clips at bearings.
- **CO Front Range hail belt** → default to Class 4 impact-resistant for the insurance discount.
- **TX coastal counties** → 130 mph wind-rated minimum, 6-nail pattern.
- **Cold climates** (avg Jan ≤ 25°F) → I&W extends 24" past warm wall (IRC R905.1.2).
- **CA Title 24** → cool-roof reflective shingles on low-slope sections.

---

## Worked example — benchmark property #1

**21106 Kenswick Meadows Ct, Humble, TX 77338** — 2,443 sqft roof, 6:12 pitch.
Line items: ridge/hip 141 lf · valleys 40 lf · rakes 101 lf · eaves 187 lf · counter-flash 27 lf · step-flash 21 pcs.
Zone: **TX low-cost competitive** → labor ×0.85, material ×0.95, target gross margin 30%.

### Tier B — Architectural (industry standard)

**Materials** (raw cost):

| Item | Qty | Unit cost | Subtotal |
|---|---:|---:|---:|
| Field shingles (architectural) w/ 15% waste | 28.10 sq | $110.00/sq | $3,091 |
| Starter strip | 288 lf | $1.10/lf | $317 |
| Hip & ridge cap shingles | 141 lf | $4.50/lf | $635 |
| Synthetic underlayment | 2,443 sqft | $0.20/sqft | $489 |
| Ice & water shield (eaves + valleys) | 681 sqft | $0.60/sqft | $409 |
| Drip edge (aluminum) | 288 lf | $1.10/lf | $317 |
| Valley metal (W-valley) | 40 lf | $3.50/lf | $140 |
| Step flashing | 21 pcs | $1.20/pc | $25 |
| Counter flashing | 27 lf | $4.50/lf | $122 |
| Pipe boots (rubber, ×3 typical) | 3 ea | $14.00/ea | $42 |
| Roofing nails (1.25" galv) | 28.10 sq | $4.50/sq | $126 |
| Sealants & consumables | 1 job | $80 | $80 |
| **Materials raw subtotal** | | | **$5,793** |
| × TX material multiplier (0.95) | | | **$5,503** |

**Labor** (raw):

| Task | Qty | Rate | Subtotal |
|---|---:|---:|---:|
| Tear-off, single layer | 2,443 sqft | $0.65/sqft | $1,588 |
| Install field + underlayment + starter | 2,443 sqft | $1.50/sqft | $3,665 |
| I&W shield install | 681 sqft | $0.40/sqft | $272 |
| Hip/ridge cap install | 141 lf | $3.00/lf | $423 |
| Valley w/ metal install | 40 lf | $5.00/lf | $200 |
| Drip edge install | 288 lf | $1.00/lf | $288 |
| Step flashing install | 21 pcs | $4.50/pc | $95 |
| Counter flashing install | 27 lf | $5.50/lf | $149 |
| Pipe boot install | 3 ea | $35.00/ea | $105 |
| Site cleanup + magnetic sweep | 1 job | $200 | $200 |
| **Crew labor subtotal** | | | **$6,985** |
| Supervision / PM / drive time (12%) | | | $838 |
| **Labor with overhead** | | | **$7,823** |
| × TX labor multiplier (0.85) | | | **$6,650** |

**Cost basis & quote:**

| | |
|---|---:|
| Materials (regional-adjusted) | $5,503 |
| Labor (regional-adjusted) | $6,650 |
| **Cost basis** | **$12,153** |
| Quote subtotal at 30% gross margin (cost / 0.70) | $17,361 |
| Dumpster (20-yard) | $480 |
| Permit (flat) | $400 |
| **Total quoted price** | **$18,241** |

That's **$7.47 per sqft of roof area** — within HomeGuide's 2026 TX architectural-shingle replacement range ($4–$8.50/sqft) and consistent with a competitive-but-profitable bid in a Houston-suburb market.

### Tier comparison (same roof, three material choices)

| | Tier A — 3-tab (budget) | **Tier B — Architectural (recommended)** | Tier C — Class 4 Impact |
|---|---:|---:|---:|
| Field shingle cost / sq | $75 | $110 | $175 |
| Materials (regional-adjusted) | $4,107 | $5,503 | $6,790 |
| Labor (regional-adjusted, same) | $6,650 | $6,650 | $6,650 |
| Cost basis | $10,757 | $12,153 | $13,440 |
| At 30% margin | $15,367 | $17,361 | $19,200 |
| + Dumpster + permit | $880 | $880 | $880 |
| **Total** | **$16,247** | **$18,241** | **$20,080** |
| Per sqft | $6.65 | $7.47 | $8.22 |
| Note | Not recommended — 25-yr life, 60 mph | Industry-standard; 130 mph, lifetime warranty | Hail-region preferred; insurance discount typically 20–30% off premium |

The same property in **Colorado** (high-cost insurance-heavy zone, labor ×1.10, material ×1.05, margin 38%) would quote roughly **$23,800 / $26,400 / $29,000** for the same three tiers — ~30% higher driven by labor rates and the insurance-market margin band, which is exactly where CO architectural reroof market data lands.

---

## What this model auto-applies vs. omits

**Auto-applied (kicks in based on measurement / location):**

- **Steep-slope premium** — pitches ≥ 9:12 carry a labor uplift driven by `pricing.labor.install_field_shingles.steep_slope_premium_pct`. Applied automatically inside `quote.ts`.
- **Penetration object detection.** Vision returns counts + per-category confidence for plumbing vents, exhaust vents, box vents, skylights, chimneys, satellite dishes, solar panels, power-attic vents. Cost rules: pipe boots (plumbing + exhaust), new assemblies (box + power-attic), reflash kits (skylights). Identified-but-not-charged: chimneys, solar panels, satellite dishes. Low-confidence categories are zeroed before they reach the quote.
- **Code-driven material promotions.** FL HVHZ → ring-shank stainless + 6-nail + full-deck I&W + lead pipe boots + hurricane clips. CO/TX hail belt → recommend Class 4 for the insurance discount. Cold climate (avg Jan ≤ 25°F) → I&W extends 24" past the warm wall (IRC R905.1.2). CA Title 24 → cool-roof shingles on low-slope sections.
- **Regional incentives.** 28 states with insurance-discount or rebate talking points attached to qualifying tiers (contractor copy, customer copy, savings math, action step).

**Deliberate gaps (documented, not pricing fudges):**

- **Two-story premium** — some markets price this in. Field present, off by default.
- **Designer / luxury shingles** (Presidential, Camelot) — material costs are in the catalog but not in the 3-tier UI.
- **Low-slope membrane** (mod-bit, TPO) — for sections below 2:12 pitch. Catalog stub only.
- **Decking replacement quantities** — present as line items in `pricing.json` but quoted as a change order; we don't speculatively bid replacement footage from imagery.

A roofer reading the estimate can add line items for any of these directly.

---

## Sources

All rates were validated against multiple 2026 sources rather than any single reference, to avoid over-fitting to one calculator's bias. Full list with usage annotations in [`pricing.json`](./pricing.json) under `"sources"`. Key references:

- [HomeGuide — Asphalt Shingle Roof Cost (2026)](https://homeguide.com/costs/asphalt-shingle-roof-cost) — loaded $/sqft and total project ranges.
- [HomeGuide — Roofing Labor Cost (2026)](https://homeguide.com/costs/roofing-labor-cost) — labor split, $25–50/sq tear-off, $150–300/sq install.
- [Opus Roofing — 2026 Shingle Prices](https://opusroofingco.com/blog/asphalt-shingle-prices-2026) — bundle pricing, contractor wholesale 20–35% off retail.
- [Profitability Partners — Roofing Margins](https://profitabilitypartners.io/roofing-profit-margins/) — gross 35–45%, net 6–12%.
- [Angi — Drip Edge / Ridge Cap / Vent Boots (2026)](https://www.angi.com/articles/whats-cost-drip-edge-install-roof.htm) — accessory $/lf and $/each.
- [HomeGuide — Roof Decking Replacement (2026)](https://homeguide.com/costs/cost-to-replace-roof-decking) — OSB/plywood sheet pricing.
- [HomeGuide — Dumpster Rental (2026)](https://homeguide.com/costs/dumpster-rental-prices) — yard-size pricing.
- [Smart Roofing Calculator — Underlayment](https://smartroofingcalculator.com/underlayment/) — synthetic + I&W $/sqft.
- [Smart Roofing Calculator — Waste Factor](https://smartroofingcalculator.com/waste/) — 10/15/20% by complexity.

When two sources disagreed, we picked the median and kept both ends of the range in `pricing.json` so the tool can produce low/expected/high quotes on demand.
