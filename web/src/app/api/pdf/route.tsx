// Server-side PDF rendering route.
//
// Client POSTs { quote, tier, mode }; server runs @react-pdf/renderer
// in Node and streams back a real vector PDF. Keeps client bundle
// small (~800 KB of react-pdf stays on the server).
import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePDF } from "@/components/pdf/InvoicePDF";
import type { Quote, QuoteTier } from "@/lib/types";
import type { InvoiceMode } from "@/components/PrintableInvoice";

// react-pdf depends on Node APIs (Buffer, fs); force the Node runtime
// rather than the default edge runtime in App Router.
export const runtime = "nodejs";

type Body = {
  quote: Quote;
  tier: QuoteTier;
  mode: InvoiceMode;
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body?.quote || !body?.tier || !body?.mode) {
    return NextResponse.json({ error: "Missing quote, tier, or mode" }, { status: 400 });
  }

  try {
    const buf = await renderToBuffer(
      <InvoicePDF quote={body.quote} tier={body.tier} mode={body.mode} />
    );
    const filename = `roofiq-${body.quote.quote_id}-${body.tier.key}-${body.mode}.pdf`;
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[/api/pdf] render failed:", err);
    return NextResponse.json(
      { error: "PDF render failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
