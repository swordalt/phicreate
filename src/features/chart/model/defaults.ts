import { createId } from '@/lib/id';
import {
  CHANNELS,
  BUILTIN_TEXTS,
  type BuiltinText,
  type Chart,
  type EventLayer,
  type JudgeLine,
  type MediaObject,
  type NoiseField,
  type Beat,
  type Note,
  type NumEvent,
  type ShaderEffect,
  type TextEvent,
  type TextObject,
} from './types';

export const CHART_FORMAT_VERSION = 1;

export const CANVAS_WIDTH = 1350;
export const CANVAS_HEIGHT = 900;

export function createLayer(name: string): EventLayer {
  const layer = { id: createId(), name } as EventLayer;
  for (const c of CHANNELS) layer[c] = [];
  return layer;
}

export const createLine = (name: string): JudgeLine => ({
  id: createId(),
  name,
  parentId: null,
  rotateWithParent: true,
  zOrder: 0,
  groupId: null,
  isCover: true,
  anchor: [0.5, 0.5],
  layers: [createLayer('Base')],
  color: [],
  notes: [],
});

export const createText = (name: string): TextObject => ({
  id: createId(),
  name,
  anchor: [0.5, 0.5],
  size: 40,
  parentId: null,
  rotateWithParent: true,
  zOrder: 0,
  layers: [createLayer('Base')],
  color: [],
  value: [],
  font: [],
});

export const createMedia = (name: string): MediaObject => ({
  id: createId(),
  name,
  kind: null,
  assetId: null,
  anchor: [0.5, 0.5],
  loop: false,
  parentId: null,
  rotateWithParent: true,
  zOrder: 0,
  layers: [createLayer('Base')],
  color: [],
  starts: [],
});

export const createEffect = (name: string, shader = 'chromatic'): ShaderEffect => ({
  id: createId(),
  name,
  shader,
  active: [],
  order: 0,
  vars: {},
});

// Visible / active ranges hold 1 / the ready flash seconds.
export const createRangeEvent = (start: Beat, end: Beat, value = 1): NumEvent => ({
  id: createId(),
  start,
  end,
  from: value,
  to: value,
  easing: { kind: 'preset', id: 1 },
  locked: true,
});

// Shader run range (an `active` event); global ones cover the UI too.
export const createActiveEvent = (start: Beat, end: Beat, global = false): NumEvent =>
  createRangeEvent(start, end, Number(global));

export const isGlobalRange = (e: NumEvent) => e.from === 1;

export const NOISE_READY_FLASH = 0.5;

// Shown for 4 beats from `start`, touchable after the first.
export const createNoiseField = (name: string, start: Beat = [0, 0, 1]): NoiseField => ({
  id: createId(),
  name,
  size: [500, 300],
  subtract: false,
  parentId: null,
  rotateWithParent: true,
  layers: [createLayer('Base')],
  visible: [createRangeEvent(start, [start[0] + 4, start[1], start[2]])],
  active: [
    createRangeEvent(
      [start[0] + 1, start[1], start[2]],
      [start[0] + 4, start[1], start[2]],
      NOISE_READY_FLASH,
    ),
  ],
  color: [],
});

// Positions are canvas units (1350 x 900, origin center, +Y up), ~20 from the 3:2 frame edge.
const BUILTIN_DEFS: Record<
  BuiltinText,
  {
    name: string;
    value: string;
    x: number;
    y: number;
    anchor: [number, number];
    size: number;
    alphaVar?: string;
  }
> = {
  // Size is the icon / bar height.
  pause: { name: 'Pause button', value: '', x: -655, y: 420, anchor: [0, 1], size: 40 },
  bar: { name: 'Progress bar', value: '', x: -675, y: 450, anchor: [0, 1], size: 11.5 },
  combo: {
    name: 'Combo number',
    value: '{combo}',
    x: 0,
    y: 420,
    anchor: [0.5, 1],
    size: 64,
    alphaVar: 'comboAlpha',
  },
  comboLabel: {
    name: 'Combo text',
    value: 'COMBO',
    x: 0,
    y: 352,
    anchor: [0.5, 1],
    size: 24,
    alphaVar: 'comboAlpha',
  },
  score: { name: 'Score', value: '{score}', x: 655, y: 420, anchor: [1, 1], size: 40 },
  songName: { name: 'Song name', value: '{name}', x: -655, y: -420, anchor: [0, 0], size: 28 },
  difficulty: {
    name: 'Song difficulty',
    value: '{difficulty}',
    x: 655,
    y: -420,
    anchor: [1, 0],
    size: 28,
  },
};

// Held forever: one locked value event from beat 0.
const builtinValue = (value: string): TextEvent => ({
  id: createId(),
  start: [0, 0, 1],
  end: [1, 0, 1],
  from: value,
  to: value,
  easing: { kind: 'preset', id: 1 },
  locked: true,
});

export function createBuiltinText(builtin: BuiltinText): TextObject {
  const d = BUILTIN_DEFS[builtin];
  return {
    ...createText(d.name),
    builtin,
    anchor: d.anchor,
    size: d.size,
    alphaVar: d.alphaVar,
    defaults: { moveX: d.x, moveY: d.y, alpha: 255 },
    value: [builtinValue(d.value)],
  };
}

// Adds missing UI texts and restores an emptied value track.
function withBuiltins(texts: TextObject[]): TextObject[] {
  const missing = BUILTIN_TEXTS.filter((b) => !texts.some((t) => t.builtin === b));
  return [
    ...missing.map(createBuiltinText),
    ...texts.map((t) => {
      if (!t.builtin) return t;
      const d = BUILTIN_DEFS[t.builtin];
      return {
        ...t,
        alphaVar: t.alphaVar ?? d.alphaVar,
        value: t.value.length ? t.value : [builtinValue(d.value)],
      };
    }),
  ];
}

export const createChart = (bpm = 120, lineCount = 1): Chart => ({
  formatVersion: CHART_FORMAT_VERSION,
  offsetMs: 0,
  bpmList: [{ beat: [0, 0, 1], bpm }],
  lines: Array.from({ length: lineCount }, (_, i) => createLine(`Line ${i}`)),
  texts: BUILTIN_TEXTS.map(createBuiltinText),
  media: [],
  effects: [],
  noiseFields: [],
  lineGroups: [],
  timeTags: [],
  editor: { lines: {} },
});

export const NOTE_DEFAULTS: Omit<Note, 'id' | 'type' | 'beat'> = {
  x: 0,
  above: true,
  speed: 1,
  fake: false,
  alpha: 255,
  size: 1,
  yOffset: 0,
  visibleTime: Infinity,
};

export const createNote = (note: Pick<Note, 'type' | 'beat'> & Partial<Note>): Note => ({
  ...NOTE_DEFAULTS,
  id: createId(),
  ...note,
});

// Effects from before `active` had one start / end range, or an object-wide `global`.
function withEffectDefaults(
  e: ShaderEffect & { start?: Beat; end?: Beat; global?: boolean },
): ShaderEffect {
  const { start, end, global, ...rest } = e;
  let active = rest.active ?? (start && end ? [createActiveEvent(start, end)] : []);
  if (global !== undefined) {
    const v = Number(global);
    active = active.map((r) => ({ ...r, from: v, to: v, locked: true }));
  }
  return { ...createEffect(e.name, e.shader), ...rest, active };
}

// Fills omitted / JSON-lossy fields (Infinity serializes to null).
export function withDefaults(chart: Chart): Chart {
  return {
    ...createChart(120, 0),
    ...chart,
    editor: { ...chart.editor, lines: chart.editor?.lines ?? {} },
    texts: withBuiltins((chart.texts ?? []).map((text) => ({ ...createText(text.name), ...text }))),
    media: (chart.media ?? []).map((m) => ({ ...createMedia(m.name), ...m })),
    effects: (chart.effects ?? []).map(withEffectDefaults),
    noiseFields: (chart.noiseFields ?? []).map((f) => ({ ...createNoiseField(f.name), ...f })),
    lines: chart.lines.map((line) => ({
      ...createLine(line.name),
      ...line,
      notes: line.notes.map((n) => ({
        ...NOTE_DEFAULTS,
        ...n,
        visibleTime: n.visibleTime ?? Infinity,
      })),
    })),
  };
}
