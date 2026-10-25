export type UiScale = '90' | '100' | '110' | '125';
export type Language = 'en';
export type NoiseQuality = 'simplified' | 'original';
// Multi-select gesture in the grids: drag a box, or draw a line through items.
export type SelectMode = 'box' | 'line';
export type HitEffects = 'always' | 'preview' | 'never';

export type { JudgeStatus } from '@/features/chart/runtime/scene';
import type { JudgeStatus } from '@/features/chart/runtime/scene';

export interface Settings {
  // General
  language: Language;
  uiScale: UiScale;
  showFps: boolean;
  // Audio (0–1)
  musicVolume: number;
  hitsoundVolume: number;
  audioOffsetMs: number;
  // Editing
  eventCurves: boolean;
  selectMode: SelectMode;
  bearingMarker: boolean;
  // Preview
  noiseQuality: NoiseQuality;
  backgroundBlur: boolean;
  fullscreenAspect: boolean;
  highlightSimultaneous: boolean;
  highlightSelected: boolean;
  hitEffects: HitEffects;
  judgeStatus: JudgeStatus;

  lastProjectId: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'en',
  uiScale: '100',
  showFps: false,
  musicVolume: 1,
  hitsoundVolume: 0.5,
  audioOffsetMs: 0,
  eventCurves: true,
  selectMode: 'box',
  bearingMarker: false,
  noiseQuality: 'simplified',
  backgroundBlur: true,
  fullscreenAspect: true,
  highlightSimultaneous: true,
  highlightSelected: true,
  hitEffects: 'preview',
  judgeStatus: 'ap',
  lastProjectId: null,
};

// Fills defaults and migrates old fields.
export function normalizeSettings(stored: unknown): Settings {
  const raw = (stored && typeof stored === 'object' ? stored : {}) as Partial<Settings> & {
    hitsounds?: boolean;
  };
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (raw[key] !== undefined) (settings as Record<string, unknown>)[key] = raw[key];
  }
  if (raw.hitsounds === false && raw.hitsoundVolume === undefined) settings.hitsoundVolume = 0;
  return settings;
}
