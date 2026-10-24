import { createId } from '@/lib/id';
import { cmp, fromFloat } from '../../model/beat';
import { ease } from '../../model/easing';
import { createLayer, createRangeEvent, NOISE_READY_FLASH } from '../../model/defaults';
import type { Beat, Easing, NoiseField, NumEvent } from '../../model/types';
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
import { toX, toY, type OfficialBlockArea, type OfficialPoint } from './types';

// Semantics follow rpe-next's official import (src/core/official-noise.mjs, noise-areas.mjs).

const SHRINK = 0.25;

const preset = (id: number): Easing => ({ kind: 'preset', id });
const LINEAR = preset(1);
// Official ease types 0-11 by actual curve (official "Sine" is quad, etc.).
const EASINGS = [1, 5, 4, 7, 9, 8, 12, 11, 10, 13, 15, 14].map(preset);
// 12 (InOutQuint) has no preset: split into InQuint + OutQuint halves.
const IN_OUT_QUINT = 12;
const IN_QUINT = preset(15);
const OUT_QUINT = preset(14);
// Hold the start value until the next keyframe / jump to the next value at once.
const ZERO = 13;
const ONE = 14;

const num = (v: unknown, fallback = 0) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

// Music seconds can be off-grid; snap near-tick times, keep others fine.
function toBeat(v: number): Beat {
  const ticks = v * 960;
  return Math.abs(ticks - Math.round(ticks)) < 0.05 ? fromFloat(v, 960) : fromFloat(v, 100000);
}

// Keyframe in chart beats. Its ease drives the segment toward the next keyframe.
interface Frame {
  time: number;
  value: number;
  ease: number;
  anchor?: [number, number];
}

// Float-beat piece; `end === start` is a step.
interface Piece {
  start: number;
  end: number;
  from: number;
  to: number;
  easing: Easing;
}

// Pieces from `a` to `b` using `a`'s ease.
function segment(a: Frame, b: Frame): Piece[] {
  const [t0, t1, v0, v1] = [a.time, b.time, a.value, b.value];
  if (a.ease === ZERO) return [{ start: t0, end: t1, from: v0, to: v0, easing: LINEAR }];
  if (a.ease === ONE) return [{ start: t0, end: t1, from: v1, to: v1, easing: LINEAR }];
  if (a.ease === IN_OUT_QUINT && v0 !== v1) {
    const tm = (t0 + t1) / 2;
    const vm = (v0 + v1) / 2;
    return [
      { start: t0, end: tm, from: v0, to: vm, easing: IN_QUINT },
      { start: tm, end: t1, from: vm, to: v1, easing: OUT_QUINT },
    ];
  }
  return [{ start: t0, end: t1, from: v0, to: v1, easing: EASINGS[a.ease] ?? LINEAR }];
}

// Value curve: steps to the first keyframe, eases between, holds the last.
// Same-time keyframes: the segment ends on the first, the next starts from the last.
function curve(frames: Frame[]): Piece[] {
  const groups: { time: number; first: Frame; last: Frame }[] = [];
  for (const f of frames) {
    const g = groups[groups.length - 1];
    if (g?.time === f.time) g.last = f;
    else groups.push({ time: f.time, first: f, last: f });
  }
  const pieces: Piece[] = [];
  for (let i = 1; i < groups.length; i++) {
    pieces.push(...segment(groups[i - 1].last, { ...groups[i].first, time: groups[i].time }));
  }
  const final = groups[groups.length - 1]?.last;
  if (final)
    pieces.push({
      start: final.time,
      end: final.time,
      from: final.value,
      to: final.value,
      easing: LINEAR,
    });
  return pieces;
}

function valueAt(p: Piece, t: number) {
  if (t >= p.end) return p.to;
  return p.from + (p.to - p.from) * ease(p.easing, (t - p.start) / (p.end - p.start));
}

// Constants already held are dropped; steps / constants get a short length.
function toEvents(pieces: Piece[], held: number): NumEvent[] {
  const out: NumEvent[] = [];
  pieces.forEach((p, i) => {
    const constant = p.from === p.to;
    if (constant && p.to === held) return;
    let end = p.end;
    if (constant) {
      const next = pieces[i + 1]?.start ?? Infinity;
      end = p.start + Math.min(SHRINK, next - p.start, p.end > p.start ? p.end - p.start : SHRINK);
    }
    const start = toBeat(p.start);
    const stop = toBeat(end);
    if (cmp(stop, start) <= 0) return;
    out.push({ id: createId(), start, end: stop, from: p.from, to: p.to, easing: p.easing });
    held = p.to;
  });
  return out;
}

// --- Pivot compensation ---
// Each rotate / scale segment transforms the center about its outgoing anchor,
// relative to its start value; segments accumulate. Moves add on top as offsets.

interface Chain {
  kind: PivotKind;
  // Segment pieces carrying the transform span and anchor; `prefix` = all earlier ones.
  steps: { piece: Piece; from: number; to: number; anchor: Point; prefix: Affine }[];
}

function chain(kind: PivotKind, frames: Frame[], center: Point): Chain {
  const steps: Chain['steps'] = [];
  let prefix = IDENTITY;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    const anchor = a.anchor ?? b.anchor ?? center;
    const pieces =
      a.time === b.time
        ? [{ start: a.time, end: a.time, from: b.value, to: b.value, easing: LINEAR }]
        : segment(a, b);
    // Split halves continue one transform span.
    for (const piece of pieces) steps.push({ piece, from: a.value, to: b.value, anchor, prefix });
    prefix = compose(relative(kind, a.value, b.value, anchor), prefix);
  }
  return { kind, steps };
}

function chainAt({ kind, steps }: Chain, t: number, p: Point): Point {
  let k = -1;
  while (k + 1 < steps.length && steps[k + 1].piece.start <= t) k++;
  if (k < 0) return p;
  const { piece, from, to, anchor, prefix } = steps[k];
  const value = t >= piece.end ? to : valueAt(piece, t);
  return apply(relative(kind, from, value, anchor), apply(prefix, p));
}

function chainLayer(chains: Chain[], center: Point) {
  const times = chains.flatMap(({ steps }) => steps.flatMap(({ piece }) => [piece.start, piece.end]));
  return pivotLayer(times, (t) => {
    let p = center;
    for (const c of chains) p = chainAt(c, t, p);
    return [p[0] - center[0], p[1] - center[1]];
  });
}

const point = (p: OfficialPoint | undefined): [number, number] | undefined =>
  p ? [toX(num(p.x, 0.5)), toY(num(p.y, 0.5))] : undefined;

// `offset` = chart offset in seconds (block times are music time).
// Lossy: the 0.5 s appear fade-in is dropped.
export function officialToNoiseFields(
  list: OfficialBlockArea[] | undefined,
  bpm0: number,
  offset = 0,
): NoiseField[] {
  const beat = (s: unknown) => ((num(s) - offset) * bpm0) / 60;
  return (list ?? []).map((a, i) => {
    const bl = point(a.bottomLeftPercentage) ?? [-250, -150];
    const tr = point(a.topRightPercentage) ?? [250, 150];
    const center: [number, number] = [(bl[0] + tr[0]) / 2, (bl[1] + tr[1]) / 2];

    // Stable sort keeps same-time keyframe order.
    const frames = <T extends { time: number; anchor?: OfficialPoint }>(
      src: T[] | undefined,
      value: (e: T) => number,
      easeType: (e: T) => unknown,
    ): Frame[] =>
      (src ?? [])
        .map((e) => ({
          time: beat(e.time),
          value: value(e),
          ease: Math.round(num(easeType(e))),
          anchor: point(e.anchor),
        }))
        .sort((x, y) => x.time - y.time);

    const f = {
      moveX: frames(
        a.moveEvents,
        (e) => toX(num(e.endPosition?.x, 0.5)),
        (e) => e.easeTypeX,
      ),
      moveY: frames(
        a.moveEvents,
        (e) => toY(num(e.endPosition?.y, 0.5)),
        (e) => e.easeTypeY,
      ),
      // Official rotation is counterclockwise.
      rotate: frames(
        a.rotateEvents,
        (e) => -num(e.rotation),
        (e) => e.easeType,
      ),
      scaleX: frames(
        a.scaleEvents,
        (e) => num(e.scale?.x, 1),
        (e) => e.easeTypeX,
      ),
      scaleY: frames(
        a.scaleEvents,
        (e) => num(e.scale?.y, 1),
        (e) => e.easeTypeY,
      ),
    };

    const base = createLayer('Base');
    base.moveX = toEvents(curve(f.moveX), center[0]);
    base.moveY = toEvents(curve(f.moveY), center[1]);
    base.rotate = toEvents(curve(f.rotate), 0);
    base.scaleX = toEvents(curve(f.scaleX), 1);
    base.scaleY = toEvents(curve(f.scaleY), 1);
    const layers = [base];
    // Scale X, then Y, then rotation.
    const pivots = chainLayer(
      [
        chain('scaleX', f.scaleX, center),
        chain('scaleY', f.scaleY, center),
        chain('rotate', f.rotate, center),
      ],
      center,
    );
    if (pivots) layers.push(pivots);

    const appear = beat(a.appearTime);
    const disappear = Number.isFinite(a.disappearTime)
      ? beat(a.disappearTime)
      : Math.max(appear, beat(a.disableTime));
    const enable = Math.max(appear, beat(a.enableTime));
    const disable = Math.min(disappear, beat(a.disableTime));
    const range = (start: number, end: number, value?: number) =>
      createRangeEvent(toBeat(start), toBeat(end), value);
    const valid = (e: NumEvent) => cmp(e.end, e.start) > 0;

    return {
      id: createId(),
      name: `Noise field ${i}`,
      size: [Math.abs(tr[0] - bl[0]), Math.abs(tr[1] - bl[1])],
      subtract: !!a.isSubtract,
      defaults: { moveX: center[0], moveY: center[1] },
      parentId: null,
      rotateWithParent: true,
      layers,
      visible: [range(appear, disappear)].filter(valid),
      active: disable > enable ? [range(enable, disable, NOISE_READY_FLASH)].filter(valid) : [],
    };
  });
}
