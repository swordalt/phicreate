import { createId } from '@/lib/id';
import {
  componentNames,
  nativeShader,
  parseUniforms,
  PRESET_SHADERS,
  uniformKeys,
} from '@/features/shaders/library';
import { add, cmp, eq, fromFloat, toFloat } from '../../model/beat';
import { createActiveEvent, createEffect, createMedia } from '../../model/defaults';
import { beatToSeconds, secondsToBeat } from '../../model/timing';
import type {
  Beat,
  BpmPoint,
  Color,
  Event,
  Id,
  MediaFit,
  MediaObject,
  NumEvent,
  ShaderEffect,
} from '../../model/types';
import { beat, easing } from './fromRpe';
import type { RpeBeat, RpeEvent } from './types';

// Phira / RPE `extra.json`. See https://teamflos.github.io/phira-docs/chart-standard/extra.html

type ExtValue = number | number[];

export interface RpeExtraEffect {
  start: RpeBeat;
  end: RpeBeat;
  // Preset name, or '/file.glsl' in the chart folder.
  shader: string;
  // Constant, or keyframes; vec4 values are 0–255 colors.
  vars?: Record<string, ExtValue | RpeEvent<ExtValue>[]>;
  global?: boolean;
  order?: number;
}

type ExtAnim = number | RpeEvent<number>[];

export interface RpeExtraVideo {
  // File in the chart folder.
  path: string;
  // Playback start.
  time?: RpeBeat;
  scale?: 'cropCenter' | 'inside' | 'fit';
  // 0–1, default 1.
  alpha?: ExtAnim;
  // Darkening 0–1, default 0.
  dim?: ExtAnim;
  // Follows a judge line (index).
  attach?: { line: number };
}

export interface RpeExtra {
  bpm?: number | { time: RpeBeat; bpm: number }[];
  effects?: RpeExtraEffect[];
  videos?: RpeExtraVideo[];
}

export const isRpeExtra = (data: unknown): data is RpeExtra =>
  !!data &&
  typeof data === 'object' &&
  (Array.isArray((data as RpeExtra).effects) || Array.isArray((data as RpeExtra).videos));

const BEAT_DENSITY = 960;
const MIN_LENGTH: Beat = [0, 1, 64];

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// Components of a value; vec4 colors become 0–1 (Phira reads them as u8).
const components = (v: unknown): number[] => {
  if (!Array.isArray(v)) return [num(v)];
  const out = v.map(num);
  return out.length === 4 ? out.map((c) => c / 255) : out;
};

function bpmList(bpm: RpeExtra['bpm']): BpmPoint[] {
  if (typeof bpm === 'number') return [{ beat: [0, 0, 1], bpm }];
  return (Array.isArray(bpm) ? bpm : [])
    .map((p) => ({ beat: beat(p?.time), bpm: num(p?.bpm) }))
    .filter((p) => p.bpm > 0)
    .sort((a, b) => cmp(a.beat, b.beat));
}

const sameBpm = (a: BpmPoint[], b: BpmPoint[]) =>
  a.length === b.length && a.every((p, i) => eq(p.beat, b[i].beat) && p.bpm === b[i].bpm);

// Maps extra beats onto the chart's BPM list.
function beatConverter(extra: RpeExtra, chartBpm: BpmPoint[]) {
  const own = bpmList(extra.bpm);
  return (b: RpeBeat | undefined): Beat => {
    const value = beat(b);
    if (!own.length || sameBpm(own, chartBpm)) return value;
    const seconds = beatToSeconds(own, toFloat(value));
    return fromFloat(Math.max(0, secondsToBeat(chartBpm, seconds)), BEAT_DENSITY);
  };
}

// No overlaps or empty events (edits reject invalid tracks).
function tidy<T extends Event<unknown>>(events: T[]): T[] {
  events.sort((a, b) => cmp(a.start, b.start));
  const out: T[] = [];
  events.forEach((e, i) => {
    let end = cmp(e.end, e.start) > 0 ? e.end : add(e.start, MIN_LENGTH);
    const next = events[i + 1];
    if (next && cmp(end, next.start) > 0) end = next.start;
    if (cmp(end, e.start) > 0) out.push({ ...e, end });
  });
  return out;
}

const LINEAR = { kind: 'preset', id: 1 } as const;

// Locked value over a range.
const hold = (start: Beat, end: Beat, value: number): Omit<NumEvent, 'id'> => ({
  start,
  end,
  from: value,
  to: value,
  easing: LINEAR,
  locked: true,
});

// Merges effects into one object per shader (and order), global per range; beats move from
// the extra's BPM list onto the chart's. Extra presets replace their bundled files.
// `sources` holds custom shaders for var defaults.
export function extraToEffects(
  extra: RpeExtra,
  chartBpm: BpmPoint[],
  sources: Record<string, string> = {},
): ShaderEffect[] {
  const convert = beatConverter(extra, chartBpm);

  interface Group {
    effect: ShaderEffect;
    // Per range: the var keys it sets.
    ranges: { start: Beat; end: Beat; keys: Set<string> }[];
  }
  const groups = new Map<string, Group>();

  for (const src of extra.effects ?? []) {
    if (!src || typeof src.shader !== 'string') continue;
    const shader = nativeShader(src.shader);
    const order = num(src.order);
    const id = `${shader}|${order}`;
    let group = groups.get(id);
    if (!group) {
      const base = shader.replace(/^.*\//, '').replace(/\.glsl$/i, '') || 'Shader';
      const name = `${base}${order ? ` #${order}` : ''}`;
      group = { effect: { ...createEffect(name, shader), order }, ranges: [] };
      groups.set(id, group);
    }
    const { effect } = group;
    const start = convert(src.start);
    let end = convert(src.end);
    if (cmp(end, start) <= 0) end = add(start, MIN_LENGTH);
    effect.active.push(createActiveEvent(start, end, !!src.global));
    const keys = new Set<string>();
    group.ranges.push({ start, end, keys });

    const put = (name: string, size: number, k: number, event: Omit<NumEvent, 'id'>) => {
      const c = componentNames(size)[k];
      const key = c ? `${name}.${c}` : name;
      keys.add(key);
      (effect.vars[key] ??= []).push({ ...event, id: createId() });
    };
    for (const [name, value] of Object.entries(src.vars ?? {})) {
      const keyframes =
        Array.isArray(value) && value.length > 0 && typeof value[0] === 'object'
          ? (value as RpeEvent<ExtValue>[])
          : null;
      if (!keyframes) {
        const v = components(value);
        v.forEach((c, k) => put(name, v.length, k, hold(start, end, c)));
        continue;
      }
      const sorted = [...keyframes].sort((a, b) => cmp(beat(a.startTime), beat(b.startTime)));
      const first = convert(sorted[0]?.startTime);
      for (const [i, e] of sorted.entries()) {
        const from = components(e.start);
        const to = components(e.end);
        from.forEach((c, k) => {
          // Before its first keyframe, the effect holds that keyframe's start value (Phira).
          if (i === 0 && cmp(first, start) > 0) put(name, from.length, k, hold(start, first, c));
          put(name, from.length, k, {
            start: convert(e.startTime),
            end: convert(e.endTime),
            from: c,
            to: to[k] ?? c,
            easing: easing(e),
          });
        });
      }
    }
  }

  return [...groups.values()].map(({ effect, ranges }) => {
    // Ranges that don't set a var use the shader default, not the previous range's value.
    const source = sources[effect.shader] ?? PRESET_SHADERS[effect.shader];
    const defaults: Record<string, number> = {};
    for (const u of source ? parseUniforms(source) : []) {
      uniformKeys(u).forEach((key, k) => (defaults[key] = u.value[k]));
    }
    for (const [key, events] of Object.entries(effect.vars)) {
      if (!(key in defaults)) continue;
      for (const r of ranges) {
        if (!r.keys.has(key))
          events.push({ ...hold(r.start, r.end, defaults[key]), id: createId() });
      }
    }
    for (const key of Object.keys(effect.vars)) effect.vars[key] = tidy(effect.vars[key]);
    effect.active = tidy(effect.active);
    return effect;
  });
}

const VIDEO_FITS: Record<string, MediaFit> = {
  cropCenter: 'cover',
  inside: 'inside',
  fit: 'stretch',
};

// Videos as frame-fitted video media objects. `files` maps paths to asset ids;
// `lineIds` maps RPE line indexes to chart line ids.
export function extraToVideos(
  extra: RpeExtra,
  chartBpm: BpmPoint[],
  files: Record<string, Id>,
  lineIds: (Id | undefined)[] = [],
): MediaObject[] {
  const convert = beatConverter(extra, chartBpm);
  const keyframes = <T>(anim: ExtAnim | undefined, value: (v: number) => T): Event<T>[] | null =>
    Array.isArray(anim)
      ? tidy(
          anim.map((e) => ({
            id: createId(),
            start: convert(e.startTime),
            end: convert(e.endTime),
            from: value(num(e.start)),
            to: value(num(e.end)),
            easing: easing(e),
          })),
        )
      : null;
  // Held from beat 0.
  const constant = <T>(v: T): Event<T> => ({
    id: createId(),
    start: [0, 0, 1],
    end: [1, 0, 1],
    from: v,
    to: v,
    easing: LINEAR,
    locked: true,
  });
  // Dim darkens the video: a gray tint.
  const gray = (dim: number): Color => {
    const v = Math.round(Math.min(1, Math.max(0, 1 - dim)) * 255);
    return [v, v, v];
  };

  return (extra.videos ?? []).flatMap((src) => {
    if (!src || typeof src.path !== 'string') return [];
    const name = src.path.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
    const media = createMedia(name || 'Video');
    media.kind = 'video';
    media.assetId = files[src.path] ?? null;
    media.fit = VIDEO_FITS[src.scale ?? 'cropCenter'] ?? 'cover';
    media.playingOnly = true;
    // Under the lines, as in Phira.
    media.zOrder = -1;
    const start = convert(src.time);
    media.starts = [{ ...constant(0), start, end: add(start, [1, 0, 1]) }];

    const alpha = keyframes(src.alpha, (v) => v * 255);
    if (alpha) media.layers[0].alpha = alpha;
    else if (src.alpha !== undefined) media.defaults = { alpha: num(src.alpha) * 255 };

    const dim = keyframes(src.dim, gray);
    if (dim) media.color = dim;
    else if (src.dim) media.color = [constant(gray(num(src.dim)))];

    const parent = src.attach ? lineIds[num(src.attach.line)] : undefined;
    if (parent) media.parentId = parent;
    return [media];
  });
}
