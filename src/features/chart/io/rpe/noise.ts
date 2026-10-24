import { createId } from '@/lib/id';
import { add, cmp, toFloat } from '../../model/beat';
import { createLayer, NOISE_READY_FLASH } from '../../model/defaults';
import { ease } from '../../model/easing';
import type { Beat, Channel, Easing, NoiseField, NumEvent } from '../../model/types';
import {
  apply,
  compose,
  IDENTITY,
  pivotLayer,
  relative,
  type Affine,
  type PivotKind,
  type Point,
} from '../pivot';
import { beat, easing, num, numEvents } from './fromRpe';
import type { RpeChart, RpeNoiseArea, RpeNoiseEvent } from './types';

// Semantics follow Phira-Pro's rpe-next block areas (prpr/src/core/rpe_next_block.rs).

const CHANNELS: [keyof RpeNoiseArea, Channel][] = [
  ['moveXEvents', 'moveX'],
  ['moveYEvents', 'moveY'],
  ['rotateEvents', 'rotate'],
  ['scaleXEvents', 'scaleX'],
  ['scaleYEvents', 'scaleY'],
];

// Applied in this order.
const PIVOTS: [keyof RpeNoiseArea, PivotKind][] = [
  ['scaleXEvents', 'scaleX'],
  ['scaleYEvents', 'scaleY'],
  ['rotateEvents', 'rotate'],
];

const range = (start: Beat, end: Beat, value = 1): NumEvent => ({
  id: createId(),
  start,
  end,
  from: value,
  to: value,
  easing: { kind: 'preset', id: 1 },
  locked: true,
});

// Seconds; absent / true = default, false = none.
const flash = (v: number | boolean | undefined) =>
  typeof v === 'boolean'
    ? v
      ? NOISE_READY_FLASH
      : 0
    : Math.round(Math.max(0, num(v, NOISE_READY_FLASH)) * 1000) / 1000;

const valid = (events: NumEvent[]) => events.filter((e) => cmp(e.end, e.start) > 0);

// Zero-length events (rpe-next instant steps) jump to their value: short holds, cut at the next event.
const steps = (events: NumEvent[]) =>
  valid(
    events.map((e, i) => {
      if (cmp(e.end, e.start) > 0) return e;
      const next = events[i + 1];
      const end = add(e.start, [0, 1, 4]);
      return { ...e, from: e.to, end: next && cmp(next.start, end) < 0 ? next.start : end };
    }),
  );

// --- Pivot compensation ---
// Each rotate / scale event transforms the center about its anchor, relative to its
// transform start; earlier events accumulate into `prefix`.

interface Step {
  start: number;
  end: number;
  from: number;
  to: number;
  easing: Easing;
  ref: number;
  anchor: Point;
  prefix: Affine;
}

const point = (p: RpeNoiseEvent['anchor']): Point | undefined =>
  p && Number.isFinite(p.x) && Number.isFinite(p.y) ? [p.x, p.y] : undefined;

function chain(kind: PivotKind, list: RpeNoiseEvent[] | undefined, center: Point): Step[] {
  // Stable sort keeps same-time step order.
  const raw = (list ?? [])
    .map((e) => {
      const start = toFloat(beat(e.startTime));
      const from = num(e.start, 0);
      const to = num(e.end, 0);
      return {
        start,
        end: Math.max(start, toFloat(beat(e.endTime))),
        from,
        to,
        easing: easing(e),
        ref: num(e.transformStart, from),
        refEnd: num(e.transformEnd, to),
        anchor: point(e.anchor) ?? center,
      };
    })
    .sort((a, b) => a.start - b.start);
  let prefix = IDENTITY;
  return raw.map((s, i) => {
    const prev = raw[i - 1];
    if (prev) {
      const done = relative(kind, prev.ref, prev.refEnd, prev.anchor);
      prefix = compose(relative(kind, prev.refEnd, s.ref, prev.anchor), compose(done, prefix));
    }
    return { ...s, prefix };
  });
}

function valueAt(s: Step, t: number) {
  if (s.from === s.to || t >= s.end) return s.to;
  return s.from + (s.to - s.from) * ease(s.easing, (t - s.start) / (s.end - s.start));
}

function chainAt(kind: PivotKind, steps: Step[], t: number, p: Point): Point {
  let k = -1;
  while (k + 1 < steps.length && steps[k + 1].start <= t) k++;
  if (k < 0) return p;
  const s = steps[k];
  return apply(relative(kind, s.ref, valueAt(s, t), s.anchor), apply(s.prefix, p));
}

function anchorLayer(a: RpeNoiseArea, center: Point) {
  const chains = PIVOTS.map(([key, kind]) => ({
    kind,
    steps: chain(kind, a[key] as RpeNoiseEvent[] | undefined, center),
  }));
  const times = chains.flatMap(({ steps }) => steps.flatMap((s) => [s.start, s.end]));
  return pivotLayer(times, (t) => {
    let p = center;
    for (const { kind, steps } of chains) p = chainAt(kind, steps, t, p);
    return [p[0] - center[0], p[1] - center[1]];
  });
}

const maxBeat = (a: Beat, b: Beat) => (cmp(a, b) > 0 ? a : b);
const minBeat = (a: Beat, b: Beat) => (cmp(a, b) < 0 ? a : b);

// rpe-next areas use `bottomLeft` / `topRight`; percentage (official-style) ones are skipped.
export const isRpeNextArea = (a: unknown): a is RpeNoiseArea =>
  !!a && typeof a === 'object' && ('bottomLeft' in a || 'topRight' in a);

export const rpeNoiseAreas = (rpe: RpeChart) =>
  (rpe.blockAreaList ?? rpe.BlockAreaList ?? []).filter(isRpeNextArea);

// Lossy: link groups, hooks and noise layers are dropped.
export function rpeToNoiseFields(list: RpeNoiseArea[]): NoiseField[] {
  return list.map((a, i) => {
    const bl = { x: num(a.bottomLeft?.x, -250), y: num(a.bottomLeft?.y, -150) };
    const tr = { x: num(a.topRight?.x, 250), y: num(a.topRight?.y, 150) };
    const center: Point = [(bl.x + tr.x) / 2, (bl.y + tr.y) / 2];
    const base = createLayer('Base');
    for (const [key, channel] of CHANNELS) {
      base[channel] = steps(numEvents(a[key] as RpeNoiseEvent[] | undefined));
    }
    const pivots = anchorLayer(a, center);
    const appear = beat(a.appearTime);
    const disappear = beat(a.disappearTime);
    return {
      id: createId(),
      name: a.Name || `Noise field ${i}`,
      size: [Math.abs(tr.x - bl.x), Math.abs(tr.y - bl.y)],
      subtract: !!a.isInvert,
      defaults: { moveX: center[0], moveY: center[1] },
      parentId: null,
      rotateWithParent: true,
      layers: pivots ? [base, pivots] : [base],
      visible: valid([range(appear, disappear)]),
      // Clipped to the shown range.
      active: valid(
        (a.activeIntervals ?? []).map((r) =>
          range(
            maxBeat(beat(r.startTime), appear),
            minBeat(beat(r.endTime), disappear),
            flash(r.readyFlash),
          ),
        ),
      ).sort((x, y) => cmp(x.start, y.start)),
    };
  });
}
