"use client";

import { useEffect, useRef, useState } from "react";
import type { ClassifiedEdge, EdgeType } from "@/lib/types";
import { playEdgeTick } from "@/lib/audio";

const COLORS: Record<EdgeType, string> = {
  ridge:  "#1f6feb",  // blue   — horizontal peak
  hip:    "#a855f7",  // purple — angled-down from ridge
  valley: "#dc2626",  // red    — inward intersection (drains water)
  rake:   "#f59e0b",  // amber  — gable end slope
  eave:   "#10b981",  // emerald— horizontal lower edge
};

const ORDER: EdgeType[] = ["ridge", "hip", "valley", "rake", "eave"];

// Slower, more deliberate timing: each line draws over 700ms and the
// gap between lines is 280ms. Total animation for a 12-edge roof ≈ 4.5s
// — paced to feel meditative rather than rushed.
const DRAW_MS = 700;
const STAGGER_MS = 280;

export default function RoofEdgeOverlay({
  imageUrl,
  edges,
  preciseOutline,
  imageSizePx = 800,
}: {
  imageUrl: string;
  edges: ClassifiedEdge[];
  // Precise building outline from Solar dataLayers raster mask, in
  // normalized [0..1] coords. When present, this is the truthful
  // spatial geometry — much more accurate than vision's pixel guesses.
  preciseOutline?: Array<[number, number]>;
  imageSizePx?: number;
}) {
  const [drawnIndices, setDrawnIndices] = useState<Set<number>>(new Set());
  const [hasStarted, setHasStarted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // IntersectionObserver: only kick off the animation when the overlay is
  // genuinely visible to the user. Without this, the user can miss the
  // entire animation if they scrolled past while the page was loading.
  useEffect(() => {
    if (hasStarted) return;
    const el = containerRef.current;
    if (!el) return;

    if (typeof IntersectionObserver === "undefined") {
      // Browsers without IO: just start.
      setHasStarted(true);
      return;
    }

    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        // Only fire when at least 40% of the overlay is on screen — gives
        // the user a clear chance to see it without firing on the
        // first 1px of intersection.
        if (entry.intersectionRatio >= 0.4) {
          setHasStarted(true);
          io.disconnect();
          return;
        }
      }
    }, { threshold: [0, 0.4, 0.7] });
    io.observe(el);
    return () => io.disconnect();
  }, [hasStarted]);

  // Draw edges in a deliberate order (skeleton → bottom). Stops the
  // viewer's eye from skipping; matches how a roofer reads a roof.
  const ordered = [...edges]
    .map((e, originalIdx) => ({ e, originalIdx }))
    .sort((a, b) => ORDER.indexOf(a.e.type) - ORDER.indexOf(b.e.type));

  useEffect(() => {
    if (!hasStarted || ordered.length === 0) return;
    setDrawnIndices(new Set());
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const drawn = new Set<number>();
    ordered.forEach(({ originalIdx, e }, i) => {
      timeouts.push(setTimeout(() => {
        drawn.add(originalIdx);
        setDrawnIndices(new Set(drawn));
        playEdgeTick(e.type);
      }, 200 + i * STAGGER_MS));
    });
    return () => { timeouts.forEach(clearTimeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasStarted, edges]);

  return (
    <div ref={containerRef} className="relative overflow-hidden rounded-xl border border-ink-100 bg-ink-100">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt="Satellite view" className="block w-full h-auto" />
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox={`0 0 ${imageSizePx} ${imageSizePx}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Precise building outline from Solar dataLayers raster mask.
            This is real spatial geometry — drawn first as a fill +
            crisp stroke so the user sees the actual roof boundary. */}
        {preciseOutline && preciseOutline.length >= 3 && hasStarted && (
          <polygon
            points={preciseOutline.map(([x, y]) => `${x * imageSizePx},${y * imageSizePx}`).join(" ")}
            fill="rgba(31, 111, 235, 0.10)"
            stroke="rgba(31, 111, 235, 0.85)"
            strokeWidth={3.5}
            strokeLinejoin="round"
            style={{
              opacity: 1,
              transition: "opacity 600ms ease-out",
            }}
          />
        )}

        {/* Vision-classified inner edges (ridge / hip / valley / rake / eave).
            These are still approximate annotations placed by Claude vision —
            the precise polygon above is the authoritative spatial source. */}
        {edges.map((e, i) => {
          if (!e.pixels) return null;
          const drawn = drawnIndices.has(i);
          const dx = e.pixels.to[0] - e.pixels.from[0];
          const dy = e.pixels.to[1] - e.pixels.from[1];
          const len = Math.hypot(dx, dy);
          return (
            <line
              key={`line-${i}`}
              x1={e.pixels.from[0]} y1={e.pixels.from[1]}
              x2={e.pixels.to[0]}   y2={e.pixels.to[1]}
              stroke={COLORS[e.type]}
              strokeWidth={3}
              strokeLinecap="round"
              strokeOpacity={0.65}
              strokeDasharray={`6 5 ${len > 30 ? len - 11 : 0}`}
              strokeDashoffset={drawn ? 0 : len}
              style={{ transition: `stroke-dashoffset ${DRAW_MS}ms ease-out, stroke-opacity ${DRAW_MS}ms ease-out` }}
            />
          );
        })}
      </svg>
      <Legend hasPrecise={!!preciseOutline && preciseOutline.length >= 3} />
    </div>
  );
}

function Legend({ hasPrecise }: { hasPrecise: boolean }) {
  return (
    <div className="absolute bottom-2 left-2 right-2 flex items-end gap-2 flex-wrap">
      <div className="bg-white/95 backdrop-blur rounded-lg shadow-soft px-2.5 py-1.5 text-[11px] flex items-center gap-3 flex-wrap">
        {hasPrecise && (
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-1.5 rounded-sm border border-brand-500" style={{ background: "rgba(31, 111, 235, 0.10)" }} />
            <span className="font-medium text-ink-700">Roof outline</span>
          </span>
        )}
        {ORDER.map((t) => (
          <span key={t} className="flex items-center gap-1.5">
            <span className="w-3 h-1 rounded-full" style={{ background: COLORS[t] }} />
            <span className="font-medium text-ink-700 capitalize">{t}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
