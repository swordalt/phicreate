import { createId } from '@/lib/id';
import { cmp, fromFloat, toFloat } from '../../model/beat';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  createChart,
  createLine,
  createNote,
  withDefaults,
} from '../../model/defaults';
import { ease } from '../../model/easing';
import type { Channel, Chart, Easing, JudgeLine, NoteType, NumEvent } from '../../model/types';

// PEC file space: 2048 x 1400, origin bottom-left, rotation clockwise.
const PEC_W = 2048;
const PEC_H = 1400;
// PhiEditer shifts the stored offset by 175 ms.
const OFFSET_SHIFT_MS = 175;
// PEC speed / 7 = official speed; official 1 = 0.6 frame heights / s, PhiCreate 1 = 120 units / s.
const SPEED_SCALE = (0.6 * CANVAS_HEIGHT) / 120 / 7;
const DENSITY = 960;
// Instant events are shortened to this many beats.
const SHRINK = 0.25;
const LINEAR: Easing = { kind: 'preset', id: 1 };

// An instant set (end === start) or an eased change to `to`.
interface Step {
  start: number;
  end: number;
  to: number;
  easing: Easing;
}

interface PecNote {
  line: number;
  type: NoteType;
  start: number;
  end: number;
  x: number;
  above: boolean;
  fake: boolean;
  speed: number;
  size: number;
}

const NOTE_TYPE: Record<string, NoteType> = { n1: 'tap', n2: 'hold', n3: 'flick', n4: 'drag' };
const HELD: Record<Channel, number> = {
  moveX: 0,
  moveY: 0,
  rotate: 0,
  alpha: 0,
  speed: 10,
  scaleX: 1,
  scaleY: 1,
};

const num = (v: string | undefined, fallback = 0) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : fallback;
};

const beat = (t: number) => fromFloat(t, DENSITY);
const clean = (text: string) => text.replace(/^﻿/, '');

// Turns steps into events; each eased step starts from the value reached by then.
function buildEvents(steps: Step[], held: number): NumEvent[] {
  const sorted = steps
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.start - b.s.start || a.i - b.i)
    .map(({ s }) => s);
  const out: NumEvent[] = [];
  let value = held;
  let active: { start: number; end: number; from: number; to: number; easing: Easing } | null =
    null;
  const valueAt = (t: number) =>
    active && t < active.end
      ? active.from +
        (active.to - active.from) * ease(active.easing, (t - active.start) / (active.end - active.start))
      : value;
  const push = (start: number, end: number, from: number, to: number, easing: Easing) => {
    if (cmp(beat(end), beat(start)) <= 0) return;
    out.push({ id: createId(), start: beat(start), end: beat(end), from, to, easing });
  };

  sorted.forEach((s, k) => {
    const from = valueAt(s.start);
    // Cut a running ease where this step takes over.
    if (active && s.start < active.end) {
      const last = out[out.length - 1];
      const at = beat(s.start);
      if (last && cmp(last.end, at) > 0) {
        if (cmp(at, last.start) <= 0) out.pop();
        else {
          last.end = at;
          last.to = from;
          last.easing = LINEAR;
        }
      }
    }
    active = null;
    value = s.to;
    if (s.end > s.start) {
      push(s.start, s.end, from, s.to, s.easing);
      active = { start: s.start, end: s.end, from, to: s.to, easing: s.easing };
      return;
    }
    if (s.to === from) return;
    const next = sorted[k + 1]?.start ?? Infinity;
    push(s.start, s.start + Math.min(SHRINK, next - s.start), s.to, s.to, LINEAR);
  });
  return out;
}

export const PEC_SNIFF_BYTES = 4096;

// Content sniff on the start of the file: a numeric offset line followed by command lines.
export function isPecText(text: string): boolean {
  const lines = clean(text.slice(0, PEC_SNIFF_BYTES))
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return (
    lines.length > 1 &&
    /^-?\d+(\.\d+)?$/.test(lines[0]) &&
    lines.slice(1, 20).some((l) => /^(bp|c[vpdamrf]|n[1-4])\s/.test(l))
  );
}

// Converts a PhiEdit (.pec) chart. Lossy: opacity -1 (hidden notes) becomes 0.
export function pecToChart(text: string): Chart {
  // Streamed line by line: big charts have millions of lines.
  const lines = clean(text).split(/\r?\n/);
  const offset = num(lines[0]?.trim().split(/\s+/)[0]);

  const bpms: { beat: number; bpm: number }[] = [];
  const steps = new Map<number, Partial<Record<Channel, Step[]>>>();
  const notes: PecNote[] = [];
  let lineCount = 1;
  let lastNote: PecNote | undefined;

  const add = (line: number, channel: Channel, step: Step) => {
    const channels = steps.get(line) ?? {};
    (channels[channel] ??= []).push(step);
    steps.set(line, channels);
    lineCount = Math.max(lineCount, line + 1);
  };
  const set = (line: number, channel: Channel, t: number, to: number) =>
    add(line, channel, { start: t, end: t, to, easing: LINEAR });
  const easeTo = (line: number, channel: Channel, s: number, e: number, to: number, id = 1) =>
    add(line, channel, { start: s, end: e, to, easing: { kind: 'preset', id: id >= 1 ? id : 1 } });
  const x = (v: number) => ((v - PEC_W / 2) / PEC_W) * CANVAS_WIDTH;
  const y = (v: number) => ((v - PEC_H / 2) / PEC_H) * CANVAS_HEIGHT;
  const alpha = (v: number) => Math.max(0, Math.min(255, v));

  for (let li = 1; li < lines.length; li++) {
    const line = lines[li].trim();
    if (!line) continue;
    const [cmd, ...a] = line.split(/\s+/);
    const n = (i: number, fallback = 0) => num(a[i], fallback);
    switch (cmd) {
      case 'bp':
        bpms.push({ beat: n(0), bpm: n(1, 120) });
        break;
      case 'cv':
        set(n(0), 'speed', n(1), n(2, 10) * SPEED_SCALE);
        break;
      case 'cp':
        set(n(0), 'moveX', n(1), x(n(2)));
        set(n(0), 'moveY', n(1), y(n(3)));
        break;
      case 'cd':
        set(n(0), 'rotate', n(1), n(2));
        break;
      case 'ca':
        set(n(0), 'alpha', n(1), alpha(n(2)));
        break;
      case 'cm':
        easeTo(n(0), 'moveX', n(1), n(2), x(n(3)), n(5));
        easeTo(n(0), 'moveY', n(1), n(2), y(n(4)), n(5));
        break;
      case 'cr':
        easeTo(n(0), 'rotate', n(1), n(2), n(3), n(4));
        break;
      case 'cf':
        easeTo(n(0), 'alpha', n(1), n(2), alpha(n(3)));
        break;
      case 'n1':
      case 'n2':
      case 'n3':
      case 'n4': {
        const o = cmd === 'n2' ? 1 : 0;
        lastNote = {
          line: n(0),
          type: NOTE_TYPE[cmd],
          start: n(1),
          end: o ? n(2) : n(1),
          x: (n(2 + o) / PEC_W) * CANVAS_WIDTH,
          above: n(3 + o, 1) === 1,
          fake: n(4 + o) === 1,
          speed: 1,
          size: 1,
        };
        notes.push(lastNote);
        lineCount = Math.max(lineCount, lastNote.line + 1);
        break;
      }
      case '#':
        if (lastNote) lastNote.speed = n(0, 1);
        break;
      case '&':
        if (lastNote) lastNote.size = n(0, 1);
        break;
    }
  }

  bpms.sort((p, q) => p.beat - q.beat);
  const chart = createChart(bpms[0]?.bpm ?? 120, 0);
  if (bpms.length) chart.bpmList = bpms.map((b) => ({ beat: beat(b.beat), bpm: b.bpm }));
  chart.offsetMs = offset - OFFSET_SHIFT_MS;

  chart.lines = Array.from({ length: lineCount }, (_, i): JudgeLine => {
    const line = createLine(`Line ${i}`);
    const base = line.layers[0];
    const channels = steps.get(i) ?? {};
    for (const c of Object.keys(channels) as Channel[]) {
      base[c] = buildEvents(channels[c]!, HELD[c]);
    }
    line.notes = notes
      .filter((p) => p.line === i)
      .map((p) => {
        const hold = p.type === 'hold' && p.end > p.start;
        return createNote({
          type: p.type === 'hold' && !hold ? 'tap' : p.type,
          beat: beat(p.start),
          endBeat: hold ? beat(p.end) : undefined,
          x: p.x,
          above: p.above,
          fake: p.fake,
          speed: p.speed,
          size: p.size,
        });
      })
      .sort((a, b) => toFloat(a.beat) - toFloat(b.beat));
    return line;
  });
  return withDefaults(chart);
}
