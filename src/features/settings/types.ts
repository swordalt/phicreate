export type UiScale = '90' | '100' | '110' | '125';
export type Language = 'en';
export type NoiseQuality = 'simplified' | 'original';
// Multi-select gesture in the grids: drag a box, or draw a line through items.
export type SelectMode = 'box' | 'line';
export type HitEffects = 'always' | 'preview' | 'never';
export type FrameCap = 'display' | 'uncapped' | 'custom';
// Preview resolution, % of device pixels.
export type RenderScale = '100' | '75' | '50';
// Object types pickable by hovering the preview.
export type PreviewSelectType = 'line' | 'note' | 'text' | 'ui' | 'media' | 'noise';

export const MIN_CUSTOM_FPS = 1;
export const MAX_CUSTOM_FPS = 1000;

export type { JudgeStatus } from '@/features/chart/runtime/scene';
import type { JudgeStatus } from '@/features/chart/runtime/scene';

export interface Settings {
  // General
  language: Language;
  uiScale: UiScale;
  showFps: boolean;
  frameCap: FrameCap;
  customFps: number;
  // Audio (0–1)
  musicVolume: number;
  hitsoundVolume: number;
  audioOffsetMs: number;
  // Editing
  eventCurves: boolean;
  selectMode: SelectMode;
  bearingMarker: boolean;
  previewSelect: boolean;
  previewSelectTypes: PreviewSelectType[];
  // Preview
  noiseQuality: NoiseQuality;
  backgroundBlur: boolean;
  renderOptimization: boolean;
  // Sub-options; only apply with renderOptimization on.
  skipStackedNotes: boolean;
  skipFaintNotes: boolean;
  skipHoldSeams: boolean;
  simpleHitEffects: boolean;
  renderScale: RenderScale;
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
  frameCap: 'display',
  customFps: 60,
  musicVolume: 1,
  hitsoundVolume: 0.5,
  audioOffsetMs: 0,
  eventCurves: true,
  selectMode: 'box',
  bearingMarker: false,
  previewSelect: true,
  previewSelectTypes: ['line', 'note'],
  noiseQuality: 'simplified',
  backgroundBlur: true,
  renderOptimization: false,
  skipStackedNotes: true,
  skipFaintNotes: true,
  skipHoldSeams: false,
  simpleHitEffects: false,
  renderScale: '100',
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

// Frame cap for the render loop: 0 = display rate, Infinity = uncapped.
export function frameCapFps({ frameCap, customFps }: Settings) {
  if (frameCap === 'uncapped') return Infinity;
  if (frameCap === 'custom') return Math.min(MAX_CUSTOM_FPS, Math.max(MIN_CUSTOM_FPS, customFps));
  return 0;
}

// Active preview optimizations, or null when render optimization is off.
export function renderOptimizations(s: Settings) {
  if (!s.renderOptimization) return null;
  return {
    stackedNotes: s.skipStackedNotes,
    faintNotes: s.skipFaintNotes,
    holdSeams: s.skipHoldSeams,
    simpleHits: s.simpleHitEffects,
  };
}

export const renderScaleFactor = (s: Settings) =>
  s.renderOptimization ? Number(s.renderScale) / 100 : 1;
