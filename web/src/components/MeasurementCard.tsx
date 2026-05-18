"use client";

import { useState } from "react";
import type { RoofMeasurement } from "@/lib/types";
import ParallaxSatellite from "./ParallaxSatellite";

export type UserPhoto = {
  url: string;
  width: number;
  height: number;
};

export default function MeasurementCard({
  m,
  userPhotos,
}: {
  m: RoofMeasurement;
  userPhotos?: UserPhoto[];
}) {
  // Notes can be 5-10 bullets and dominate the card visually. Collapse
  // them by default behind a disclosure toggle so the headline numbers
  // (sqft / pitch / segments) stay the focus.
  const [notesOpen, setNotesOpen] = useState(false);
  // Carousel index when multiple user photos were uploaded. Reset to 0
  // whenever the underlying url list changes (new submission).
  const [photoIdx, setPhotoIdx] = useState(0);
  const visibleIdx = userPhotos && userPhotos.length > 0
    ? Math.min(photoIdx, userPhotos.length - 1)
    : 0;
  const confColor =
    m.confidence === "high" ? "badge-green" :
    m.confidence === "medium" ? "badge-amber" : "badge-gray";

  // Compute which signal-source badges to surface. The data_sources
  // array is populated server-side; the rules below are about what to
  // SHOW the contractor in the header (a few succinct chips) rather
  // than dumping the raw source list.
  const sources = m.data_sources;
  const fromPhoto = sources.some((s) => s.startsWith("user_aerial_photo"));
  const solarPitch = sources.includes("google_solar_pitch_fallback");
  const exifGps = sources.includes("exif_gps");
  const gsdActive = sources.some((s) => s.startsWith("exif_altitude_gsd"));
  const isHybrid = fromPhoto && (solarPitch || exifGps);
  return (
    <div className="card p-6 fade-up">
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="label-tiny mb-1">Measured roof</div>
          <div className="font-display text-xl font-semibold text-ink-900">{m.formatted_address}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {isHybrid && (
            <span
              className="badge bg-brand-50 text-brand-700"
              title={[
                fromPhoto ? "Polygon + scale: from your uploaded photo(s)" : "",
                solarPitch ? "Pitch: Google Solar buildingInsights (authoritative)" : "",
                gsdActive ? "EXIF altitude → ground-sample-distance signal active" : "",
                exifGps && !solarPitch ? "EXIF GPS used to anchor scale signals" : "",
              ].filter(Boolean).join("\n")}
            >
              Hybrid: photo + {solarPitch ? "Solar pitch" : "EXIF GPS"}
            </span>
          )}
          {gsdActive && (
            <span className="badge bg-emerald-50 text-emerald-700" title="EXIF altitude × focal length × ground elevation = direct pixels-per-foot. Strongest scale signal when present.">
              EXIF GSD
            </span>
          )}
          <span className={confColor}>{m.confidence} confidence</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Stat label="Total roof area" value={m.total_sqft.toLocaleString()} unit="sqft" />
        <Stat label="Pitch" value={m.pitch.label} unit={`${m.pitch.degrees}°`} />
        <Stat label="Roof planes" value={String(m.segments)} unit={m.complexity.replace("_", " ")} />
        <Stat label="Footprint" value={m.footprint_sqft.toLocaleString()} unit="sqft" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <LfStat label="Ridge" v={m.line_items.ridge_lf} />
        <LfStat label="Hip" v={m.line_items.hip_lf} />
        <LfStat label="Valley" v={m.line_items.valley_lf} />
        <LfStat label="Rake" v={m.line_items.rake_lf} />
        <LfStat label="Eave" v={m.line_items.eave_lf} />
      </div>

      {m.satellite_image_url ? (
        <ParallaxSatellite imageUrl={m.satellite_image_url} />
      ) : userPhotos && userPhotos.length > 0 ? (
        <UserPhotoCarousel
          photos={userPhotos}
          activeIdx={visibleIdx}
          onPrev={() => setPhotoIdx((i) => (i - 1 + userPhotos.length) % userPhotos.length)}
          onNext={() => setPhotoIdx((i) => (i + 1) % userPhotos.length)}
          onSelect={setPhotoIdx}
        />
      ) : null}

      <div className="mt-4 text-xs text-ink-500">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>Sources: {m.data_sources.join(", ") || "fallback heuristics"}</span>
          {m.notes.length > 0 && (
            <button
              onClick={() => setNotesOpen((o) => !o)}
              className="inline-flex items-center gap-1 text-ink-600 hover:text-ink-900 underline-offset-2 hover:underline"
              aria-expanded={notesOpen}
            >
              <svg
                className={"size-3 transition-transform " + (notesOpen ? "rotate-90" : "")}
                viewBox="0 0 20 20" fill="currentColor"
              >
                <path d="M7.05 4.05a.75.75 0 011.06 0l5.4 5.4a.75.75 0 010 1.06l-5.4 5.4a.75.75 0 01-1.06-1.06L11.93 10 7.05 5.11a.75.75 0 010-1.06z" />
              </svg>
              {notesOpen ? `Hide details (${m.notes.length})` : `Show details (${m.notes.length})`}
            </button>
          )}
        </div>
        {notesOpen && m.notes.length > 0 && (
          <ul className="mt-2 space-y-1">{m.notes.map((n, i) => <li key={i}>· {n}</li>)}</ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div>
      <div className="label-tiny">{label}</div>
      <div className="stat-num">{value}</div>
      {unit && <div className="text-xs text-ink-500 mt-0.5">{unit}</div>}
    </div>
  );
}

// Static carousel for user-uploaded photos. We tried the parallax
// scroll-zoom here too but it didn't read well on user photos
// (oblique angles, off-center subjects, varying aspects all fought
// the centered scale-up). Now: plain <img> with aspect-ratio
// reserved up-front to prevent reflow, plus prev/next arrows + dots
// when more than one photo was uploaded.
function UserPhotoCarousel({
  photos,
  activeIdx,
  onPrev,
  onNext,
  onSelect,
}: {
  photos: UserPhoto[];
  activeIdx: number;
  onPrev: () => void;
  onNext: () => void;
  onSelect: (idx: number) => void;
}) {
  const active = photos[activeIdx];
  const aspectRatio = active.width > 0 && active.height > 0
    ? `${active.width} / ${active.height}`
    : "16 / 9";
  const multi = photos.length > 1;
  return (
    <div className="relative rounded-xl overflow-hidden border border-ink-100 bg-ink-100">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={active.url}
        alt={`Uploaded photo ${activeIdx + 1} of ${photos.length}`}
        className="block w-full select-none"
        draggable={false}
        style={{ aspectRatio, width: "100%", height: "auto" }}
      />
      <div className="pointer-events-none absolute top-2 left-2 right-2 flex items-center justify-between">
        <span className="badge-blue bg-white/90 backdrop-blur-sm pointer-events-auto">
          User-uploaded photo{multi ? ` ${activeIdx + 1} / ${photos.length}` : ""}
        </span>
        {multi && (
          <div className="pointer-events-auto flex items-center gap-1.5 px-1.5 py-1 rounded-full bg-white/85 backdrop-blur-sm border border-ink-100">
            {photos.map((_, i) => (
              <button
                key={i}
                onClick={() => onSelect(i)}
                aria-label={`Show photo ${i + 1}`}
                className={
                  "size-2 rounded-full transition " +
                  (i === activeIdx ? "bg-brand-500" : "bg-ink-300 hover:bg-ink-400")
                }
              />
            ))}
          </div>
        )}
      </div>
      {multi && (
        <>
          <button
            onClick={onPrev}
            aria-label="Previous photo"
            className="absolute top-1/2 left-2 -translate-y-1/2 size-9 rounded-full bg-white/85 backdrop-blur-sm border border-ink-100 hover:bg-white shadow-soft grid place-items-center text-ink-700 hover:text-ink-900"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="size-4">
              <path d="M12.95 4.55a.75.75 0 010 1.06L8.51 10l4.44 4.39a.75.75 0 11-1.06 1.06l-5-4.94a.75.75 0 010-1.06l5-4.94a.75.75 0 011.06.04z" />
            </svg>
          </button>
          <button
            onClick={onNext}
            aria-label="Next photo"
            className="absolute top-1/2 right-2 -translate-y-1/2 size-9 rounded-full bg-white/85 backdrop-blur-sm border border-ink-100 hover:bg-white shadow-soft grid place-items-center text-ink-700 hover:text-ink-900"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="size-4">
              <path d="M7.05 4.55a.75.75 0 011.06-.04l5 4.94a.75.75 0 010 1.06l-5 4.94a.75.75 0 11-1.06-1.06L11.49 10 7.05 5.61a.75.75 0 010-1.06z" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}

function LfStat({ label, v }: { label: string; v: number }) {
  return (
    <div className="rounded-xl bg-ink-100/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold">{label}</div>
      <div className="text-base font-semibold text-ink-900 tabular-nums">{v} <span className="text-xs text-ink-500 font-normal">lf</span></div>
    </div>
  );
}
