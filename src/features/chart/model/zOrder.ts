import type { Chart, JudgeLine, MediaObject, TextObject } from './types';

// Lines, texts and media share one depth space (rpe-next). Holds draw at HOLD_Z and other
// notes at NOTE_Z, each after objects of the same depth.
export const HOLD_Z = 999;
export const NOTE_Z = 1000;
// Lowest depth above every note; the builtin UI's default.
export const ABOVE_NOTES = NOTE_Z + 1;

export type Drawable =
  | { kind: 'line'; index: number; object: JudgeLine }
  | { kind: 'text'; index: number; object: TextObject }
  | { kind: 'media'; index: number; object: MediaObject };

const KIND_RANK = { line: 0, text: 1, media: 2 };

const byTie = (a?: number, b?: number) =>
  a === b ? 0 : a === undefined ? 1 : b === undefined ? -1 : a - b;

// Lower first. Equal zOrder: zTie, then lines, texts, media in list order.
export const compareDepth = (a: Drawable, b: Drawable) =>
  a.object.zOrder - b.object.zOrder ||
  byTie(a.object.zTie, b.object.zTie) ||
  KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
  a.index - b.index;

export const drawOrder = (chart: Pick<Chart, 'lines' | 'texts' | 'media'>): Drawable[] =>
  [
    ...chart.lines.map((object, index) => ({ kind: 'line' as const, index, object })),
    ...chart.texts.map((object, index) => ({ kind: 'text' as const, index, object })),
    ...chart.media.map((object, index) => ({ kind: 'media' as const, index, object })),
  ].sort(compareDepth);
