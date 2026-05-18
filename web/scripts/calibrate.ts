// Calibration harness: runs our measurement pipeline on the 5 benchmark
// properties and compares to Reference A and Reference B from
// benchmark-measurements.md. Writes a markdown report to outputs/calibration.md.

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "node:process";
import { measureRoof } from "../src/lib/measure";
import { generateQuote } from "../src/lib/quote";
import { BENCHMARK_PROPERTIES } from "./benchmark-data";

// Load env from ../.env or ../.env.local if present (next does this for the app, not for scripts).
import dotenv from "dotenv";
import fs from "node:fs";
const envPath = [".env.local", ".env"].map((f) => path.resolve(process.cwd(), f)).find((p) => fs.existsSync(p));
if (envPath) dotenv.config({ path: envPath });

type Row = {
  address: string;
  predicted_sqft: number;
  predicted_pitch: string;
  ref_a_sqft: number;
  ref_b_sqft: number;
  err_pct_vs_a: number;
  err_pct_vs_b: number;
  err_pct_vs_avg: number;
  data_sources: string;
  confidence: string;
  notes: string;
  predicted_quote_better: number;
};

async function main() {
  const rows: Row[] = [];
  console.log(`Calibrating ${BENCHMARK_PROPERTIES.length} benchmark properties…`);

  for (const prop of BENCHMARK_PROPERTIES) {
    process.stdout.write(`  · ${prop.address.split(",")[0]} … `);
    try {
      const m = await measureRoof(prop.address);
      const q = generateQuote(m);
      const refA = prop.references[0];
      const refB = prop.references[1];
      const refAvg = (refA.total_sqft + refB.total_sqft) / 2;
      const errA = ((m.total_sqft - refA.total_sqft) / refA.total_sqft) * 100;
      const errB = ((m.total_sqft - refB.total_sqft) / refB.total_sqft) * 100;
      const errAvg = ((m.total_sqft - refAvg) / refAvg) * 100;
      const better = q.tiers.find((t) => t.key === "better")!;
      rows.push({
        address: prop.address,
        predicted_sqft: m.total_sqft,
        predicted_pitch: m.pitch.label,
        ref_a_sqft: refA.total_sqft,
        ref_b_sqft: refB.total_sqft,
        err_pct_vs_a: errA,
        err_pct_vs_b: errB,
        err_pct_vs_avg: errAvg,
        data_sources: m.data_sources.join(", ") || "(none)",
        confidence: m.confidence,
        notes: m.notes.join(" | "),
        predicted_quote_better: better.total,
      });
      console.log(`predicted ${m.total_sqft} sqft (refs ${refA.total_sqft}/${refB.total_sqft}) — err ${errAvg.toFixed(1)}% vs avg`);
    } catch (e: any) {
      console.log(`ERROR: ${e?.message}`);
    }
  }

  // Write report.
  const outDir = path.resolve(process.cwd(), "..", "outputs");
  mkdirSync(outDir, { recursive: true });
  const md = renderReport(rows);
  const reportPath = path.resolve(outDir, "calibration.md");
  writeFileSync(reportPath, md, "utf8");
  const jsonPath = path.resolve(outDir, "calibration.json");
  writeFileSync(jsonPath, JSON.stringify(rows, null, 2), "utf8");
  console.log(`\nReport written → ${path.relative(process.cwd(), reportPath)}`);
  console.log(`JSON written   → ${path.relative(process.cwd(), jsonPath)}`);

  if (rows.length > 0) {
    const errs = rows.map((r) => Math.abs(r.err_pct_vs_avg)).sort((a, b) => a - b);
    const median = errs[Math.floor(errs.length / 2)];
    const max = errs[errs.length - 1];
    console.log(`\nAbs error vs reference average: median ${median.toFixed(1)}%, max ${max.toFixed(1)}%`);
  }
}

function renderReport(rows: Row[]): string {
  const lines: string[] = [];
  lines.push("# Calibration Report — Benchmark Properties");
  lines.push("");
  lines.push("Our measurement pipeline (Google Solar API → Claude vision fallback → heuristics) run against the 5 example properties from `benchmark-measurements.md`. Reference A and Reference B are the trusted commercial measurements provided by the hackathon.");
  lines.push("");
  lines.push("| Property | Predicted sqft | Pitch | Ref A | Ref B | Err vs avg | Sources | Confidence |");
  lines.push("|---|---:|---:|---:|---:|---:|---|---|");
  for (const r of rows) {
    const addrShort = r.address.split(",")[0];
    lines.push(
      `| ${addrShort} | ${r.predicted_sqft.toLocaleString()} | ${r.predicted_pitch} | ${r.ref_a_sqft.toLocaleString()} | ${r.ref_b_sqft.toLocaleString()} | ${r.err_pct_vs_avg >= 0 ? "+" : ""}${r.err_pct_vs_avg.toFixed(1)}% | ${r.data_sources} | ${r.confidence} |`
    );
  }
  lines.push("");
  if (rows.length) {
    const errs = rows.map((r) => Math.abs(r.err_pct_vs_avg)).sort((a, b) => a - b);
    const median = errs[Math.floor(errs.length / 2)];
    const max = errs[errs.length - 1];
    lines.push(`**Aggregate accuracy:** median absolute error ${median.toFixed(1)}%, worst-case ${max.toFixed(1)}%.`);
  }
  lines.push("");
  lines.push("## Predicted quote (Better tier) for each benchmark");
  lines.push("");
  lines.push("| Property | Predicted Better-tier total |");
  lines.push("|---|---:|");
  for (const r of rows) lines.push(`| ${r.address.split(",")[0]} | $${r.predicted_quote_better.toLocaleString()} |`);
  lines.push("");
  lines.push("## Notes per property");
  lines.push("");
  for (const r of rows) {
    if (r.notes) lines.push(`- **${r.address.split(",")[0]}**: ${r.notes}`);
  }
  return lines.join("\n") + "\n";
}

void main();
