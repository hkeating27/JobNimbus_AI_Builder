"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Quote, QuoteTier } from "@/lib/types";
import type { InvoiceMode } from "./PrintableInvoice";

// PDF generation happens server-side via /api/pdf (uses
// @react-pdf/renderer under the hood). Client just POSTs the
// quote + tier + mode and downloads the response blob.
//
// Why server-side:
//   - keeps ~800 KB of react-pdf out of the client bundle
//   - Node-only code path can use Buffer/streams natively
//   - one render pipeline regardless of browser
//
// PrintableInvoice + window.print() is still around as a fallback
// path; if the PDF output ever looks worse than browser print, we
// can revert by swapping the click handler back.
type DownloadKey = `${string}-${InvoiceMode}`;

export default function TierCards({ quote }: { quote: Quote }) {
  // Line items render in a wide modal (not inline) — the tier cards
  // are ~280px wide and previously expanded into a tall, very narrow
  // list that scrolled forever. The modal gets the full viewport
  // width up to a max so two columns fit (materials + labor).
  const [lineItemsTier, setLineItemsTier] = useState<QuoteTier | null>(null);
  const [downloading, setDownloading] = useState<DownloadKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const downloadPdf = async (tier: QuoteTier, mode: InvoiceMode) => {
    const key: DownloadKey = `${tier.key}-${mode}`;
    setDownloading(key);
    setError(null);
    try {
      const res = await fetch("/api/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote, tier, mode }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(detail?.detail || detail?.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `roofiq-${quote.quote_id}-${tier.key}-${mode}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke after a short tick so the browser has time to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <>
      <div className="grid md:grid-cols-3 gap-4">
        {quote.tiers.map((t) => (
          <Card
            key={t.key}
            tier={t}
            recommended={t.key === quote.recommended_tier_key}
            downloading={downloading}
            onShowLineItems={() => setLineItemsTier(t)}
            onDownload={(mode) => downloadPdf(t, mode)}
          />
        ))}
      </div>
      {error && (
        <div className="mt-3 rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-800">
          PDF generation failed: {error}
        </div>
      )}
      {lineItemsTier && (
        <LineItemsModal tier={lineItemsTier} onClose={() => setLineItemsTier(null)} />
      )}
    </>
  );
}

function Card({
  tier, recommended, downloading, onShowLineItems, onDownload,
}: {
  tier: QuoteTier;
  recommended: boolean;
  downloading: DownloadKey | null;
  onShowLineItems: () => void;
  onDownload: (mode: InvoiceMode) => void;
}) {
  // Tier name is "Better — Architectural"; the tier-key label above already
  // says "BETTER", so we strip the redundant prefix and show just the
  // product type as the title — also avoids the em-dash forcing a wrap.
  const productType = tier.name.includes(" — ") ? tier.name.split(" — ", 2)[1] : tier.name;
  const isSimpleLoading = downloading === `${tier.key}-simple`;
  const isDetailedLoading = downloading === `${tier.key}-detailed`;
  const anyLoading = downloading !== null;

  return (
    <div className={"card p-5 flex flex-col fade-up relative " + (recommended ? "ring-2 ring-brand-500" : "")}>
      {/* All tier badges sit at the same top-right edge instead of
          inline in the header. This frees up the title's horizontal
          space so "Architectural" doesn't truncate to "Ar..." next to
          a long badge like "Industry standard". Mutually exclusive: a
          tier is either "Recommended" (blue, the highlighted tier) or
          shows its own badge ("Budget" / "Industry standard" /
          "Insurance ✓"), never both. */}
      {recommended ? (
        <div className="absolute -top-2.5 right-4 badge-blue whitespace-nowrap">Recommended</div>
      ) : tier.badge ? (
        <div className="absolute -top-2.5 right-4 badge-gray whitespace-nowrap">{tier.badge}</div>
      ) : null}
      <div className="min-h-[4.25rem]">
        <div className="label-tiny">{tier.key.toUpperCase()}</div>
        <div className="font-display text-lg font-semibold mt-0.5 leading-tight whitespace-nowrap truncate" title={productType}>{productType}</div>
        <div className="text-xs text-ink-500 mt-0.5 truncate">{tier.shingle_product}</div>
      </div>

      <div className="mt-5 min-h-[4.25rem]">
        <div className="text-3xl font-display font-semibold tabular-nums">${tier.total.toLocaleString()}</div>
        <div className="text-sm text-ink-500 leading-snug">${tier.per_sqft}/sqft · {tier.warranty} · {tier.wind_rating_mph} mph rated</div>
      </div>

      {tier.incentives && tier.incentives.length > 0 && (
        <div className="mt-3 rounded-lg bg-emerald-50/70 border border-emerald-200 px-3 py-2 text-xs">
          <div className="flex items-start gap-1.5">
            <svg className="size-3.5 text-emerald-600 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
            <div className="min-w-0">
              <div className="font-medium text-emerald-900">{tier.incentives[0].headline}</div>
              {tier.incentives.length > 1 && (
                <div className="text-emerald-700 mt-0.5">+ {tier.incentives.length - 1} more incentive{tier.incentives.length > 2 ? "s" : ""} available</div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 text-sm space-y-1.5">
        <Row label="Materials" v={tier.materials_regional} />
        <Row label="Labor" v={tier.labor_regional} />
        <Row label="Cost basis" v={tier.cost_basis} muted />
        {/* "+ Gross margin" is honest labeling: this is gross profit
            margin (% of revenue), NOT net profit. After typical 20%
            overhead the contractor's net is ~10-15% — surfaced below. */}
        <Row label={`+ Gross margin (${(tier.target_gross_margin * 100).toFixed(0)}%)`} v={tier.quote_subtotal - tier.cost_basis} />
        <Row label="Dumpster + permit" v={tier.dumpster + tier.permit} />
        <div className="border-t border-ink-100 pt-2 mt-2 flex justify-between font-medium">
          <span>Total</span>
          <span className="tabular-nums">${tier.total.toLocaleString()}</span>
        </div>
        {/* Net-profit estimate. Industry overhead (G&A, sales,
            insurance, equipment, vehicle, marketing) typically eats
            ~20% of revenue for a healthy roofing business. So at a
            30% gross margin, real net profit is ~10%. We show the
            estimate so the contractor isn't tricked into thinking
            "30% margin = 30% take-home." */}
        <NetProfitEstimate tier={tier} />
      </div>

      {/* Two-row button layout. The previous 3-column grid couldn't
          fit "Detailed PDF" inside btn-ghost's px-4 padding without
          either wrapping the text or overflowing the grid cell into
          its neighbor — visible as overlapping button outlines.
          Stacking gives each PDF button ~half the card width, which
          easily fits both labels and the "Saving…" loading state at
          rest height. */}
      <div className="mt-4 space-y-2">
        <button
          onClick={onShowLineItems}
          className="btn-ghost text-xs w-full whitespace-nowrap"
          disabled={anyLoading}
        >
          Show line items
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onDownload("simple")}
            className="btn-ghost text-xs whitespace-nowrap"
            title="One-page customer-facing invoice"
            disabled={anyLoading}
          >
            {isSimpleLoading ? "Saving…" : "Simple PDF"}
          </button>
          <button
            onClick={() => onDownload("detailed")}
            className="btn-ghost text-xs whitespace-nowrap"
            title="Two-page invoice with itemized materials and labor"
            disabled={anyLoading}
          >
            {isDetailedLoading ? "Saving…" : "Detailed PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Estimated net profit after typical roofing-industry overhead.
//
// Why this matters: contractors looking at "+ Gross margin (30%)"
// often misread that as "I take home 30%." Real take-home is much
// less because overhead (G&A, sales commission, GL + workers' comp
// insurance, office, vehicles, marketing, owner draw) eats a healthy
// chunk of revenue before profit. We use 20% as a representative
// number — real overhead spans 15-30% depending on company size and
// market. The result is shown as an ESTIMATE, not a hard number.
//
// At 30% gross margin and 20% overhead, net is 10%. At 40% gross,
// net is 20%. Surfacing both lets the contractor sanity-check
// pricing against what they actually pocket.
const TYPICAL_OVERHEAD_PCT = 0.20;

function NetProfitEstimate({ tier }: { tier: QuoteTier }) {
  const grossProfit = tier.quote_subtotal - tier.cost_basis;
  const overhead = tier.total * TYPICAL_OVERHEAD_PCT;
  const netProfit = grossProfit - overhead;
  const netMarginPct = tier.total > 0 ? (netProfit / tier.total) * 100 : 0;
  return (
    <div className="text-[11px] text-ink-500 pt-1.5 leading-snug">
      <div className="flex justify-between gap-2">
        <span title={`Gross profit ($${Math.round(grossProfit).toLocaleString()}) minus typical 20% overhead (G&A, insurance, vehicle, marketing).`}>
          Est. net profit after ~20% overhead
        </span>
        <span className="tabular-nums">
          ${Math.round(netProfit).toLocaleString()} <span className="text-ink-400">({netMarginPct.toFixed(0)}%)</span>
        </span>
      </div>
    </div>
  );
}

function Row({ label, v, muted }: { label: string; v: number; muted?: boolean }) {
  // No `truncate` here: in a 3-column tier layout the cards are
  // narrow enough that "+ Gross margin (35%)" and "Dumpster + permit"
  // would clip to "+ Gross margi…" / "Dumpster + per…" — both losing
  // critical information. Letting the label wrap to a second line
  // keeps it fully readable; the row gets slightly taller but stays
  // legible.
  return (
    <div className={"flex justify-between gap-3 items-baseline " + (muted ? "text-ink-500" : "")}>
      <span className="min-w-0 leading-snug">{label}</span>
      <span className="tabular-nums shrink-0">${Math.round(v).toLocaleString()}</span>
    </div>
  );
}

// Wide line-items modal. Materials and labor sit side-by-side on
// desktop (full readable widths, no scrolling forever) and stack on
// narrow viewports. Portaled to <body> so the backdrop covers the
// whole viewport regardless of where in the DOM the trigger sits.
function LineItemsModal({ tier, onClose }: { tier: QuoteTier; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Lock body scroll while modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!mounted) return null;

  const productType = tier.name.includes(" — ") ? tier.name.split(" — ", 2)[1] : tier.name;
  const matsTotal = tier.materials.reduce((s, li) => s + li.subtotal, 0);
  const laborTotal = tier.labor.reduce((s, li) => s + li.subtotal, 0);

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 backdrop-blur-sm fade-up p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="card w-full max-w-5xl max-h-[88vh] overflow-y-auto p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <div className="label-tiny mb-1">{tier.key.toUpperCase()} · LINE ITEMS</div>
            <h2 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
              {productType}
            </h2>
            <div className="text-sm text-ink-500 mt-1">{tier.shingle_product}</div>
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

        <div className="grid md:grid-cols-2 gap-6 text-sm">
          <ItemColumn title="Materials" total={matsTotal} items={tier.materials} />
          <ItemColumn title="Labor" total={laborTotal} items={tier.labor} />
        </div>

        <div className="mt-6 pt-4 border-t border-ink-100 text-xs text-ink-500">
          These are the COST BASIS line items at internal rates (pre-margin).
          Customer-facing PDFs apply the gross margin uplift uniformly across
          materials and labor — see the &ldquo;Detailed PDF&rdquo; for the bid
          version.
        </div>
      </div>
    </div>,
    document.body
  );
}

function ItemColumn({ title, total, items }: { title: string; total: number; items: QuoteTier["materials"] }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <div className="label-tiny">{title}</div>
        <div className="text-sm font-medium text-ink-700 tabular-nums">${Math.round(total).toLocaleString()}</div>
      </div>
      <div className="rounded-lg border border-ink-100 divide-y divide-ink-100/70">
        {items.map((li, i) => (
          <Item key={`${title}-${i}`} desc={li.description} qty={li.qty} unit={li.unit} unitCost={li.unit_cost} sub={li.subtotal} />
        ))}
      </div>
    </div>
  );
}

function Item({ desc, qty, unit, unitCost, sub }: { desc: string; qty: number; unit: string; unitCost: number; sub: number }) {
  return (
    <div className="py-2">
      <div className="text-ink-700 leading-snug">{desc}</div>
      <div className="flex justify-between text-[11px] text-ink-500 mt-1 tabular-nums">
        <span>{qty} {unit} × ${unitCost.toFixed(2)}</span>
        <span className="text-ink-900 font-medium">${sub.toFixed(2)}</span>
      </div>
    </div>
  );
}
