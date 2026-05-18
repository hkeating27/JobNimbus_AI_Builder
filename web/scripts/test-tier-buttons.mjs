// Verify TierCards buttons don't overlap.
//
// Failure mode being checked: with whitespace-nowrap and a 3-col
// grid, "Detailed PDF" was wider than its grid cell and overlapped
// the neighboring button. The check is geometric — for every pair
// of buttons in the same card, assert their bounding boxes don't
// intersect on the X axis.

import { chromium } from "playwright";

const URL = "http://localhost:3000/test/tiers";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const page = await ctx.newPage();

  console.log(`navigating to ${URL}`);
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector(".card button");

  // Group buttons by their parent card. For each card, check that
  // all buttons' x-ranges are disjoint OR they sit in distinct rows
  // (different y-ranges). Overlap on BOTH x and y = visual overlap.
  const result = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".card"));
    const findings = [];
    for (let cardIdx = 0; cardIdx < cards.length; cardIdx++) {
      const buttons = Array.from(cards[cardIdx].querySelectorAll("button"));
      const rects = buttons.map((b) => {
        const r = b.getBoundingClientRect();
        return { text: b.textContent?.trim() ?? "", x: r.left, right: r.right, y: r.top, bottom: r.bottom, width: r.width };
      });
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i];
          const b = rects[j];
          const xOverlap = a.x < b.right && b.x < a.right;
          const yOverlap = a.y < b.bottom && b.y < a.bottom;
          if (xOverlap && yOverlap) {
            findings.push({
              cardIdx,
              a: a.text, aRect: { x: a.x, right: a.right, y: a.y, bottom: a.bottom, width: a.width },
              b: b.text, bRect: { x: b.x, right: b.right, y: b.y, bottom: b.bottom, width: b.width },
            });
          }
        }
      }
    }
    return { cardCount: cards.length, findings };
  });

  console.log(`cards inspected: ${result.cardCount}`);
  console.log(`overlapping pairs: ${result.findings.length}`);
  if (result.findings.length > 0) {
    for (const f of result.findings) {
      console.log(`  card #${f.cardIdx}: "${f.a}" (${f.aRect.width}px wide) overlaps "${f.b}" (${f.bRect.width}px wide)`);
    }
  }

  // Also screenshot for human review.
  await page.screenshot({ path: "/tmp/tier-buttons.png", fullPage: true });
  console.log("screenshot: /tmp/tier-buttons.png");

  await browser.close();
  process.exit(result.findings.length === 0 ? 0 : 1);
})();
