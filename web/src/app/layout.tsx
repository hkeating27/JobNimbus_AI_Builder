import type { Metadata } from "next";
import "./globals.css";
import { MethodologyNav } from "@/components/MethodologyModals";

export const metadata: Metadata = {
  title: "RoofIQ — Address-to-Quote in seconds",
  description: "Aerial roof measurement and instant quote-ready estimates for residential roofing replacement.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <div className="mx-auto max-w-[1200px] px-6 md:px-8 py-6">
          <header className="flex items-center justify-between mb-10">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-xl bg-brand-500 grid place-items-center text-white font-bold shadow-sm">R</div>
              <div>
                <div className="font-display text-lg font-semibold tracking-tight">RoofIQ</div>
                <div className="text-xs text-ink-500 -mt-0.5">Aerial measurement → quote in seconds</div>
              </div>
            </div>
            <nav className="hidden md:flex items-center gap-6 text-sm text-ink-500">
              <MethodologyNav />
            </nav>
          </header>
          {children}
          <footer className="mt-20 mb-6 text-center text-xs text-ink-500">
            Demo built for the JobNimbus AI Hackathon 2026 · Pricing model is fully transparent in <code className="font-mono text-ink-700">pricing.json</code>
          </footer>
        </div>
      </body>
    </html>
  );
}
