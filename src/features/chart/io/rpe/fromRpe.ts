import { createId } from '@/lib/id';
import { cmp, fromFloat, reduce, toFloat, ZERO } from '../../model/beat';
import {
  createChart,
  createLayer,
  createLine,
  createMedia,
  createNote,
  createText,
  withDefaults,
} from '../../model/defaults';
import { beatToSeconds, secondsToBeat } from '../../model/timing';
import type {
  Beat,
  BuiltinText,
  Channel,
  Chart,
  Color,
  Easing,
  Event,
  EventLayer,
  Id,
  JudgeLine,
  MediaObject,
  Note,
  NoteType,
  TextObject,
} from '../../model/types';
import { BASE_DEFAULTS, LINE_COLOR, WHITE } from '../../runtime/scene';
import { rpeNoiseAreas, rpeToNoiseFields } from './noise';
import {
  rpeTexture,
  type RpeBeat,
  type RpeChart,
  type RpeEvent,
  type RpeEventLayer,
  type RpeJudgeLine,
  type RpeNote,
} from './types';

const NOTE_TYPES: Record<number, NoteType> = { 1: 'tap', 2: 'hold', 3: 'flick', 4: 'drag' };

const LAYER_CHANNELS: [keyof RpeEventLayer, Channel][] = [
  ['moveXEvents', 'moveX'],
  ['moveYEvents', 'moveY'],
  ['rotateEvents', 'rotate'],
  ['alphaEvents', 'alpha'],
  ['speedEvents', 'speed'],
];

const UI_TEXTS: Record<string, BuiltinText> = {
  pause: 'pause',
  bar: 'bar',
  combonumber: 'combo',
  combo: 'comboLabel',
  score: 'score',
  name: 'songName',
  level: 'difficulty',
};

export const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

export function beat(b: RpeBeat | undefined): Beat {
  if (!Array.isArray(b)) return [0, 0, 1];
  const [w, n, d] = b.map((v) => Math.round(num(v, 0)));
  return d > 0 ? reduce([w, n, d]) : [w, 0, 1];
}

export function easing(e: RpeEvent<unknown>): Easing {
  if ((e.bezier === 1 || e.bezier === true) && e.bezierPoints?.length === 4) {
    return { kind: 'bezier', points: e.bezierPoints as [number, number, number, number] };
  }
  const id = Math.round(num(e.easingType, 1));
  const preset = id >= 1 && id <= 29 ? id : 1;
  // Clipped to 0-1; an empty clip is ignored (Phira).
  const l = Math.min(1, Math.max(0, num(e.easingLeft, 0)));
  const r = Math.min(1, Math.max(0, num(e.easingRight, 1)));
  return (l === 0 && r === 1) || l >= r
    ? { kind: 'preset', id: preset }
    : { kind: 'preset', id: preset, clip: [l, r] };
}

const LINEAR: Easing = { kind: 'preset', id: 1 };

// RPE beat to chart beat (lines with a bpmfactor map their own beats).
type BeatOf = (b: RpeBeat | undefined) => Beat;

function events<T>(
  list: RpeEvent<T>[] | undefined,
  value: (v: T) => T,
  at: BeatOf = beat,
): Event<T>[] {
  return (list ?? [])
    .map((e) => {
      const start = at(e.startTime);
      const end = at(e.endTime);
      return {
        id: createId(),
        start,
        end: cmp(end, start) < 0 ? start : end,
        from: value(e.start),
        to: value(e.end),
        easing: easing(e),
      };
    })
    .sort((a, b) => cmp(a.start, b.start));
}

export const numEvents = (list: RpeEvent[] | undefined, at: BeatOf = beat) =>
  events(list, (v) => num(v, 0), at);

const constant = <T>(start: Beat, end: Beat, v: T): Event<T> => ({
  id: createId(),
  start,
  end,
  from: v,
  to: v,
  easing: LINEAR,
});

// Before its first event an RPE track holds that event's start; PhiCreate holds the default.
function leadIn<T>(list: Event<T>[], fallback: T, same = (a: T, b: T) => a === b): Event<T>[] {
  const first = list[0];
  if (!first || cmp(first.start, ZERO) <= 0 || same(first.from, fallback)) return list;
  return [constant(ZERO, first.start, first.from), ...list];
}

const color = (v: unknown): Color =>
  Array.isArray(v)
    ? ([0, 1, 2].map((i) => Math.max(0, Math.min(255, num(v[i], 255)))) as Color)
    : [255, 255, 255];

const sameColor = (a: Color, b: Color) => a.every((v, i) => v === b[i]);

// Text, textured and UI lines default to white (rpe-next). Other lines default to the
// {color} variable, so a late first event is held explicitly instead of matching it.
function colorEvents(line: RpeJudgeLine, at: BeatOf) {
  const white = !!line.attachUI || !!line.extended?.textEvents?.length || !!rpeTexture(line);
  return leadIn(
    events(line.extended?.colorEvents, color, at),
    white ? WHITE : LINE_COLOR,
    white ? sameColor : () => false,
  );
}

// `linearSpeed`: speed easings before RPE 170 shaped the floor position, not the speed.
function layers(line: RpeJudgeLine, at: BeatOf, linearSpeed: boolean): EventLayer[] {
  const result = (line.eventLayers ?? []).map((src, i) => {
    const layer = createLayer(i === 0 ? 'Base' : `Layer ${i}`);
    for (const [key, channel] of LAYER_CHANNELS) {
      let list = numEvents(src?.[key], at);
      if (channel === 'speed' && linearSpeed) list = list.map((e) => ({ ...e, easing: LINEAR }));
      layer[channel] = leadIn(list, i ? 0 : BASE_DEFAULTS[channel]);
    }
    return layer;
  });
  // Drop trailing empty layers (RPE pads with nulls).
  while (result.length > 1 && !line.eventLayers?.[result.length - 1]) result.pop();
  if (!result.length) result.push(createLayer('Base'));
  // Scale isn't layered in RPE; it lives on the base layer.
  result[0].scaleX = leadIn(numEvents(line.extended?.scaleXEvents, at), 1);
  result[0].scaleY = leadIn(numEvents(line.extended?.scaleYEvents, at), 1);
  return result;
}

function note(n: RpeNote, at: BeatOf): Note {
  const start = at(n.startTime);
  const end = at(n.endTime);
  const isHold = n.type === 2 && cmp(end, start) > 0;
  const visibleTime = num(n.visibleTime, Infinity);
  const tint = n.tint ?? n.color;
  return createNote({
    type: isHold ? 'hold' : n.type === 2 ? 'tap' : (NOTE_TYPES[n.type] ?? 'tap'),
    beat: start,
    endBeat: isHold ? end : undefined,
    x: num(n.positionX, 0),
    above: (n.above ?? 1) === 1,
    speed: num(n.speed, 1),
    fake: n.isFake === 1 || n.isFake === true,
    alpha: num(n.alpha, 255),
    size: num(n.size, 1),
    yOffset: num(n.yOffset, 0),
    visibleTime: visibleTime >= 999999 ? Infinity : visibleTime,
    tint: tint && !(tint[0] === 255 && tint[1] === 255 && tint[2] === 255) ? tint : undefined,
  });
}

// Texture as a media object; GIFs loop from beat 0 (progress events are dropped).
function textureMedia(l: RpeJudgeLine, name: string, texture: string, assetId: Id | null) {
  const media = createMedia(name);
  const gif = !!l.isGif || /\.gif$/i.test(texture);
  media.kind = gif ? 'gif' : 'image';
  media.assetId = assetId;
  media.zOrder = num(l.zOrder, 0);
  media.anchor = l.anchor ?? [0.5, 0.5];
  // RPE line alpha starts at 0.
  media.defaults = { alpha: 0 };
  if (gif) {
    media.loop = true;
    media.starts = [
      {
        id: createId(),
        start: [0, 0, 1],
        end: [1, 0, 1],
        from: 0,
        to: 0,
        easing: { kind: 'preset', id: 1 },
        locked: true,
      },
    ];
  }
  return media;
}

const withIds = <T>(list: Event<T>[], value = (v: T) => v) =>
  list.map((e) => ({ ...e, id: createId(), from: value(e.from), to: value(e.to) }));

// Converts an RPE chart. `textures` maps texture file names to media asset ids.
// Lossy: controls and GIF progress are dropped.
// `ids` = line ids by RPE index (lines turned into text or media don't use theirs).
export function rpeToChart(
  rpe: RpeChart,
  textures: Record<string, Id> = {},
  ids: Id[] = rpe.judgeLineList.map(() => createId()),
): Chart {
  const chart = createChart(120, 0);
  chart.offsetMs = num(rpe.META?.offset, 0);

  const bpmList = (rpe.BPMList ?? [])
    .map((p) => ({ beat: beat(p.startTime), bpm: num(p.bpm, 120) }))
    .filter((p) => p.bpm > 0)
    .sort((a, b) => cmp(a.beat, b.beat));
  if (bpmList.length) {
    bpmList[0].beat = [0, 0, 1];
    chart.bpmList = bpmList;
  }

  const version = Number(rpe.META?.RPEVersion ?? 160) || 160;
  // Missing before RPE 163, where children didn't rotate with their parent.
  const rotates = (l: RpeJudgeLine) => l.rotateWithFather ?? version >= 163;
  // Line time runs `bpmfactor` times slower.
  const beatOf = (l: RpeJudgeLine): BeatOf => {
    const f = num(l.bpmfactor, 1);
    if (f <= 0 || f === 1) return beat;
    const bpm = chart.bpmList;
    return (b) => fromFloat(secondsToBeat(bpm, beatToSeconds(bpm, toFloat(beat(b))) * f), 960);
  };

  chart.lineGroups = (rpe.judgeLineGroup ?? []).map((name) => ({
    id: createId(),
    name: String(name),
  }));
  chart.timeTags = (rpe.timeTags ?? []).map((t) => ({
    id: createId(),
    name: String(t.name ?? ''),
    beat: beat(t.time),
  }));

  const src = rpe.judgeLineList;
  const parentOf = (l: RpeJudgeLine) => {
    const f = num(l.father, -1);
    return f >= 0 && f < ids.length ? ids[f] : null;
  };
  const hasChildren = new Set(src.map((l) => num(l.father, -1)));

  const lines: JudgeLine[] = [];
  const texts: TextObject[] = [];
  const media: MediaObject[] = [];

  src.forEach((l, i) => {
    const name = l.Name && l.Name !== 'Untitled' ? l.Name : `Line ${i}`;
    const at = beatOf(l);
    let lineLayers = layers(l, at, version < 170);
    // Color goes to whatever the line shows: its text, its texture or the line itself.
    let lineColor = colorEvents(l, at);
    const textEvents = l.extended?.textEvents;

    // Text lines show only text: turn them into text objects unless notes or children need the line.
    if (textEvents?.length) {
      const text = createText(name);
      text.value = events(textEvents, (v) => String(v ?? ''), at);
      text.color = lineColor;
      lineColor = [];
      text.zOrder = num(l.zOrder, 0);
      if (l.anchor) text.anchor = l.anchor;
      if (!l.notes?.length && !hasChildren.has(i)) {
        text.layers = lineLayers;
        text.parentId = parentOf(l);
        text.rotateWithParent = rotates(l);
        texts.push(text);
        return;
      }
      text.parentId = ids[i];
      text.defaults = { alpha: 255 };
      texts.push(text);
    }

    // Textured lines show the image instead of the line: same split as text lines.
    const texture = rpeTexture(l);
    if (texture) {
      const item = textureMedia(l, name, texture, textures[texture] ?? null);
      item.color = colorEvents(l, at);
      lineColor = [];
      media.push(item);
      if (!l.notes?.length && !hasChildren.has(i)) {
        item.layers = lineLayers;
        item.parentId = parentOf(l);
        item.rotateWithParent = rotates(l);
        return;
      }
      // Follows the kept line; takes over its alpha and scale.
      item.parentId = ids[i];
      item.layers = lineLayers.map((y) => ({
        ...createLayer(y.name),
        alpha: withIds(y.alpha),
        scaleX: withIds(y.scaleX),
        scaleY: withIds(y.scaleY),
      }));
      // The line stays invisible; negative alpha still hides its notes.
      lineLayers = lineLayers.map((y) => ({
        ...y,
        alpha: withIds(y.alpha, (v) => Math.min(v, 0)),
      }));
    }

    const builtin = l.attachUI && UI_TEXTS[l.attachUI];
    const ui = builtin && chart.texts.find((t) => t.builtin === builtin);

    // Note-less UI lines carry only events: put them on the UI element itself.
    if (ui && !l.notes?.length && !hasChildren.has(i) && !textEvents?.length && !texture) {
      // Base keeps the standard position and takes rotate and scale; the rest moves to Layer 1+.
      const base = createLayer('Base');
      const [first, ...rest] = lineLayers;
      base.rotate = first.rotate;
      base.scaleX = first.scaleX;
      base.scaleY = first.scaleY;
      ui.layers = [
        base,
        { ...first, name: 'Layer 1', rotate: [], scaleX: [], scaleY: [] },
        ...rest.map((y, k) => ({ ...y, name: `Layer ${k + 2}` })),
      ];
      // Alpha events are absolute in RPE: zero the base so the UI's default 255 doesn't add to them.
      if (first.alpha.length) ui.defaults = { ...ui.defaults, alpha: 0 };
      ui.color = lineColor;
      ui.parentId = parentOf(l);
      ui.rotateWithParent = rotates(l);
      return;
    }

    const group = num(l.Group, -1);
    // RPE speed without events is 0.
    if (!lineLayers[0].speed.length) {
      lineLayers[0] = { ...lineLayers[0], speed: [constant(ZERO, [1, 0, 1], 0)] };
    }
    lines.push({
      ...createLine(name),
      id: ids[i],
      parentId: parentOf(l),
      rotateWithParent: rotates(l),
      zOrder: num(l.zOrder, 0),
      groupId: chart.lineGroups[group]?.id ?? null,
      isCover: (l.isCover ?? 1) === 1,
      anchor: l.anchor ?? [0.5, 0.5],
      layers: lineLayers,
      color: lineColor,
      notes: (l.notes ?? []).map((n) => note(n, at)).sort((a, b) => cmp(a.beat, b.beat)),
    });

    // UI bound to a line follows it.
    if (ui) {
      ui.parentId = ids[i];
      ui.rotateWithParent = true;
      // RPE colors bound UI with the line color.
      if (lineColor.length) {
        ui.color = lineColor;
        lines[lines.length - 1].color = [];
      }
    }
  });

  chart.lines = lines;
  chart.texts = [...chart.texts, ...texts];
  chart.media = media;
  chart.noiseFields = rpeToNoiseFields(rpeNoiseAreas(rpe));
  return withDefaults(chart);
}
