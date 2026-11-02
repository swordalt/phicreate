import { useCallback, useEffect, useRef, useState } from 'react';
import { ContextMenu } from '@/components/ui';
import type { Chart } from '@/features/chart/model/types';
import { useChartStore } from '@/features/chart/runtime/useChartStore';
import {
  renderOptimizations,
  renderScaleFactor,
  type PreviewSelectType,
} from '@/features/settings/types';
import { useSettingsStore } from '@/features/settings/useSettingsStore';
import { onFrame } from '@/lib/frameLoop';
import { scrollTimeline } from '../grid/useGridCanvas';
import { playback } from '../playback/playback';
import { useEditorStore } from '../useEditorStore';
import { toChartTime } from '../time';
import { drawPreview } from './drawPreview';
import { hitsAt, outlineHit, type PreviewHit } from './hits';
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

// Hover reach around objects, in CSS px.
const HIT_TOLERANCE = 4;

const kindsCache = new WeakMap<PreviewSelectType[], Set<PreviewSelectType>>();

function kindSet(kinds: PreviewSelectType[]) {
  let set = kindsCache.get(kinds);
  if (!set) kindsCache.set(kinds, (set = new Set(kinds)));
  return set;
}

const KIND_LABELS: Record<PreviewSelectType, string> = {
  line: 'Judge line',
  note: 'Note',
  text: 'Text',
  ui: 'UI element',
  media: 'Media',
  noise: 'Noise field',
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function hitLabel(chart: Chart, hit: PreviewHit) {
  if (hit.kind === 'note') {
    const line = chart.lines.find((l) => l.id === hit.lineId);
    const note = line?.notes.find((n) => n.id === hit.id);
    return { label: `${capitalize(note?.type ?? 'note')} note`, hint: line?.name };
  }
  const list: { id: string; name: string }[] =
    hit.kind === 'line'
      ? chart.lines
      : hit.kind === 'media'
        ? chart.media
        : hit.kind === 'noise'
          ? chart.noiseFields
          : chart.texts;
  const name = list.find((o) => o.id === hit.id)?.name;
  return { label: name || KIND_LABELS[hit.kind], hint: KIND_LABELS[hit.kind] };
}

// Selects the object and opens its properties.
function focusHit(hit: PreviewHit) {
  const editor = useEditorStore.getState();
  if (hit.kind === 'note') {
    editor.selectLine(hit.lineId!);
    editor.set({ activeGrid: 'notes' });
    editor.selectNotes([hit.id]);
  } else if (hit.kind === 'line') {
    editor.selectLine(hit.id);
    editor.set({ objectPanelOpen: true });
  } else {
    editor.selectObject(hit.id);
    editor.set({ objectPanelOpen: true });
  }
}

interface Menu {
  x: number;
  y: number;
  hits: PreviewHit[];
}

let previewWrap: HTMLElement | null = null;

export function togglePreviewFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void previewWrap?.requestFullscreen().catch(() => {});
}

// Gameplay preview; renders every frame from the stores.
export function PreviewCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [toast, setToast] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const menuRef = useRef<Menu | null>(null);
  const menuHoverRef = useRef<string | null>(null);
  menuRef.current = menu;
  const closeMenu = useCallback(() => {
    menuHoverRef.current = null;
    setMenu(null);
  }, []);

  useEffect(() => {
    void loadSkin();
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    previewWrap = wrap;
    const ctx = canvas.getContext('2d')!;
    let size = { w: 0, h: 0, dpr: 1 };

    const ro = new ResizeObserver(() => {
      size = { ...size, w: wrap.clientWidth, h: wrap.clientHeight };
    });
    ro.observe(wrap);
    // Backing store follows the container and render scale.
    const fitCanvas = (scale: number) => {
      size.dpr = (window.devicePixelRatio || 1) * scale;
      const w = Math.round(size.w * size.dpr);
      const h = Math.round(size.h * size.dpr);
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
    };

    // Pointer over the canvas (CSS px) and the last frame's selectable objects.
    let pointer: { x: number; y: number } | null = null;
    let lastHits: PreviewHit[] = [];
    const hitsUnder = (x: number, y: number) =>
      hitsAt(lastHits, x * size.dpr, y * size.dpr, HIT_TOLERANCE * size.dpr);

    let effectsSince = Infinity;
    let wasPlaying = false;
    const frame = () => {
      const chart = useChartStore.getState().chart;
      const editor = useEditorStore.getState();
      if (!chart || !size.w) return;

      const t = toChartTime(chart, editor.playing ? playback.time : editor.time);
      // Only show hit effects for notes hit during the current playback.
      if (editor.playing && !wasPlaying) effectsSince = t;
      if (!editor.playing) effectsSince = Infinity;
      wasPlaying = editor.playing;

      const settings = useSettingsStore.getState().settings;
      fitCanvas(renderScaleFactor(settings));
      // Preview only: none under the editing grid.
      const showHits =
        settings.hitEffects === 'always' ||
        (settings.hitEffects === 'preview' && editor.mode !== 'edit');

      const selecting = settings.previewSelect && (!!pointer || !!menuRef.current);
      const hits = selecting ? { kinds: kindSet(settings.previewSelectTypes), out: [] } : null;

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
        optimize: renderOptimizations(settings),
        hits,
      });

      lastHits = hits?.out ?? [];
      const hoverId = menuRef.current
        ? menuHoverRef.current
        : pointer && hitsUnder(pointer.x, pointer.y)[0]?.id;
      if (hoverId) outlineHit(ctx, lastHits, hoverId);
      canvas.style.cursor = hoverId && !menuRef.current ? 'pointer' : '';
    };
    const stopFrames = onFrame(frame);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      scrollTimeline(e.deltaY);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    const enabled = () => useSettingsStore.getState().settings.previewSelect;
    const onPointerMove = (e: PointerEvent) => {
      pointer = { x: e.offsetX, y: e.offsetY };
    };
    const onPointerLeave = () => {
      pointer = null;
    };
    const onPointerDown = (e: PointerEvent) => {
      // A press that dismisses the menu selects nothing.
      if (e.button !== 0 || !enabled() || menuRef.current) return;
      const hit = hitsUnder(e.offsetX, e.offsetY)[0];
      if (hit) focusHit(hit);
    };
    const onContextMenu = (e: MouseEvent) => {
      if (!enabled()) return;
      e.preventDefault();
      const hits = hitsUnder(e.offsetX, e.offsetY);
      setMenu(hits.length ? { x: e.clientX, y: e.clientY, hits } : null);
    };
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('contextmenu', onContextMenu);

    // Fit the aspect ratio to the screen while fullscreen, restoring it after.
    let savedAspect: number | null = null;
    const restoreAspect = () => {
      if (savedAspect === null) return;
      useEditorStore.getState().set({ aspect: savedAspect });
      savedAspect = null;
    };
    const onFullscreen = () => {
      setFullscreen(document.fullscreenElement === wrap);
      if (document.fullscreenElement === wrap) {
        if (!useSettingsStore.getState().settings.fullscreenAspect) return;
        savedAspect = useEditorStore.getState().aspect;
        useEditorStore.getState().set({ aspect: screen.width / screen.height });
      } else restoreAspect();
    };
    document.addEventListener('fullscreenchange', onFullscreen);

    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen);
      restoreAspect();
      stopFrames();
      if (document.fullscreenElement === wrap) void document.exitFullscreen();
      if (previewWrap === wrap) previewWrap = null;
      pauseAllMedia();
      ro.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);

  useEffect(() => {
    if (!fullscreen) return setToast(false);
    setToast(true);
    const id = setTimeout(() => setToast(false), 2500);
    return () => clearTimeout(id);
  }, [fullscreen]);

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <canvas ref={canvasRef} className={styles.canvas} />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title="Select object"
          items={menu.hits.map((hit) => {
            const chart = useChartStore.getState().chart;
            return {
              key: hit.id,
              ...(chart ? hitLabel(chart, hit) : { label: KIND_LABELS[hit.kind] }),
              onSelect: () => focusHit(hit),
            };
          })}
          onClose={closeMenu}
          onHover={(id) => (menuHoverRef.current = id)}
        />
      )}
      {fullscreen && (
        <>
          {toast && <div className={styles.toast}>Fullscreen preview enabled</div>}
          <div className={styles.badge}>PhiCreate Beta</div>
        </>
      )}
    </div>
  );
}
