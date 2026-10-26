import { add, cmp, fromFloat, toFloat } from '../model/beat';
import { EASING_NAMES, ease } from '../model/easing';
import {
  CHANNELS,
  type Beat,
  type Channel,
  type Chart,
  type Id,
  type Note,
  type NumEvent,
} from '../model/types';
import { addNotes, findOwner, removeNotes, updateEvents, updateNotes } from './commands';

// Batch edits: a value ramps from `lower` to `upper` over the selection's time span
// (through `easing`), is scaled by the repeating `sequence`, then combined via `op`.

export const MULTI_OPS = ['add', 'multiply', 'equate', 'min', 'max'] as const;
export type MultiOp = (typeof MULTI_OPS)[number];

export interface Ramp {
  lower: number;
  upper: number;
  op: MultiOp;
  // RPE preset id.
  easing: number;
  // Multipliers by item index, repeating; e.g. [1, -1] alternates sign.
  sequence: number[];
}

export const NOTE_ATTRS = [
  'x',
  'speed',
  'size',
  'yOffset',
  'visibleTime',
  'alpha',
  'start',
  'end',
  'line',
] as const;
export type NoteAttr = (typeof NOTE_ATTRS)[number];

export const EVENT_ATTRS = ['values', 'from', 'to', 'start', 'end', 'easing'] as const;
export type EventAttr = (typeof EVENT_ATTRS)[number];
export type EventTarget = Channel | 'all';

export const isTimeAttr = (attr: NoteAttr | EventAttr) => attr === 'start' || attr === 'end';

// Space- or comma-separated numbers; empty = [1].
export function parseSequence(text: string): number[] | null {
  const parts = text.split(/[\s,]+/).filter(Boolean);
  if (!parts.length) return [1];
  const nums = parts.map(Number);
  return nums.every(Number.isFinite) ? nums : null;
}

const rampAt = (r: Ramp, t: number, n: number) =>
  (r.lower + (r.upper - r.lower) * ease({ kind: 'preset', id: r.easing }, t)) *
  (r.sequence[n % r.sequence.length] ?? 1);

export function applyOp(op: MultiOp, cur: number, v: number) {
  if (op === 'add') return cur + v;
  if (op === 'multiply') return cur * v;
  if (op === 'min') return Math.min(cur, v);
  if (op === 'max') return Math.max(cur, v);
  return v;
}

const round = (v: number) => Math.round(v * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Adds stay exact; other ops snap to 1/960 beat. Never below 0.
function beatOp(op: MultiOp, cur: Beat, v: number): Beat {
  const next =
    op === 'add' ? add(cur, fromFloat(v, 960)) : fromFloat(applyOp(op, toFloat(cur), v), 960);
  return toFloat(next) < 0 ? [0, 0, 1] : next;
}

// Progress 0–1 of `beat` across [lo, hi]; falls back to index order when the span is empty.
const progress = (beat: number, lo: number, hi: number, i: number, count: number) =>
  hi > lo ? (beat - lo) / (hi - lo) : count > 1 ? i / (count - 1) : 0;

function noteValue(attr: NoteAttr, n: Note, v: number, op: MultiOp): Note {
  if (attr === 'start') {
    const beat = beatOp(op, n.beat, v);
    if (n.endBeat && cmp(beat, n.endBeat) >= 0) {
      throw new Error('A hold note would start at or after its end time.');
    }
    return { ...n, beat };
  }
  if (attr === 'end') {
    if (n.type !== 'hold' || !n.endBeat) return n;
    const endBeat = beatOp(op, n.endBeat, v);
    return cmp(endBeat, n.beat) > 0 ? { ...n, endBeat } : n;
  }
  if (attr === 'line') return n;
  const next = applyOp(op, n[attr], v);
  if (attr === 'alpha') return { ...n, alpha: clamp(Math.round(next), 0, 255) };
  if (attr === 'size' || attr === 'visibleTime') return { ...n, [attr]: Math.max(0, round(next)) };
  return { ...n, [attr]: round(next) };
}

export function multiEditNotes(
  chart: Chart,
  lineId: Id,
  ids: Id[],
  attr: NoteAttr,
  ramp: Ramp,
): Chart {
  const line = chart.lines.find((l) => l.id === lineId);
  const set = new Set(ids);
  const notes = line?.notes.filter((n) => set.has(n.id)) ?? [];
  if (!notes.length) return chart;
  const lo = toFloat(notes[0].beat);
  const hi = toFloat(notes[notes.length - 1].beat);
  const values = new Map(
    notes.map((n, i) => [
      n.id,
      rampAt(ramp, progress(toFloat(n.beat), lo, hi, i, notes.length), i),
    ]),
  );

  if (attr !== 'line') {
    return updateNotes(chart, lineId, ids, (n) => noteValue(attr, n, values.get(n.id)!, ramp.op));
  }

  // Line attribute: index into chart.lines.
  const from = chart.lines.indexOf(line!);
  const moves = new Map<number, Note[]>();
  for (const n of notes) {
    const to = clamp(
      Math.round(applyOp(ramp.op, from, values.get(n.id)!)),
      0,
      chart.lines.length - 1,
    );
    if (to !== from) moves.set(to, [...(moves.get(to) ?? []), n]);
  }
  let next = chart;
  for (const [to, moved] of moves) {
    next = removeNotes(
      next,
      lineId,
      moved.map((n) => n.id),
    );
    next = addNotes(next, chart.lines[to].id, moved);
  }
  return next;
}

const LAST_EASING = EASING_NAMES.length;

function eventValue(
  attr: EventAttr,
  channel: Channel,
  e: NumEvent,
  vStart: number,
  vEnd: number,
  op: MultiOp,
): NumEvent {
  const num = (cur: number, v: number) => {
    const next = applyOp(op, cur, v);
    return channel === 'alpha' ? clamp(Math.round(next), 0, 255) : round(next);
  };
  if (attr === 'start') {
    const start = beatOp(op, e.start, vStart);
    return cmp(start, e.end) < 0 ? { ...e, start } : e;
  }
  if (attr === 'end') {
    const end = beatOp(op, e.end, vEnd);
    return cmp(end, e.start) > 0 ? { ...e, end } : e;
  }
  if (attr === 'easing') {
    const cur = e.easing.kind === 'preset' ? e.easing.id : 1;
    const id = clamp(Math.round(applyOp(op, cur, vStart)), 1, LAST_EASING);
    const clip = e.easing.kind === 'preset' ? e.easing.clip : undefined;
    return { ...e, easing: { kind: 'preset', id, ...(clip && { clip }) } };
  }
  // Locked events keep from = to.
  if (e.locked) {
    const v = num(attr === 'to' ? e.to : e.from, attr === 'to' ? vEnd : vStart);
    return { ...e, from: v, to: v };
  }
  return {
    ...e,
    from: attr === 'to' ? e.from : num(e.from, vStart),
    to: attr === 'from' ? e.to : num(e.to, vEnd),
  };
}

// Layer channel events only; returns the same chart when nothing matches or edits overlap.
export function multiEditEvents(
  chart: Chart,
  ownerId: Id,
  layerId: Id | null,
  ids: Id[],
  target: EventTarget,
  attr: EventAttr,
  ramp: Ramp,
): Chart {
  const owner = findOwner(chart, ownerId);
  if (!owner || !('layers' in owner)) return chart;
  const layer = owner.layers.find((y) => y.id === layerId) ?? owner.layers[0];
  if (!layer) return chart;
  const set = new Set(ids);
  const tracks = (target === 'all' ? CHANNELS : [target]).map(
    (c) => [c, layer[c].filter((e) => set.has(e.id))] as const,
  );
  const all = tracks.flatMap(([, events]) => events);
  if (!all.length) return chart;
  const lo = Math.min(...all.map((e) => toFloat(e.start)));
  const hi = Math.max(...all.map((e) => toFloat(e.end)));

  // Index runs per channel so sequences line up across channels.
  const edits = new Map<Id, NumEvent>();
  for (const [channel, events] of tracks) {
    events.forEach((e, i) => {
      const at = (beat: number) => rampAt(ramp, progress(beat, lo, hi, i, events.length), i);
      edits.set(
        e.id,
        eventValue(attr, channel, e, at(toFloat(e.start)), at(toFloat(e.end)), ramp.op),
      );
    });
  }
  return updateEvents(chart, ownerId, layer.id, [...edits.keys()], (e) => edits.get(e.id) ?? e);
}
