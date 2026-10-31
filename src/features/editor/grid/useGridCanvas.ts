import { useEffect, useRef, type RefObject } from 'react';
import {
  isShader,
  type Chart,
  type EventLayer,
  type EventOwner,
} from '@/features/chart/model/types';
import { useChartStore } from '@/features/chart/runtime/useChartStore';
import { onFrame } from '@/lib/frameLoop';
import { playback } from '../playback/playback';
import { useEditorStore } from '../useEditorStore';
import { beatToMusicTime, musicTimeToBeat } from '../time';
import { GridGeometry } from './geometry';
import { readPalette, type Palette } from './timeGrid';

const ZOOM_STEP = 1.15;
const MIN_PPB = 20;
const MAX_PPB = 1200;

// Grid backdrop opacity over the gameplay preview.
export const GRID_BACKDROP = 0.55;

export interface GridFrame {
  ctx: CanvasRenderingContext2D;
  g: GridGeometry;
  palette: Palette;
  chart: Chart;
  editor: ReturnType<typeof useEditorStore.getState>;
}

// Shared time-grid canvas: sizing, per-frame geometry, wheel scroll / Ctrl+wheel zoom.
export function useGridCanvas(
  wrapRef: RefObject<HTMLDivElement>,
  canvasRef: RefObject<HTMLCanvasElement>,
  draw: (frame: GridFrame) => void,
) {
  const geoRef = useRef<GridGeometry | null>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    let palette = readPalette();
    let size = { w: 0, h: 0, dpr: 1 };

    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      size = { w: wrap.clientWidth, h: wrap.clientHeight, dpr };
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
      palette = readPalette();
    });
    ro.observe(wrap);

    const frame = () => {
      const chart = useChartStore.getState().chart;
      const editor = useEditorStore.getState();
      if (!chart || !size.w) return;
      const time = editor.playing ? playback.time : editor.time;
      const g = new GridGeometry(size.w, size.h, editor.pxPerBeat, musicTimeToBeat(chart, time));
      geoRef.current = g;
      ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      drawRef.current({ ctx, g, palette, chart, editor });
    };
    const stopFrames = onFrame(frame);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const editor = useEditorStore.getState();
        const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        editor.set({ pxPerBeat: Math.min(MAX_PPB, Math.max(MIN_PPB, editor.pxPerBeat * factor)) });
      } else {
        scrollTimeline(e.deltaY);
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      stopFrames();
      ro.disconnect();
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [wrapRef, canvasRef]);

  return geoRef;
}

// Moves the playhead by a wheel delta; scrolling pauses playback.
export function scrollTimeline(deltaY: number) {
  const editor = useEditorStore.getState();
  const chart = useChartStore.getState().chart;
  if (!chart) return;
  if (editor.playing) editor.pause();
  const beat = musicTimeToBeat(chart, useEditorStore.getState().time);
  editor.seek(beatToMusicTime(chart, beat - deltaY / editor.pxPerBeat));
}

export function currentLine(chart: Chart | null) {
  const id = useEditorStore.getState().selectedLineId;
  return chart?.lines.find((l) => l.id === id) ?? null;
}

// Selected judge line, text, media object, shader effect or noise field.
export function currentOwner(chart: Chart | null): EventOwner | null {
  const { selectedObjectId: id } = useEditorStore.getState();
  return (
    currentLine(chart) ??
    chart?.texts.find((t) => t.id === id) ??
    chart?.media.find((m) => m.id === id) ??
    chart?.effects.find((e) => e.id === id) ??
    chart?.noiseFields.find((f) => f.id === id) ??
    null
  );
}

// Selected event layer, falling back to the base layer. Null for shaders (no layers).
export function currentLayer(owner: EventOwner | null): EventLayer | null {
  if (!owner || isShader(owner)) return null;
  const id = useEditorStore.getState().selectedLayerId;
  return owner.layers.find((y) => y.id === id) ?? owner.layers[0] ?? null;
}

// Owner whose events the grid edits, with its layer (null for shaders).
export function currentTarget(chart: Chart | null) {
  const owner = currentOwner(chart);
  const layer = currentLayer(owner);
  if (!owner || (!layer && !isShader(owner))) return null;
  return { owner, layer, layerId: layer?.id ?? null };
}
