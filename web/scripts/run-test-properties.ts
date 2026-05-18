// Runs the 5 hackathon test properties through the full pipeline and writes
// per-property quote artifacts to ../outputs/test-properties/.

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import fs from "node:fs";
import { measureRoof } from "../src/lib/measure";
import { generateQuote } from "../src/lib/quote";
import { TEST_PROPERTIES } from "./benchmark-data";

const envPath = [".env.local", ".env"].map((f) => path.resolve(process.cwd(), f)).find((p) => fs.existsSync(p));
if (envPath) dotenv.config({ path: envPath });

async function main() {
  const outRoot = path.resolve(process.cwd(), "..", "outputs", "test-properties");
  mkdirSync(outRoot, { recursive: true });

  const summary: Array<{ address: string; total_sqft: number; pitch: string; quote_better: number; quote_good: number; quote_best: number; confidence: string; sources: string }> = [];

  for (const addr of TEST_PROPERTIES) {
    const slug = addr.split(",")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-");
    process.stdout.write(`  · ${addr} … `);
    try {
      const m = await measureRoof(addr);
      const q = generateQuote(m);
      const propDir = path.resolve(outRoot, slug);
      mkdirSync(propDir, { recursive: true });
      writeFileSync(path.resolve(propDir, "measurement.json"), JSON.stringify(m, null, 2));
      writeFileSync(path.resolve(propDir, "quote.json"), JSON.stringify(q, null, 2));
      writeFileSync(path.resolve(propDir, "quote.md"), renderQuoteMd(q));
      const better = q.tiers.find((t) => t.key === "better")!;
      const good = q.tiers.find((t) => t.key === "good")!;
      const best = q.tiers.find((t) => t.key === "best")!;
      summary.push({ address: addr, total_sqft: m.total_sqft, pitch: m.pitch.label, quote_better: better.total, quote_good: good.total, quote_best: best.total, confidence: m.confidence, sources: m.data_sources.join(", ") });
      console.log(`${m.total_sqft} sqft → $${better.total.toLocaleString()} (better)`);
    } catch (e: any) {
      console.log(`ERROR: ${e?.message}`);
    }
  }

  const summaryMd = renderSummary(summary);
  writeFileSync(path.resolve(outRoot, "summary.md"), summaryMd);
  writeFileSync(path.resolve(outRoot, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`\nSummary → outputs/test-properties/summary.md`);
}

function renderQuoteMd(q: any): string {
  const m = q.measurement;
  const lines: string[] = [];
  lines.push(`# Quote — ${m.formatted_address}`);
  lines.push("");
  lines.push(`**Quote ID:** ${q.quote_id} · **Generated:** ${q.generated_at}`);
  lines.push("");
  lines.push(`**Roof:** ${m.total_sqft.toLocaleString()} sqft total · ${m.pitch.label} pitch · ${m.complexity.replaceAll("_", " ")} · ${m.segments} segments`);
  lines.push("");
  lines.push(`**Region:** ${q.zone_label} · labor ×${q.labor_multiplier} · material ×${q.material_multiplier} · margin ${(q.target_gross_margin * 100).toFixed(0)}%`);
  lines.push("");
  lines.push("## Tier comparison");
  lines.push("");
  lines.push("| Tier | Materials | Labor | Cost basis | Quote subtotal | + dumpster + permit | **Total** | $/sqft |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const t of q.tiers) {
    lines.push(`| ${t.name} | $${Math.round(t.materials_regional).toLocaleString()} | $${Math.round(t.labor_regional).toLocaleString()} | $${Math.round(t.cost_basis).toLocaleString()} | $${Math.round(t.quote_subtotal).toLocaleString()} | $${(t.dumpster + t.permit).toLocaleString()} | **$${t.total.toLocaleString()}** | $${t.per_sqft} |`);
  }
  lines.push("");
  lines.push(`**Recommended for this address:** ${q.recommended_tier_key.toUpperCase()}`);
  lines.push("");
  lines.push("## Detailed line items — Better tier");
  lines.push("");
  const better = q.tiers.find((t: any) => t.key === "better")!;
  lines.push("### Materials");
  for (const li of better.materials) lines.push(`- ${li.description}: ${li.qty} ${li.unit} × $${li.unit_cost.toFixed(2)} = $${li.subtotal.toFixed(2)}`);
  lines.push("");
  lines.push("### Labor");
  for (const li of better.labor) lines.push(`- ${li.description}: ${li.qty} ${li.unit} × $${li.unit_cost.toFixed(2)} = $${li.subtotal.toFixed(2)}`);
  return lines.join("\n") + "\n";
}

function renderSummary(rows: any[]): string {
  const lines: string[] = [];
  lines.push("# Test Properties — Submission Summary");
  lines.push("");
  lines.push("Per-property results from running the RoofIQ pipeline on the 5 hackathon test addresses. **Total sqft for each is what we submit on the form.**");
  lines.push("");
  lines.push("| Address | Total sqft | Pitch | Quote (Good) | Quote (Better) | Quote (Best) | Confidence |");
  lines.push("|---|---:|---:|---:|---:|---:|---|");
  for (const r of rows) {
    lines.push(`| ${r.address} | **${r.total_sqft.toLocaleString()}** | ${r.pitch} | $${r.quote_good.toLocaleString()} | $${r.quote_better.toLocaleString()} | $${r.quote_best.toLocaleString()} | ${r.confidence} |`);
  }
  lines.push("");
  lines.push("## Submission numbers");
  lines.push("");
  for (const r of rows) lines.push(`- **${r.address}** → ${r.total_sqft.toLocaleString()} sqft`);
  return lines.join("\n") + "\n";
}

void main();
