// Real PDF version of PrintableInvoice, using @react-pdf/renderer.
//
// Lays out the same content as web/src/components/PrintableInvoice.tsx
// (header → property/scope → optional itemized tables → totals →
// incentives → terms → signatures), but emits a true vector PDF
// instead of relying on the browser's print dialog.
//
// Two modes:
//   simple   — one page: property + scope + totals + terms + sign
//   detailed — two pages: above + itemized materials & labor tables
import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { Quote, QuoteTier } from "@/lib/types";
import type { InvoiceMode } from "@/components/PrintableInvoice";

// Palette mirrors the JobNimbus brand colors used in the web UI.
const C = {
  ink: "#0f172a",        // body text
  ink600: "#475569",     // labels
  ink400: "#94a3b8",     // muted
  brand: "#3968C6",      // primary
  navy: "#152952",       // titles
  rule: "#e2e8f0",       // borders
  panel: "#f8fafc",      // section backgrounds
  emerald: "#047857",
  emeraldBg: "#ecfdf5",
};

const s = StyleSheet.create({
  page: {
    // Tighter paddings so a typical Simple invoice with one regional
    // incentive block can stay on a single page. Was 36/48 top/bottom
    // — now 28/30. Saves ~26 pt of vertical real estate.
    paddingTop: 28,
    paddingHorizontal: 40,
    paddingBottom: 30,
    fontSize: 10,
    color: C.ink,
    fontFamily: "Helvetica",
    lineHeight: 1.4,
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: C.brand,
    marginBottom: 14,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: {
    width: 32,
    height: 32,
    backgroundColor: C.brand,
    color: "#fff",
    borderRadius: 6,
    textAlign: "center",
    fontSize: 18,
    fontWeight: 700,
    paddingTop: 5,
    fontFamily: "Helvetica-Bold",
  },
  brandName: { fontSize: 14, fontFamily: "Helvetica-Bold", color: C.navy },
  brandTag: { fontSize: 8, color: C.ink600 },
  metaCol: { fontSize: 8, textAlign: "right", color: C.ink600, gap: 1 },

  title: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: C.navy,
    marginBottom: 6,
  },

  label: {
    fontSize: 7,
    color: C.ink400,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 2,
    fontFamily: "Helvetica-Bold",
  },

  customerBlock: { marginBottom: 8 },
  property: { fontSize: 11, fontFamily: "Helvetica-Bold", color: C.navy },

  propGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    backgroundColor: C.panel,
    borderRadius: 4,
    padding: 8,
    marginBottom: 8,
  },
  propCell: { width: "33.33%", marginBottom: 4 },
  propVal: { fontSize: 10, fontFamily: "Helvetica-Bold", color: C.ink },

  sectionTitle: {
    fontSize: 10.5,
    fontFamily: "Helvetica-Bold",
    color: C.navy,
    marginBottom: 4,
    marginTop: 4,
  },
  scopePara: { fontSize: 9, color: C.ink, marginBottom: 6, lineHeight: 1.32 },

  // Detailed-mode (page 2+) tables. Tightened so a typical
  // residential reroof's full Materials + Labor item lists fit on a
  // single page-2: ~13 material rows + ~12 labor rows = ~25 rows.
  // At ~13pt each (fontSize 8 + paddingVertical 2.5 × 2) that fits
  // comfortably under the page-2 header.
  tablesWrap: { marginBottom: 8 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: C.panel,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 0.75,
    borderBottomColor: C.rule,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 2.5,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: C.rule,
  },
  thItem: { flexBasis: "50%", fontSize: 7.5, fontFamily: "Helvetica-Bold", color: C.ink600 },
  thRight: { flexBasis: "16.66%", fontSize: 7.5, fontFamily: "Helvetica-Bold", color: C.ink600, textAlign: "right" },
  tdItem: { flexBasis: "50%", fontSize: 8.5 },
  tdRight: { flexBasis: "16.66%", fontSize: 8.5, textAlign: "right" },
  subtotalRow: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderTopWidth: 0.75,
    borderTopColor: C.rule,
    marginBottom: 6,
  },
  subtotalSpacer: { flexBasis: "83.33%", textAlign: "right", fontSize: 8.5, fontFamily: "Helvetica-Bold" },
  subtotalAmt: { flexBasis: "16.66%", textAlign: "right", fontSize: 8.5, fontFamily: "Helvetica-Bold" },

  totals: {
    backgroundColor: C.panel,
    padding: 9,
    borderRadius: 4,
    marginBottom: 8,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 10,
    paddingVertical: 2,
  },
  grand: {
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: C.navy,
    paddingTop: 8,
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: C.rule,
  },

  incentiveBlock: {
    backgroundColor: C.emeraldBg,
    borderLeftWidth: 2.5,
    borderLeftColor: C.emerald,
    padding: 6,
    marginBottom: 5,
    borderRadius: 2,
  },
  incentiveLabel: { fontSize: 9, fontFamily: "Helvetica-Bold", color: C.emerald, marginBottom: 1 },
  incentiveBody: { fontSize: 8.5, color: C.ink, marginBottom: 2, lineHeight: 1.3 },
  incentiveMath: { fontSize: 8, color: C.ink600, fontStyle: "italic", marginBottom: 2, lineHeight: 1.3 },

  // termsPara.marginBottom IS the writing space above the customer
  // signature line (the line itself is the border-top of the next
  // row). 30pt = about 0.4 inch of ink room — enough to fit a
  // hand-written signature comfortably without crowding terms.
  termsPara: { fontSize: 8.5, color: C.ink600, lineHeight: 1.4, marginBottom: 30 },

  // signRow.marginBottom is the writing space above the contractor
  // signature line, same logic. The label text inside the cell sits
  // BELOW the line, so this margin opens up the space ABOVE the
  // next line where the contractor actually signs.
  signRow: { flexDirection: "row", gap: 18, marginBottom: 28 },
  signCell: { flex: 1, borderTopWidth: 0.5, borderTopColor: C.ink, paddingTop: 3, fontSize: 8, color: C.ink600 },

  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 8,
    color: C.ink400,
    textAlign: "center",
  },
});

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

export function InvoicePDF({ quote, tier, mode }: { quote: Quote; tier: QuoteTier; mode: InvoiceMode }) {
  const m = quote.measurement;
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const validUntil = new Date(Date.now() + 30 * 86400 * 1000).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const uplift = tier.cost_basis > 0 ? tier.quote_subtotal / tier.cost_basis : 1;
  const matsTotal = Math.round(tier.materials_regional * uplift);
  const laborTotal = Math.round(tier.labor_regional * uplift);

  const propRow = (label: string, value: string) => (
    <View style={s.propCell}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.propVal}>{value}</Text>
    </View>
  );

  const showTables = mode === "detailed";

  return (
    <Document title={`RoofIQ Quote ${quote.quote_id}`} author="RoofIQ">
      <Page size="LETTER" style={s.page} wrap>
        {/* Header */}
        <View style={s.header}>
          <View style={s.brandRow}>
            <Text style={s.logo}>R</Text>
            <View>
              <Text style={s.brandName}>RoofIQ</Text>
              <Text style={s.brandTag}>Aerial measurement · transparent pricing</Text>
            </View>
          </View>
          <View style={s.metaCol}>
            <Text>Quote #{quote.quote_id}</Text>
            <Text>Date: {today}</Text>
            <Text>Valid through: {validUntil}</Text>
          </View>
        </View>

        <Text style={s.title}>Roof Replacement Estimate</Text>

        {/* Customer / property */}
        <View style={s.customerBlock}>
          <Text style={s.label}>Property</Text>
          <Text style={s.property}>{m.formatted_address}</Text>
        </View>

        <View style={s.propGrid}>
          {propRow("Roof area", `${m.total_sqft.toLocaleString()} sqft`)}
          {propRow("Pitch", m.pitch.label)}
          {propRow("Material", tier.shingle_product)}
          {propRow("Warranty", tier.warranty)}
          {propRow("Wind rating", `${tier.wind_rating_mph} mph`)}
          {propRow("Tear-off", m.layers === 2 ? "Two layers" : "Single layer")}
        </View>

        {/* Scope */}
        <Text style={s.sectionTitle}>Scope of work</Text>
        <Text style={s.scopePara}>
          Complete tear-off of existing roofing material with full deck inspection. Install {tier.shingle_product} field shingles, matched starter strip, and hip & ridge cap shingles; new synthetic underlayment over the entire deck and ice & water shield at all eaves and valleys. New aluminum drip edge along eaves and rakes, W-valley metal in all valleys, and step + counter flashing at sidewalls and chimneys. New pipe boots on all plumbing vents and a continuous ridge vent. Permits, inspections, dumpster, site protection, daily cleanup, and a final magnetic sweep are included.
        </Text>

        {/* Totals (always on page 1) */}
        <View style={s.totals}>
          <View style={s.totalRow}><Text>Materials</Text><Text>{fmtMoney(matsTotal)}</Text></View>
          <View style={s.totalRow}><Text>Labor</Text><Text>{fmtMoney(laborTotal)}</Text></View>
          <View style={s.totalRow}><Text>Disposal & permit</Text><Text>{fmtMoney(tier.dumpster + tier.permit)}</Text></View>
          <View style={s.grand}><Text>Total</Text><Text>{fmtMoney(tier.total)}</Text></View>
        </View>

        {/* Incentives. Compact: label + description + math (italic
            inline) + action step are intentionally stacked tight so a
            single regional incentive doesn't push terms+signatures to
            page 2. wrap={false} kept so a single block stays intact;
            if multiple blocks total too tall, later blocks naturally
            push to the next page rather than splitting mid-block. */}
        {tier.incentives && tier.incentives.length > 0 && (
          <View>
            <Text style={s.sectionTitle}>Insurance & rebate notes</Text>
            {tier.incentives.map((inc) => (
              <View key={inc.id} style={s.incentiveBlock} wrap={false}>
                <Text style={s.incentiveLabel}>{inc.label}</Text>
                <Text style={s.incentiveBody}>
                  {inc.description_for_customer}{" "}
                  <Text style={{ fontStyle: "italic", color: C.ink600 }}>
                    ({inc.savings_math_template})
                  </Text>
                </Text>
                <Text style={s.incentiveBody}>
                  <Text style={{ fontFamily: "Helvetica-Bold" }}>Next step: </Text>
                  {inc.action_step}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Terms (placed before signature lines so they read as the small-print) */}
        <Text style={s.sectionTitle}>Terms</Text>
        <Text style={s.termsPara}>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>Validity: </Text>30 days from date above.{"  "}
          <Text style={{ fontFamily: "Helvetica-Bold" }}>Warranty: </Text>manufacturer warranty per product spec ({tier.warranty}); 5-year workmanship warranty from completion.{"  "}
          <Text style={{ fontFamily: "Helvetica-Bold" }}>Payment: </Text>30% deposit at signing, 40% on tear-off, 30% on completion. Insurance jobs may follow ACV/RCV release schedule.{"  "}
          <Text style={{ fontFamily: "Helvetica-Bold" }}>Scope changes: </Text>decking replacement or hidden damage discovered during tear-off will be quoted as change orders before work proceeds.
        </Text>

        {/* Signatures */}
        <View style={s.signRow}>
          <Text style={s.signCell}>Customer signature</Text>
          <Text style={s.signCell}>Date</Text>
        </View>
        <View style={s.signRow}>
          <Text style={s.signCell}>Contractor representative</Text>
          <Text style={s.signCell}>Date</Text>
        </View>

        <Text
          style={s.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `RoofIQ · Quote #${quote.quote_id} · Page ${pageNumber} of ${totalPages} · Thank you for considering our quote.`
          }
        />
      </Page>

      {/* Detailed mode — itemized tables on page 2 (may wrap to page 3+) */}
      {showTables && (
        <Page size="LETTER" style={s.page} wrap>
          <View style={s.header}>
            <View style={s.brandRow}>
              <Text style={s.logo}>R</Text>
              <View>
                <Text style={s.brandName}>RoofIQ</Text>
                <Text style={s.brandTag}>Itemized scope · Quote #{quote.quote_id}</Text>
              </View>
            </View>
            <View style={s.metaCol}>
              <Text>{m.formatted_address}</Text>
              <Text>{tier.name}</Text>
            </View>
          </View>

          <View style={s.tablesWrap}>
            <Text style={s.sectionTitle}>Materials</Text>
            <View style={s.tableHeader}>
              <Text style={s.thItem}>Item</Text>
              <Text style={s.thRight}>Qty</Text>
              <Text style={s.thRight}>Rate</Text>
              <Text style={s.thRight}>Amount</Text>
            </View>
            {tier.materials.map((li, i) => (
              <View style={s.tableRow} key={`m${i}`} wrap={false}>
                <Text style={s.tdItem}>{li.description}</Text>
                <Text style={s.tdRight}>{li.qty} {li.unit}</Text>
                <Text style={s.tdRight}>${(li.unit_cost * uplift).toFixed(2)}</Text>
                <Text style={s.tdRight}>${(li.subtotal * uplift).toFixed(2)}</Text>
              </View>
            ))}
            <View style={s.subtotalRow}>
              <Text style={s.subtotalSpacer}>Materials</Text>
              <Text style={s.subtotalAmt}>{fmtMoney(matsTotal)}</Text>
            </View>
          </View>

          <View style={s.tablesWrap}>
            <Text style={s.sectionTitle}>Labor</Text>
            <View style={s.tableHeader}>
              <Text style={s.thItem}>Item</Text>
              <Text style={s.thRight}>Qty</Text>
              <Text style={s.thRight}>Rate</Text>
              <Text style={s.thRight}>Amount</Text>
            </View>
            {tier.labor.map((li, i) => (
              <View style={s.tableRow} key={`l${i}`} wrap={false}>
                <Text style={s.tdItem}>{li.description}</Text>
                <Text style={s.tdRight}>{li.qty} {li.unit}</Text>
                <Text style={s.tdRight}>${(li.unit_cost * uplift).toFixed(2)}</Text>
                <Text style={s.tdRight}>${(li.subtotal * uplift).toFixed(2)}</Text>
              </View>
            ))}
            <View style={s.subtotalRow}>
              <Text style={s.subtotalSpacer}>Labor</Text>
              <Text style={s.subtotalAmt}>{fmtMoney(laborTotal)}</Text>
            </View>
          </View>

          <Text
            style={s.footer}
            fixed
            render={({ pageNumber, totalPages }) =>
              `RoofIQ · Quote #${quote.quote_id} · Page ${pageNumber} of ${totalPages}`
            }
          />
        </Page>
      )}
    </Document>
  );
}
