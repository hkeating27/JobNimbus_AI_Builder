// Autonomous verification that ParallaxSatellite has no "initial-
// scroll jump." Run against a running dev server at :3000.
//
// Test method:
//   1. Navigate to /test/parallax (a fixture that mounts
//      ParallaxSatellite inside the same .fade-up wrapper as the
//      production MeasurementCard).
//   2. Wait long enough for: image load + fade-up animation (400ms)
//      + all of our settle-timer cascade (longest is 700ms).
//   3. Capture the img's transform scale at scrollY=0 (BASELINE).
//   4. Scroll +5px (a tiny scroll). Wait one frame.
//   5. Capture scale (FIRST_SCROLL_SAMPLE).
//   6. Assert |FIRST_SCROLL_SAMPLE - BASELINE| < 0.03.
//
// If the bug were still present, BASELINE would be wrong (set during
// the fade-up animation against a transient layout), and the first
// scroll would snap scale toward the post-settle value — a large
// delta. With the fix, BASELINE already matches the post-settle
// value, so a 5px scroll produces a 5px-worth-of-delta scale change
// (essentially zero).
//
// Also captures a swept curve of (scrollY, scale) pairs to verify
// there's no discontinuity anywhere in the animation, just for
// completeness.

import { chromium } from "playwright";

const URL = "http://localhost:3000/test/parallax";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getScale(page) {
  return page.evaluate(() => {
    const img = document.querySelector("main img");
    if (!img) return null;
    const m = (img.style.transform || "").match(/scale\(([\d.]+)\)/);
    return m ? parseFloat(m[1]) : null;
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  console.log(`navigating to ${URL}`);
  await page.goto(URL, { waitUntil: "networkidle" });

  // Wait for image to actually be laid out + decoded.
  await page.waitForSelector("main img");
  await page.waitForFunction(() => {
    const img = document.querySelector("main img");
    return img && img.complete && img.naturalHeight > 0;
  }, { timeout: 10_000 });

  // Wait past all settle timers (longest is 700ms). +500ms safety margin.
  await sleep(1300);

  const baseline = await getScale(page);
  console.log(`baseline scale @ scrollY=0: ${baseline}`);
  if (baseline === null) {
    console.error("FAIL: could not read scale from img");
    process.exit(1);
  }

  // Stale-baseline detection: dispatch a scroll event WITHOUT changing
  // scrollY. With the fix, scale is already converged to the post-settle
  // value, so a forced recompute leaves it unchanged. Without the fix,
  // mount-time compute() locked scale to a stale value and the forced
  // recompute snaps it to the correct settled value — the same snap a
  // real first-scroll would produce. Threshold: ~0.5 was the observed
  // pre-fix vs post-fix delta in this fixture; any fresh regression
  // would show similarly.
  await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
  await sleep(40);
  const afterForceRecompute = await getScale(page);
  const staleness = Math.abs(afterForceRecompute - baseline);
  console.log(`scale after forced recompute: ${afterForceRecompute}  (staleness ${staleness.toFixed(4)})`);

  // Reset scroll position (the synthetic event set hasScrolledRef but
  // didn't move scrollY, which is what we want for the next test).
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(40);

  // Tiny real scroll to also catch any first-scroll discontinuity.
  await page.evaluate(() => window.scrollTo(0, 5));
  await sleep(40);

  const afterFirstScroll = await getScale(page);
  console.log(`scale @ scrollY=5: ${afterFirstScroll}`);

  const delta = Math.abs(afterFirstScroll - afterForceRecompute);
  console.log(`5px-scroll delta vs settled: ${delta.toFixed(4)}`);
  // Threshold tuned for the half-bell curve: at the steepest point,
  // 5px of scroll yields ~0.03 of natural scale change. A real jump
  // from the bug would snap by ~0.3-1.0 in one frame — an order of
  // magnitude larger. 0.10 is well clear of natural delta and well
  // below any real jump.
  const PASS_THRESHOLD = 0.10;

  // Also sweep a smooth curve and look for any single-frame
  // discontinuity (not just first-scroll).
  const sweep = [];
  for (let y = 0; y <= 600; y += 10) {
    await page.evaluate((sy) => window.scrollTo(0, sy), y);
    await sleep(30);
    sweep.push({ y, scale: await getScale(page) });
  }
  let maxStepDelta = 0;
  let maxStepAt = null;
  for (let i = 1; i < sweep.length; i++) {
    const d = Math.abs(sweep[i].scale - sweep[i - 1].scale);
    if (d > maxStepDelta) {
      maxStepDelta = d;
      maxStepAt = sweep[i].y;
    }
  }
  console.log(`sweep max step delta: ${maxStepDelta.toFixed(4)} at scrollY=${maxStepAt}`);

  await browser.close();

  const firstScrollOk = delta < PASS_THRESHOLD;
  const sweepOk = maxStepDelta < 0.20;
  // Stale baseline: this is the most sensitive bug detector. Pre-fix
  // showed staleness ≈ 0.5 in our fixture; with the fix it's <0.01.
  const stalenessOk = staleness < 0.10;

  console.log("");
  console.log(`stale-baseline check    : ${stalenessOk ? "PASS" : "FAIL"} (staleness ${staleness.toFixed(4)} < 0.10)`);
  console.log(`first-scroll jump check : ${firstScrollOk ? "PASS" : "FAIL"} (delta ${delta.toFixed(4)} < ${PASS_THRESHOLD})`);
  console.log(`sweep continuity check  : ${sweepOk ? "PASS" : "FAIL"} (max step ${maxStepDelta.toFixed(4)} < 0.20)`);

  process.exit(stalenessOk && firstScrollOk && sweepOk ? 0 : 1);
})();
