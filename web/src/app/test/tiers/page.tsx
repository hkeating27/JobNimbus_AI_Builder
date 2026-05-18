// Visual fixture for TierCards button layout regression check.
// Mounts the real TierCards with a real quote fixture so the
// Playwright check exercises the same Tailwind classes and grid
// behavior as production. No API calls.
import TierCards from "@/components/TierCards";
import quoteFixture from "../../../../__fixtures__/canton-quote.json";
import type { Quote } from "@/lib/types";

export default function TierTestPage() {
  return (
    <main className="min-h-screen p-6 max-w-5xl mx-auto">
      <h1 className="font-display text-xl mb-4">TierCards layout fixture</h1>
      <TierCards quote={quoteFixture as Quote} />
    </main>
  );
}
