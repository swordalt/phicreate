import type { LineRuntime } from '@/features/chart/runtime/scene';

// Notes on a line grouped by signed speed (speed * side), sorted by floor-space extent.
// A note's line-local y is (floor - lineFloor) * k, so a y range maps to a floor range per group.
interface Group {
  k: number;
  lo: Float64Array;
  hi: Float64Array;
  // Running max of `hi`, to skip notes whose extent ends before the range.
  maxHi: Float64Array;
  index: Int32Array;
}

export interface NoteIndex {
  groups: Group[];
  maxSize: number;
}

const cache = new WeakMap<LineRuntime, NoteIndex>();

export function noteIndex(runtime: LineRuntime): NoteIndex {
  const cached = cache.get(runtime);
  if (cached) return cached;
  const { notes } = runtime;
  const byK = new Map<number, number[]>();
  let maxSize = 0;
  notes.forEach((e, i) => {
    const k = e.note.speed * (e.note.above ? 1 : -1);
    const ids = byK.get(k);
    if (ids) ids.push(i);
    else byK.set(k, [i]);
    maxSize = Math.max(maxSize, Math.abs(e.note.size));
  });
  const lo = (i: number) => Math.min(notes[i].floor, notes[i].tail);
  const hi = (i: number) => Math.max(notes[i].floor, notes[i].tail);
  const groups = [...byK].map(([k, ids]): Group => {
    ids.sort((a, b) => lo(a) - lo(b));
    let max = -Infinity;
    return {
      k,
      lo: Float64Array.from(ids, lo),
      hi: Float64Array.from(ids, hi),
      maxHi: Float64Array.from(ids, (i) => (max = Math.max(max, hi(i)))),
      index: Int32Array.from(ids),
    };
  });
  const index = { groups, maxSize };
  cache.set(runtime, index);
  return index;
}

// Indexes (sorted) of notes whose line-local y extent may overlap [yMin, yMax] (canvas units).
export function queryNotes(idx: NoteIndex, lineFloor: number, yMin: number, yMax: number) {
  const out: number[] = [];
  for (const g of idx.groups) {
    if (g.k === 0) {
      if (yMin <= 0 && yMax >= 0) out.push(...g.index);
      continue;
    }
    const a = lineFloor + yMin / g.k;
    const b = lineFloor + yMax / g.k;
    const fLo = Math.min(a, b);
    const fHi = Math.max(a, b);
    let lo = 0;
    let hi = g.maxHi.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (g.maxHi[mid] < fLo) lo = mid + 1;
      else hi = mid;
    }
    for (let j = lo; j < g.lo.length && g.lo[j] <= fHi; j++) {
      if (g.hi[j] >= fLo) out.push(g.index[j]);
    }
  }
  return out.sort((a, b) => a - b);
}
