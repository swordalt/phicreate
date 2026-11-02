import type { PreviewSelectType } from '@/features/settings/types';

type Point = [number, number];

// A selectable object as drawn this frame; quad in device pixels.
export interface PreviewHit {
  kind: PreviewSelectType;
  id: string;
  // Owning line, for notes.
  lineId?: string;
  quad: Point[];
}

// Gathers hits of the given kinds in draw order (topmost last).
export interface HitCollector {
  kinds: ReadonlySet<PreviewSelectType>;
  out: PreviewHit[];
}

export const transformPoints = (m: DOMMatrix, points: number[][]): Point[] =>
  points.map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);

export const rectPoints = (x: number, y: number, w: number, h: number) => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const k = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - ax - k * dx, py - ay - k * dy);
}

// Inside the quad, or within `tol` of its edge.
function contains(quad: Point[], x: number, y: number, tol: number) {
  let inside = false;
  let near = Infinity;
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
    const [xi, yi] = quad[i];
    const [xj, yj] = quad[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    near = Math.min(near, segmentDistance(x, y, xi, yi, xj, yj));
  }
  return inside || near <= tol;
}

// Hits under a device point, topmost first, one per object.
export function hitsAt(hits: PreviewHit[], x: number, y: number, tol: number) {
  const seen = new Set<string>();
  const out: PreviewHit[] = [];
  for (let k = hits.length - 1; k >= 0; k--) {
    const hit = hits[k];
    if (seen.has(hit.id) || !contains(hit.quad, x, y, tol)) continue;
    seen.add(hit.id);
    out.push(hit);
  }
  return out;
}

// Outlines every quad of the object, in device pixels.
export function outlineHit(ctx: CanvasRenderingContext2D, hits: PreviewHit[], id: string) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  for (const hit of hits) {
    if (hit.id !== id) continue;
    ctx.moveTo(hit.quad[0][0], hit.quad[0][1]);
    for (let i = 1; i < hit.quad.length; i++) ctx.lineTo(hit.quad[i][0], hit.quad[i][1]);
    ctx.closePath();
  }
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}
