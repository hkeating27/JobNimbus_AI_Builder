// Isolated test harness for ParallaxSatellite. Mirrors the real
// MeasurementCard layout (card + fade-up parent, ParallaxSatellite
// inside) so the playwright test exercises the same animation +
// reflow paths as the live results page. Lots of vertical filler so
// scroll has somewhere to go.
//
// Loaded at /test/parallax (gated to dev/preview only would be ideal,
// but it's harmless in prod — no API calls, no secrets).
import ParallaxSatellite from "@/components/ParallaxSatellite";

const SAMPLE_IMAGE =
  "https://maps.gstatic.com/tactile/basepage/pegman_sherlock.png";
// Use a known external square-ish image that doesn't require API
// keys. The fix is image-shape-agnostic — the test asserts smooth
// scale progression regardless of source.

export default function ParallaxTestPage() {
  return (
    <main className="min-h-[300vh] p-6">
      {/* Short pre-filler so the parallax is partly in viewport at
          scrollY=0 (mid-entry zone). This is the regime where the
          first-scroll jump would manifest if the bug were present —
          mount-time compute() runs against transient layout, then
          first scroll snaps. With h-screen filler the image sits
          below viewport at mount and scale=1.0 either way, so the
          test doesn't actually exercise the bug surface. */}
      <div className="h-32" />
      <div className="card p-6 fade-up max-w-3xl mx-auto">
        <h1 className="font-display text-xl mb-4">Parallax test fixture</h1>
        <ParallaxSatellite imageUrl={SAMPLE_IMAGE} />
      </div>
      <div className="h-screen" />
    </main>
  );
}
