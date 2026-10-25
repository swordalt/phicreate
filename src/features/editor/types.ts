import type { NoteType, TrackKey } from '@/features/chart/model/types';

export type EditorMode = 'preview' | 'edit';

// Grid that receives keyboard shortcuts (last clicked).
export type ActiveGrid = 'notes' | 'events';

export interface EventColumn {
  channel: TrackKey;
  label: string;
  color: string;
}

// Event grid columns, grouped as move / rotate / alpha / speed / scale / color.
export const EVENT_COLUMNS: EventColumn[] = [
  { channel: 'moveX', label: 'Move X', color: '#7aa2ff' },
  { channel: 'moveY', label: 'Move Y', color: '#5fb8ff' },
  { channel: 'rotate', label: 'Rotate', color: '#c792ea' },
  { channel: 'alpha', label: 'Alpha', color: '#f0ed69' },
  { channel: 'speed', label: 'Speed', color: '#fe8a65' },
  { channel: 'scaleX', label: 'Scale X', color: '#8bd17c' },
  { channel: 'scaleY', label: 'Scale Y', color: '#5fc79a' },
  { channel: 'color', label: 'Color', color: '#e6e6e6' },
];

// Text objects: no speed, plus the string track.
export const TEXT_COLUMNS: EventColumn[] = [
  ...EVENT_COLUMNS.filter((c) => c.channel !== 'speed'),
  { channel: 'value', label: 'Value', color: '#ff9ecb' },
  { channel: 'font', label: 'Font', color: '#ffc78a' },
];

// Media: no speed; GIFs and videos add the start track.
export const MEDIA_COLUMNS: EventColumn[] = EVENT_COLUMNS.filter((c) => c.channel !== 'speed');
export const PLAYABLE_COLUMNS: EventColumn[] = [
  ...MEDIA_COLUMNS,
  { channel: 'start', label: 'Start', color: '#4fd6d0' },
];

// Noise fields: shown / touchable ranges, then transform channels.
export const NOISE_COLUMNS: EventColumn[] = [
  { channel: 'visible', label: 'Visible', color: '#e6e6e6' },
  { channel: 'active', label: 'Active', color: '#ff5454' },
  ...EVENT_COLUMNS.filter((c) =>
    ['moveX', 'moveY', 'rotate', 'scaleX', 'scaleY', 'color'].includes(c.channel),
  ),
];

// Shader var columns cycle through these.
export const VAR_COLORS = [
  '#7aa2ff',
  '#c792ea',
  '#f0ed69',
  '#fe8a65',
  '#8bd17c',
  '#4fd6d0',
  '#ff9ecb',
];

// Quick-place keys (at cursor), RPE-style.
export const PLACE_KEYS: Record<string, NoteType> = { q: 'tap', w: 'drag', e: 'flick', r: 'hold' };

export const NOTE_COLORS: Record<NoteType, string> = {
  tap: '#0ac3ff',
  drag: '#f0ed69',
  flick: '#fe4365',
  hold: '#0ac3ff',
};

// Properties given to newly placed notes.
export interface NoteDefaults {
  speed: number;
  alpha: number;
  size: number;
  yOffset: number;
  above: boolean;
  fake: boolean;
}

export const MAX_DIVISION = 64;
// Beat resolution used when Snap Y is off.
export const FREE_DENSITY = 960;
export const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
export const ASPECTS: { label: string; value: number }[] = [
  { label: '3:2', value: 3 / 2 },
  { label: '16:9', value: 16 / 9 },
  { label: '16:10', value: 16 / 10 },
  { label: '4:3', value: 4 / 3 },
  { label: '21:9', value: 21 / 9 },
  { label: '1:1', value: 1 },
];
export const MIN_FOV = 0.1;
export const MAX_FOV = 10;
export const MIN_RATE = 0.1;
export const MAX_RATE = 4;
