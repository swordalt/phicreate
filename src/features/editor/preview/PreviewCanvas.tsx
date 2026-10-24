import { useEffect, useRef } from 'react';
import type { Chart } from '@/features/chart/model/types';
import { useChartStore } from '@/features/chart/runtime/useChartStore';
import { useSettingsStore } from '@/features/settings/useSettingsStore';
import { scrollTimeline } from '../grid/useGridCanvas';
import { playback } from '../playback/playback';
import { useEditorStore } from '../useEditorStore';
import { toChartTime } from '../time';
import { drawPreview } from './drawPreview';
import { pauseAllMedia } from './media';
import { activePasses } from './shaderPasses';
import { loadSkin } from './skin';
import styles from './PreviewCanvas.module.css';

const hiddenCache = new WeakMap<Chart['editor'], Set<string>>();

function hiddenLines(chart: Chart) {
  let set = hiddenCache.get(chart.editor);
  if (!set) {
    set = new Set(
      Object.entries(chart.editor.lines)
        .filter(([, d]) => d.hidden)
        .map(([id]) => id),
    );
    hiddenCache.set(chart.editor, set);
  }
  return set;
}

// Gameplay preview; renders every frame from the stores.
export function PreviewCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    void loadSkin();
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    let size = { w: 0, h: 0, dpr: 1 };

    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      size = { w: wrap.clientWidth, h: wrap.clientHeight, dpr };
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
    });
    ro.observe(wrap);

    let raf = 0;
    let effectsSince = Infinity;
    let wasPlaying = false;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const chart = useChartStore.getState().chart;
      const editor = useEditorStore.getState();
      if (!chart || !size.w) return;

      const t = toChartTime(chart, editor.playing ? playback.time : editor.time);
      // Only show hit effects for notes hit during the current playback.
      if (editor.playing && !wasPlaying) effectsSince = t;
      if (!editor.playing) effectsSince = Infinity;
      wasPlaying = editor.playing;

      const settings = useSettingsStore.getState().settings;
      // Preview only: none under the editing grid.
      const showHits =
        settings.hitEffects === 'always' ||
        (settings.hitEffects === 'preview' && editor.mode !== 'edit');

      ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);
      drawPreview(ctx, size.w, size.h, chart, t, {
        effectsSince: showHits ? effectsSince : Infinity,
        hiddenLines: hiddenLines(chart),
        aspect: editor.aspect,
        fov: editor.fov,
        selectedLineId: editor.selectedLineId,
        selectedObjectId: editor.selectedObjectId,
        info: { name: editor.projectName, difficulty: editor.difficulty },
        playing: editor.playing,
        rate: editor.rate,
        duration: editor.duration,
        shaders: editor.shaders ? activePasses(chart, t) : undefined,
        hideUI: !editor.showUI,
        hideText: !editor.showText,
        hideMedia: !editor.showMedia,
        hideNoise: !editor.showNoise,
        noiseQuality: settings.noiseQuality,
        backgroundBlur: settings.backgroundBlur,
        highlightSimultaneous: settings.highlightSimultaneous,
        highlightSelected: settings.highlightSelected,
        judgeStatus: settings.judgeStatus,
        bearingMarker: settings.bearingMarker,
      });
    };
    raf = requestAnimationFrame(frame);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      scrollTimeline(e.deltaY);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      pauseAllMedia();
      ro.disconnect();
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  );
}
