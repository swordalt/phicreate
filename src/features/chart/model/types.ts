// See docs/chart-data-plan.md §3–§6.

// [whole, numerator, denominator], reduced, 0 <= numerator < denominator.
export type Beat = [number, number, number];

export type Id = string;

export interface BpmPoint {
  beat: Beat;
  bpm: number;
}

export interface Chart {
  formatVersion: number;
  offsetMs: number;
  bpmList: BpmPoint[];
  lines: JudgeLine[];
  texts: TextObject[];
  media: MediaObject[];
  effects: ShaderEffect[];
  noiseFields: NoiseField[];
  lineGroups: LineGroup[];
  timeTags: TimeTag[];
  editor: EditorChartMeta;
}

export interface LineGroup {
  id: Id;
  name: string;
}

export interface TimeTag {
  id: Id;
  name: string;
  beat: Beat;
}

export interface JudgeLine {
  id: Id;
  name: string;
  parentId: Id | null;
  rotateWithParent: boolean;
  zOrder: number;
  groupId: Id | null;
  isCover: boolean;
  // Pivot within the line, 0–1 (y up); 0.5 0.5 = middle.
  anchor: [number, number];
  layers: EventLayer[];
  // Single track (colors don't add across layers).
  color: ColorEvent[];
  notes: Note[];
}

// Fixed UI elements every chart has; they can't be deleted. `pause` and `bar` are shapes, not text.
export const BUILTIN_TEXTS = [
  'pause',
  'bar',
  'combo',
  'comboLabel',
  'score',
  'songName',
  'difficulty',
] as const;
export type BuiltinText = (typeof BUILTIN_TEXTS)[number];

// Renders text; no notes. Move / rotate / alpha / scale come from layers, the string from `value`.
export interface TextObject {
  id: Id;
  name: string;
  builtin?: BuiltinText;
  // Pivot within the text, 0-1 (y up); 0.5 0.5 = middle.
  anchor: [number, number];
  // Font size in canvas units.
  size: number;
  // Base-layer starting values (override the channel defaults).
  defaults?: Partial<Record<Channel, number>>;
  // Variable (0-255) that scales the alpha channel, e.g. 'comboAlpha'.
  alphaVar?: string;
  parentId: Id | null; // judge line
  rotateWithParent: boolean;
  zOrder: number;
  layers: EventLayer[];
  color: ColorEvent[];
  // Single track (strings don't add across layers).
  value: TextEvent[];
  // Single track of library font file names; none = DEFAULT_FONT.
  font: TextEvent[];
}

export const DEFAULT_FONT = 'Saira';

export const MEDIA_KINDS = ['image', 'gif', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

// Sizing against the play frame (Phira video `scale`); 'none' = 1 pixel per canvas unit.
export const MEDIA_FITS = ['none', 'cover', 'inside', 'stretch'] as const;
export type MediaFit = (typeof MEDIA_FITS)[number];

// Imported image / GIF / video. Transform from layers; GIFs and videos play from `starts`.
export interface MediaObject {
  id: Id;
  name: string;
  // Null until a file is imported.
  kind: MediaKind | null;
  // Blob key in the project's media store.
  assetId: Id | null;
  // Pivot within the media, 0-1 (y up); 0.5 0.5 = middle.
  anchor: [number, number];
  loop: boolean;
  fit?: MediaFit;
  // GIFs / videos show only between a start and the end of playback (Phira videos).
  playingOnly?: boolean;
  // Base-layer starting values (override the channel defaults).
  defaults?: Partial<Record<Channel, number>>;
  parentId: Id | null; // judge line
  rotateWithParent: boolean;
  zOrder: number;
  layers: EventLayer[];
  // Tint (multiplied).
  color: ColorEvent[];
  // Each start restarts playback; `from` is the media time (seconds) to start at.
  starts: NumEvent[];
}

// Post-processing shader; one object per shader, running during its `active` events
// (each a Phira / RPE `extra.json` effect).
export interface ShaderEffect {
  id: Id;
  name: string;
  // Preset name (e.g. 'chromatic') or a custom file as '/name.glsl'.
  shader: string;
  // Ranges the shader runs in; locked 1 covers the UI too (global), 0 the chart only.
  active: NumEvent[];
  // Lower renders first.
  order: number;
  // Uniform tracks by var key: `power`, or a vector component like `offset.x` / `color.r`.
  vars: Record<string, NumEvent[]>;
}

// Phigros block area. A rect centered on its position; layers move / rotate / scale it.
export interface NoiseField {
  id: Id;
  name: string;
  // Canvas units, before scale.
  size: [number, number];
  // Hole (official `isSubtract`, rpe-next `isInvert`).
  subtract: boolean;
  // Base-layer starting values (override the channel defaults).
  defaults?: Partial<Record<Channel, number>>;
  parentId: Id | null; // judge line
  rotateWithParent: boolean;
  layers: EventLayer[];
  // Shown ranges; values unused (locked 1).
  visible: NumEvent[];
  // Touchable ranges; `from` is the ready flash length in seconds (locked).
  active: NumEvent[];
  // Tint; red (NOISE_COLOR) without events. Single track.
  color: ColorEvent[];
}

// Objects with layers.
export type LayerOwner = JudgeLine | TextObject | MediaObject | NoiseField;
export type EventOwner = LayerOwner | ShaderEffect;
export const isNoise = (o: EventOwner): o is NoiseField => 'subtract' in o;
export const isShader = (o: EventOwner): o is ShaderEffect => 'shader' in o;
export const isText = (o: EventOwner): o is TextObject => 'value' in o;
export const isMedia = (o: EventOwner): o is MediaObject => 'assetId' in o;
export const isLine = (o: EventOwner): o is JudgeLine => 'notes' in o;
// GIFs and videos have a start track.
export const isPlayable = (kind: MediaKind | null) => kind === 'gif' || kind === 'video';

export const CHANNELS = ['moveX', 'moveY', 'rotate', 'alpha', 'speed', 'scaleX', 'scaleY'] as const;
export type Channel = (typeof CHANNELS)[number];

export type EventLayer = { id: Id; name: string } & Record<Channel, NumEvent[]>;

export interface Event<T> {
  id: Id;
  start: Beat;
  end: Beat;
  from: T;
  to: T;
  easing: Easing;
  // From and to stay identical.
  locked?: boolean;
}
export type NumEvent = Event<number>;
export type TextEvent = Event<string>;
// RGB, 0-255.
export type Color = [number, number, number];
export type ColorEvent = Event<Color>;

export type EventItem =
  | { channel: Channel; event: NumEvent }
  | { channel: 'start'; event: NumEvent }
  | { channel: 'active'; event: NumEvent }
  | { channel: 'visible'; event: NumEvent }
  | { channel: 'value'; event: TextEvent }
  | { channel: 'font'; event: TextEvent }
  | { channel: 'color'; event: ColorEvent }
  | { channel: VarKey; event: NumEvent };

// Shader uniform track.
export type VarKey = `var:${string}`;
export const isVarKey = (key: string): key is VarKey => key.startsWith('var:');

// Event layer channels plus object-level single tracks.
export type TrackKey = EventItem['channel'];

export type Easing =
  | { kind: 'preset'; id: number; clip?: [number, number] }
  | { kind: 'bezier'; points: [number, number, number, number] };

export const NOTE_TYPES = ['tap', 'drag', 'hold', 'flick'] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

export interface Note {
  id: Id;
  type: NoteType;
  beat: Beat;
  endBeat?: Beat; // hold only
  x: number;
  above: boolean;
  speed: number;
  fake: boolean;
  alpha: number;
  size: number;
  yOffset: number;
  visibleTime: number;
  tint?: Color;
}

export interface LineDisplay {
  color?: string;
  locked?: boolean;
  hidden?: boolean;
}

export interface EditorChartMeta {
  lines: Record<Id, LineDisplay>;
}
