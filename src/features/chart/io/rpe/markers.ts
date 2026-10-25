import { createId } from '@/lib/id';
import { cmp, fromFloat } from '../../model/beat';
import { createLayer, NOISE_READY_FLASH } from '../../model/defaults';
import { ease } from '../../model/easing';
import type { ColorEvent, EventLayer, Id, NoiseField, NumEvent } from '../../model/types';
import { pivotLayer } from '../pivot';

// RPE noise markers: texture lines named isSubtract0.png (normal) / isSubtract1.png (subtract).
// Semantics follow Phira-Pro (prpr/src/core/rpe_block.rs, chart.rs).

// Pixel size of the standard marker PNGs.
export const MARKER_SIZE: [number, number] = [900, 900];

// True = subtract, false = normal, null = not a marker.
export function markerKind(texture: string | null | undefined): boolean | null {
  const name = texture?.split(/[\\/]/).pop()?.toLowerCase();
  return name === 'issubtract0.png' ? false : name === 'issubtract1.png' ? true : null;
}

// Width and height from a PNG header.
export function pngSize(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const w = view.getUint32(16);
  const h = view.getUint32(20);
  return w > 0 && h > 0 ? [w, h] : null;
}

type Phase = 'hidden' | 'disabled' | 'active';

// Float beats; `life` groups spans of one appear → disappear cycle.
interface Span {
  start: number;
  end: number;
  phase: Phase;
  life: number;
}

// Speed event start values: 1 appear, 2 enable, 3 disable, 4 disappear.
// A code not above the previous one starts a new cycle.
function codeSpans(codes: { t: number; code: number }[]): Span[] {
  const spans: Span[] = [];
  let life = 0;
  let open = false;
  let previous = 0;
  const finish = (end: number) => {
    for (const s of spans) if (s.life === life) s.end = Math.min(s.end, end);
    life++;
    open = false;
  };
  for (const { t, code } of codes) {
    if (code <= previous && open) finish(t);
    const last = spans[spans.length - 1];
    if (last) last.end = Math.min(last.end, t);
    if (code === 4) finish(t);
    else {
      open = true;
      spans.push({ start: t, end: Infinity, phase: code === 2 ? 'active' : 'disabled', life });
    }
    previous = code;
  }
  return spans.filter((s) => s.end > s.start);
}

const ALPHA_DISABLED = 128;
const alphaPhase = (a: number): Phase =>
  !Number.isFinite(a) || a <= 0 ? 'hidden' : a <= ALPHA_DISABLED ? 'disabled' : 'active';

// Fallback without codes: alpha <= 0 hidden, <= 128 disabled, above that active.
function alphaSpans(alpha: (t: number) => number, knots: number[]): Span[] {
  const sorted = [...new Set([0, ...knots])].sort((a, b) => a - b);
  const bounds = [...sorted];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[i + 1] - Math.min((sorted[i + 1] - a) * 1e-8, 1e-8);
    const left = alpha(a);
    const right = alpha(b);
    for (const th of [0, ALPHA_DISABLED]) {
      if (left > th === right > th) continue;
      let lo = a;
      let hi = b;
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2;
        if (alpha(mid) > th === left > th) lo = mid;
        else hi = mid;
      }
      bounds.push(hi);
    }
  }
  bounds.sort((a, b) => a - b);
  const spans: Span[] = [];
  let life = 0;
  bounds.forEach((start, i) => {
    const end = bounds[i + 1] ?? Infinity;
    const phase = alphaPhase(alpha(Number.isFinite(end) ? (start + end) / 2 : start));
    const last = spans[spans.length - 1];
    if (last?.phase === phase) last.end = end;
    else {
      if (phase === 'hidden') life++;
      spans.push({ start, end, phase, life });
    }
  });
  return spans.filter((s) => s.phase !== 'hidden' && s.end > s.start);
}

const range = (start: number, end: number, value = 1): NumEvent => ({
  id: createId(),
  start: fromFloat(start, 960),
  end: fromFloat(end, 960),
  from: value,
  to: value,
  easing: { kind: 'preset', id: 1 },
  locked: true,
});

// Shown cycles and touchable spans; ready flashes only after a disabled span of the same cycle.
function ranges(spans: Span[], last: number) {
  const visible: NumEvent[] = [];
  const active: NumEvent[] = [];
  const end = (s: Span) => (Number.isFinite(s.end) ? s.end : Math.max(last, s.start + 1));
  const shown: { start: number; end: number }[] = [];
  spans.forEach((s, i) => {
    const cur = shown[shown.length - 1];
    if (cur && Math.abs(cur.end - s.start) < 1e-9) cur.end = end(s);
    else shown.push({ start: s.start, end: end(s) });
    if (s.phase !== 'active') return;
    const prev = spans[i - 1];
    const ready = prev?.life === s.life && prev.phase === 'disabled' && prev.end === s.start;
    active.push(range(s.start, end(s), ready ? NOISE_READY_FLASH : 0));
  });
  for (const r of shown) visible.push(range(r.start, r.end));
  const valid = (e: NumEvent) => cmp(e.end, e.start) > 0;
  return { visible: visible.filter(valid), active: active.filter(valid) };
}

// Summed layer value at float beat t (holds like the runtime; layer 0 falls back to `base`).
function layerSum(layers: EventLayer[], key: keyof EventLayer, t: number, base: number) {
  let sum = 0;
  layers.forEach((layer, i) => {
    const list = layer[key] as NumEvent[];
    let v = i ? 0 : base;
    for (const e of list) {
      const s = e.start[0] + e.start[1] / e.start[2];
      if (s > t) break;
      const en = e.end[0] + e.end[1] / e.end[2];
      v =
        t >= en || e.from === e.to
          ? e.to
          : e.from + (e.to - e.from) * ease(e.easing, (t - s) / (en - s));
    }
    sum += v;
  });
  return sum;
}

const knotsOf = (layers: EventLayer[], keys: (keyof EventLayer)[]) =>
  layers.flatMap((y) =>
    keys.flatMap((k) =>
      (y[k] as NumEvent[]).flatMap((e) => [
        e.start[0] + e.start[1] / e.start[2],
        e.end[0] + e.end[1] / e.end[2],
      ]),
    ),
  );

export interface MarkerInput {
  name: string;
  subtract: boolean;
  // Texture pixels.
  size: [number, number];
  anchor: [number, number];
  // The line's layers in chart beats; only move / rotate / scale are kept.
  layers: EventLayer[];
  // Alpha layers, for the lifecycle fallback.
  alphaLayers: EventLayer[];
  // Speed event starts in float chart beats.
  codes: { t: number; code: number }[];
  color: ColorEvent[];
  parentId: Id | null;
  rotateWithParent: boolean;
  // Float beat where open-ended cycles stop.
  last: number;
}

export function markerToNoise(m: MarkerInput): NoiseField {
  const codes = m.codes
    .filter((c) => Number.isFinite(c.t) && [1, 2, 3, 4].includes(c.code))
    .sort((a, b) => a.t - b.t);
  const spans = codes.length
    ? codeSpans(codes)
    : alphaSpans((t) => layerSum(m.alphaLayers, 'alpha', t, 0), knotsOf(m.alphaLayers, ['alpha']));
  const layers = m.layers.map((y) => ({
    ...createLayer(y.name),
    moveX: y.moveX,
    moveY: y.moveY,
    rotate: y.rotate,
    scaleX: y.scaleX,
    scaleY: y.scaleY,
  }));
  // Moves position the anchor: shift the center by the rotated, scaled anchor offset.
  const [w, h] = m.size;
  const ox = (0.5 - m.anchor[0]) * w;
  const oy = (0.5 - m.anchor[1]) * h;
  const pivots =
    ox || oy
      ? pivotLayer([0, ...knotsOf(layers, ['rotate', 'scaleX', 'scaleY'])], (t) => {
          const dx = ox * layerSum(layers, 'scaleX', t, 1);
          const dy = oy * layerSum(layers, 'scaleY', t, 1);
          // Positive rotation is clockwise.
          const a = (-layerSum(layers, 'rotate', t, 0) * Math.PI) / 180;
          return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
        })
      : null;
  if (pivots) layers.push({ ...pivots, name: `Layer ${layers.length}` });
  return {
    id: createId(),
    name: m.name,
    size: [w, h],
    subtract: m.subtract,
    parentId: m.parentId,
    rotateWithParent: m.rotateWithParent,
    layers,
    ...ranges(spans, m.last),
    color: m.color,
  };
}
