import { createId } from '@/lib/id';
import { add, cmp, eq, fromFloat, sub, toFloat, ZERO } from '../model/beat';
import { isColor } from '../model/color';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  createEffect,
  createLayer,
  createLine,
  createMedia,
  createNoiseField,
  createText,
} from '../model/defaults';
import { ease } from '../model/easing';
import { beatToSeconds } from '../model/timing';
import {
  CHANNELS,
  type Beat,
  type BpmPoint,
  type Chart,
  type Color,
  type ColorEvent,
  type Easing,
  type Event,
  type EventItem,
  type EventOwner,
  type Id,
  type JudgeLine,
  type LayerOwner,
  type MediaObject,
  type NoiseField,
  type Note,
  type NumEvent,
  type ShaderEffect,
  type TextEvent,
  type TextObject,
  type TrackKey,
  isMedia,
  isNoise,
  isPlayable,
  isShader,
  isText,
  isVarKey,
} from '../model/types';

// Pure chart transforms; the store wraps them with undo/redo.

const sortNotes = (notes: Note[]) => notes.sort((a, b) => cmp(a.beat, b.beat) || a.x - b.x);

export const mapLine = (chart: Chart, lineId: Id, fn: (l: JudgeLine) => JudgeLine): Chart => ({
  ...chart,
  lines: chart.lines.map((l) => (l.id === lineId ? fn(l) : l)),
});

export const mapText = (chart: Chart, textId: Id, fn: (t: TextObject) => TextObject): Chart => ({
  ...chart,
  texts: chart.texts.map((t) => (t.id === textId ? fn(t) : t)),
});

export const mapMedia = (
  chart: Chart,
  mediaId: Id,
  fn: (m: MediaObject) => MediaObject,
): Chart => ({
  ...chart,
  media: chart.media.map((m) => (m.id === mediaId ? fn(m) : m)),
});

export const mapEffect = (
  chart: Chart,
  effectId: Id,
  fn: (e: ShaderEffect) => ShaderEffect,
): Chart => ({
  ...chart,
  effects: chart.effects.map((e) => (e.id === effectId ? fn(e) : e)),
});

export const mapNoise = (
  chart: Chart,
  fieldId: Id,
  fn: (f: NoiseField) => NoiseField,
): Chart => ({
  ...chart,
  noiseFields: chart.noiseFields.map((f) => (f.id === fieldId ? fn(f) : f)),
});

const mapOwner = (chart: Chart, id: Id, fn: <T extends EventOwner>(o: T) => T): Chart =>
  chart.texts.some((t) => t.id === id)
    ? mapText(chart, id, fn)
    : chart.media.some((m) => m.id === id)
      ? mapMedia(chart, id, fn)
      : chart.effects.some((e) => e.id === id)
        ? mapEffect(chart, id, fn)
        : chart.noiseFields.some((f) => f.id === id)
          ? mapNoise(chart, id, fn)
          : mapLine(chart, id, fn);

// Skips shader effects (no layers).
const mapLayered = (chart: Chart, id: Id, fn: <T extends LayerOwner>(o: T) => T): Chart =>
  mapOwner(chart, id, (o) => (isShader(o) ? o : (fn(o as LayerOwner) as typeof o)));

export type OwnerPatch = Partial<
  Pick<
    JudgeLine,
    'name' | 'parentId' | 'rotateWithParent' | 'zOrder' | 'anchor' | 'isCover' | 'groupId'
  > &
    Pick<TextObject, 'size'> &
    Pick<MediaObject, 'loop' | 'fit' | 'playingOnly'>
>;

export const patchOwner = (chart: Chart, id: Id, patch: OwnerPatch) =>
  mapLayered(chart, id, (o) => ({ ...o, ...patch }));

// The line and everything parented below it.
export function lineDescendants(lines: JudgeLine[], id: Id) {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const l of lines) {
      if (l.parentId && out.has(l.parentId) && !out.has(l.id)) {
        out.add(l.id);
        grew = true;
      }
    }
  }
  return out;
}

export const addNotes = (chart: Chart, lineId: Id, notes: Note[]) =>
  mapLine(chart, lineId, (l) => ({ ...l, notes: sortNotes([...l.notes, ...notes]) }));

export const removeNotes = (chart: Chart, lineId: Id, ids: Id[]) => {
  const set = new Set(ids);
  return mapLine(chart, lineId, (l) => ({ ...l, notes: l.notes.filter((n) => !set.has(n.id)) }));
};

export const updateNotes = (chart: Chart, lineId: Id, ids: Id[], fn: (n: Note) => Note) => {
  const set = new Set(ids);
  return mapLine(chart, lineId, (l) => ({
    ...l,
    notes: sortNotes(l.notes.map((n) => (set.has(n.id) ? normalizeNote(fn(n)) : n))),
  }));
};

export const moveNotes = (chart: Chart, lineId: Id, ids: Id[], dBeat: Beat, dx: number) =>
  updateNotes(chart, lineId, ids, (n) => ({
    ...n,
    beat: add(n.beat, dBeat),
    endBeat: n.endBeat && add(n.endBeat, dBeat),
    x: n.x + dx,
  }));

// Keeps hold/non-hold fields consistent.
function normalizeNote(n: Note): Note {
  if (n.type !== 'hold') {
    if (!n.endBeat) return n;
    const rest = { ...n };
    delete rest.endBeat;
    return rest;
  }
  const endBeat = n.endBeat && cmp(n.endBeat, n.beat) > 0 ? n.endBeat : add(n.beat, [1, 0, 1]);
  return { ...n, endBeat };
}

export const hasNoteAt = (line: JudgeLine, type: Note['type'], beat: Beat, x: number) =>
  line.notes.some((n) => n.type === type && n.x === x && eq(n.beat, beat));

export const addLine = (chart: Chart, line = createLine(`Line ${chart.lines.length}`)) => ({
  ...chart,
  lines: [...chart.lines, line],
});

export const removeLine = (chart: Chart, lineId: Id): Chart => ({
  ...chart,
  lines: chart.lines
    .filter((l) => l.id !== lineId)
    .map((l) => (l.parentId === lineId ? { ...l, parentId: null } : l)),
  texts: chart.texts.map((t) => (t.parentId === lineId ? { ...t, parentId: null } : t)),
  media: chart.media.map((m) => (m.parentId === lineId ? { ...m, parentId: null } : m)),
  noiseFields: chart.noiseFields.map((f) =>
    f.parentId === lineId ? { ...f, parentId: null } : f,
  ),
});

export const setLineParent = (chart: Chart, lineId: Id, parentId: Id | null) =>
  mapLine(chart, lineId, (l) => ({ ...l, parentId }));

export const setLineAnchor = (chart: Chart, lineId: Id, anchor: [number, number]) =>
  mapLine(chart, lineId, (l) => ({ ...l, anchor }));

export const renameLine = (chart: Chart, lineId: Id, name: string) =>
  mapLine(chart, lineId, (l) => ({ ...l, name }));

export const addLayer = (chart: Chart, ownerId: Id) =>
  mapLayered(chart, ownerId, (o) => ({
    ...o,
    layers: [...o.layers, createLayer(`Layer ${o.layers.length}`)],
  }));

export const removeLayer = (chart: Chart, ownerId: Id, layerId: Id) =>
  mapLayered(chart, ownerId, (o) =>
    o.layers.length > 1 ? { ...o, layers: o.layers.filter((y) => y.id !== layerId) } : o,
  );

export const addText = (chart: Chart, text = createText(`Text ${chart.texts.length}`)) => ({
  ...chart,
  texts: [...chart.texts, text],
});

// UI texts stay.
export const removeText = (chart: Chart, textId: Id): Chart => ({
  ...chart,
  texts: chart.texts.filter((t) => t.id !== textId || t.builtin),
});

export const addMedia = (chart: Chart, media = createMedia(`Media ${chart.media.length}`)) => ({
  ...chart,
  media: [...chart.media, media],
});

// Swaps the media file; starts are dropped for still images.
export const setMediaFile = (
  chart: Chart,
  mediaId: Id,
  file: Pick<MediaObject, 'kind' | 'assetId'> & Partial<Pick<MediaObject, 'name'>>,
) =>
  mapMedia(chart, mediaId, (m) => ({
    ...m,
    ...file,
    starts: isPlayable(file.kind) ? m.starts : [],
  }));

export const removeMedia = (chart: Chart, mediaId: Id): Chart => ({
  ...chart,
  media: chart.media.filter((m) => m.id !== mediaId),
});

export const addNoiseField = (
  chart: Chart,
  field = createNoiseField(`Noise field ${chart.noiseFields.length}`),
) => ({
  ...chart,
  noiseFields: [...chart.noiseFields, field],
});

export type NoisePatch = Partial<Pick<NoiseField, 'size' | 'subtract' | 'defaults'>>;

export const patchNoiseField = (chart: Chart, fieldId: Id, patch: NoisePatch) =>
  mapNoise(chart, fieldId, (f) => ({ ...f, ...patch }));

export const removeNoiseField = (chart: Chart, fieldId: Id): Chart => ({
  ...chart,
  noiseFields: chart.noiseFields.filter((f) => f.id !== fieldId),
});

export const addEffect = (
  chart: Chart,
  effect = createEffect(`Shader ${chart.effects.length}`),
) => ({
  ...chart,
  effects: [...chart.effects, effect],
});

export const removeEffect = (chart: Chart, effectId: Id): Chart => ({
  ...chart,
  effects: chart.effects.filter((e) => e.id !== effectId),
});

export type EffectPatch = Partial<Pick<ShaderEffect, 'name' | 'shader' | 'global' | 'order'>>;

export const patchEffect = (chart: Chart, effectId: Id, patch: EffectPatch) =>
  mapEffect(chart, effectId, (e) => ({ ...e, ...patch }));

// Repoints effects after a shader file is renamed.
export const renameEffectShader = (chart: Chart, from: string, to: string): Chart => ({
  ...chart,
  effects: chart.effects.map((e) => (e.shader === from ? { ...e, shader: to } : e)),
});

// Single-BPM editing for now: sets the BPM at beat 0.
export const setBaseBpm = (chart: Chart, bpm: number): Chart => ({
  ...chart,
  bpmList: chart.bpmList.length
    ? chart.bpmList.map((p) => (eq(p.beat, ZERO) ? { ...p, bpm } : p))
    : [{ beat: ZERO, bpm }],
});

const sortedBpm = (list: BpmPoint[]) => [...list].sort((a, b) => cmp(a.beat, b.beat));

// Adds a BPM change, or replaces the one already at that beat.
export const setBpmPoint = (chart: Chart, beat: Beat, bpm: number): Chart => ({
  ...chart,
  bpmList: sortedBpm([...chart.bpmList.filter((p) => !eq(p.beat, beat)), { beat, bpm }]),
});

// The point at beat 0 can't move.
export const moveBpmPoint = (chart: Chart, from: Beat, to: Beat): Chart => {
  if (eq(from, ZERO) || cmp(to, ZERO) < 0) return chart;
  if (!eq(from, to) && chart.bpmList.some((p) => eq(p.beat, to))) return chart;
  return {
    ...chart,
    bpmList: sortedBpm(chart.bpmList.map((p) => (eq(p.beat, from) ? { ...p, beat: to } : p))),
  };
};

export const removeBpmPoint = (chart: Chart, beat: Beat): Chart =>
  eq(beat, ZERO) ? chart : { ...chart, bpmList: chart.bpmList.filter((p) => !eq(p.beat, beat)) };

export const bpmAt = (chart: Chart, beat: Beat) =>
  sortedBpm(chart.bpmList)
    .filter((p) => cmp(p.beat, beat) <= 0)
    .at(-1)?.bpm ?? baseBpm(chart);

export const setOffset = (chart: Chart, offsetMs: number): Chart => ({ ...chart, offsetMs });

export const baseBpm = (chart: Chart) =>
  chart.bpmList.find((p) => eq(p.beat, ZERO))?.bpm ?? chart.bpmList[0]?.bpm ?? 120;

// Events (see chart-data-plan §4: no overlaps within one layer channel).

export const findOwner = (chart: Chart, id: Id | null): EventOwner | undefined =>
  chart.lines.find((l) => l.id === id) ??
  chart.texts.find((t) => t.id === id) ??
  chart.media.find((m) => m.id === id) ??
  chart.effects.find((e) => e.id === id) ??
  chart.noiseFields.find((f) => f.id === id);

export function channelValid(events: Event<unknown>[]) {
  return events.every(
    (e, i) =>
      cmp(e.end, e.start) > 0 &&
      cmp(e.start, ZERO) >= 0 &&
      (i === 0 || cmp(events[i - 1].end, e.start) <= 0),
  );
}

const sortEvents = (events: Event<unknown>[]) => events.sort((a, b) => cmp(a.start, b.start));

type AnyEvent = Event<unknown>;
// Returns the same array when the track is unchanged.
type TrackEdit = (events: AnyEvent[], key: TrackKey) => AnyEvent[];

// Applies `fn` to every track (layer channels, color, a text's values, a media's starts,
// a shader's vars, a noise field's visible / active ranges). `layerId` is ignored for shaders. Rejects (returns the same chart) on overlap.
function editEvents(
  chart: Chart,
  ownerId: Id,
  layerId: Id | null,
  fn: TrackEdit,
  newVars: string[] = [],
): Chart {
  const owner = findOwner(chart, ownerId);
  if (!owner) return chart;
  let changed = false;
  let invalid = false;
  const edit = <T extends AnyEvent>(events: T[], key: TrackKey): T[] => {
    const next = fn(events, key) as T[];
    if (next === events) return events;
    sortEvents(next);
    if (!channelValid(next)) invalid = true;
    changed = true;
    return next;
  };

  if (isShader(owner)) {
    const active = edit(owner.active, 'active');
    const vars: Record<string, NumEvent[]> = {};
    for (const key of new Set([...Object.keys(owner.vars), ...newVars])) {
      vars[key] = edit(owner.vars[key] ?? [], `var:${key}`);
    }
    if (!changed || invalid) return chart;
    return mapEffect(chart, ownerId, (e) => ({ ...e, active, vars }));
  }

  const layer = owner.layers.find((y) => y.id === layerId);
  if (!layer) return chart;
  const nextLayer = { ...layer };
  for (const c of CHANNELS) nextLayer[c] = edit(layer[c], c);
  const layers = owner.layers.map((y) => (y.id === layerId ? nextLayer : y));
  if (isNoise(owner)) {
    const visible = edit(owner.visible, 'visible');
    const active = edit(owner.active, 'active');
    const color = edit(owner.color, 'color');
    if (!changed || invalid) return chart;
    return mapNoise(chart, ownerId, (f) => ({ ...f, layers, visible, active, color }));
  }
  const next = { ...owner, layers, color: edit(owner.color, 'color') };
  if (isText(owner)) {
    let value = edit(owner.value, 'value');
    // UI texts always keep a value event.
    if (owner.builtin && owner.value.length && !value.length) value = owner.value.slice(0, 1);
    (next as TextObject).value = value;
    (next as TextObject).font = edit(owner.font, 'font');
  } else if (isMedia(owner)) {
    (next as MediaObject).starts = edit(owner.starts, 'start');
  }
  if (!changed || invalid) return chart;
  return mapOwner(chart, ownerId, () => next as never);
}

const has = (events: AnyEvent[], ids: Set<Id>) => events.some((e) => ids.has(e.id));

// Maps the matching events of the given tracks.
const mapIds =
  (
    ids: Id[],
    fn: (e: AnyEvent, key: TrackKey) => AnyEvent,
    keys?: (key: TrackKey) => boolean,
  ): TrackEdit =>
  (events, key) => {
    const set = new Set(ids);
    if ((keys && !keys(key)) || !has(events, set)) return events;
    return events.map((e) => (set.has(e.id) ? fn(e, key) : e));
  };

export const addEvents = (chart: Chart, ownerId: Id, layerId: Id | null, items: EventItem[]) =>
  editEvents(
    chart,
    ownerId,
    layerId,
    (events, key) => {
      const added = items.filter((i) => i.channel === key).map((i) => i.event);
      return added.length ? [...events, ...added] : events;
    },
    items.flatMap((i) => (isVarKey(i.channel) ? [i.channel.slice(4)] : [])),
  );

export const addEvent = (chart: Chart, ownerId: Id, layerId: Id | null, item: EventItem) =>
  addEvents(chart, ownerId, layerId, [item]);

export const removeEvents = (chart: Chart, ownerId: Id, layerId: Id | null, ids: Id[]) => {
  const set = new Set(ids);
  return editEvents(chart, ownerId, layerId, (events) =>
    has(events, set) ? events.filter((e) => !set.has(e.id)) : events,
  );
};

// `fn` only changes timing, so it applies to every track.
export const retimeEvents = (
  chart: Chart,
  ownerId: Id,
  layerId: Id | null,
  ids: Id[],
  fn: <T>(e: Event<T>) => Event<T>,
) => editEvents(chart, ownerId, layerId, mapIds(ids, fn));

// Numeric events (layer channels and media starts).
export const updateEvents = (
  chart: Chart,
  ownerId: Id,
  layerId: Id | null,
  ids: Id[],
  fn: (e: NumEvent) => NumEvent,
) =>
  editEvents(
    chart,
    ownerId,
    layerId,
    mapIds(
      ids,
      (e) => fn(e as NumEvent),
      (key) => key !== 'value' && key !== 'font' && key !== 'color',
    ),
  );

export const updateTextEvents = (
  chart: Chart,
  ownerId: Id,
  layerId: Id | null,
  ids: Id[],
  fn: (e: TextEvent) => TextEvent,
) =>
  editEvents(
    chart,
    ownerId,
    layerId,
    mapIds(
      ids,
      (e) => fn(e as TextEvent),
      (key) => key === 'value' || key === 'font',
    ),
  );

export const updateColorEvents = (
  chart: Chart,
  ownerId: Id,
  layerId: Id | null,
  ids: Id[],
  fn: (e: ColorEvent) => ColorEvent,
) =>
  editEvents(
    chart,
    ownerId,
    layerId,
    mapIds(
      ids,
      (e) => fn(e as ColorEvent),
      (key) => key === 'color',
    ),
  );

export const moveEvents = (chart: Chart, ownerId: Id, layerId: Id | null, ids: Id[], dBeat: Beat) =>
  retimeEvents(chart, ownerId, layerId, ids, (e) => ({
    ...e,
    start: add(e.start, dBeat),
    end: add(e.end, dBeat),
  }));

const isRangeKey = (key: TrackKey) =>
  key === 'active' || key === 'visible' || key === 'font' || key === 'start';

// Sets each selected event's `from` to the preceding event's `to` (chaining front-to-back).
export const stickEvents = (chart: Chart, ownerId: Id, layerId: Id | null, ids: Id[]) => {
  const set = new Set(ids);
  return editEvents(chart, ownerId, layerId, (events, key) => {
    if (isRangeKey(key) || !has(events, set)) return events;
    const out = [...events];
    let changed = false;
    for (let i = 1; i < out.length; i++) {
      if (!set.has(out[i].id) || (set.size > 1 && out[i].locked)) continue;
      const from = out[i - 1].to;
      out[i] = out[i].locked ? { ...out[i], from, to: from } : { ...out[i], from };
      changed = true;
    }
    return changed ? out : events;
  });
};

// Swaps `from` and `to` on each selected event.
export const swapEvents = (chart: Chart, ownerId: Id, layerId: Id | null, ids: Id[]) =>
  editEvents(
    chart,
    ownerId,
    layerId,
    mapIds(
      ids,
      (e) => (e.locked ? e : { ...e, from: e.to, to: e.from }),
      (key) => !isRangeKey(key),
    ),
  );

const roundNum = (key: TrackKey, v: number) =>
  key === 'alpha' ? Math.max(0, Math.min(255, Math.round(v))) : Math.round(v * 1000) / 1000;

const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

// Extrapolates `from` and `to` from the preceding two events on the same track.
export const passEvents = (chart: Chart, ownerId: Id, layerId: Id | null, ids: Id[]) => {
  const set = new Set(ids);
  return editEvents(chart, ownerId, layerId, (events, key) => {
    if (isRangeKey(key) || key === 'value' || !has(events, set)) return events;
    const out = [...events];
    let changed = false;
    for (let i = 1; i < out.length; i++) {
      const cur = out[i];
      if (!set.has(cur.id)) continue;
      const b = out[i - 1];
      const a = out[i - 2];
      if (typeof b.from === 'number' && typeof b.to === 'number') {
        const af = a && typeof a.from === 'number' ? a.from : undefined;
        const at = a && typeof a.to === 'number' ? a.to : undefined;
        const from = roundNum(key, af !== undefined ? 2 * b.from - af : b.to);
        const to = cur.locked
          ? from
          : roundNum(key, at !== undefined ? 2 * b.to - at : 2 * b.to - b.from);
        out[i] = { ...cur, from, to };
        changed = true;
      } else if (isColor(b.from) && isColor(b.to)) {
        const bTo = b.to;
        const bFrom = b.from;
        const af = a && isColor(a.from) ? a.from : undefined;
        const at = a && isColor(a.to) ? a.to : undefined;
        const from = bFrom.map((v, k) => clampByte(af ? 2 * v - af[k] : bTo[k])) as Color;
        const to = cur.locked
          ? from
          : (bTo.map((v, k) => clampByte(at ? 2 * v - at[k] : 2 * v - bFrom[k])) as Color);
        out[i] = { ...cur, from, to };
        changed = true;
      }
    }
    return changed ? out : events;
  });
};

const randInt = (lo: number, hi: number) => Math.floor(lo + Math.random() * (hi - lo + 1));

function randomValue(key: TrackKey): number | Color {
  if (key === 'color') return [randInt(0, 255), randInt(0, 255), randInt(0, 255)];
  if (key === 'moveX') return randInt(-CANVAS_WIDTH / 2, CANVAS_WIDTH / 2);
  if (key === 'moveY') return randInt(-CANVAS_HEIGHT / 2, CANVAS_HEIGHT / 2);
  if (key === 'rotate') return randInt(-180, 180);
  if (key === 'alpha') return randInt(0, 255);
  if (key === 'speed') return Math.round(Math.random() * 100) / 10;
  if (key === 'scaleX' || key === 'scaleY')
    return Math.round((0.5 + Math.random() * 1.5) * 100) / 100;
  return Math.round(Math.random() * 100) / 100;
}

// Randomizes `to` (or both when locked) within standard channel bounds.
export const randomEvents = (chart: Chart, ownerId: Id, layerId: Id | null, ids: Id[]) =>
  editEvents(
    chart,
    ownerId,
    layerId,
    mapIds(
      ids,
      (e, key) => {
        const to = randomValue(key);
        return e.locked ? { ...e, from: to, to } : { ...e, to };
      },
      (key) => !isRangeKey(key) && key !== 'value',
    ),
  );

function cutBeats(start: Beat, end: Beat, division: number, playheadBeat: number): Beat[] {
  const step: Beat = [0, 1, Math.max(1, division)];
  const center = fromFloat(playheadBeat, Math.max(1, division));
  if (cmp(center, start) > 0 && cmp(center, end) < 0) {
    const before: Beat[] = [];
    for (let b = sub(center, step); cmp(b, start) > 0; b = sub(b, step)) before.push(b);
    const after: Beat[] = [];
    for (let b = add(center, step); cmp(b, end) < 0; b = add(b, step)) after.push(b);
    return [start, ...before.reverse(), center, ...after, end];
  }
  const out: Beat[] = [start];
  for (let b = add(start, step); cmp(b, end) < 0; b = add(b, step)) out.push(b);
  out.push(end);
  return out;
}

function interpEventValue(e: AnyEvent, key: TrackKey, p: number): unknown {
  if (typeof e.from === 'number' && typeof e.to === 'number') {
    return roundNum(key, e.from + (e.to - e.from) * p);
  }
  if (isColor(e.from) && isColor(e.to)) {
    const to = e.to;
    return e.from.map((c, i) => clampByte(c + (to[i] - c) * p)) as Color;
  }
  if (typeof e.from === 'string' && typeof e.to === 'string') {
    const a = e.from;
    const b = e.to;
    const q = Math.min(1, Math.max(0, p));
    if (b.startsWith(a)) return b.slice(0, a.length + Math.floor((b.length - a.length) * q));
    if (a.startsWith(b)) return a.slice(0, b.length + Math.ceil((a.length - b.length) * (1 - q)));
    return a;
  }
  return e.from;
}

// Subdivides selected events into 1/division-beat linear segments along their easing curves.
export const cutEvents = (
  chart: Chart,
  ownerId: Id,
  layerId: Id | null,
  ids: Id[],
  division: number,
  playheadBeat: number,
  newIds?: Id[],
) => {
  const set = new Set(ids);
  return editEvents(chart, ownerId, layerId, (events, key) => {
    if (isRangeKey(key) || !has(events, set)) return events;
    let changed = false;
    const out = events.flatMap((e) => {
      if (!set.has(e.id)) return [e];
      const beats = cutBeats(e.start, e.end, division, playheadBeat);
      if (beats.length <= 2) {
        newIds?.push(e.id);
        return [e];
      }
      changed = true;
      const s0 = toFloat(e.start);
      const span = toFloat(e.end) - s0;
      const valAt = (i: number) => {
        if (i === 0 || e.locked) return e.from;
        if (i === beats.length - 1) return e.to;
        return interpEventValue(e, key, ease(e.easing, (toFloat(beats[i]) - s0) / span));
      };
      return beats.slice(0, -1).map((start, i): AnyEvent => {
        const id = i === 0 ? e.id : createId();
        newIds?.push(id);
        const from = valAt(i);
        const to = e.locked ? from : valAt(i + 1);
        return { ...e, id, start, end: beats[i + 1], from, to, easing: { kind: 'preset', id: 1 } };
      });
    });
    return changed ? out : events;
  });
};

// Splits selected events into two at the playhead beat, preserving the curve via easing clip.
export const splitEvents = (
  chart: Chart,
  ownerId: Id,
  layerId: Id | null,
  ids: Id[],
  division: number,
  playheadBeat: number,
  newIds?: Id[],
) => {
  const set = new Set(ids);
  const snapped = fromFloat(playheadBeat, Math.max(1, division));
  const raw = fromFloat(playheadBeat, 960);
  return editEvents(chart, ownerId, layerId, (events, key) => {
    if (isRangeKey(key) || !has(events, set)) return events;
    let changed = false;
    const out = events.flatMap((e): AnyEvent[] => {
      if (!set.has(e.id)) return [e];
      const split =
        cmp(snapped, e.start) > 0 && cmp(snapped, e.end) < 0
          ? snapped
          : cmp(raw, e.start) > 0 && cmp(raw, e.end) < 0
            ? raw
            : null;
      if (!split) {
        newIds?.push(e.id);
        return [e];
      }
      changed = true;
      const t0 = beatToSeconds(chart.bpmList, toFloat(e.start));
      const t1 = beatToSeconds(chart.bpmList, toFloat(e.end));
      const ts = beatToSeconds(chart.bpmList, toFloat(split));
      const progress = t1 > t0 ? (ts - t0) / (t1 - t0) : 0.5;
      const mid = e.locked ? e.from : interpEventValue(e, key, ease(e.easing, progress));
      const id2 = createId();
      newIds?.push(e.id, id2);
      if (e.easing.kind === 'preset') {
        const [l, r] = e.easing.clip ?? [0, 1];
        const m = Math.round((l + (r - l) * progress) * 10000) / 10000;
        const e1: Easing =
          l === 0 && m === 1
            ? { kind: 'preset', id: e.easing.id }
            : { kind: 'preset', id: e.easing.id, clip: [l, m] };
        const e2: Easing =
          m === 0 && r === 1
            ? { kind: 'preset', id: e.easing.id }
            : { kind: 'preset', id: e.easing.id, clip: [m, r] };
        return [
          { ...e, end: split, to: mid, easing: e1 },
          { ...e, id: id2, start: split, from: mid, easing: e2 },
        ];
      }
      return [
        { ...e, end: split, to: mid, easing: { kind: 'preset', id: 1 } },
        { ...e, id: id2, start: split, from: mid },
      ];
    });
    return changed ? out : events;
  });
};
