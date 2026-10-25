import { toFloat } from '../model/beat';
import { ease, isLinear } from '../model/easing';
import { beatToSeconds } from '../model/timing';
import {
  DEFAULT_FONT,
  isMedia,
  isNoise,
  isText,
  type BpmPoint,
  type LayerOwner,
  type Channel,
  type Chart,
  type Color,
  type ColorEvent,
  type Easing,
  type EventLayer,
  type JudgeLine,
  type MediaObject,
  type NoiseField,
  type Note,
  type NumEvent,
  type ShaderEffect,
  type TextEvent,
  type TextObject,
} from '../model/types';

// Evaluates line/note state at a chart time (seconds). See chart-data-plan §4, §8.

// Speed 1.0 = 120 canvas units per second.
const SPEED_UNIT = 120;

export const BASE_DEFAULTS: Record<Channel, number> = {
  moveX: 0,
  moveY: 0,
  rotate: 0,
  alpha: 0,
  speed: 10,
  scaleX: 1,
  scaleY: 1,
};

interface Segment {
  start: number;
  end: number;
  from: number;
  to: number;
  easing: Easing;
}

function lastAtOrBefore<T>(items: T[], t: number, key: (item: T) => number) {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(items[mid]) <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

class Track {
  protected segs: Segment[];

  constructor(
    events: NumEvent[],
    bpmList: BpmPoint[],
    readonly fallback: number,
  ) {
    this.segs = events
      .map((e) => ({
        start: beatToSeconds(bpmList, toFloat(e.start)),
        end: beatToSeconds(bpmList, toFloat(e.end)),
        from: e.from,
        to: e.to,
        easing: e.easing,
      }))
      .sort((a, b) => a.start - b.start);
  }

  // Before the first event: default. After an event: its `to`.
  value(t: number) {
    const i = lastAtOrBefore(this.segs, t, (s) => s.start);
    if (i < 0) return this.fallback;
    const s = this.segs[i];
    if (t >= s.end || s.from === s.to) return s.to;
    return s.from + (s.to - s.from) * ease(s.easing, (t - s.start) / (s.end - s.start));
  }
}

class SpeedTrack extends Track {
  private knots: { t: number; d: number }[] = [];
  private zero: number;

  constructor(events: NumEvent[], bpmList: BpmPoint[], fallback: number) {
    super(events, bpmList, fallback);
    const times = [...new Set(this.segs.flatMap((s) => [s.start, s.end]))].sort((a, b) => a - b);
    let d = 0;
    for (let i = 0; i < times.length; i++) {
      if (i > 0) d += this.integrate(times[i - 1], times[i]);
      this.knots.push({ t: times[i], d });
    }
    this.zero = this.raw(0);
  }

  // [a, b] never crosses a knot.
  private integrate(a: number, b: number) {
    if (b <= a) return 0;
    const mid = (a + b) / 2;
    const i = lastAtOrBefore(this.segs, mid, (s) => s.start);
    const seg = i >= 0 && mid < this.segs[i].end ? this.segs[i] : null;
    if (!seg) return this.value(mid) * (b - a);
    if (isLinear(seg.easing) || seg.from === seg.to) {
      return ((this.value(a) + this.value(Math.min(b, seg.end - 1e-9))) / 2) * (b - a);
    }
    // Simpson's rule
    const n = 20;
    const h = (b - a) / n;
    let sum = 0;
    for (let k = 0; k <= n; k++) {
      const w = k === 0 || k === n ? 1 : k % 2 ? 4 : 2;
      sum += w * this.value(Math.min(a + h * k, seg.end - 1e-9));
    }
    return (sum * h) / 3;
  }

  private raw(t: number) {
    if (!this.knots.length) return this.fallback * t;
    if (t <= this.knots[0].t) return (t - this.knots[0].t) * this.fallback;
    const k = this.knots[lastAtOrBefore(this.knots, t, (x) => x.t)];
    return k.d + this.integrate(k.t, t);
  }

  // Floor position in canvas units, 0 at t = 0.
  distance(t: number) {
    return (this.raw(t) - this.zero) * SPEED_UNIT;
  }
}

// Default colors when no color event applies (RPE).
export const LINE_COLOR: Color = [241, 216, 148];
export const WHITE: Color = [255, 255, 255];
// Noise field tint (rpe-next / Phira default).
export const NOISE_COLOR: Color = [255, 84, 84];

export type JudgeStatus = 'ap' | 'fc' | 'none';

export const JUDGE_COLORS: Record<JudgeStatus, Color> = {
  ap: LINE_COLOR,
  fc: [162, 238, 255],
  none: WHITE,
};

// The {color} variable: the line default, following the AP/FC indicator.
let judgeStatus: JudgeStatus = 'ap';
export const setJudgeStatus = (status: JudgeStatus) => {
  judgeStatus = status;
};
const variableColor = () => JUDGE_COLORS[judgeStatus];

class ColorTrack {
  private segs: { start: number; end: number; event: ColorEvent }[];

  constructor(
    events: ColorEvent[],
    bpmList: BpmPoint[],
    private readonly defaultColor: Color | (() => Color),
  ) {
    this.segs = events
      .map((event) => ({
        start: beatToSeconds(bpmList, toFloat(event.start)),
        end: beatToSeconds(bpmList, toFloat(event.end)),
        event,
      }))
      .sort((a, b) => a.start - b.start);
  }

  // Per-channel interpolation; same hold rules as Track.
  value(t: number): Color {
    const i = lastAtOrBefore(this.segs, t, (s) => s.start);
    if (i < 0) return typeof this.defaultColor === 'function' ? this.defaultColor() : this.defaultColor;
    const { start, end, event } = this.segs[i];
    if (t >= end) return event.to;
    const p = ease(event.easing, (t - start) / (end - start));
    return event.from.map((v, k) => v + (event.to[k] - v) * p) as Color;
  }
}

export interface LineState {
  x: number;
  y: number;
  rotation: number;
  alpha: number;
  scaleX: number;
  scaleY: number;
  color: Color;
  floor: number;
}

export interface NoteEntry {
  note: Note;
  start: number;
  end: number;
  floor: number;
  tail: number;
}

type ValueChannel = Exclude<Channel, 'speed'>;
const VALUE_CHANNELS: ValueChannel[] = ['moveX', 'moveY', 'rotate', 'alpha', 'scaleX', 'scaleY'];

// Only the base layer starts from the channel default; extra layers add 0.
const fallback = (c: Channel, layerIndex: number, defaults?: TextObject['defaults']) =>
  layerIndex === 0 ? (defaults?.[c] ?? BASE_DEFAULTS[c]) : 0;

function buildTracks(layers: EventLayer[], bpmList: BpmPoint[], defaults?: TextObject['defaults']) {
  return Object.fromEntries(
    VALUE_CHANNELS.map((c) => [
      c,
      layers.map((layer, i) => new Track(layer[c], bpmList, fallback(c, i, defaults))),
    ]),
  ) as Record<ValueChannel, Track[]>;
}

function sumTracks(tracks: Record<ValueChannel, Track[]>, c: ValueChannel, t: number) {
  let v = 0;
  for (const track of tracks[c]) v += track.value(t);
  return v;
}

export class LineRuntime {
  private tracks: Record<ValueChannel, Track[]>;
  private speeds: SpeedTrack[];
  private colors: ColorTrack;
  readonly notes: NoteEntry[];
  // True when notes are in start order.
  readonly sortedByStart: boolean;
  // Running max of note ends, to skip notes that ended earlier.
  private maxEnds: number[];

  constructor(
    readonly line: JudgeLine,
    bpmList: BpmPoint[],
  ) {
    this.tracks = buildTracks(line.layers, bpmList);
    this.colors = new ColorTrack(line.color, bpmList, variableColor);
    this.speeds = line.layers.map((l, i) => new SpeedTrack(l.speed, bpmList, fallback('speed', i)));
    this.notes = line.notes.map((note) => {
      const start = beatToSeconds(bpmList, toFloat(note.beat));
      const end = note.endBeat ? beatToSeconds(bpmList, toFloat(note.endBeat)) : start;
      return {
        note,
        start,
        end,
        floor: this.floor(start) + note.yOffset,
        tail: this.floor(end) + note.yOffset,
      };
    });
    let max = -Infinity;
    this.maxEnds = this.notes.map((e) => (max = Math.max(max, e.end)));
    this.sortedByStart = this.notes.every((e, i) => !i || this.notes[i - 1].start <= e.start);
  }

  // Index of the first note that may end at or after t; earlier notes all end before t.
  firstEndingFrom(t: number) {
    let lo = 0;
    let hi = this.maxEnds.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.maxEnds[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private sum(c: ValueChannel, t: number) {
    return sumTracks(this.tracks, c, t);
  }

  // Value of one layer's channel (not summed).
  layerValue(layerIndex: number, channel: Channel, t: number) {
    const track = channel === 'speed' ? this.speeds[layerIndex] : this.tracks[channel][layerIndex];
    return track?.value(t) ?? 0;
  }

  colorAt(t: number) {
    return this.colors.value(t);
  }

  floor(t: number) {
    let d = 0;
    for (const s of this.speeds) d += s.distance(t);
    return d;
  }

  localState(t: number): LineState {
    return {
      x: this.sum('moveX', t),
      y: this.sum('moveY', t),
      rotation: this.sum('rotate', t),
      alpha: this.sum('alpha', t),
      scaleX: this.sum('scaleX', t),
      scaleY: this.sum('scaleY', t),
      color: this.colors.value(t),
      floor: this.floor(t),
    };
  }
}

const runtimes = new WeakMap<JudgeLine, { bpmList: BpmPoint[]; runtime: LineRuntime }>();

export function lineRuntime(line: JudgeLine, bpmList: BpmPoint[]) {
  const cached = runtimes.get(line);
  if (cached?.bpmList === bpmList) return cached.runtime;
  const runtime = new LineRuntime(line, bpmList);
  runtimes.set(line, { bpmList, runtime });
  return runtime;
}

export interface TextState {
  x: number;
  y: number;
  rotation: number;
  alpha: number;
  scaleX: number;
  scaleY: number;
  color: Color;
  text: string;
  font: string;
}

// Same-prefix strings type in / out; otherwise `a` holds until the event ends.
function lerpText(a: string, b: string, p: number) {
  const q = Math.min(1, Math.max(0, p));
  if (b.startsWith(a)) return b.slice(0, a.length + Math.floor((b.length - a.length) * q));
  if (a.startsWith(b)) return a.slice(0, b.length + Math.ceil((a.length - b.length) * (1 - q)));
  return a;
}

class TextTrack {
  private segs: { start: number; end: number; event: TextEvent }[];

  constructor(events: TextEvent[], bpmList: BpmPoint[]) {
    this.segs = events
      .map((event) => ({
        start: beatToSeconds(bpmList, toFloat(event.start)),
        end: beatToSeconds(bpmList, toFloat(event.end)),
        event,
      }))
      .sort((a, b) => a.start - b.start);
  }

  // Empty before the first event; after an event: its `to`.
  value(t: number) {
    const i = lastAtOrBefore(this.segs, t, (s) => s.start);
    if (i < 0) return '';
    const { start, end, event } = this.segs[i];
    if (t >= end || event.from === event.to) return event.to;
    return lerpText(event.from, event.to, ease(event.easing, (t - start) / (end - start)));
  }
}

// Font file name; steps from `from` to `to` when an event ends.
class FontTrack {
  private segs: { start: number; end: number; event: TextEvent }[];

  constructor(events: TextEvent[], bpmList: BpmPoint[]) {
    this.segs = events
      .map((event) => ({
        start: beatToSeconds(bpmList, toFloat(event.start)),
        end: beatToSeconds(bpmList, toFloat(event.end)),
        event,
      }))
      .sort((a, b) => a.start - b.start);
  }

  value(t: number) {
    const i = lastAtOrBefore(this.segs, t, (s) => s.start);
    if (i < 0) return DEFAULT_FONT;
    const { end, event } = this.segs[i];
    return (t >= end ? event.to : event.from) || DEFAULT_FONT;
  }
}

export class TextRuntime {
  private tracks: Record<ValueChannel, Track[]>;
  private fonts: FontTrack;
  private values: TextTrack;
  private colors: ColorTrack;

  constructor(
    readonly text: TextObject,
    bpmList: BpmPoint[],
  ) {
    this.tracks = buildTracks(text.layers, bpmList, text.defaults);
    this.values = new TextTrack(text.value, bpmList);
    this.fonts = new FontTrack(text.font, bpmList);
    this.colors = new ColorTrack(text.color, bpmList, WHITE);
  }

  colorAt(t: number) {
    return this.colors.value(t);
  }

  fontAt(t: number) {
    return this.fonts.value(t);
  }

  // Value of one layer's channel (not summed); texts have no speed.
  layerValue(layerIndex: number, channel: Channel, t: number) {
    return channel === 'speed' ? 0 : (this.tracks[channel][layerIndex]?.value(t) ?? 0);
  }

  textAt(t: number) {
    return this.values.value(t);
  }

  localState(t: number): TextState {
    return {
      x: sumTracks(this.tracks, 'moveX', t),
      y: sumTracks(this.tracks, 'moveY', t),
      rotation: sumTracks(this.tracks, 'rotate', t),
      alpha: sumTracks(this.tracks, 'alpha', t),
      scaleX: sumTracks(this.tracks, 'scaleX', t),
      scaleY: sumTracks(this.tracks, 'scaleY', t),
      color: this.colors.value(t),
      text: this.values.value(t),
      font: this.fonts.value(t),
    };
  }
}

const textRuntimes = new WeakMap<TextObject, { bpmList: BpmPoint[]; runtime: TextRuntime }>();

export function textRuntime(text: TextObject, bpmList: BpmPoint[]) {
  const cached = textRuntimes.get(text);
  if (cached?.bpmList === bpmList) return cached.runtime;
  const runtime = new TextRuntime(text, bpmList);
  textRuntimes.set(text, { bpmList, runtime });
  return runtime;
}

export interface MediaState extends Omit<TextState, 'text' | 'font'> {
  // Seconds since the latest start (plus its offset); null before the first start.
  mediaTime: number | null;
}

// Media are visible by default.
export const MEDIA_DEFAULTS: TextObject['defaults'] = { alpha: 255 };

export class MediaRuntime {
  private tracks: Record<ValueChannel, Track[]>;
  private starts: { time: number; offset: number }[];
  private colors: ColorTrack;

  constructor(
    readonly media: MediaObject,
    bpmList: BpmPoint[],
  ) {
    this.tracks = buildTracks(media.layers, bpmList, { ...MEDIA_DEFAULTS, ...media.defaults });
    this.colors = new ColorTrack(media.color, bpmList, WHITE);
    this.starts = media.starts
      .map((e) => ({ time: beatToSeconds(bpmList, toFloat(e.start)), offset: e.from }))
      .sort((a, b) => a.time - b.time);
  }

  layerValue(layerIndex: number, channel: Channel, t: number) {
    return channel === 'speed' ? 0 : (this.tracks[channel][layerIndex]?.value(t) ?? 0);
  }

  colorAt(t: number) {
    return this.colors.value(t);
  }

  mediaTime(t: number) {
    const i = lastAtOrBefore(this.starts, t, (s) => s.time);
    return i < 0 ? null : t - this.starts[i].time + this.starts[i].offset;
  }

  localState(t: number): MediaState {
    return {
      x: sumTracks(this.tracks, 'moveX', t),
      y: sumTracks(this.tracks, 'moveY', t),
      rotation: sumTracks(this.tracks, 'rotate', t),
      alpha: sumTracks(this.tracks, 'alpha', t),
      scaleX: sumTracks(this.tracks, 'scaleX', t),
      scaleY: sumTracks(this.tracks, 'scaleY', t),
      color: this.colors.value(t),
      mediaTime: this.mediaTime(t),
    };
  }
}

const mediaRuntimes = new WeakMap<MediaObject, { bpmList: BpmPoint[]; runtime: MediaRuntime }>();

export function mediaRuntime(media: MediaObject, bpmList: BpmPoint[]) {
  const cached = mediaRuntimes.get(media);
  if (cached?.bpmList === bpmList) return cached.runtime;
  const runtime = new MediaRuntime(media, bpmList);
  mediaRuntimes.set(media, { bpmList, runtime });
  return runtime;
}

const lineIndexes = new WeakMap<JudgeLine[], Map<string, number>>();

function indexOf(lines: JudgeLine[]) {
  let map = lineIndexes.get(lines);
  if (!map) {
    map = new Map(lines.map((l, i) => [l.id, i]));
    lineIndexes.set(lines, map);
  }
  return map;
}

interface Pose {
  x: number;
  y: number;
  rotation: number;
}

// `yScale` squashes y while rotating, as a player stretching the canvas to another aspect
// does (Phira rotates in screen space); 1 = the canvas's own 3:2.
export function toWorld<S extends Pose>(
  local: S,
  parent: Pose,
  rotateWithParent: boolean,
  yScale = 1,
): S {
  const a = (-parent.rotation * Math.PI) / 180;
  const ly = local.y * yScale;
  return {
    ...local,
    x: parent.x + local.x * Math.cos(a) - ly * Math.sin(a),
    y: parent.y + (local.x * Math.sin(a) + ly * Math.cos(a)) / yScale,
    rotation: local.rotation + (rotateWithParent ? parent.rotation : 0),
  };
}

// Lazily resolves world-space line states at time t (parents first, cycles ignored).
export function createSampler(chart: Chart, t: number, yScale = 1) {
  const index = indexOf(chart.lines);
  const states: LineState[] = [];
  const visiting = new Set<number>();

  const resolve = (i: number): LineState => {
    if (states[i]) return states[i];
    const line = chart.lines[i];
    const local = lineRuntime(line, chart.bpmList).localState(t);
    const parentIndex = line.parentId ? index.get(line.parentId) : undefined;
    if (parentIndex === undefined || visiting.has(parentIndex)) return (states[i] = local);
    visiting.add(i);
    const parent = resolve(parentIndex);
    visiting.delete(i);
    return (states[i] = toWorld(local, parent, line.rotateWithParent, yScale));
  };

  return resolve;
}

type Sampler = ReturnType<typeof createSampler>;

export function attach<S extends Pose>(
  chart: Chart,
  sample: Sampler,
  obj: { parentId: string | null; rotateWithParent: boolean },
  local: S,
  yScale = 1,
) {
  const parentIndex = obj.parentId ? indexOf(chart.lines).get(obj.parentId) : undefined;
  return parentIndex === undefined
    ? local
    : toWorld(local, sample(parentIndex), obj.rotateWithParent, yScale);
}

// World-space text states; `sample` is the line sampler for the same time.
export const sampleTexts = (chart: Chart, t: number, sample: Sampler) =>
  chart.texts.map((text) => ({
    text,
    state: attach(chart, sample, text, textRuntime(text, chart.bpmList).localState(t)),
  }));

export const sampleMedia = (chart: Chart, t: number, sample: Sampler) =>
  chart.media.map((media) => ({
    media,
    state: attach(chart, sample, media, mediaRuntime(media, chart.bpmList).localState(t)),
  }));

export class EffectRuntime {
  // Active ranges in seconds, sorted.
  private ranges: { start: number; end: number }[];
  private tracks = new Map<string, Track>();

  constructor(
    readonly effect: ShaderEffect,
    bpmList: BpmPoint[],
  ) {
    this.ranges = effect.active
      .map((e) => ({
        start: beatToSeconds(bpmList, toFloat(e.start)),
        end: beatToSeconds(bpmList, toFloat(e.end)),
      }))
      .sort((a, b) => a.start - b.start);
    for (const [key, events] of Object.entries(effect.vars)) {
      if (!events.length) continue;
      // Before the first event: its start value (Phira).
      const first = events.reduce((a, b) => (toFloat(b.start) < toFloat(a.start) ? b : a));
      this.tracks.set(key, new Track(events, bpmList, first.from));
    }
  }

  isActive(t: number) {
    const i = lastAtOrBefore(this.ranges, t, (r) => r.start);
    return i >= 0 && t < this.ranges[i].end;
  }

  // `fallback` (the uniform default) applies to tracks without events.
  varValue(key: string, t: number, fallback: number) {
    return this.tracks.get(key)?.value(t) ?? fallback;
  }
}

const effectRuntimes = new WeakMap<ShaderEffect, { bpmList: BpmPoint[]; runtime: EffectRuntime }>();

export function effectRuntime(effect: ShaderEffect, bpmList: BpmPoint[]) {
  const cached = effectRuntimes.get(effect);
  if (cached?.bpmList === bpmList) return cached.runtime;
  const runtime = new EffectRuntime(effect, bpmList);
  effectRuntimes.set(effect, { bpmList, runtime });
  return runtime;
}

export type NoisePhase = 'disabled' | 'ready' | 'active';

export interface NoiseState {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  // Null while hidden.
  phase: NoisePhase | null;
  // 0 = disabled look, 1 = active look (flashes while ready).
  mix: number;
  color: Color;
}

// Ready flash: 3 pulses (rpe-next).
const FLASHES = 3;

export class NoiseRuntime {
  private tracks: Record<ValueChannel, Track[]>;
  private visible: { start: number; end: number }[];
  private active: { start: number; end: number; flash: number }[];
  private colors: ColorTrack;

  constructor(
    readonly field: NoiseField,
    bpmList: BpmPoint[],
  ) {
    const sec = (b: NumEvent['start']) => beatToSeconds(bpmList, toFloat(b));
    this.tracks = buildTracks(field.layers, bpmList, field.defaults);
    this.colors = new ColorTrack(field.color ?? [], bpmList, NOISE_COLOR);
    this.visible = field.visible
      .map((e) => ({ start: sec(e.start), end: sec(e.end) }))
      .sort((a, b) => a.start - b.start);
    this.active = field.active
      .map((e) => ({ start: sec(e.start), end: sec(e.end), flash: Math.max(0, e.from) }))
      .sort((a, b) => a.start - b.start);
  }

  layerValue(layerIndex: number, channel: Channel, t: number) {
    return channel === 'speed' ? 0 : (this.tracks[channel][layerIndex]?.value(t) ?? 0);
  }

  colorAt(t: number) {
    return this.colors.value(t);
  }

  isShown(t: number) {
    const i = lastAtOrBefore(this.visible, t, (r) => r.start);
    return i >= 0 && t < this.visible[i].end;
  }

  phaseAt(t: number): Pick<NoiseState, 'phase' | 'mix'> {
    if (!this.isShown(t)) return { phase: null, mix: 0 };
    const i = lastAtOrBefore(this.active, t, (r) => r.start);
    if (i >= 0 && t < this.active[i].end) return { phase: 'active', mix: 1 };
    const next = this.active[i + 1];
    if (next && next.flash > 0 && t >= next.start - next.flash) {
      const p = (t - (next.start - next.flash)) / next.flash;
      return { phase: 'ready', mix: (1 - Math.cos(p * Math.PI * 2 * FLASHES)) / 2 };
    }
    return { phase: 'disabled', mix: 0 };
  }

  localState(t: number): NoiseState {
    return {
      x: sumTracks(this.tracks, 'moveX', t),
      y: sumTracks(this.tracks, 'moveY', t),
      rotation: sumTracks(this.tracks, 'rotate', t),
      scaleX: sumTracks(this.tracks, 'scaleX', t),
      scaleY: sumTracks(this.tracks, 'scaleY', t),
      color: this.colors.value(t),
      ...this.phaseAt(t),
    };
  }
}

const noiseRuntimes = new WeakMap<NoiseField, { bpmList: BpmPoint[]; runtime: NoiseRuntime }>();

export function noiseRuntime(field: NoiseField, bpmList: BpmPoint[]) {
  const cached = noiseRuntimes.get(field);
  if (cached?.bpmList === bpmList) return cached.runtime;
  const runtime = new NoiseRuntime(field, bpmList);
  noiseRuntimes.set(field, { bpmList, runtime });
  return runtime;
}

// Shown ranges bucketed by second, so a frame only samples fields shown around it.
const NOISE_BUCKET = 1;
// Fields shown longer than this many buckets are always candidates.
const NOISE_MAX_BUCKETS = 64;

interface NoiseIndex {
  buckets: Map<number, number[]>;
  always: number[];
  byId: Map<string, number>;
}

const noiseIndexes = new WeakMap<NoiseField[], { bpmList: BpmPoint[]; index: NoiseIndex }>();

function noiseIndex(fields: NoiseField[], bpmList: BpmPoint[]): NoiseIndex {
  const cached = noiseIndexes.get(fields);
  if (cached?.bpmList === bpmList) return cached.index;
  const index: NoiseIndex = { buckets: new Map(), always: [], byId: new Map() };
  const sec = (b: NumEvent['start']) => beatToSeconds(bpmList, toFloat(b));
  fields.forEach((field, i) => {
    index.byId.set(field.id, i);
    for (const e of field.visible) {
      const b0 = Math.floor(sec(e.start) / NOISE_BUCKET);
      const b1 = Math.floor(sec(e.end) / NOISE_BUCKET);
      if (b1 < b0) continue;
      if (b1 - b0 > NOISE_MAX_BUCKETS) {
        if (index.always[index.always.length - 1] !== i) index.always.push(i);
        continue;
      }
      for (let b = b0; b <= b1; b++) {
        const list = index.buckets.get(b);
        if (!list) index.buckets.set(b, [i]);
        else if (list[list.length - 1] !== i) list.push(i);
      }
    }
  });
  noiseIndexes.set(fields, { bpmList, index });
  return index;
}

// Fields shown at `t`, plus `includeId` (e.g. the selection) even while hidden. Keeps chart order.
export function sampleNoiseFields(
  chart: Chart,
  t: number,
  sample: Sampler,
  includeId?: string | null,
) {
  const { buckets, always, byId } = noiseIndex(chart.noiseFields, chart.bpmList);
  const candidates = new Set([...(buckets.get(Math.floor(t / NOISE_BUCKET)) ?? []), ...always]);
  const extra = includeId ? byId.get(includeId) : undefined;
  if (extra !== undefined) candidates.add(extra);
  const out: { field: NoiseField; state: NoiseState }[] = [];
  for (const i of [...candidates].sort((a, b) => a - b)) {
    const field = chart.noiseFields[i];
    const runtime = noiseRuntime(field, chart.bpmList);
    if (i !== extra && !runtime.isShown(t)) continue;
    out.push({ field, state: attach(chart, sample, field, runtime.localState(t)) });
  }
  return out;
}

// Any layered owner's runtime (for per-layer values).
export const ownerRuntime = (owner: LayerOwner, bpmList: BpmPoint[]) =>
  isText(owner)
    ? textRuntime(owner, bpmList)
    : isMedia(owner)
      ? mediaRuntime(owner, bpmList)
      : isNoise(owner)
        ? noiseRuntime(owner, bpmList)
        : lineRuntime(owner, bpmList);

export function sampleScene(chart: Chart, t: number): LineState[] {
  const sample = createSampler(chart, t);
  return chart.lines.map((_, i) => sample(i));
}

export interface NoteState {
  x: number;
  y: number;
  tail: number;
  alpha: number;
  size: number;
  showHead: boolean;
}

// Note position in line-local space (+y = away from the line, above side).
export function noteState(entry: NoteEntry, line: LineState, t: number): NoteState {
  const { note } = entry;
  const side = note.above ? 1 : -1;
  const activeHold = note.type === 'hold' && entry.start < t;
  const distance = activeHold ? note.yOffset : entry.floor - line.floor;
  return {
    x: note.x,
    y: distance * note.speed * side,
    tail: (entry.tail - line.floor) * note.speed * side,
    alpha: note.alpha / 255,
    size: note.size,
    showHead: !activeHold,
  };
}

export function isNoteVisible(entry: NoteEntry, runtime: LineRuntime, line: LineState, t: number) {
  if (line.alpha < 0 || entry.end < t) return false;
  if (entry.start - t > entry.note.visibleTime) return false;
  const lead = entry.note.type === 'hold' ? entry.tail : entry.floor;
  return !(runtime.line.isCover && lead < line.floor);
}
