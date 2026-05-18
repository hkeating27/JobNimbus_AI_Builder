import Anthropic from "@anthropic-ai/sdk";
import type { Quote } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lazy client init for consistency with vision.ts; safer if this module
// ever gets imported by a script outside the Next.js runtime.
let clientCache: Anthropic | null = null;
function getClient(): Anthropic {
  if (!clientCache) clientCache = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return clientCache;
}

const SYSTEM = `You are a sales + estimating co-pilot embedded in a contractor's roofing-quote tool. The user is a ROOFING CONTRACTOR (estimator, sales rep, owner) who just generated a quote for a property. They will use the quote to bid the job to a homeowner. They are NOT the homeowner. The PDF artifact in the app is what they send to the homeowner; this chat is their internal tool.

Your role:
- Help them think through the property, the price, and the conversation they're about to have.
- Surface pricing strategy: is the margin healthy, is the upsell defensible, what's the strongest talking point?
- Flag anomalies (low confidence, suspect Solar reading, unusual segment count) that they should eyeball before committing.
- Give them specific, ready-to-use talking points for when the homeowner asks a question — including the dollar amounts and the "why".
- Surface applicable insurance / utility incentives so they can use them in the sales conversation. When an incentive applies, give them the SPECIFIC savings math the homeowner will care about (typical premium, typical wind/hail share, typical discount %, payback in years).

Personality:
- Plainspoken, contractor-to-contractor. You can be a little salty about Solar misreads or marginal upsells.
- Use roofer-conventional terminology: "planes" or "faces" for the distinct roof surfaces (NOT "segments" — that's aerial-measurement-data jargon). "Hips", "ridges", "valleys", "rakes", "eaves" for edges. "Pitch" in rise:12 form.
- Lead with the most impactful thing for THIS quote.
- Cite specific numbers. Don't round to the nearest thousand.
- If a code requirement drove a material choice (FL HVHZ → ring-shank, CO hail belt → Class 4), tell them so they can use it in the pitch.

Format:
- First response: 4–7 sentences. What this property is, what's interesting about the price, what their best move is, AND if an insurance / utility incentive applies to the recommended tier — surface the talking point with the specific savings math in the opener. Don't wait for the contractor to ask. The incentive is often the strongest reason to upgrade and the contractor needs it ready before they pick up the phone.
- After: prose answers, brief, action-oriented. Use bullet lists only when comparing options.
- Avoid homeowner-speak. The user is a pro.`;

export async function POST(req: Request) {
  const body = (await req.json()) as {
    quote: Quote;
    history: Array<{ role: "user" | "assistant"; content: string }>;
    user_message: string;
  };

  const ctx = quoteContext(body.quote);
  const messages: Anthropic.Messages.MessageParam[] = [
    ...body.history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: body.user_message },
  ];

  const stream = await getClient().messages.stream({
    model: "claude-opus-4-7",
    max_tokens: 1024,
    system: `${SYSTEM}\n\n--- QUOTE CONTEXT ---\n${ctx}`,
    messages,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      for await (const evt of stream) {
        if (evt.type === "content_block_delta" && evt.delta.type === "text_delta") {
          controller.enqueue(encoder.encode(evt.delta.text));
        }
      }
      controller.close();
    },
  });

  return new Response(readable, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" } });
}

function quoteContext(q: Quote): string {
  const m = q.measurement;
  const tiers = q.tiers
    .map((t) => `  ${t.name}: total $${t.total.toLocaleString()} ($${t.per_sqft}/sqft), warranty ${t.warranty}, wind ${t.wind_rating_mph} mph`)
    .join("\n");

  // Insurance / utility incentives that apply to the tiers the customer
  // is looking at. Format with both contractor-side context AND specific
  // savings math so the agent can quote real numbers.
  const incentiveLines: string[] = [];
  for (const t of q.tiers) {
    if (!t.incentives || t.incentives.length === 0) continue;
    for (const inc of t.incentives) {
      incentiveLines.push(`  [${t.key.toUpperCase()} tier] ${inc.label}: ${inc.description_for_contractor}`);
      incentiveLines.push(`    Savings math: ${inc.savings_math_template}`);
      incentiveLines.push(`    Action: ${inc.action_step}`);
    }
  }
  const incentiveBlock = incentiveLines.length > 0
    ? `\nApplicable insurance / utility incentives (raise these naturally when relevant):\n${incentiveLines.join("\n")}`
    : "";

  return [
    `Address: ${m.formatted_address}`,
    `Roof: ${m.total_sqft.toLocaleString()} sqft total · ${m.pitch.label} pitch (${m.pitch.degrees}°) · ${m.complexity.replaceAll("_", " ")} · ${m.segments} planes`,
    `Line items: ridge ${m.line_items.ridge_lf} lf · hip ${m.line_items.hip_lf} lf · valley ${m.line_items.valley_lf} lf · rake ${m.line_items.rake_lf} lf · eave ${m.line_items.eave_lf} lf`,
    `Pipe boots: ${m.pipe_boots_count} · Layers: ${m.layers}`,
    `Confidence: ${m.confidence} · Sources: ${m.data_sources.join(", ")}`,
    `Pricing zone: ${q.zone_label} (labor ×${q.labor_multiplier}, material ×${q.material_multiplier}, margin ${(q.target_gross_margin * 100).toFixed(0)}%)`,
    `Recommended tier: ${q.recommended_tier_key.toUpperCase()}`,
    `Tier totals:\n${tiers}` + incentiveBlock,
  ].join("\n");
}
