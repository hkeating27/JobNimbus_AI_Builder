"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { updateScrollScrubbedSwoosh, stopScrollScrubbedSwoosh } from "@/lib/audio";

// useLayoutEffect runs synchronously after DOM mutation but BEFORE the
// browser paints — so initial-mount layout work is reflected in the
// first paint. On the server (SSR) it's not available, so we fall back
// to useEffect to silence Next's warning.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Scroll-driven parallax zoom on the satellite image.
//
// The image is fetched at zoom 19 (one notch wider than zoom 20) so
// the starting frame shows street-level context — neighbors visible,
// road frontage, lot. As the user scrolls down, the parallax scales
// from 1.0 → 2.0 (clipping into close-on-the-building detail).
//
// Curve: HALF-BELL ON ENTRY, PLATEAU AT PEAK.
//   - Image entering from below the viewport → ramps from 1.0 to peak
//     via a quadratic ease.
//   - Image center reaches viewport center → fully zoomed in.
//   - Image continues past viewport center toward the top → STAYS at
//     full zoom (no decay). Once you've arrived, you've arrived.
//
// Audio: the whoosh fires the FIRST time the parallax engages
// (progress > 3%). The "drone arriving" beat lines up with the ramp.

const MIN_SCALE = 1.0;
const MAX_SCALE = 2.7;  // tight crop on the building at peak

export default function ParallaxSatellite({
  imageUrl,
  alt = "Satellite view",
  aspectRatio = "1 / 1",
}: {
  imageUrl: string;
  alt?: string;
  // CSS aspect-ratio string. Default 1:1 because Google's static
  // satellite tiles are always square. For user-uploaded photos pass
  // the actual aspect (e.g. `${width} / ${height}`) so the container
  // reserves the right space at first paint and there's no reflow
  // when the image decodes.
  aspectRatio?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(MIN_SCALE);
  // Click-to-focus: contractor clicks anywhere on the image to set
  // the zoom-in target. transformOrigin in CSS uses the same
  // percentage point so the parallax zooms toward THAT point instead
  // of the geometric center. Defaults to center; a small dot marks
  // the chosen focus when not centered.
  const [focusPct, setFocusPct] = useState<{ x: number; y: number }>({ x: 50, y: 50 });
  const hasCustomFocus = focusPct.x !== 50 || focusPct.y !== 50;
  // Whether a scroll event has fired since this component mounted. The
  // scrubbed swoosh only updates after the first real scroll, so the
  // initial mount-time compute() doesn't kick off audio at t > 0.
  const hasScrolledRef = useRef(false);

  function onContainerClick(e: React.MouseEvent<HTMLDivElement>) {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setFocusPct({
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, y)),
    });
  }

  // The "initial-scroll jump" was caused by two compounding layout
  // shifts that happen AFTER mount but BEFORE the user's first scroll:
  //
  // 1) The MeasurementCard parent has `.fade-up` — a 400ms
  //    `translateY(8px) → 0` animation. During those 400ms,
  //    `getBoundingClientRect()` returns a position 0–8px lower than
  //    its settled position, so the mount-time compute() sets a scale
  //    based on a transient layout. Once the animation lands, no
  //    recompute runs (no scroll, no size change), so scale stays
  //    wrong until the user scrolls — at which point compute() fires
  //    with the new rect and scale snaps.
  //
  // 2) The satellite <img> uses h-auto. Until it loads, height = 0
  //    and the container is short. When the image loads, height jumps
  //    to its natural size and the container reflows.
  //
  // Fix (belt-and-suspenders):
  //   • Reserve image space up-front via aspect-ratio (kills #2 outright)
  //   • ResizeObserver re-runs compute() on any container size change
  //     (catches anything else)
  //   • Image onLoad handler also re-runs compute() (redundant safety)
  //   • A short cascade of timed recomputes covers the fade-up animation
  //     window (catches #1)
  useIsoLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let rafId = 0;

    function compute() {
      rafId = 0;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      // viewportPosition: where the element center sits relative to the
      // viewport. 0 = element center at top of viewport. 0.5 = at
      // viewport center. 1 = at viewport bottom (image just appearing).
      const elementCenter = rect.top + rect.height / 2;
      const viewportPosition = Math.max(0, Math.min(1, elementCenter / vh));

      // Half-bell on entry, plateau at peak.
      let t: number;
      if (viewportPosition >= 0.5) {
        const distance = (viewportPosition - 0.5) * 2;  // 0 at center, 1 at viewport bottom
        t = Math.max(0, 1 - distance * distance);
      } else {
        t = 1;
      }

      setScale(MIN_SCALE + t * (MAX_SCALE - MIN_SCALE));

      // Audio gated on real scroll (not mount/reflow recomputes).
      if (hasScrolledRef.current) {
        updateScrollScrubbedSwoosh(t);
      }
    }

    function scheduleCompute() {
      if (rafId) return;
      rafId = requestAnimationFrame(compute);
    }

    function onScroll() {
      hasScrolledRef.current = true;
      scheduleCompute();
    }

    // ResizeObserver: catches container reflow from image load,
    // viewport resize, or any other layout shift we didn't anticipate.
    const ro = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => scheduleCompute())
      : null;
    if (ro) ro.observe(el);

    compute();

    // Catch the fade-up animation settling (parent translates 8px over
    // 400ms). Several samples across the animation window means we
    // converge on the correct scale even if the user hasn't scrolled.
    const settleTimers = [60, 200, 450, 700].map((ms) =>
      setTimeout(scheduleCompute, ms)
    );

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", scheduleCompute, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", scheduleCompute);
      if (rafId) cancelAnimationFrame(rafId);
      settleTimers.forEach(clearTimeout);
      if (ro) ro.disconnect();
      stopScrollScrubbedSwoosh();
    };
  }, []);

  // Image-onLoad recompute: redundant with the ResizeObserver but
  // belt-and-suspenders.
  function handleImageLoad() {
    const el = containerRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const elementCenter = rect.top + rect.height / 2;
      const viewportPosition = Math.max(0, Math.min(1, elementCenter / vh));
      let t: number;
      if (viewportPosition >= 0.5) {
        const distance = (viewportPosition - 0.5) * 2;
        t = Math.max(0, 1 - distance * distance);
      } else {
        t = 1;
      }
      setScale(MIN_SCALE + t * (MAX_SCALE - MIN_SCALE));
    });
  }

  return (
    <div
      ref={containerRef}
      onClick={onContainerClick}
      className="relative rounded-xl overflow-hidden border border-ink-100 bg-ink-100 cursor-zoom-in"
      title="Click to set the parallax zoom focus point"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt={alt}
        className="block w-full select-none"
        draggable={false}
        onLoad={handleImageLoad}
        style={{
          // aspectRatio reserves the final image space *before* the
          // image loads, so there's no container reflow when the
          // tile arrives. Default 1:1 for square Google satellite
          // tiles; user-photo paths pass the photo's actual ratio.
          aspectRatio,
          width: "100%",
          height: "auto",
          // No CSS transition: the rAF-driven scroll handler updates
          // `scale` every frame already (smooth on its own), and adding
          // a 90ms transition on top means the very first scale change
          // animates from MIN_SCALE *to* the new value over 90ms —
          // that's the slight jump on entry. Without the transition,
          // scale tracks scroll position 1:1 and there is nothing to lag.
          transform: `scale(${scale.toFixed(3)})`,
          // transformOrigin tracks the contractor's click — defaults to
          // center but can be moved to any point on the image. CSS
          // converts percentages to pixel offsets relative to the
          // element box, which is exactly what we want.
          transformOrigin: `${focusPct.x.toFixed(1)}% ${focusPct.y.toFixed(1)}%`,
          willChange: "transform",
        }}
      />
      {/* Focus-point marker. Only shown when the user has explicitly
          set a non-center focus, so the default behavior stays clean.
          The marker tracks the same focusPct used for transformOrigin
          so it sits exactly where the zoom is anchored. */}
      {hasCustomFocus && (
        <div
          className="pointer-events-none absolute size-3 rounded-full bg-brand-500 ring-2 ring-white shadow-soft -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${focusPct.x}%`, top: `${focusPct.y}%` }}
          aria-label="Parallax zoom focus point"
        />
      )}
      {hasCustomFocus && (
        <button
          onClick={(e) => { e.stopPropagation(); setFocusPct({ x: 50, y: 50 }); }}
          className="absolute bottom-2 right-2 px-2.5 py-1 text-xs rounded-full bg-white/90 backdrop-blur-sm border border-ink-100 text-ink-700 hover:text-ink-900 hover:bg-white shadow-soft"
        >
          Reset focus
        </button>
      )}
    </div>
  );
}
