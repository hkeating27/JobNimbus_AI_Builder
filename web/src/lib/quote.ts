// Quote generator: RoofMeasurement → 3-tier Quote.
// Cost build: materials + labor (raw) → regional multipliers → margin uplift → permits + dumpster.

import { loadPricing, rate } from "./pricing";
import { zoneForState, recommendedShingleTier, codeFlags } from "./regional";
import type { LineItem, Quote, QuoteTier, RoofMeasurement } from "./types";
import { applyFeedbackAdjustment } from "./feedback";
import { resolveIncentives } from "./incentives";

const WASTE_BY_COMPLEXITY = { simple_gable: 0.10, hip_or_valleys: 0.15, complex_cutup: 0.20 } as const;

const TIER_DEFS = [
  { key: "good",   shingleKey: "asphalt_3tab",          name: "Good — 3-tab",                     badge: "Budget",          warranty: "25 yr ltd" },
  { key: "better", shingleKey: "asphalt_architectural", name: "Better — Architectural",           badge: "Industry standard", warranty: "Lifetime ltd" },
  { key: "best",   shingleKey: "asphalt_class4_impact", name: "Best — Class 4 Impact",            badge: "Insurance ✓",      warranty: "Lifetime ltd" },
] as const;

export function generateQuote(m: RoofMeasurement): Quote {
  const pricing = loadPricing();
  const zone = zoneForState(m.state_code, m.county);
  const adj = applyFeedbackAdjustment(zone.key);
  const labor_mult = zone.labor_multiplier * adj.labor_adjust;
  const mat_mult = zone.material_multiplier * adj.material_adjust;
  const margin = zone.target_gross_margin;

  const flags = codeFlags(m.state_code, m.county);
  const recommended = recommendedShingleTier(m.state_code, m.county);

  const tiers: QuoteTier[] = TIER_DEFS.map((t) => buildTier(t, m, pricing, mat_mult, labor_mult, margin, flags));

  // Dumpster sizing (added to all tiers identically).
  const dumpsterKey = m.total_sqft <= 1500 ? "yard_10" : m.total_sqft <= 2500 ? "yard_20" : m.total_sqft <= 4000 ? "yard_30" : "yard_40";
  const dumpster = (pricing.demo_disposal.dumpster[dumpsterKey] as any).cost as number;
  const permit = (pricing.permits_inspections.permit_flat as any).rate as number;
  for (const t of tiers) {
    t.dumpster = dumpster;
    t.permit = permit;
    t.total = Math.round(t.quote_subtotal + dumpster + permit);
    t.per_sqft = round(t.total / m.total_sqft, 2);
    // Regional insurance / utility incentives this tier qualifies for.
    // Surfaced on the contractor view, in the agent's system prompt,
    // and on the customer-facing PDF footer.
    const incentives = resolveIncentives({ state_code: m.state_code, tier_key: t.key });
    if (incentives.length > 0) t.incentives = incentives;
  }

  return {
    measurement: m,
    zone_key: zone.key,
    zone_label: zone.label,
    labor_multiplier: round(labor_mult, 3),
    material_multiplier: round(mat_mult, 3),
    target_gross_margin: margin,
    tiers,
    recommended_tier_key: recommended,
    generated_at: new Date().toISOString(),
    quote_id: `Q-${new Date().toISOString().slice(0,10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
  };
}

function buildTier(
  def: typeof TIER_DEFS[number],
  m: RoofMeasurement,
  pricing: ReturnType<typeof loadPricing>,
  matMult: number,
  laborMult: number,
  margin: number,
  flags: ReturnType<typeof codeFlags>
): QuoteTier {
  const waste = 1 + WASTE_BY_COMPLEXITY[m.complexity];
  const squares = m.total_sqft / 100;
  const squares_with_waste = squares * waste;

  const shingleProduct = pricing.materials.shingles_field[def.shingleKey] as any;
  const wind_rating_mph = (shingleProduct.wind_rating_mph ?? 60) as number;

  // === MATERIALS ===
  const eaves = m.line_items.eave_lf;
  const rakes = m.line_items.rake_lf;
  const ridge_hip = m.line_items.ridge_lf + m.line_items.hip_lf;
  const valleys = m.line_items.valley_lf;
  const drip_edge_lf = eaves + rakes;
  const i_w_sqft = eaves * 3 + valleys * 3;          // 3' from eave + 3' wide at valleys
  const i_w_sqft_full_deck = m.total_sqft;            // for HVHZ secondary water barrier

  const materials: LineItem[] = [];
  materials.push(li(`${def.name.split(" — ")[1]} field shingles (${(WASTE_BY_COMPLEXITY[m.complexity] * 100).toFixed(0)}% waste)`,
    round(squares_with_waste, 2), "sq", rate(shingleProduct), squares_with_waste * rate(shingleProduct)));

  materials.push(li("Starter strip", drip_edge_lf, "lf", rate(pricing.materials.shingles_starter.starter_strip),
    drip_edge_lf * rate(pricing.materials.shingles_starter.starter_strip)));

  const hipRidgeMat = pricing.materials.shingles_hip_ridge_cap.ridge_cap_standard;
  materials.push(li("Hip & ridge cap shingles", ridge_hip, "lf", rate(hipRidgeMat), ridge_hip * rate(hipRidgeMat)));

  const synU = pricing.materials.underlayment.synthetic;
  materials.push(li("Synthetic underlayment", m.total_sqft, "sqft", rate(synU), m.total_sqft * rate(synU)));

  const iws = pricing.materials.underlayment.ice_water_shield;
  const iwsApply = flags.fl_hvhz ? i_w_sqft_full_deck : i_w_sqft;
  if (iwsApply > 0) {
    materials.push(li(flags.fl_hvhz ? "Ice & water shield (full deck — HVHZ secondary water barrier)" : "Ice & water shield (eaves + valleys)",
      iwsApply, "sqft", rate(iws), iwsApply * rate(iws)));
  }

  const drip = pricing.materials.flashings_metal.drip_edge_aluminum;
  materials.push(li("Drip edge (aluminum, eaves + rakes)", drip_edge_lf, "lf", rate(drip), drip_edge_lf * rate(drip)));

  if (valleys > 0) {
    const vm = pricing.materials.flashings_metal.valley_metal_w;
    materials.push(li("Valley metal (W-valley)", valleys, "lf", rate(vm), valleys * rate(vm)));
  }

  if (m.line_items.step_flashing_lf > 0) {
    const sf = pricing.materials.flashings_metal.step_flashing_aluminum;
    materials.push(li("Step flashing", m.line_items.step_flashing_lf, "pc", rate(sf), m.line_items.step_flashing_lf * rate(sf)));
  }

  if (m.line_items.counter_flashing_lf > 0) {
    const cf = pricing.materials.flashings_metal.counter_flashing;
    materials.push(li("Counter flashing", m.line_items.counter_flashing_lf, "lf", rate(cf), m.line_items.counter_flashing_lf * rate(cf)));
  }

  // Penetrations — drive material counts from vision-detected categories.
  // Plumbing + exhaust vents both need a new boot (same flashing). Box vents
  // and power-attic vents need a new vent assembly. Skylights need a kit.
  // Chimneys are intentionally NOT charged (homeowner keeps them; counter-
  // flashing is a separate optional adder). Solar panels are flagged in
  // measurement notes upstream and not charged.
  const ventBootCount = m.penetrations.plumbing_vents + m.penetrations.exhaust_vents;
  if (ventBootCount > 0) {
    const pipeBoot = flags.fl_hvhz
      ? pricing.materials.flashings_metal.pipe_boot_lead
      : pricing.materials.flashings_metal.pipe_boot_rubber;
    const desc = m.penetrations.exhaust_vents > 0
      ? `Vent boots (plumbing + exhaust, ${flags.fl_hvhz ? "lead — HVHZ" : "rubber"})`
      : `Pipe boots (${flags.fl_hvhz ? "lead — HVHZ" : "rubber"})`;
    materials.push(li(desc, ventBootCount, "ea", rate(pipeBoot), ventBootCount * rate(pipeBoot)));
  }

  const boxVentCount = m.penetrations.box_vents + m.penetrations.power_attic_vents;
  if (boxVentCount > 0) {
    const bv = pricing.materials.ventilation.box_vent_static;
    materials.push(li("Box vent assemblies (replace existing)", boxVentCount, "ea", rate(bv), boxVentCount * rate(bv)));
  }

  if (m.penetrations.skylights > 0) {
    const sk = pricing.materials.flashings_metal.skylight_flashing_kit;
    materials.push(li("Skylight flashing kit", m.penetrations.skylights, "ea", rate(sk), m.penetrations.skylights * rate(sk)));
  }

  const fastenerKey = flags.fl_hvhz ? "ring_shank_stainless" : "roofing_nails_1_25_galv";
  const fasteners = pricing.materials.fasteners[fastenerKey];
  materials.push(li(flags.fl_hvhz ? "Stainless ring-shank fasteners (HVHZ)" : "Roofing nails (1.25\" galv)",
    round(squares_with_waste, 2), "sq", rate(fasteners), squares_with_waste * rate(fasteners)));

  if (ridge_hip > 0) {
    const rv = pricing.materials.ventilation.ridge_vent_continuous;
    const ridgeOnly = m.line_items.ridge_lf;
    if (ridgeOnly > 0) materials.push(li("Continuous ridge vent", ridgeOnly, "lf", rate(rv), ridgeOnly * rate(rv)));
  }

  materials.push(li("Sealants & consumables", 1, "job", 80, 80));

  const materials_subtotal = sum(materials);

  // === LABOR ===
  const labor: LineItem[] = [];
  const tearOff = pricing.labor.tear_off[m.layers === 2 ? "double_layer_per_sqft" : "single_layer_per_sqft"];
  labor.push(li(`Tear-off (${m.layers === 2 ? "double" : "single"}-layer)`, m.total_sqft, "sqft", rate(tearOff), m.total_sqft * rate(tearOff)));

  const installField = pricing.labor.install_field_shingles.asphalt_per_sqft;
  labor.push(li("Install field shingles + underlayment + starter", m.total_sqft, "sqft", rate(installField), m.total_sqft * rate(installField)));

  const iwsLab = pricing.labor.ice_water_shield_install_per_sqft;
  if (iwsApply > 0) labor.push(li("Ice & water shield install", iwsApply, "sqft", rate(iwsLab), iwsApply * rate(iwsLab)));

  const ridgeLab = pricing.labor.install_accessories_per_lf.ridge_or_hip_cap;
  labor.push(li("Hip / ridge cap install", ridge_hip, "lf", rate(ridgeLab), ridge_hip * rate(ridgeLab)));

  if (valleys > 0) {
    const vlab = pricing.labor.install_accessories_per_lf.valley_w_metal;
    labor.push(li("Valley install (with metal)", valleys, "lf", rate(vlab), valleys * rate(vlab)));
  }

  const drlab = pricing.labor.install_accessories_per_lf.drip_edge;
  labor.push(li("Drip edge install", drip_edge_lf, "lf", rate(drlab), drip_edge_lf * rate(drlab)));

  if (m.line_items.step_flashing_lf > 0) {
    const sflab = pricing.labor.install_accessories_per_lf.step_flashing;
    labor.push(li("Step flashing install", m.line_items.step_flashing_lf, "pc", rate(sflab), m.line_items.step_flashing_lf * rate(sflab)));
  }

  if (m.line_items.counter_flashing_lf > 0) {
    const cflab = pricing.labor.install_accessories_per_lf.counter_flashing;
    labor.push(li("Counter flashing install", m.line_items.counter_flashing_lf, "lf", rate(cflab), m.line_items.counter_flashing_lf * rate(cflab)));
  }

  // Penetration labor — mirrors the materials section.
  if (ventBootCount > 0) {
    const pblab = pricing.labor.install_accessories_each.pipe_boot;
    labor.push(li("Vent boot install", ventBootCount, "ea", rate(pblab), ventBootCount * rate(pblab)));
  }
  if (boxVentCount > 0) {
    const pblab = pricing.labor.install_accessories_each.pipe_boot;
    labor.push(li("Box vent install", boxVentCount, "ea", rate(pblab), boxVentCount * rate(pblab)));
  }
  if (m.penetrations.skylights > 0) {
    const sklab = pricing.labor.install_accessories_each.skylight_reflash;
    labor.push(li("Skylight reflash labor", m.penetrations.skylights, "ea", rate(sklab), m.penetrations.skylights * rate(sklab)));
  }
  // Satellite dish reset is intentionally not a separate line item —
  // detach/reattach is ~20 min of one crew member's time and gets absorbed
  // by the supervision overhead already loaded into labor. Tracking it
  // creates noise without a meaningful price impact.

  if (m.line_items.ridge_lf > 0) {
    const rvlab = pricing.labor.install_accessories_per_lf.ridge_vent;
    labor.push(li("Ridge vent install", m.line_items.ridge_lf, "lf", rate(rvlab), m.line_items.ridge_lf * rate(rvlab)));
  }

  const cleanup = pricing.labor.cleanup_and_haul.magnetic_sweep_and_site_cleanup;
  labor.push(li("Site cleanup + magnetic sweep", 1, "job", rate(cleanup), rate(cleanup)));

  const labor_crew_subtotal = sum(labor);
  const supervision_pct = rate(pricing.labor.supervision_overhead_pct);
  const labor_subtotal = labor_crew_subtotal * (1 + supervision_pct);

  // Steep slope premium
  const steepPremium = m.pitch.rise >= 9 ? rate(pricing.labor.install_field_shingles.steep_slope_premium_pct) : 0;
  const labor_with_steep = labor_subtotal * (1 + steepPremium);

  // === Apply regional multipliers ===
  const materials_regional = materials_subtotal * matMult;
  const labor_regional = labor_with_steep * laborMult;
  const cost_basis = materials_regional + labor_regional;

  // === Margin uplift ===
  const quote_subtotal = cost_basis / (1 - margin);

  return {
    key: def.key,
    name: def.name,
    shingle_product: (shingleProduct.examples?.[0] ?? def.shingleKey) as string,
    badge: def.badge,
    warranty: def.warranty,
    wind_rating_mph,
    materials,
    labor,
    materials_subtotal: round(materials_subtotal, 2),
    labor_subtotal: round(labor_subtotal, 2),
    materials_regional: round(materials_regional, 2),
    labor_regional: round(labor_regional, 2),
    cost_basis: round(cost_basis, 2),
    target_gross_margin: margin,
    quote_subtotal: round(quote_subtotal, 2),
    dumpster: 0, permit: 0, total: 0, per_sqft: 0,  // filled in by caller
  };
}

function li(description: string, qty: number, unit: string, unit_cost: number, subtotal: number): LineItem {
  return { description, qty: round(qty, 2), unit, unit_cost: round(unit_cost, 2), subtotal: round(subtotal, 2) };
}

function sum(items: LineItem[]): number {
  return items.reduce((s, i) => s + i.subtotal, 0);
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
