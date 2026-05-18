// Measure a roof from a user-uploaded aerial photo.
//
// Flow:
//   1. Parse multipart (image + optional address)
//   2. EXIF-parse GPS + altitude (exifr) — surface what we found
//   3. Vision: get roof polygon + scale references + pitch best-effort
//   4. Compute pixels-per-foot from reference (median across multiple)
//   5. Convert polygon area → footprint sqft → total sqft (× pitch)
//   6. If GPS or address present, run Google Solar in parallel for
//      authoritative pitch fallback (high-confidence override)
//   7. Build the same RoofMeasurement shape as /api/measure so the
//      downstream pipeline (quote, agent, PDF) is unaffected
import { NextRequest, NextResponse } from "next/server";
import exifr from "exifr";
import {
  analyzePhotoForMeasurement,
  computePerPhotoPpf,
  computeGsdPpfNormalized,
  combinePpfWithGsd,
  polygonAreaNormalized,
  footprintToTotalSqft,
} from "@/lib/photo-measure";
import { deriveLineItems } from "@/lib/measure";
import { geocode, elevationMeters, solarBuildingInsights } from "@/lib/google";
import type { RoofMeasurement, Pitch } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function pitchFromRise(rise: number): Pitch {
  const run = 12;
  const slope = Math.sqrt(rise * rise + run * run) / run;
  const degrees = (Math.atan(rise / run) * 180) / Math.PI;
  return {
    rise,
    run,
    multiplier: slope,
    degrees: Math.round(degrees * 10) / 10,
    label: `${rise}:12`,
  };
}

function inferStateFromAddress(address: string): string {
  const m = address.toUpperCase().match(/\b([A-Z]{2})\b\s+\d{5}/);
  return m?.[1] ?? "";
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const images = form.getAll("image").filter((v): v is File => v instanceof Blob && (v as Blob).size > 0) as unknown as Blob[];
  const address = ((form.get("address") as string) || "").trim();
  // Optional contractor-supplied pitch override. When present, this
  // takes priority over Solar/vision-derived pitch. Used by the
  // "Recalculate with this pitch" UI when the contractor isn't
  // satisfied with our automatic estimate.
  const pitchOverrideRaw = (form.get("pitch_override") as string | null) ?? null;
  const pitchOverride = pitchOverrideRaw ? parseInt(pitchOverrideRaw, 10) : null;

  if (images.length === 0) {
    return NextResponse.json({ error: "Missing image field" }, { status: 400 });
  }
  const MAX_PHOTOS = 3;
  if (images.length > MAX_PHOTOS) {
    return NextResponse.json({ error: `Too many photos (max ${MAX_PHOTOS})` }, { status: 400 });
  }
  for (const img of images) {
    if (img.size > 12 * 1024 * 1024) {
      return NextResponse.json({ error: "Image too large (max 12 MB each)" }, { status: 413 });
    }
  }

  // Sniff each image's media type from magic bytes (Content-Type is
  // unreliable from curl/some browsers). Anthropic rejects mismatched
  // declared-vs-actual types.
  function sniffMediaType(buffer: Buffer, declared: string): "image/jpeg" | "image/png" | "image/webp" | "image/gif" {
    if (buffer.length >= 4) {
      const b0 = buffer[0], b1 = buffer[1], b2 = buffer[2], b3 = buffer[3];
      if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return "image/png";
      if (b0 === 0xff && b1 === 0xd8) return "image/jpeg";
      if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46) return "image/gif";
      if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46) {
        if (buffer.length >= 12 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
          return "image/webp";
        }
      }
    }
    if (declared === "image/jpeg" || declared === "image/png" || declared === "image/webp" || declared === "image/gif") {
      return declared as "image/jpeg" | "image/png" | "image/webp" | "image/gif";
    }
    return "image/jpeg";
  }

  const photoInputs = await Promise.all(images.map(async (img) => {
    const buffer = Buffer.from(await img.arrayBuffer());
    return { buffer, mediaType: sniffMediaType(buffer, img.type) };
  }));

  // EXIF is parsed from the FIRST photo only — that's the photo we
  // also display in the UI, and it's the canonical "primary view"
  // for GPS context. Multi-photo EXIF aggregation is a Tier 3 concern.
  const buffer = photoInputs[0].buffer;

  // ----- EXIF GPS + altitude + camera info -----
  // Prefer client-supplied EXIF (extracted from the ORIGINAL photo
  // bytes BEFORE client-side compression strips metadata via canvas
  // re-encoding). Fall back to server-side parse for clients that
  // don't pre-extract.
  let exifLat: number | undefined;
  let exifLng: number | undefined;
  let exifAltitudeM: number | undefined;
  let exifFocalLength35mm: number | undefined;
  let exifImageWidth: number | undefined;
  let exifMake: string | undefined;
  let exifModel: string | undefined;
  try {
    let exif: Record<string, unknown> | null = null;
    const clientExifRaw = form.get("exif_0");
    if (typeof clientExifRaw === "string" && clientExifRaw.length > 0) {
      try { exif = JSON.parse(clientExifRaw) as Record<string, unknown>; } catch {/* fall through */}
    }
    if (!exif) {
      const parsed = await exifr.parse(buffer, { gps: true, exif: true });
      exif = parsed ?? null;
    }
    if (exif) {
      if (typeof exif.latitude === "number" && typeof exif.longitude === "number") {
        exifLat = exif.latitude;
        exifLng = exif.longitude;
      }
      if (typeof exif.GPSAltitude === "number") {
        exifAltitudeM = exif.GPSAltitude;
      }
      // FocalLengthIn35mmFormat is the canonical "equivalent on full
      // frame" focal length we need for GSD math. Some cameras only
      // report FocalLength (sensor-specific) — that requires knowing
      // the sensor crop factor, which we don't always have, so we
      // skip the GSD path in those cases.
      if (typeof exif.FocalLengthIn35mmFormat === "number") {
        exifFocalLength35mm = exif.FocalLengthIn35mmFormat;
      }
      // Image width in pixels: prefer the EXIF "PixelXDimension"
      // (the photographic image width), fall back to ExifImageWidth.
      if (typeof exif.PixelXDimension === "number") {
        exifImageWidth = exif.PixelXDimension;
      } else if (typeof exif.ExifImageWidth === "number") {
        exifImageWidth = exif.ExifImageWidth;
      }
      if (typeof exif.Make === "string") exifMake = exif.Make;
      if (typeof exif.Model === "string") exifModel = exif.Model;
    }
  } catch {
    // EXIF parsing is non-fatal.
  }

  // ----- Vision pass + Solar fallback (parallelized) -----
  const visionPromise = analyzePhotoForMeasurement(photoInputs, address || undefined);

  // Solar gives us authoritative pitch when we have coordinates. Prefer
  // EXIF GPS (matches the actual photographed property), fall back to
  // geocoded address.
  const solarPromise: Promise<{ pitchRise?: number; lat?: number; lng?: number; formatted?: string; ok: boolean }> = (async () => {
    let lat = exifLat;
    let lng = exifLng;
    let formatted: string | undefined;
    if ((lat === undefined || lng === undefined) && address) {
      try {
        const g = await geocode(address);
        if (g) { lat = g.lat; lng = g.lng; formatted = g.formatted_address; }
      } catch {/* ignore */}
    }
    if (lat === undefined || lng === undefined) return { ok: false };
    try {
      const s = await solarBuildingInsights(lat, lng);
      if (!s) return { ok: false, lat, lng, formatted };
      // Mean pitch across segments → rise:12 equivalent.
      const meanPitchDeg = s.averagePitchDegrees;
      const rise = Math.max(2, Math.min(12, Math.round(Math.tan((meanPitchDeg * Math.PI) / 180) * 12)));
      return { pitchRise: rise, lat, lng, formatted, ok: true };
    } catch {
      return { ok: false, lat, lng, formatted };
    }
  })();

  const [vision, solar] = await Promise.all([visionPromise, solarPromise]);

  // ----- Per-photo PPF + primary-photo selection -----
  // Each photo has its own normalized coordinate system, so refs from
  // different photos can't be averaged. computePerPhotoPpf groups
  // refs by photo, computes ppf within each, and picks the polygon-
  // source photo's ppf as the one driving the area math.
  const multiPpf = computePerPhotoPpf(vision.scale_references, vision.polygon_source_photo_index);
  let ppf = multiPpf?.primary_ppf ?? null;

  // ----- EXIF GSD PPF (independent signal, when EXIF is rich enough) -----
  // Requires: GPS altitude, focal length 35mm equiv, image pixel width,
  // AND the ground elevation at the photo location. Any missing piece
  // falls through to vision-only. Only the primary photo's EXIF (we
  // parsed `exif_0`) is used here — Tier 3 will aggregate all photos.
  let gsdInfo: { value: number; altitude_agl_m: number; sigma_pct: number } | null = null;
  if (
    exifAltitudeM !== undefined &&
    exifFocalLength35mm !== undefined &&
    exifImageWidth !== undefined &&
    (exifLat !== undefined && exifLng !== undefined)
  ) {
    try {
      const groundM = await elevationMeters(exifLat, exifLng);
      if (groundM !== null) {
        gsdInfo = computeGsdPpfNormalized(
          {
            focalLength35mmEquiv: exifFocalLength35mm,
            altitudeAboveSeaLevelM: exifAltitudeM,
            imagePixelWidth: exifImageWidth,
          },
          groundM,
        );
      }
    } catch {/* ignore — degrade to vision-only */}
  }

  // Combine the two signals when both are available (only valid when
  // EXIF came from the primary photo, which is the case for now since
  // we parse exif_0 and prefer photo 0 as primary when ambiguous).
  if (ppf && gsdInfo && (multiPpf?.primary_photo_index ?? 0) === 0) {
    ppf = combinePpfWithGsd(ppf, { value: gsdInfo.value, sigma_pct: gsdInfo.sigma_pct });
  } else if (!ppf && gsdInfo) {
    // No vision references but we have GSD — still measurable.
    ppf = {
      value: gsdInfo.value,
      agreement_pct: 100,                     // single source, no ensemble disagreement
      per_ref: [],
      best_contributor: null,
    };
  }

  // ----- Up-front bail-outs (return cleanly instead of producing a stub quote) -----
  // The previous version only blocked on missing ppf or <4 polygon
  // points. That let several broken-but-shaped-correctly results
  // through: degenerate polygons (4 points clustered together),
  // ground-level photos that vision tried to interpret as aerial,
  // annotated/sketched photos where vision couldn't lock onto the
  // actual roof outline. All of those produced 0-sqft quotes that
  // were objectively wrong but rendered as if successful.
  const polyAreaNorm = polygonAreaNormalized(vision.roof_polygon_normalized);

  if (vision.view_type === "ground_level") {
    return NextResponse.json({
      error: "This looks like a ground-level photo, not an aerial. We can only measure roofs from overhead views (drone, plane, satellite). Try a top-down aerial photo, or use the address input for satellite-based measurement.",
    }, { status: 422 });
  }

  if (!ppf || vision.roof_polygon_normalized.length < 4) {
    const reason = !ppf
      ? "We couldn't identify any scale references in the photo (sidewalk, driveway, vehicle, etc.)."
      : "We couldn't trace the roof outline reliably.";
    return NextResponse.json({
      error: `${reason} Try a clearer aerial photo where the property and at least one of {sidewalk, driveway, vehicle, parking space} are clearly visible — or use the address input instead.`,
    }, { status: 422 });
  }

  // Reject degenerate polygons. A real residential roof on a typical
  // aerial frame occupies at least ~3-5% of the normalized image
  // area. Below 1% means vision returned a near-zero polygon — would
  // produce a 0-sqft quote, which is worse than failing.
  if (polyAreaNorm < 0.01) {
    return NextResponse.json({
      error: "We couldn't lock onto the roof outline in this photo (the traced polygon was too small to be a real building). This often happens with annotated/sketched photos, very wide overview shots, or images where the roof is partially obscured. Try a clearer aerial photo of the target property — or use the address input.",
    }, { status: 422 });
  }

  // ----- Sqft math -----
  // normalized_area / (pixels_per_foot_normalized)^2 = real square feet
  const ppfSquared = ppf.value * ppf.value;
  const footprint_sqft = ppfSquared > 0 ? polyAreaNorm / ppfSquared : 0;

  // Final sanity check: any residential roof under ~200 sqft is
  // implausible. If we got there, the scale signal failed even
  // though we had references — common when EXIF altitude was wrong
  // or vision misidentified a small object as a major reference.
  if (footprint_sqft < 200) {
    return NextResponse.json({
      error: `We computed an implausibly small roof (${Math.round(footprint_sqft)} sqft footprint). The scale references in the photo probably didn't pin down camera height correctly. Try uploading a different photo with clearer scale objects (sidewalk, driveway, parked car) — or use the address input.`,
    }, { status: 422 });
  }

  // Pitch: contractor override > Solar > vision-high > vision-default
  let pitchRise = vision.pitch_rise_in_12 || 6;
  let pitchSource: "user_override" | "google_solar" | "vision_oblique" | "vision_default";
  if (pitchOverride && pitchOverride >= 2 && pitchOverride <= 14) {
    pitchRise = pitchOverride;
    pitchSource = "user_override";
  } else if (solar.pitchRise) {
    pitchRise = solar.pitchRise;
    pitchSource = "google_solar";
  } else if (vision.pitch_confidence === "high") {
    pitchSource = "vision_oblique";
  } else {
    pitchSource = "vision_default";
  }
  const pitch = pitchFromRise(pitchRise);

  const total_sqft = Math.round(footprintToTotalSqft(footprint_sqft, pitchRise));
  const footprint_sqft_rounded = Math.round(footprint_sqft);

  // Confidence — combination of polygon, scale-reference agreement, and
  // pitch source.
  let confidence: "high" | "medium" | "low" = "medium";
  if (
    vision.polygon_confidence === "high" &&
    ppf.agreement_pct >= 80 &&
    vision.scale_references.length >= 2 &&
    (solar.pitchRise || vision.pitch_confidence === "high")
  ) {
    confidence = "high";
  } else if (
    vision.polygon_confidence === "low" ||
    vision.scale_references.length === 0 ||
    ppf.agreement_pct < 50
  ) {
    confidence = "low";
  }

  // ----- Build the RoofMeasurement record -----
  const data_sources: string[] = [
    images.length === 1 ? "user_aerial_photo" : `user_aerial_photos (${images.length})`,
    `vision_scale_reference (${vision.scale_references.length} ref${vision.scale_references.length === 1 ? "" : "s"})`,
  ];
  if (exifLat !== undefined && exifLng !== undefined) data_sources.push("exif_gps");
  if (gsdInfo) data_sources.push(`exif_altitude_gsd (${Math.round(gsdInfo.altitude_agl_m)} m AGL)`);
  if (solar.pitchRise) data_sources.push("google_solar_pitch_fallback");

  const primaryRefs = vision.scale_references.filter((r) => r.photo_index === (multiPpf?.primary_photo_index ?? 0));
  const refSummary = primaryRefs.length > 0
    ? primaryRefs.map((r) => `${r.type.replace(/_/g, " ")} (${r.assumed_real_length_ft} ft)`).join(", ")
    : "none";
  const notes: string[] = [
    images.length > 1
      ? `${images.length} photos uploaded; primary measurement from photo ${(multiPpf?.primary_photo_index ?? 0) + 1}.`
      : "Single photo analyzed for scale.",
    `Scale derived from ${primaryRefs.length} reference${primaryRefs.length === 1 ? "" : "s"} in the primary photo: ${refSummary}.`,
    ppf.best_contributor
      ? `Highest-weighted reference: ${ppf.best_contributor.replace(/_/g, " ")} (variance-weighted ensemble).`
      : "Single reference, no ensemble.",
    `Within-primary-photo reference agreement: ${ppf.agreement_pct}%.`,
  ];
  if (images.length > 1) {
    notes.push(`Cross-photo agreement (do all uploads agree on camera height?): ${multiPpf?.cross_photo_agreement_pct ?? 100}%.`);
  }
  notes.push(
    `Photo type: ${vision.view_type} (${vision.view_confidence} confidence).`,
    `Pitch source: ${pitchSource} (${pitch.label}).`,
  );
  if (exifLat !== undefined && exifLng !== undefined) {
    notes.push(`EXIF GPS: ${exifLat.toFixed(5)}, ${exifLng.toFixed(5)}${exifAltitudeM !== undefined ? `; altitude ${Math.round(exifAltitudeM)} m` : ""}.`);
  }
  if (gsdInfo) {
    notes.push(`EXIF GSD signal active: ${Math.round(gsdInfo.altitude_agl_m)} m above ground level (±${gsdInfo.sigma_pct.toFixed(0)}% σ). This is an independent scale signal cross-validated against vision references.`);
  }
  if (exifMake || exifModel) notes.push(`Camera: ${[exifMake, exifModel].filter(Boolean).join(" ")}.`);
  for (const n of vision.notes) notes.push(n);

  const measurement: RoofMeasurement = {
    address: address || (solar.formatted ?? "Photo upload"),
    formatted_address: solar.formatted ?? address ?? "Photo upload",
    lat: solar.lat ?? exifLat ?? 0,
    lng: solar.lng ?? exifLng ?? 0,
    state_code: address ? inferStateFromAddress(address) : "",
    total_sqft,
    footprint_sqft: footprint_sqft_rounded,
    pitch,
    segments: vision.segment_count || 1,
    line_items: deriveLineItems(footprint_sqft_rounded, vision.complexity, vision.segment_count || 1),
    complexity: vision.complexity,
    layers: vision.visible_layers,
    pipe_boots_count: vision.penetrations.plumbing_vents,
    penetrations: vision.penetrations,
    data_sources,
    confidence,
    notes,
    // No satellite proxy URL for photo mode — the user's own photo
    // would need an upload-and-serve flow to support the parallax view.
    // For Tier 1 we omit the image; the measurement card will fall
    // back to its no-image layout.
    satellite_image_url: undefined,
    // Photo-mode-specific diagnostics for the uncertainty UI.
    photo_diagnostics: {
      // reference_count is the number of refs IN THE PRIMARY PHOTO
      // — the ones actually contributing to the area math. Refs from
      // other photos are still useful as a cross-photo agreement
      // signal but don't affect the ppf used for sqft.
      reference_count: ppf.per_ref.length,
      agreement_pct: ppf.agreement_pct,
      per_reference: ppf.per_ref.map((r) => ({
        type: r.type,
        pixels_per_foot_normalized: r.ppf,
        weight: r.weight,
        variance_ft: r.variance_ft,
        confidence: r.confidence,
        photo_index: multiPpf?.primary_photo_index ?? 0,
      })),
      total_photos: images.length,
      primary_photo_index: multiPpf?.primary_photo_index ?? 0,
      cross_photo_agreement_pct: multiPpf?.cross_photo_agreement_pct ?? 100,
      gsd_active: gsdInfo !== null,
      altitude_agl_m: gsdInfo?.altitude_agl_m,
      gsd_sigma_pct: gsdInfo?.sigma_pct,
      pitch_source: pitchSource,
      view_type: vision.view_type,
    },
  };

  return NextResponse.json(measurement);
}
