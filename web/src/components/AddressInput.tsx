"use client";

import { useRef, useState } from "react";
import { unlockAudio } from "@/lib/audio";
import { compressForUpload, formatBytes, type CompressedPhoto } from "@/lib/image-compress";

// Sample chips show the 5 BLIND TEST addresses we submit sqft
// totals for via the hackathon form. Plugging one in proves the
// live tool produces the same number we documented in
// SUBMISSION-NUMBERS.md. The 5 calibration/example properties (with
// Reference A + B published) are documented in
// benchmark-measurements.md and validated in outputs/calibration.md.
const SAMPLE_ADDRESSES = [
  "3561 E 102nd Ct, Thornton, CO 80229",
  "1612 S Canton Ave, Springfield, MO 65802",
  "6310 Laguna Bay Court, Houston, TX 77041",
  "3820 E Rosebrier St, Springfield, MO 65809",
  "1261 20th Street, Newport News, VA 23607",
];

// Submit can be either an address-only run, a photos-only run, or a
// hybrid (photos + address). The route handler picks the right
// pipeline based on which fields are present. Multi-photo (up to 3)
// gives the scale-reference ensemble more independent signals.
//
// Each photo is COMPRESSED on-pick (canvas, ~2048px max long edge,
// JPEG q=0.85) to fit Vercel's 4.5 MB request body cap, and its
// EXIF is extracted BEFORE compression (canvas re-encoding strips
// metadata) so the server-side EXIF GSD path still works.
export type AttachedPhoto = {
  file: File;
  exif: Record<string, unknown> | null;
  width: number;
  height: number;
};
export type SearchInput = { address?: string; photos?: AttachedPhoto[] };

const MAX_PHOTOS = 3;
// Vercel free-tier serverless body cap is 4.5 MB; leave 500 KB slack
// for multipart envelope + EXIF JSON + address field.
const TOTAL_PAYLOAD_LIMIT_BYTES = 4 * 1024 * 1024;

export default function AddressInput({
  onSubmit,
  busy,
  compact,
}: {
  onSubmit: (input: SearchInput) => void;
  busy: boolean;
  compact: boolean;
}) {
  const [value, setValue] = useState("");
  const [photos, setPhotos] = useState<CompressedPhoto[]>([]);
  const [compressing, setCompressing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalSize = photos.reduce((s, p) => s + p.compressedSizeBytes, 0);
  const overLimit = totalSize > TOTAL_PAYLOAD_LIMIT_BYTES;

  function handle() {
    const v = value.trim();
    // Need either an address OR at least one photo to submit.
    if (photos.length === 0 && v.length < 6) return;
    if (overLimit) return;  // submit button is disabled but guard anyway
    unlockAudio();
    onSubmit({
      address: v.length >= 6 ? v : undefined,
      photos: photos.length > 0 ? photos.map((p) => ({ file: p.file, exif: p.exif, width: p.width, height: p.height })) : undefined,
    });
  }

  async function onFilesPicked(fileList: FileList | null) {
    if (!fileList) return;
    setPhotoError(null);
    const incoming = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (incoming.length === 0) return;

    setCompressing(true);
    try {
      const compressed = await Promise.all(incoming.map(compressForUpload));
      setPhotos((prev) => {
        const seen = new Set(prev.map((p) => `${p.file.name}::${p.originalSizeBytes}`));
        const merged = [...prev];
        for (const c of compressed) {
          const key = `${c.file.name}::${c.originalSizeBytes}`;
          if (!seen.has(key)) {
            merged.push(c);
            seen.add(key);
          }
          if (merged.length >= MAX_PHOTOS) break;
        }
        return merged.slice(0, MAX_PHOTOS);
      });
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : "Photo processing failed");
    } finally {
      setCompressing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removePhoto(idx: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
    setPhotoError(null);
  }

  // Hidden <input type="file" multiple> driven by the visible upload button.
  // multiple=true so the OS picker lets the user grab several at once.
  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      multiple
      className="sr-only"
      onChange={(e) => onFilesPicked(e.target.files)}
    />
  );

  const slotsLeft = MAX_PHOTOS - photos.length;

  if (compact) {
    return (
      <div className="card px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="text-ink-500 text-sm shrink-0">Quote another address:</div>
        <input
          className="flex-1 min-w-[200px] bg-transparent outline-none text-ink-900 placeholder:text-ink-300"
          placeholder="123 Main St, City, ST"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handle(); }}
          disabled={busy}
        />
        {photos.map((p, i) => (
          <PhotoChip key={`${p.file.name}-${i}`} name={p.file.name} sizeBytes={p.compressedSizeBytes} onClear={() => removePhoto(i)} />
        ))}
        <UploadButton
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || compressing || slotsLeft === 0}
          compact
          slotsLeft={slotsLeft}
          compressing={compressing}
        />
        {fileInput}
        <button
          className="btn-primary text-sm py-2 px-4"
          onClick={handle}
          disabled={busy || compressing || overLimit || (photos.length === 0 && value.trim().length < 6)}
        >
          {busy ? "Working…" : "Quote"}
        </button>
      </div>
    );
  }

  return (
    <div className="fade-up">
      <div className="text-center mb-10">
        <div className="badge-blue mb-4 inline-flex">
          <span className="size-1.5 rounded-full bg-brand-500 mr-2 pulse-ring"></span>
          Live aerial measurement · 3-source ensemble + line-itemized quote
        </div>
        <h1 className="font-display text-4xl md:text-6xl font-semibold tracking-tight text-ink-900 leading-[1.05]">
          From an address to a quote-ready estimate <span className="text-brand-500">in under a minute.</span>
        </h1>
        <p className="mt-5 text-lg text-ink-500 max-w-[640px] mx-auto">
          Enter a property address — or upload your own aerial photo — and we&rsquo;ll measure the roof, build a tiered quote, and walk you through every line item.
        </p>
      </div>
      <div className="card p-2 max-w-[960px] mx-auto">
        <div className="flex flex-col md:flex-row md:items-center gap-2 p-2">
          <div className="flex-1 flex items-center gap-3 px-4 min-w-0">
            <svg className="size-5 text-ink-300 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 22s7-5.5 7-12a7 7 0 1 0-14 0c0 6.5 7 12 7 12z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
            <input
              className="w-full py-4 text-lg bg-transparent outline-none placeholder:text-ink-300 min-w-0"
              placeholder="123 Main St, City, ST 12345"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handle(); }}
              disabled={busy}
              autoFocus
            />
          </div>
          <UploadButton
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || compressing || slotsLeft === 0}
            compact={false}
            slotsLeft={slotsLeft}
            compressing={compressing}
          />
          {fileInput}
          <button
            className="btn-primary md:py-4 md:px-7"
            onClick={handle}
            disabled={busy || compressing || overLimit || (photos.length === 0 && value.trim().length < 6)}
          >
            {busy ? "Measuring…" : "Get my quote"}
          </button>
        </div>
        {photos.length > 0 && (
          <div className="px-4 pb-2 -mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-600">
            <span className="label-tiny">
              {photos.length === 1 ? "Aerial photo attached:" : `${photos.length} aerial photos attached:`}
            </span>
            {photos.map((p, i) => (
              <PhotoChip key={`${p.file.name}-${i}`} name={p.file.name} sizeBytes={p.compressedSizeBytes} onClear={() => removePhoto(i)} />
            ))}
            <span className="text-ink-400">
              {photos.some((p) => p.wasCompressed)
                ? `Compressed to ${formatBytes(totalSize)} total (from ${formatBytes(photos.reduce((s, p) => s + p.originalSizeBytes, 0))}).`
                : `${formatBytes(totalSize)} total.`}
              {" "}
              {value.trim().length >= 6
                ? "Address used as fallback for pitch."
                : photos.length < MAX_PHOTOS
                  ? `Up to ${MAX_PHOTOS - photos.length} more photo${MAX_PHOTOS - photos.length === 1 ? "" : "s"} for better accuracy.`
                  : "(Optional: add an address to enable Solar pitch fallback.)"}
            </span>
          </div>
        )}
        {(overLimit || photoError) && (
          <div className="px-4 pb-2 -mt-1 text-xs text-rose-700">
            {photoError ? (
              <>Photo error: {photoError}</>
            ) : (
              <>
                Photos exceed the 4 MB upload limit ({formatBytes(totalSize)} total). Try removing one photo, or upload smaller versions.
              </>
            )}
          </div>
        )}
      </div>
      <div className="mt-6 max-w-[960px] mx-auto">
        <div className="label-tiny mb-2">
          Try a hackathon test address
          <span className="text-ink-400 normal-case font-normal tracking-normal">
            {" "}— our submitted totals are in <code className="text-ink-500">SUBMISSION-NUMBERS.md</code>
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {SAMPLE_ADDRESSES.map((a) => (
            <button key={a} onClick={() => setValue(a)} className="text-xs px-3 py-1.5 rounded-full bg-white border border-ink-100 text-ink-700 hover:border-brand-500 hover:text-brand-700 transition">
              {a.split(",")[0]}<span className="text-ink-300"> · {a.split(",").slice(1).join(",").trim()}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function UploadButton({ onClick, disabled, compact, slotsLeft, compressing }: { onClick: () => void; disabled: boolean; compact: boolean; slotsLeft: number; compressing: boolean }) {
  // When at capacity, the button is disabled and the label reflects
  // it. Otherwise the label tells you how many slots remain so the
  // limit isn't a surprise after you've already picked.
  const label = compressing
    ? "Compressing…"
    : slotsLeft === MAX_PHOTOS
      ? "Upload photo"
      : slotsLeft > 0
        ? `Add photo (${slotsLeft} left)`
        : "Max photos";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "btn-ghost whitespace-nowrap " +
        (compact ? "text-sm py-2 px-3" : "md:py-4 md:px-5")
      }
      title={`Upload up to ${MAX_PHOTOS} aerial photos of the property. More photos = better scale accuracy.`}
    >
      {/* Arrow points UP (upload), out of a tray. The previous icon
          had the arrow pointing DOWN which read as a download. */}
      <svg className="size-4 mr-1.5 inline-block" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 3a.75.75 0 01.53.22l3.25 3.25a.75.75 0 01-1.06 1.06l-1.97-1.97v6.94a.75.75 0 01-1.5 0V5.56L7.28 7.53a.75.75 0 01-1.06-1.06l3.25-3.25A.75.75 0 0110 3z" clipRule="evenodd" />
        <path d="M3.5 13.25a.75.75 0 011.5 0v1.75a.75.75 0 00.75.75h8.5a.75.75 0 00.75-.75v-1.75a.75.75 0 011.5 0v1.75A2.25 2.25 0 0114.25 17h-8.5A2.25 2.25 0 013.5 14.75v-1.5z" />
      </svg>
      {label}
    </button>
  );
}

function PhotoChip({ name, sizeBytes, onClear }: { name: string; sizeBytes?: number; onClear: () => void }) {
  // Truncate long filenames so the chip doesn't blow out the row.
  const trimmed = name.length > 22 ? name.slice(0, 10) + "…" + name.slice(-10) : name;
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 text-xs">
      <svg className="size-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 5.5A1.5 1.5 0 015.5 4h9A1.5 1.5 0 0116 5.5v9a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 014 14.5v-9zM5.5 5a.5.5 0 00-.5.5v9c0 .03 0 .06.002.09l3.39-3.39a1.5 1.5 0 012.12 0l3.99 3.99V5.5a.5.5 0 00-.5-.5h-9zm1.75 1.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" clipRule="evenodd" /></svg>
      <span>{trimmed}{sizeBytes !== undefined ? ` · ${formatBytes(sizeBytes)}` : ""}</span>
      <button onClick={onClear} className="ml-0.5 hover:text-brand-900" aria-label="Remove photo">
        <svg className="size-3" viewBox="0 0 20 20" fill="currentColor"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" /></svg>
      </button>
    </span>
  );
}
