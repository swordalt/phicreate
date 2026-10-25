import { parseUniforms, PRESET_SHADERS, rpeShader, uniformKeys } from '@/features/shaders/library';
import { cmp, fromFloat, toFloat, ZERO } from '../../model/beat';
import { isGlobalRange } from '../../model/defaults';
import { ease } from '../../model/easing';
import { beatToSeconds } from '../../model/timing';
import {
  BASE_DEFAULTS,
  effectRuntime,
  LINE_COLOR,
  MEDIA_DEFAULTS,
  ownerRuntime,
  WHITE,
} from '../../runtime/scene';
import {
  CHANNELS,
  isLine,
  isMedia,
  type Beat,
  type BuiltinText,
  type Channel,
  type Chart,
  type Color,
  type Easing,
  type Event,
  type Id,
  type JudgeLine,
  type LayerOwner,
  type MediaFit,
  type MediaObject,
  type NoiseField,
  type Note,
  type NoteType,
  type NumEvent,
  type ShaderEffect,
  type TextObject,
} from '../../model/types';
import { drawOrder } from '../../model/zOrder';
import { sample, simplify } from '../bake';
import { FIT_EPS } from '../fit';
import type { RpeExtra, RpeExtraEffect, RpeExtraVideo } from './extra';
import type {
  RpeBeat,
  RpeChart,
  RpeEvent,
  RpeEventLayer,
  RpeExtended,
  RpeJudgeLine,
  RpeNoiseArea,
  RpeNote,
} from './types';

const RPE_VERSION = 170;
// rpe-next version with noise areas.
const NOISE_VERSION = 220;

const NOTE_TYPES: Record<NoteType, number> = { tap: 1, hold: 2, flick: 3, drag: 4 };

const UI_NAMES: Record<BuiltinText, string> = {
  pause: 'pause',
  bar: 'bar',
  combo: 'combonumber',
  comboLabel: 'combo',
  score: 'score',
  songName: 'name',
  difficulty: 'level',
};

const LAYER_KEYS: [Channel, keyof RpeEventLayer][] = [
  ['moveX', 'moveXEvents'],
  ['moveY', 'moveYEvents'],
  ['rotate', 'rotateEvents'],
  ['alpha', 'alphaEvents'],
  ['speed', 'speedEvents'],
];

const VIDEO_SCALES: Record<MediaFit, RpeExtraVideo['scale']> = {
  none: 'cropCenter',
  cover: 'cropCenter',
  inside: 'inside',
  stretch: 'fit',
};

// Bake grid, in beats.
const STEP = 1 / 32;
const NO_LIMIT = 999999;
const LINEAR: Easing = { kind: 'preset', id: 1 };
// Linear pieces per bezier speed event.
const SPEED_SLICES = 16;
// Vector components in uniform order.
const COMPONENTS = ['x', 'y', 'z', 'r', 'g', 'b', 'a'];

type Defaults = Partial<Record<Channel, number>>;
type Shown = JudgeLine | TextObject | MediaObject;

const rpeBeat = (b: Beat): RpeBeat => [b[0], b[1], b[2]];

function easingFields(e: Easing) {
  if (e.kind === 'bezier') {
    return { easingType: 1, easingLeft: 0, easingRight: 1, bezier: 1, bezierPoints: [...e.points] };
  }
  const [l, r] = e.clip ?? [0, 1];
  return { easingType: e.id, easingLeft: l, easingRight: r, bezier: 0, bezierPoints: [0, 0, 1, 1] };
}

function rpeEvent<T, U = T>(e: Omit<Event<T>, 'id'>, value: (v: T) => U): RpeEvent<U> {
  return {
    startTime: rpeBeat(e.start),
    endTime: rpeBeat(e.end),
    start: value(e.from),
    end: value(e.to),
    ...easingFields(e.easing),
    linkgroup: 0,
  };
}

const same = (v: number) => v;
const hold = (start: Beat, end: Beat, v: number) =>
  rpeEvent({ start, end, from: v, to: v, easing: LINEAR }, same);

// `held` = value before the first event; `empty` = RPE's value without events, and before
// the first one unless `lead` (lines hold the first start there). `offset` shifts every value.
function channel(
  events: NumEvent[],
  held: number,
  empty: number,
  offset = 0,
  lead = true,
): RpeEvent[] {
  const sorted = [...events].sort((a, b) => cmp(a.start, b.start));
  const out = sorted.map((e) => rpeEvent(e, (v) => v + offset));
  const v = held + offset;
  const first = sorted[0];
  if (!first) return Math.abs(v - empty) < 1e-9 ? [] : [hold(ZERO, [1, 0, 1], v)];
  const before = lead ? first.from + offset : empty;
  if (cmp(first.start, ZERO) > 0 && Math.abs(v - before) > 1e-9)
    out.unshift(hold(ZERO, first.start, v));
  return out;
}

const int = (list: RpeEvent[]) =>
  list.map((e) => ({ ...e, start: Math.round(e.start), end: Math.round(e.end) }));

// RPE speed has no bezier (Phira fails to load it): sliced into linear pieces.
const unbezier = (events: NumEvent[]) =>
  events.flatMap((e): NumEvent[] => {
    if (e.easing.kind !== 'bezier') return [e];
    const [a, b] = [toFloat(e.start), toFloat(e.end)];
    const at = (t: number) => e.from + (e.to - e.from) * ease(e.easing, t);
    return Array.from({ length: SPEED_SLICES }, (_, k) => {
      const [t0, t1] = [k / SPEED_SLICES, (k + 1) / SPEED_SLICES];
      return {
        ...e,
        start: fromFloat(a + (b - a) * t0, 960),
        end: fromFloat(a + (b - a) * t1, 960),
        from: at(t0),
        to: at(t1),
        easing: LINEAR,
      };
    }).filter((p) => cmp(p.end, p.start) > 0);
  });

const rgb = (c: Color): Color =>
  [0, 1, 2].map((i) => Math.max(0, Math.min(255, Math.round(c[i])))) as Color;

// Sum of all layers as linear events (for tracks RPE doesn't layer).
function baked(owner: LayerOwner, chart: Chart, c: Channel, eps: number): RpeEvent[] {
  const events = owner.layers.flatMap((l) => l[c]);
  if (!events.length) return [];
  const end = Math.max(...events.map((e) => toFloat(e.end)));
  const runtime = ownerRuntime(owner, chart.bpmList);
  const value = (b: number) => {
    const t = beatToSeconds(chart.bpmList, b);
    return owner.layers.reduce((sum, _, i) => sum + runtime.layerValue(i, c, t), 0);
  };
  return simplify(sample(0, end + STEP, STEP, value), eps).map((s) =>
    rpeEvent(
      {
        start: fromFloat(s.start, 32),
        end: fromFloat(s.end, 32),
        from: s.from,
        to: s.to,
        easing: LINEAR,
      },
      same,
    ),
  );
}

const layered = (owner: LayerOwner, c: Channel) => owner.layers.slice(1).some((l) => l[c].length);

const scaleEvents = (owner: LayerOwner, chart: Chart, c: Channel, held: number) =>
  layered(owner, c)
    ? baked(owner, chart, c, FIT_EPS.scale)
    : channel(owner.layers[0][c], held, BASE_DEFAULTS[c]);

// RPE layer channels are 0 without events (speed too).
function eventLayers(owner: LayerOwner, defaults: Defaults, offsets: Defaults): RpeEventLayer[] {
  const layers: RpeEventLayer[] = owner.layers.map((layer, i) =>
    Object.fromEntries(
      LAYER_KEYS.map(([c, key]) => {
        const events = c === 'speed' ? unbezier(layer[c]) : layer[c];
        const list = i
          ? channel(events, 0, 0)
          : channel(events, defaults[c] ?? BASE_DEFAULTS[c], 0, offsets[c]);
        // RPE alpha is an int.
        return [key, c === 'alpha' ? int(list) : list];
      }),
    ),
  );
  // Phira chains layers per channel: an empty list after a filled one panics, and an empty
  // first one drops the rest. Pad empties with a zero hold (speed handles empties itself).
  for (const [c, key] of LAYER_KEYS) {
    if (c === 'speed' || !layers.some((l) => l[key]?.length)) continue;
    for (const l of layers) if (!l[key]?.length) l[key] = [hold(ZERO, [1, 0, 1], 0)];
  }
  return layers;
}

// Before its first event RPE holds that color; PhiCreate the default.
function colorEvents(owner: Shown): RpeEvent<Color>[] {
  const sorted = [...owner.color].sort((a, b) => cmp(a.start, b.start));
  const out = sorted.map((e) => rpeEvent(e, rgb));
  const fallback = isLine(owner) ? LINE_COLOR : WHITE;
  const first = sorted[0];
  if (first && cmp(first.start, ZERO) > 0 && !first.from.every((v, i) => v === fallback[i])) {
    out.unshift(
      rpeEvent(
        { start: ZERO, end: first.start, from: fallback, to: fallback, easing: LINEAR },
        rgb,
      ),
    );
  }
  return out;
}

function shownLine(
  owner: Shown,
  chart: Chart,
  father: number,
  defaults: Defaults = {},
  offsets: Defaults = {},
): RpeJudgeLine {
  const extended: RpeExtended = {
    scaleXEvents: scaleEvents(owner, chart, 'scaleX', defaults.scaleX ?? 1),
    scaleYEvents: scaleEvents(owner, chart, 'scaleY', defaults.scaleY ?? 1),
    colorEvents: colorEvents(owner),
  };
  return {
    Name: owner.name,
    Group: 0,
    Texture: 'line.png',
    isGif: false,
    bpmfactor: 1,
    father,
    rotateWithFather: owner.rotateWithParent,
    isCover: 0,
    zOrder: owner.zOrder,
    anchor: [owner.anchor[0], owner.anchor[1]],
    eventLayers: eventLayers(owner, defaults, offsets),
    extended,
    notes: [],
    numOfNotes: 0,
  };
}

const note = (n: Note): RpeNote => ({
  type: NOTE_TYPES[n.type],
  startTime: rpeBeat(n.beat),
  endTime: rpeBeat(n.type === 'hold' && n.endBeat ? n.endBeat : n.beat),
  positionX: n.x,
  above: n.above ? 1 : 0,
  isFake: n.fake ? 1 : 0,
  speed: n.speed,
  size: n.size,
  alpha: Math.max(0, Math.min(255, Math.round(n.alpha))),
  yOffset: n.yOffset,
  visibleTime: Number.isFinite(n.visibleTime) ? n.visibleTime : NO_LIMIT,
  ...(n.tint && { tint: rgb(n.tint) }),
});

const hasEvents = (t: TextObject) =>
  t.layers.some((l) => CHANNELS.some((c) => l[c].length)) || t.color.length > 0;

function video(m: MediaObject, path: string, father: number): RpeExtraVideo {
  const start = [...m.starts].sort((a, b) => cmp(a.start, b.start))[0];
  const alpha = m.layers[0].alpha;
  const out: RpeExtraVideo = {
    path,
    time: rpeBeat(start?.start ?? ZERO),
    scale: VIDEO_SCALES[m.fit ?? 'cover'],
    alpha: alpha.length
      ? alpha.map((e) => rpeEvent(e, (v) => v / 255))
      : (m.defaults?.alpha ?? 255) / 255,
  };
  if (m.color.length) out.dim = m.color.map((e) => rpeEvent(e, (c) => 1 - c[0] / 255));
  if (father >= 0) out.attach = { line: father };
  return out;
}

function noiseArea(f: NoiseField, chart: Chart): RpeNoiseArea | null {
  const visible = [...f.visible].sort((a, b) => cmp(a.start, b.start));
  if (!visible.length) return null;
  const d = f.defaults ?? {};
  const center = [d.moveX ?? 0, d.moveY ?? 0];
  const multi = f.layers.length > 1;
  const track = (c: Channel, eps: number, fallback: number) =>
    multi
      ? baked(f, chart, c, eps)
      : channel(f.layers[0][c], d[c] ?? BASE_DEFAULTS[c], fallback, 0, false);
  // rpe-next requires rotate / scale anchors; the area's center pivots in place.
  const anchor = { x: center[0], y: center[1] };
  const anchored = (list: RpeEvent[]) => list.map((e) => ({ ...e, anchor: { ...anchor } }));
  const last = visible.reduce((a, b) => (cmp(b.end, a.end) > 0 ? b : a));
  return {
    Name: f.name,
    bottomLeft: { x: center[0] - f.size[0] / 2, y: center[1] - f.size[1] / 2 },
    topRight: { x: center[0] + f.size[0] / 2, y: center[1] + f.size[1] / 2 },
    appearTime: rpeBeat(visible[0].start),
    disappearTime: rpeBeat(last.end),
    activeIntervals: [...f.active]
      .sort((a, b) => cmp(a.start, b.start))
      .map((e) => ({ startTime: rpeBeat(e.start), endTime: rpeBeat(e.end), readyFlash: e.from })),
    isInvert: f.subtract,
    moveXEvents: track('moveX', FIT_EPS.move, center[0]),
    moveYEvents: track('moveY', FIT_EPS.move, center[1]),
    rotateEvents: anchored(track('rotate', FIT_EPS.rotate, 0)),
    scaleXEvents: anchored(track('scaleX', FIT_EPS.scale, 1)),
    scaleYEvents: anchored(track('scaleY', FIT_EPS.scale, 1)),
  };
}

type ExtValue = number | number[];

// One extra.json effect per active range; vec4 colors become 0–255.
function effectEntries(
  effect: ShaderEffect,
  chart: Chart,
  sources: Record<string, string>,
): RpeExtraEffect[] {
  const sec = (b: Beat) => beatToSeconds(chart.bpmList, toFloat(b));
  const runtime = effectRuntime(effect, chart.bpmList);
  const source = sources[effect.shader] ?? PRESET_SHADERS[effect.shader];
  const defaults: Record<string, number> = {};
  for (const u of source ? parseUniforms(source) : []) {
    uniformKeys(u).forEach((key, k) => (defaults[key] = u.value[k]));
  }
  const uniforms = new Map<string, string[]>();
  for (const [key, events] of Object.entries(effect.vars)) {
    if (!events.length) continue;
    const name = key.split('.')[0];
    uniforms.set(name, [...(uniforms.get(name) ?? []), key]);
  }
  const order = (key: string) => COMPONENTS.indexOf(key.split('.')[1] ?? '');

  return effect.active.map((range) => {
    const vars: Record<string, ExtValue | RpeEvent<ExtValue>[]> = {};
    for (const [name, keys] of uniforms) {
      keys.sort((a, b) => order(a) - order(b));
      // Phira reads vec4 colors as u8.
      const color = keys.length === 4;
      const at = (t: number): ExtValue => {
        const v = keys.map((k) => {
          const x = runtime.varValue(k, t, defaults[k] ?? 0);
          return color ? Math.max(0, Math.min(255, Math.round(x * 255))) : x;
        });
        return keys[0].includes('.') ? v : v[0];
      };
      const inRange = (e: NumEvent) => cmp(e.end, range.start) > 0 && cmp(e.start, range.end) < 0;
      const driver = keys
        .map((k) => effect.vars[k].filter(inRange))
        .sort((a, b) => b.length - a.length)[0];
      if (!driver.length) {
        vars[name] = at(sec(range.start));
        continue;
      }
      vars[name] = [...driver]
        .sort((a, b) => cmp(a.start, b.start))
        .map((e) => {
          const start = cmp(e.start, range.start) < 0 ? range.start : e.start;
          const end = cmp(e.end, range.end) > 0 ? range.end : e.end;
          return {
            startTime: rpeBeat(start),
            endTime: rpeBeat(end),
            start: at(sec(start)),
            end: at(sec(end) - 1e-6),
            ...easingFields(e.easing),
            linkgroup: 0,
          };
        });
    }
    return {
      start: rpeBeat(range.start),
      end: rpeBeat(range.end),
      shader: rpeShader(effect.shader),
      global: isGlobalRange(range),
      order: effect.order,
      vars,
    };
  });
}

export interface RpeExportOptions {
  meta: {
    id: string;
    name: string;
    artist: string;
    illustrator: string;
    charter: string;
    difficulty: string;
  };
  song?: string;
  background?: string;
  // Package file paths by media asset id.
  mediaPaths: Record<Id, string>;
  // Custom shader sources by path.
  shaders: Record<string, string>;
  // Noise fields as rpe-next noise areas.
  noise: boolean;
}

// Lossy: fonts, text sizes, builtin UI strings, GIF starts and video transforms are dropped;
// layered scale and multi-layer noise fields are baked into linear events.
export function chartToRpe(
  chart: Chart,
  opts: RpeExportOptions,
): { rpe: RpeChart; extra?: RpeExtra } {
  const index = new Map(chart.lines.map((l, i) => [l.id, i]));
  const father = (id: Id | null) => (id ? (index.get(id) ?? -1) : -1);

  const names = chart.lineGroups.map((g) => g.name);
  const groupIndex = (l: JudgeLine) => chart.lineGroups.findIndex((g) => g.id === l.groupId);
  const pad = chart.lines.some((l) => groupIndex(l) < 0) && !names.includes('Default') ? 1 : 0;
  const groups = pad || !names.length ? ['Default', ...names] : names;
  const defaultGroup = Math.max(0, groups.indexOf('Default'));

  const list: RpeJudgeLine[] = chart.lines.map((l) => {
    const group = groupIndex(l);
    return {
      ...shownLine(l, chart, father(l.parentId)),
      Group: group < 0 ? defaultGroup : group + pad,
      isCover: l.isCover ? 1 : 0,
      notes: [...l.notes].sort((a, b) => cmp(a.beat, b.beat)).map(note),
      // Holds aren't counted (RPE).
      numOfNotes: l.notes.filter((n) => n.type !== 'hold').length,
    };
  });

  // Lines keep their indices (fathers); texts and media follow in draw order, as RPE breaks
  // zOrder ties by index.
  const objects = drawOrder(chart).flatMap((d) => (d.kind === 'line' ? [] : [d.object]));
  const videos: RpeExtraVideo[] = [];
  for (const o of objects) {
    if (isMedia(o)) {
      const path = o.assetId ? opts.mediaPaths[o.assetId] : undefined;
      if (!path) continue;
      if (o.kind === 'video') videos.push(video(o, path, father(o.parentId)));
      if (o.kind !== 'image' && o.kind !== 'gif') continue;
      list.push({
        ...shownLine(o, chart, father(o.parentId), { ...MEDIA_DEFAULTS, ...o.defaults }),
        Texture: path,
        isGif: o.kind === 'gif',
      });
      continue;
    }
    const t = o;
    if (t.builtin) {
      if (!hasEvents(t) && !t.parentId) continue;
      // Attached UI events are offsets from the standard position.
      const d = t.defaults ?? {};
      const offsets = { moveX: -(d.moveX ?? 0), moveY: -(d.moveY ?? 0), alpha: -(d.alpha ?? 0) };
      list.push({
        ...shownLine(t, chart, father(t.parentId), d, offsets),
        attachUI: UI_NAMES[t.builtin],
      });
      continue;
    }
    const line = shownLine(t, chart, father(t.parentId), t.defaults);
    line.extended = { ...line.extended, textEvents: t.value.map((e) => rpeEvent(e, String)) };
    list.push(line);
  }

  const areas = opts.noise ? chart.noiseFields.flatMap((f) => noiseArea(f, chart) ?? []) : [];
  const BPMList = chart.bpmList.map((p) => ({ bpm: p.bpm, startTime: rpeBeat(p.beat) }));
  const rpe: RpeChart = {
    META: {
      RPEVersion: areas.length ? NOISE_VERSION : RPE_VERSION,
      id: opts.meta.id,
      name: opts.meta.name,
      composer: opts.meta.artist,
      charter: opts.meta.charter,
      illustration: opts.meta.illustrator,
      level: opts.meta.difficulty,
      song: opts.song ?? '',
      background: opts.background ?? '',
      // Milliseconds, an int.
      offset: Math.round(chart.offsetMs),
    },
    BPMList,
    judgeLineGroup: groups,
    judgeLineList: list,
    timeTags: chart.timeTags.map((t) => ({ name: t.name, time: rpeBeat(t.beat) })),
    ...(areas.length > 0 && { blockAreaList: areas }),
  };

  const effects = chart.effects.flatMap((e) => effectEntries(e, chart, opts.shaders));
  if (!effects.length && !videos.length) return { rpe };
  return {
    rpe,
    extra: { bpm: BPMList.map((p) => ({ time: p.startTime, bpm: p.bpm })), effects, videos },
  };
}
