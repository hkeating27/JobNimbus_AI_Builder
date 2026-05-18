// Raster processing for Google Solar dataLayers.
//
// dataLayers returns a building-mask GeoTIFF/PNG: a per-pixel binary
// telling us which pixels are roof and which aren't. We use this to
// extract a precise polygon boundary of the building, instead of relying
// on Claude vision to "draw" coordinates (which it can't do reliably).
//
// Pipeline:
//   1. fetchMaskBuffer(maskUrl)   — download + decode to grayscale Uint8
//   2. extractBoundary(buf)       — Moore-neighborhood boundary tracing
//   3. simplifyPolygon(pts, eps)  — Douglas-Peucker reduction
//   4. clipToWindow(...)          — convert to normalized image coords
//                                   relative to the static-map view we
//                                   show in the UI
//
// Why this is the proper fix: vision returned approximate pixel coords
// (often miss-sized or wholly hallucinated). Solar's mask is real
// raster data measured from elevation imagery — same source as the
// roof-segment areas. Using it as the polygon source means the overlay
// outline lands ON the actual roof.

import sharp from "sharp";
import { fetchSolarImage } from "./google";

export type Point = [number, number];   // [x, y] in image pixels

// Fetch the mask URL and return:
//  - raw     : 0/255 grayscale Uint8Array, length = width*height
//  - width   : pixel width
//  - height  : pixel height
export async function fetchMaskBuffer(maskUrl: string): Promise<{ raw: Uint8Array; width: number; height: number } | null> {
  const buf = await fetchSolarImage(maskUrl);
  if (!buf) return null;
  try {
    const { data, info } = await sharp(buf)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return {
      raw: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      width: info.width,
      height: info.height,
    };
  } catch {
    return null;
  }
}

// Find the connected component of building pixels closest to the mask
// center (which is the target building — the lat/lng we asked Solar
// about), isolate it, and return its outer boundary as ordered pixel
// coordinates.
//
// Solar dataLayers masks use 0/1 binary values and cover the requested
// radius — typically including 5+ neighboring buildings in dense
// suburbs. We must NOT trace neighbors. The algorithm:
//   1. Find the target connected component (CC) containing the pixel
//      closest to mask center that's "on"
//   2. Build an isolated mask containing ONLY that CC
//   3. Moore-neighborhood trace its outer boundary
export function extractBoundary(mask: Uint8Array, width: number, height: number): Point[] {
  const idx = (x: number, y: number) => y * width + x;
  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;

  // 1. Find the closest "on" pixel to the mask center via expanding
  //    diamond search (taxicab distance).
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  let seedX = -1, seedY = -1;
  const maxRadius = Math.max(width, height);
  outer: for (let r = 0; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) + Math.abs(dy) !== r) continue;
        const x = cx + dx, y = cy + dy;
        if (!inBounds(x, y)) continue;
        if (mask[idx(x, y)] > 0) { seedX = x; seedY = y; break outer; }
      }
    }
  }
  if (seedX < 0) return [];

  // 2. Flood-fill from seed to mark the target connected component.
  //    Use 4-connectivity for the flood (neighbors share an edge); the
  //    boundary tracer below uses 8-connectivity which is fine.
  const cc = new Uint8Array(width * height);
  const stack: number[] = [seedX, seedY];
  while (stack.length > 0) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    if (!inBounds(x, y)) continue;
    if (cc[idx(x, y)] === 1) continue;
    if (mask[idx(x, y)] === 0) continue;
    cc[idx(x, y)] = 1;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }

  // 3. Find topmost-leftmost pixel of the isolated CC as the boundary
  //    trace seed.
  const isOn = (x: number, y: number) => inBounds(x, y) && cc[idx(x, y)] === 1;
  let traceX = -1, traceY = -1;
  outerTrace: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isOn(x, y)) { traceX = x; traceY = y; break outerTrace; }
    }
  }
  if (traceX < 0) return [];
  const seedXFinal = traceX, seedYFinal = traceY;

  // 8-connected neighborhood, ordered clockwise starting from the
  // direction we entered (above-left = "we came from up").
  const NEIGHBORS: Point[] = [
    [-1, -1], [0, -1], [1, -1],
    [1, 0], [1, 1], [0, 1],
    [-1, 1], [-1, 0],
  ];

  const polygon: Point[] = [[seedXFinal, seedYFinal]];
  let curr: Point = [seedXFinal, seedYFinal];
  let backtrackIdx = 7;

  const maxIter = (width + height) * 4;
  for (let step = 0; step < maxIter; step++) {
    let foundNext = false;
    for (let i = 0; i < 8; i++) {
      const checkIdx = (backtrackIdx + 1 + i) % 8;
      const [dx, dy] = NEIGHBORS[checkIdx];
      const nx = curr[0] + dx;
      const ny = curr[1] + dy;
      if (isOn(nx, ny)) {
        if (nx === seedXFinal && ny === seedYFinal && polygon.length > 2) {
          return polygon;
        }
        polygon.push([nx, ny]);
        backtrackIdx = (checkIdx + 4) % 8;
        curr = [nx, ny];
        foundNext = true;
        break;
      }
    }
    if (!foundNext) break;
  }
  return polygon;
}

// Douglas-Peucker polyline simplification. Reduces a noisy boundary
// (potentially hundreds of pixel-stepped points) down to the visually
// meaningful corners. epsilon is the perpendicular distance threshold
// in pixels — points within this distance of a connecting line get
// dropped.
export function simplifyPolygon(points: Point[], epsilon = 1.5): Point[] {
  if (points.length < 3) return points;
  return dp(points, epsilon);
}

function dp(points: Point[], eps: number): Point[] {
  if (points.length < 3) return points;
  const start = points[0];
  const end = points[points.length - 1];
  let maxDist = 0;
  let idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], start, end);
    if (d > maxDist) { maxDist = d; idx = i; }
  }
  if (maxDist > eps) {
    const left = dp(points.slice(0, idx + 1), eps);
    const right = dp(points.slice(idx), eps);
    return [...left.slice(0, -1), ...right];
  }
  return [start, end];
}

function perpDist(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) {
    const ddx = p[0] - a[0];
    const ddy = p[1] - a[1];
    return Math.sqrt(ddx * ddx + ddy * ddy);
  }
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const proj: Point = [a[0] + t * dx, a[1] + t * dy];
  const ddx = p[0] - proj[0];
  const ddy = p[1] - proj[1];
  return Math.sqrt(ddx * ddx + ddy * ddy);
}

// Solar's dataLayers mask is centered on the same lat/lng as our
// static-map view but covers a larger area (radiusMeters argument we
// passed). To overlay the mask polygon on the static map image, we
// need to convert mask pixel coords → static-map normalized coords.
//
// Given:
//   - maskW, maskH    : mask raster dimensions
//   - radiusMeters    : the radius we requested when calling dataLayers
//   - viewSizeMeters  : the static-map's coverage in meters (computed
//                       from zoom + size)
//   - lat, lng        : building center (same for both)
//
// Both rasters are in equirectangular projection at this scale, so the
// transformation is a simple linear scale + translate.
export function maskPolygonToStaticMapNormalized(
  polygon: Point[],
  maskW: number,
  maskH: number,
  maskRadiusMeters: number,
  staticMapPixelSizeMeters: number,
  staticMapPx: number,
): Point[] {
  // Mask: pixel size in meters
  const maskPxSize = (maskRadiusMeters * 2) / Math.min(maskW, maskH);
  return polygon.map(([px, py]) => {
    // Mask pixel offset from center
    const dxFromCenterPx = px - maskW / 2;
    const dyFromCenterPx = py - maskH / 2;
    // Convert to meters
    const dxM = dxFromCenterPx * maskPxSize;
    const dyM = dyFromCenterPx * maskPxSize;
    // Convert to static-map pixels
    const staticX = staticMapPx / 2 + dxM / staticMapPixelSizeMeters;
    const staticY = staticMapPx / 2 + dyM / staticMapPixelSizeMeters;
    // Normalize to [0, 1]
    return [staticX / staticMapPx, staticY / staticMapPx] as Point;
  });
}

// Compute the static-map's pixel size in meters at a given lat + zoom.
// Web Mercator standard formula.
export function staticMapPixelSizeMeters(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}
