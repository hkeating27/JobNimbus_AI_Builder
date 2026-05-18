"use client";

import { useEffect, useRef, useState } from "react";
import type { Quote } from "@/lib/types";

type Msg = { role: "user" | "assistant"; content: string };

// Suggestion chips for the CONTRACTOR using this tool. They're about to
// pitch the job to a homeowner — these chips probe sales strategy,
// pricing health, and talking points the contractor needs.
function suggestionsFor(quote: Quote): string[] {
  const m = quote.measurement;
  const recommendedTier = quote.tiers.find((t) => t.key === quote.recommended_tier_key);
  const better = quote.tiers.find((t) => t.key === "better");
  const best = quote.tiers.find((t) => t.key === "best");
  const out: string[] = [];

  // Always: anomalies / risks the contractor should eyeball first.
  if (m.confidence === "low") {
    out.push("Anything sketchy I should double-check on this property?");
  } else if (m.ensemble?.flag === "moderate_disagreement") {
    out.push("How tight is this measurement — should I site-verify?");
  } else {
    out.push("Anything unusual about this property's measurements?");
  }

  // The opener already delivers the headline incentive talking point
  // when one applies. The chip drills DEEPER — paperwork, carriers,
  // process — rather than re-asking for what was just delivered.
  const hasIncentives = recommendedTier?.incentives && recommendedTier.incentives.length > 0;
  if (hasIncentives) {
    out.push("What paperwork does the homeowner need for the discount?");
  } else {
    out.push("What's my strongest talking point on this quote?");
  }

  // Upsell pitch — only relevant when there's a clear upsell.
  if (best && better && best.total - better.total > 1000) {
    const upsellAmt = best.total - better.total;
    out.push(`How do I justify the $${upsellAmt.toLocaleString()} jump from Better to Best?`);
  } else {
    out.push("Where should I push for upsell vs. hold the line?");
  }

  // Margin posture — contractor question, not homeowner.
  out.push("Is the margin healthy on the recommended tier?");

  return out;
}

export default function AgentChat({ quote }: { quote: Quote }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // "Stuck to bottom" means new content auto-scrolls into view; when
  // the user scrolls up to read mid-stream, we flip this off and stop
  // yanking them back. They re-engage by scrolling back near the
  // bottom themselves.
  const stickToBottomRef = useRef(true);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // 80px threshold lets the user nudge a hair off the bottom without
    // breaking auto-scroll, but any deliberate upward scroll wins.
    stickToBottomRef.current = distanceFromBottom < 80;
  }

  // Kick off with an opening message from the agent.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Contractor-facing opener: quick read on the property + the
      // pricing posture + (when applicable) the insurance-discount
      // talking point with specific numbers, all unprompted.
      const opener = `Give me a quick opening read on this property — what's noteworthy about the measurements, the recommended tier, and the angle to use with the homeowner. If an insurance or utility incentive applies to the recommended tier, INCLUDE the specific savings math (typical premium, discount %, payback in years) as part of this opener — don't wait for me to ask.`;
      setMessages([{ role: "assistant", content: "" }]);
      await stream(opener, [], (chunk) => {
        if (cancelled) return;
        setMessages((cur) => {
          const last = cur[cur.length - 1];
          const updated = { ...last, content: last.content + chunk };
          return [...cur.slice(0, -1), updated];
        });
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote.quote_id]);

  useEffect(() => {
    // Only follow new content into view if the user is already near
    // the bottom. If they've scrolled up to read, leave them alone —
    // fighting the user mid-read is the actual bad behavior here.
    if (!stickToBottomRef.current) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    if (!text.trim() || streaming) return;
    const userMsg: Msg = { role: "user", content: text.trim() };
    const next = [...messages, userMsg, { role: "assistant" as const, content: "" }];
    setMessages(next);
    setInput("");
    setStreaming(true);
    await stream(text, messages, (chunk) => {
      setMessages((cur) => {
        const last = cur[cur.length - 1];
        const updated = { ...last, content: last.content + chunk };
        return [...cur.slice(0, -1), updated];
      });
    });
    setStreaming(false);
  }

  async function stream(user_message: string, history: Msg[], onChunk: (s: string) => void) {
    setStreaming(true);
    try {
      const r = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote, history, user_message }),
      });
      if (!r.body) return;
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) onChunk(decoder.decode(value, { stream: true }));
      }
    } catch (e) {
      onChunk(`\n\n[stream error: ${(e as Error).message}]`);
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="card p-5 flex flex-col h-[560px] fade-up">
      <div className="flex items-center gap-3 pb-4 border-b border-ink-100">
        <div className="size-9 rounded-full bg-brand-500 grid place-items-center text-white font-semibold">A</div>
        <div>
          <div className="font-medium text-ink-900">Agent</div>
          <div className="text-xs text-ink-500">{streaming ? "thinking…" : "ready"}</div>
        </div>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto py-4 space-y-3 pr-1">
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} content={m.content} />
        ))}
      </div>

      {messages.length <= 2 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {suggestionsFor(quote).map((s) => (
            <button key={s} onClick={() => send(s)} disabled={streaming} className="text-xs px-2.5 py-1 rounded-full border border-ink-100 text-ink-700 hover:border-brand-500 hover:text-brand-700 transition disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          className="flex-1 rounded-xl bg-ink-100/40 px-4 py-3 outline-none focus:bg-white focus:ring-2 focus:ring-brand-500/30"
          placeholder="Ask about any line item…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(input); }}
          disabled={streaming}
        />
        <button className="btn-primary py-3 px-4" onClick={() => send(input)} disabled={streaming || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}

function Bubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="rounded-2xl bg-brand-500 text-white px-4 py-2.5 max-w-[80%] text-sm">{content}</div>
      </div>
    );
  }
  return (
    <div className="flex">
      <div className="rounded-2xl bg-ink-100/40 text-ink-900 px-4 py-2.5 max-w-[85%] text-sm">
        {content
          ? <MarkdownLite text={content} />
          : <span className="text-ink-300">…</span>}
      </div>
    </div>
  );
}

// Tiny inline markdown renderer. The agent's natural output uses
// ## headings, **bold**, and - bullet lists; we render those rather
// than showing raw asterisks. Streaming-friendly: callers re-render
// the full string every chunk and this just re-parses (millisecond
// cost on a typical 500-char response).
//
// Intentionally NOT using react-markdown — would add ~30 KB of deps
// for a feature we control end-to-end (the system prompt restricts
// what shapes of markdown the agent emits).
function MarkdownLite({ text }: { text: string }) {
  // Split into blocks by blank line. Each block becomes a paragraph,
  // heading, or list depending on its prefix.
  const blocks = text.split(/\n\n+/);
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        const trimmed = block.trim();
        if (trimmed.startsWith("### ")) {
          return <h4 key={i} className="font-medium text-ink-900 mt-1 first:mt-0">{renderInline(trimmed.slice(4))}</h4>;
        }
        if (trimmed.startsWith("## ")) {
          return <h3 key={i} className="font-display text-[15px] font-semibold text-ink-900 mt-1 first:mt-0">{renderInline(trimmed.slice(3))}</h3>;
        }
        // Bullet list: every line starts with - or *
        const lines = trimmed.split(/\n/);
        if (lines.length > 0 && lines.every((l) => /^[-*]\s/.test(l))) {
          return (
            <ul key={i} className="list-disc pl-4 space-y-0.5">
              {lines.map((line, j) => (
                <li key={j}>{renderInline(line.replace(/^[-*]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        // Paragraph. Preserve single-line breaks within the block by
        // splitting on \n and inserting <br />.
        const parts = trimmed.split(/\n/);
        return (
          <p key={i} className="leading-snug">
            {parts.map((p, j) => (
              <span key={j}>
                {renderInline(p)}
                {j < parts.length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

// Inline span: handles **bold** and `code`. Anything else passes
// through as plain text.
function renderInline(s: string): React.ReactNode {
  // Single regex captures **bold** OR `code` so we tokenize once.
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong>;
    }
    if (p.startsWith("`") && p.endsWith("`")) {
      return <code key={i} className="font-mono text-[12px] bg-ink-100/60 px-1 rounded">{p.slice(1, -1)}</code>;
    }
    return <span key={i}>{p}</span>;
  });
}
