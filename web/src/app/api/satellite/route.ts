// Server-side proxy for Google Static Maps imagery. The Google API key
// stays in process.env on the server and is never exposed to the browser
// or written into any committed artifact. Clients call this route with
// only lat/lng/zoom/size; we attach the key here and stream the image
// bytes back.
//
// Cache hint set to 24h so repeated demo views of the same address don't
// hit the upstream quota.

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ALLOWED_ZOOM = new Set([16, 17, 18, 19, 20, 21]);
const ALLOWED_SIZES = new Set(["400x400", "640x640", "800x800", "1024x1024"]);
const ALLOWED_SCALE = new Set([1, 2]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = parseFloat(url.searchParams.get("lat") ?? "");
  const lng = parseFloat(url.searchParams.get("lng") ?? "");
  const zoom = parseInt(url.searchParams.get("zoom") ?? "20", 10);
  const size = url.searchParams.get("size") ?? "800x800";
  // scale=2 returns the same geographic coverage at 2x pixel density.
  // We use it for the parallax so the CSS scale-up to 2x stays sharp
  // instead of upscaling-blurry.
  const scale = parseInt(url.searchParams.get("scale") ?? "1", 10);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat and lng required as numbers" }, { status: 400 });
  }
  if (!ALLOWED_ZOOM.has(zoom)) {
    return NextResponse.json({ error: "zoom must be 16..21" }, { status: 400 });
  }
  if (!ALLOWED_SIZES.has(size)) {
    return NextResponse.json({ error: "size must be one of 400x400, 640x640, 800x800, 1024x1024" }, { status: 400 });
  }
  if (!ALLOWED_SCALE.has(scale)) {
    return NextResponse.json({ error: "scale must be 1 or 2" }, { status: 400 });
  }

  const KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";
  if (!KEY) {
    return NextResponse.json({ error: "satellite imagery unavailable" }, { status: 503 });
  }

  const upstream = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${size}&scale=${scale}&maptype=satellite&key=${KEY}`;
  const r = await fetch(upstream, { cache: "no-store" });
  if (!r.ok) {
    return NextResponse.json({ error: `upstream ${r.status}` }, { status: 502 });
  }
  const ct = r.headers.get("content-type") ?? "image/png";
  const buf = await r.arrayBuffer();
  return new Response(buf, {
    headers: {
      "content-type": ct,
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
