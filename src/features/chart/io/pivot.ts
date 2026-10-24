import { createLayer } from '../model/defaults';
import { FIT_EPS, fitEvents, type Segment } from './fit';

// Anchored rotate / scale move a noise field's center; a move-only layer compensates.

// Sample step, in beats.
const STEP = 1 / 16;
const BEFORE = 1e-7;

export type Affine = [number, number, number, number, number, number]; // x' = a x + c y + e, y' = b x + d y + f
export type PivotKind = 'scaleX' | 'scaleY' | 'rotate';
export type Point = [number, number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export const apply = (m: Affine, [x, y]: Point): Point => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

// `after` ∘ `before`.
export function compose(after: Affine, before: Affine): Affine {
  const [e, f] = apply(after, [before[4], before[5]]);
  return [
    after[0] * before[0] + after[2] * before[1],
    after[1] * before[0] + after[3] * before[1],
    after[0] * before[2] + after[2] * before[3],
    after[1] * before[2] + after[3] * before[3],
    e,
    f,
  ];
}

// Transform taking the value from `from` to `to` about `anchor`. Rotation is clockwise.
export function relative(kind: PivotKind, from: number, to: number, [ax, ay]: Point): Affine {
  if (kind === 'rotate') {
    const a = ((to - from) * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return [cos, -sin, sin, cos, ax * (1 - cos) - ay * sin, ay * (1 - cos) + ax * sin];
  }
  const r = from === 0 || !Number.isFinite(to / from) ? 1 : to / from;
  return kind === 'scaleX' ? [r, 0, 0, 1, ax * (1 - r), 0] : [1, 0, 0, r, 0, ay * (1 - r)];
}

// Layer adding `offset(t)` to the center, sampled between `times` (float beats); null if not needed.
export function pivotLayer(times: Iterable<number>, offset: (t: number) => Point) {
  const sorted = [...new Set(times)].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const grid: number[] = [];
  sorted.forEach((t, i) => {
    grid.push(t);
    const next = sorted[i + 1];
    if (next !== undefined) for (let s = t + STEP; s < next; s += STEP) grid.push(s);
  });
  const segs: [Segment[], Segment[]] = [[], []];
  let needed = false;
  for (let i = 0; i < grid.length; i++) {
    const t = grid[i];
    const from = offset(t);
    // Last sample holds; earlier ones run to just before the next sample (steps stay sharp).
    const end = grid[i + 1] ?? t;
    const to = i + 1 < grid.length ? offset(end - BEFORE) : from;
    for (const axis of [0, 1]) {
      segs[axis].push({ start: t, end, from: from[axis], to: to[axis] });
      needed ||= Math.abs(from[axis]) > FIT_EPS.move;
    }
  }
  if (!needed) return null;
  const layer = createLayer('Layer 1');
  layer.moveX = fitEvents(segs[0], FIT_EPS.move, 0);
  layer.moveY = fitEvents(segs[1], FIT_EPS.move, 0);
  return layer;
}
