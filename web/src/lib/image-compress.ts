// Client-side image compression for upload. Vercel serverless
// functions cap request bodies at 4.5 MB total — phone photos
// straight off the camera weigh 5-10 MB each, drone photos 15-30 MB,
// so we'd routinely exceed the limit with multi-photo uploads.
//
// We solve it by downscaling to MAX_LONG_EDGE on the longer side and
// re-encoding as JPEG at QUALITY. Anthropic's vision pipeline
// internally caps at 1568px anyway, so anything above ~2000px on the
// long edge is wasted bandwidth.
//
// CRITICAL — preserve EXIF: re-encoding via <canvas> strips ALL
// metadata, including GPS, focal length, and altitude. Those signals
// are exactly what the Tier 2 GSD path needs to compute pixels-per-
// foot directly. So we extract the EXIF blob FIRST (using exifr's
// browser build), then attach it to the upload as a separate field.
// The server-side route prefers client-supplied EXIF over its own
// re-parse of the (now stripped) compressed bytes.
import exifr from "exifr";

const MAX_LONG_EDGE = 2048;
const JPEG_QUALITY = 0.85;
const MIN_SIZE_TO_COMPRESS = 1.5 * 1024 * 1024;  // <1.5 MB → leave alone

export type CompressedPhoto = {
  file: File;                       // (possibly) compressed file ready to upload
  originalSizeBytes: number;
  compressedSizeBytes: number;
  wasCompressed: boolean;
  exif: Record<string, unknown> | null;
  // Pixel dimensions of the (post-compression) image. Used downstream
  // to set the parallax container's aspect-ratio so the image
  // reserves its space at first paint and doesn't reflow on load.
  width: number;
  height: number;
};

export async function compressForUpload(file: File): Promise<CompressedPhoto> {
  // Always extract EXIF from the ORIGINAL file (re-encoding strips it).
  let exif: Record<string, unknown> | null = null;
  try {
    const parsed = await exifr.parse(file, { gps: true, exif: true });
    exif = parsed ?? null;
  } catch {
    // EXIF parsing is best-effort; degrade silently.
  }

  // We always need dimensions for the parallax aspect-ratio, so even
  // for small files we read them. If small enough, skip compression
  // and return original + dimensions.
  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    return { file, originalSizeBytes: file.size, compressedSizeBytes: file.size, wasCompressed: false, exif, width: 0, height: 0 };
  }

  if (file.size < MIN_SIZE_TO_COMPRESS) {
    return {
      file,
      originalSizeBytes: file.size,
      compressedSizeBytes: file.size,
      wasCompressed: false,
      exif,
      width: img.naturalWidth,
      height: img.naturalHeight,
    };
  }

  try {
    const longEdge = Math.max(img.width, img.height);
    const scale = Math.min(1, MAX_LONG_EDGE / longEdge);
    const newW = Math.round(img.width * scale);
    const newH = Math.round(img.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = newW;
    canvas.height = newH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return { file, originalSizeBytes: file.size, compressedSizeBytes: file.size, wasCompressed: false, exif, width: img.naturalWidth, height: img.naturalHeight };
    }
    ctx.drawImage(img, 0, 0, newW, newH);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY);
    });
    if (!blob) {
      return { file, originalSizeBytes: file.size, compressedSizeBytes: file.size, wasCompressed: false, exif, width: img.naturalWidth, height: img.naturalHeight };
    }

    // Even if the compressed result is larger (rare, for already-tiny
    // images), prefer the original.
    if (blob.size >= file.size) {
      return { file, originalSizeBytes: file.size, compressedSizeBytes: file.size, wasCompressed: false, exif, width: img.naturalWidth, height: img.naturalHeight };
    }

    const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    const compressed = new File([blob], newName, { type: "image/jpeg" });
    return {
      file: compressed,
      originalSizeBytes: file.size,
      compressedSizeBytes: compressed.size,
      wasCompressed: true,
      exif,
      width: newW,
      height: newH,
    };
  } catch {
    // Decoding can fail on HEIC, very corrupt files, etc. Degrade to
    // the original file — server-side limit will reject and the UI
    // will surface a friendlier error.
    return { file, originalSizeBytes: file.size, compressedSizeBytes: file.size, wasCompressed: false, exif, width: img.naturalWidth, height: img.naturalHeight };
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
