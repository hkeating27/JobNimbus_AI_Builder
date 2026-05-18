import type { Quote, QuoteTier } from "@/lib/types";

export type InvoiceMode = "simple" | "detailed";

// Customer-facing invoice. Internal data (confidence flags, pricing zone,
// gross-margin breakdown, cost basis) is intentionally omitted — that's
// contractor-only telemetry. Line item rates are marked up by the gross
// margin uplift so what the customer sees is a real bid price.
//
// `simple`   = property + scope + totals + terms + sign  (one page)
// `detailed` = same + itemized materials & labor tables  (two pages max)
export default function PrintableInvoice({ quote, tier, mode }: { quote: Quote; tier: QuoteTier; mode: InvoiceMode }) {
  const m = quote.measurement;
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const validUntil = new Date(Date.now() + 30 * 86400 * 1000).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // Uplift = quote_subtotal / cost_basis. Scales raw line item costs into
  // the bid price the customer would see on any contractor's invoice.
  const uplift = tier.cost_basis > 0 ? tier.quote_subtotal / tier.cost_basis : 1;
  const matsTotal = Math.round(tier.materials_regional * uplift);
  const laborTotal = Math.round(tier.labor_regional * uplift);

  return (
    <div className="print-invoice">
      <header className="pi-header">
        <div className="pi-brand">
          <div className="pi-logo">R</div>
          <div>
            <div className="pi-brand-name">RoofIQ</div>
            <div className="pi-brand-tag">Aerial measurement · transparent pricing</div>
          </div>
        </div>
        <div className="pi-meta">
          <div><strong>Quote #</strong> {quote.quote_id}</div>
          <div><strong>Date</strong> {today}</div>
          <div><strong>Valid through</strong> {validUntil}</div>
        </div>
      </header>

      <h1 className="pi-title">Roof Replacement Estimate</h1>

      <section className="pi-customer">
        <div className="pi-label">Property</div>
        <div className="pi-property">{m.formatted_address}</div>
      </section>

      <section className="pi-property-grid">
        <div><span className="pi-label">Roof area</span><span>{m.total_sqft.toLocaleString()} sqft</span></div>
        <div><span className="pi-label">Pitch</span><span>{m.pitch.label}</span></div>
        <div><span className="pi-label">Material</span><span>{tier.shingle_product}</span></div>
        <div><span className="pi-label">Warranty</span><span>{tier.warranty}</span></div>
        <div><span className="pi-label">Wind rating</span><span>{tier.wind_rating_mph} mph</span></div>
        <div><span className="pi-label">Tear-off</span><span>{m.layers === 2 ? "Two layers" : "Single layer"}</span></div>
      </section>

      <section className="pi-scope">
        <div className="pi-section-title">Scope of work</div>
        <p>
          Complete tear-off of existing roofing material with full deck inspection. Install <strong>{tier.shingle_product}</strong> field shingles, matched starter strip, and hip &amp; ridge cap shingles; new synthetic underlayment over the entire deck and ice &amp; water shield at all eaves and valleys. New aluminum drip edge along eaves and rakes, W-valley metal in all valleys, and step + counter flashing at sidewalls and chimneys. New pipe boots on all plumbing vents and a continuous ridge vent. Permits, inspections, dumpster, site protection, daily cleanup, and a final magnetic sweep are included.
        </p>
      </section>

      {mode === "detailed" && (
        <section className="pi-tables">
          <div>
            <div className="pi-section-title">Materials</div>
            <table className="pi-table">
              <thead>
                <tr><th className="al">Item</th><th className="ar">Qty</th><th className="ar">Rate</th><th className="ar">Amount</th></tr>
              </thead>
              <tbody>
                {tier.materials.map((li, i) => (
                  <tr key={i}>
                    <td className="al">{li.description}</td>
                    <td className="ar">{li.qty} {li.unit}</td>
                    <td className="ar">${(li.unit_cost * uplift).toFixed(2)}</td>
                    <td className="ar">${(li.subtotal * uplift).toFixed(2)}</td>
                  </tr>
                ))}
                <tr className="pi-subtotal">
                  <td colSpan={3} className="ar"><strong>Materials</strong></td>
                  <td className="ar"><strong>${matsTotal.toLocaleString()}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div>
            <div className="pi-section-title">Labor</div>
            <table className="pi-table">
              <thead>
                <tr><th className="al">Item</th><th className="ar">Qty</th><th className="ar">Rate</th><th className="ar">Amount</th></tr>
              </thead>
              <tbody>
                {tier.labor.map((li, i) => (
                  <tr key={i}>
                    <td className="al">{li.description}</td>
                    <td className="ar">{li.qty} {li.unit}</td>
                    <td className="ar">${(li.unit_cost * uplift).toFixed(2)}</td>
                    <td className="ar">${(li.subtotal * uplift).toFixed(2)}</td>
                  </tr>
                ))}
                <tr className="pi-subtotal">
                  <td colSpan={3} className="ar"><strong>Labor</strong></td>
                  <td className="ar"><strong>${laborTotal.toLocaleString()}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="pi-totals">
        <div className="pi-total-row"><span>Materials</span><span>${matsTotal.toLocaleString()}</span></div>
        <div className="pi-total-row"><span>Labor</span><span>${laborTotal.toLocaleString()}</span></div>
        <div className="pi-total-row"><span>Disposal &amp; permit</span><span>${(tier.dumpster + tier.permit).toLocaleString()}</span></div>
        <div className="pi-total-row pi-grand"><span>Total</span><span>${tier.total.toLocaleString()}</span></div>
      </section>

      {tier.incentives && tier.incentives.length > 0 && (
        <section className="pi-incentives">
          <div className="pi-section-title">Insurance &amp; rebate notes</div>
          {tier.incentives.map((inc) => (
            <div key={inc.id} className="pi-incentive">
              <p><strong>{inc.label}.</strong> {inc.description_for_customer}</p>
              <p className="pi-incentive-math">{inc.savings_math_template}</p>
              <p className="pi-incentive-action"><strong>Next step:</strong> {inc.action_step}</p>
            </div>
          ))}
        </section>
      )}

      <section className="pi-terms">
        <div className="pi-section-title">Terms</div>
        <p><strong>Validity:</strong> 30 days from date above. <strong>Warranty:</strong> manufacturer warranty per product spec ({tier.warranty}); 5-year workmanship warranty from completion. <strong>Payment:</strong> 30% deposit at signing, 40% on tear-off, 30% on completion. Insurance jobs may follow ACV/RCV release schedule. <strong>Scope changes:</strong> decking replacement or hidden damage discovered during tear-off will be quoted as change orders before work proceeds.</p>
      </section>

      <section className="pi-sign">
        <div className="pi-sign-row">
          <div className="pi-sign-line">Customer signature</div>
          <div className="pi-sign-line">Date</div>
        </div>
        <div className="pi-sign-row">
          <div className="pi-sign-line">Contractor representative</div>
          <div className="pi-sign-line">Date</div>
        </div>
      </section>

      <footer className="pi-footer">Thank you for considering our quote.</footer>
    </div>
  );
}
