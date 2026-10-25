import { useEffect, useRef } from 'react';
import { add, cmp, fromFloat, sub, toFloat, ZERO } from '@/features/chart/model/beat';
import { beatToSeconds } from '@/features/chart/model/timing';
import { isGlobalRange, NOISE_READY_FLASH } from '@/features/chart/model/defaults';
import {
  isNoise,
  isShader,
  isText,
  isVarKey,
  type Beat,
  type Chart,
  type Event,
  type EventItem,
  type NumEvent,
  type TrackKey,
} from '@/features/chart/model/types';
import {
  addEvent,
  moveEvents,
  removeEvents,
  retimeEvents,
} from '@/features/chart/runtime/commands';
import {
  effectRuntime,
  noiseRuntime,
  ownerRuntime,
  textRuntime,
} from '@/features/chart/runtime/scene';
import { varDefaults } from '@/features/shaders/library';
import { useChartStore } from '@/features/chart/runtime/useChartStore';
import { useSettingsStore } from '@/features/settings/useSettingsStore';
import { createId } from '@/lib/id';
import { FREE_DENSITY } from '../types';
import { setHover } from '../grid/hover';
import { columnsFor, ownerEvents, trackEvents } from '../events';
import { useEditorStore } from '../useEditorStore';
import { isTyping } from '../useEditorShortcuts';
import { segmentHitsRect } from '../grid/geometry';
import { drawBox, drawStroke, drawTimeGrid, outsideGrid } from '../grid/timeGrid';
import { currentTarget, GRID_BACKDROP, useGridCanvas, type GridFrame } from '../grid/useGridCanvas';
import {
  columnAt,
  columnWidth,
  drawEvent,
  drawFooter,
  drawHeader,
  eventRect,
  type EventValue,
} from './draw';
import styles from '../NoteGrid/NoteGrid.module.css';

interface Pointer {
  beat: Beat; // snapped, >= 0
  beatF: number;
  column: number;
  px: number;
  py: number;
}

type Drag =
  | { kind: 'move'; start: Beat; dBeat: Beat; ids: string[] }
  | { kind: 'resize'; id: string; edge: 'start' | 'end'; beat: Beat }
  | { kind: 'box'; b0: number; c0: number; b1: number; c1: number; base: string[] }
  | { kind: 'line'; points: { beat: number; px: number }[]; base: string[]; hits: Set<string> };

const EDGE_PX = 5;

// All events of the current layer (plus object-level tracks), tagged with their column.
function layerEvents(chart: Chart | null) {
  const target = currentTarget(chart);
  return target ? ownerEvents(target.owner, target.layer) : [];
}

const currentColumns = (chart: Chart | null) => columnsFor(currentTarget(chart)?.owner ?? null);

// At least one division after the start.
function minEnd(start: Beat, end: Beat, division: number): Beat {
  const min = add(start, [0, 1, division]);
  return cmp(end, min) < 0 ? min : end;
}

export function EventGrid() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<Pointer | null>(null);
  const dragRef = useRef<Drag | null>(null);
  // First R press of a two-press event.
  const pendingRef = useRef<{ column: number; beat: Beat } | null>(null);
  const hasObjects = useChartStore(
    (s) =>
      !!s.chart?.lines.length ||
      !!s.chart?.texts.length ||
      !!s.chart?.media.length ||
      !!s.chart?.effects.length ||
      !!s.chart?.noiseFields.length,
  );

  const draw = ({ ctx, g, palette, chart, editor }: GridFrame) => {
    const target = currentTarget(chart);
    const cols = columnsFor(target?.owner ?? null);
    const w = columnWidth(g, cols);
    drawTimeGrid(
      ctx,
      g,
      palette,
      editor.snapY ? editor.division : 1,
      cols.map((_, i) => ({ px: g.x0 + i * w, strong: true })),
      editor.previewBehind ? GRID_BACKDROP : 1,
    );

    if (!target) return;
    const { owner, layer } = target;
    const events = ownerEvents(owner, layer);
    const drag = dragRef.current;

    // Dim beats where a shader isn't active.
    if (isShader(owner)) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      let bottom = g.height;
      for (const e of owner.active) {
        const y = Math.min(bottom, g.beatToY(toFloat(e.start)));
        if (y < bottom) ctx.fillRect(g.x0, y, g.x1 - g.x0, bottom - y);
        bottom = Math.min(bottom, g.beatToY(toFloat(e.end)));
        if (bottom <= 0) break;
      }
      if (bottom > 0) ctx.fillRect(g.x0, 0, g.x1 - g.x0, bottom);
    }
    const curve = useSettingsStore.getState().settings.eventCurves;
    const selected = new Set(editor.selectedEventIds);
    const moving = drag?.kind === 'move' ? new Set(drag.ids) : null;

    // Shader ranges show their scope instead of 0 / 1.
    const scope = (channel: TrackKey, e: Event<unknown>) =>
      isShader(owner) && channel === 'active'
        ? isGlobalRange(e as NumEvent)
          ? 'global'
          : 'chart'
        : undefined;

    for (const { event, column, channel } of events) {
      if (moving?.has(event.id) || (drag?.kind === 'resize' && drag.id === event.id)) continue;
      drawEvent(ctx, g, cols, column, event, {
        selected: selected.has(event.id),
        curve,
        label: scope(channel, event),
      });
    }

    const hover = hoverRef.current;
    const pending = pendingRef.current;
    const ghost = (column: number, start: Beat, end: Beat) =>
      drawEvent(
        ctx,
        g,
        cols,
        column,
        { start, end, from: 0, to: 0, easing: easingOf(editor.eventEasing) },
        { ghost: true },
      );

    if (drag?.kind === 'move') {
      const dBeat = toFloat(drag.dBeat);
      for (const { event, column, channel } of events) {
        if (moving!.has(event.id))
          drawEvent(
            ctx,
            g,
            cols,
            column,
            event,
            { selected: true, curve, label: scope(channel, event) },
            dBeat,
          );
      }
    } else if (drag?.kind === 'resize') {
      const found = events.find((x) => x.event.id === drag.id);
      if (found)
        drawEvent(ctx, g, cols, found.column, resized(found.event, drag), {
          selected: true,
          curve,
          label: scope(found.channel, found.event),
        });
    } else if (drag?.kind === 'box') {
      const left = (c: number) => g.x0 + c * w;
      const [c0, c1] = [Math.min(drag.c0, drag.c1), Math.max(drag.c0, drag.c1)];
      drawBox(ctx, palette, left(c0), g.beatToY(drag.b0), left(c1 + 1), g.beatToY(drag.b1));
    } else if (drag?.kind === 'line') {
      drawStroke(
        ctx,
        palette,
        drag.points.map((q) => [q.px, g.beatToY(q.beat)]),
      );
    } else if (pending) {
      ghost(
        pending.column,
        pending.beat,
        hover ? minEnd(pending.beat, hover.beat, editor.division) : add(pending.beat, [1, 0, 1]),
      );
    }

    const count = events.length;
    const label = `${count} event${count === 1 ? '' : 's'} on ${(layer ?? owner).name}`;
    drawHeader(ctx, g, palette, label);
    // Footer: column names with this layer's value at the playhead.
    const t = beatToSeconds(chart.bpmList, g.beat);
    drawFooter(
      ctx,
      g,
      palette,
      cols,
      cols.map((c) => trackValue(chart, c.channel, t, target) ?? ''),
    );
  };

  const geoRef = useGridCanvas(wrapRef, canvasRef, draw);

  // R: press at the start, press again at the end. Q: locked event at the cursor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
      if (e.key === 'Escape') pendingRef.current = null;
      const hover = hoverRef.current;
      const key = e.key.toLowerCase();
      if ((key !== 'r' && key !== 'q') || !hover || e.repeat) return;
      // Q: one-press locked event at the cursor.
      if (key === 'q') {
        const { division } = useEditorStore.getState();
        createEvent(hover.column, hover.beat, add(hover.beat, [0, 1, division]), true);
        return;
      }
      const pending = pendingRef.current;
      if (!pending) {
        pendingRef.current = { column: hover.column, beat: hover.beat };
        return;
      }
      pendingRef.current = null;
      const { division } = useEditorStore.getState();
      createEvent(pending.column, pending.beat, minEnd(pending.beat, hover.beat, division));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pointerAt = (e: React.PointerEvent): Pointer | null => {
    const g = geoRef.current;
    if (!g) return null;
    const [px, py] = g.point(canvasRef.current!, e);
    const beatF = g.yToBeat(py);
    const { division, snapY } = useEditorStore.getState();
    let beat = fromFloat(beatF, snapY && !e.altKey ? division : FREE_DENSITY);
    if (cmp(beat, ZERO) < 0) beat = ZERO;
    return {
      beat,
      beatF,
      column: columnAt(g, currentColumns(useChartStore.getState().chart), px),
      px,
      py,
    };
  };

  const hitTest = (p: Pointer) => {
    const g = geoRef.current!;
    const chart = useChartStore.getState().chart;
    const cols = currentColumns(chart);
    const events = layerEvents(chart);
    for (let i = events.length - 1; i >= 0; i--) {
      const { event, column } = events[i];
      const r = eventRect(g, cols, column, toFloat(event.start), toFloat(event.end));
      if (p.px < r.left || p.px > r.right || p.py < r.top - 2 || p.py > r.bottom + 2) continue;
      const tall = r.bottom - r.top > EDGE_PX * 3;
      const edge = !tall
        ? null
        : p.py - r.top < EDGE_PX
          ? 'end'
          : r.bottom - p.py < EDGE_PX
            ? 'start'
            : null;
      return { event, column, edge } as const;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    useEditorStore.getState().set({ activeGrid: 'events' });
    const p = pointerAt(e);
    const editor = useEditorStore.getState();
    const charts = useChartStore.getState();
    const target = currentTarget(charts.chart);
    if (!p || !target || outsideGrid(geoRef.current!, p.py)) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    if (e.button === 2) {
      const hit = hitTest(p);
      if (hit) {
        charts.apply((c) => removeEvents(c, target.owner.id, target.layerId, [hit.event.id]));
        editor.selectEvents(editor.selectedEventIds.filter((id) => id !== hit.event.id));
      }
      return;
    }
    if (e.button !== 0) return;

    const hit = hitTest(p);
    const selected = editor.selectedEventIds;
    if (!hit) {
      const base = e.shiftKey ? selected : [];
      editor.selectEvents(base);
      dragRef.current =
        useSettingsStore.getState().settings.selectMode === 'line'
          ? { kind: 'line', points: [{ beat: p.beatF, px: p.px }], base, hits: new Set() }
          : { kind: 'box', b0: p.beatF, c0: p.column, b1: p.beatF, c1: p.column, base };
      return;
    }
    if (hit.edge) {
      editor.selectEvents([hit.event.id]);
      dragRef.current = {
        kind: 'resize',
        id: hit.event.id,
        edge: hit.edge,
        beat: hit.event[hit.edge],
      };
      return;
    }
    if (e.shiftKey && selected.includes(hit.event.id)) {
      editor.selectEvents(selected.filter((id) => id !== hit.event.id));
      return;
    }
    const ids = selected.includes(hit.event.id)
      ? selected
      : e.shiftKey
        ? [...selected, hit.event.id]
        : [hit.event.id];
    editor.selectEvents(ids);
    dragRef.current = { kind: 'move', start: p.beat, dBeat: ZERO, ids };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = pointerAt(e);
    hoverRef.current = p && !outsideGrid(geoRef.current!, p.py) ? p : null;
    setHover('events', hoverRef.current?.beat ?? null);
    const drag = dragRef.current;
    if (!p || !drag) return;

    if (drag.kind === 'move') {
      let dBeat = sub(p.beat, drag.start);
      // Keep every moved event at beat >= 0.
      const min = layerEvents(useChartStore.getState().chart)
        .filter(({ event }) => drag.ids.includes(event.id))
        .reduce<Beat | null>(
          (m, { event }) => (!m || cmp(event.start, m) < 0 ? event.start : m),
          null,
        );
      if (min && cmp(add(min, dBeat), ZERO) < 0) dBeat = sub(ZERO, min);
      drag.dBeat = dBeat;
    } else if (drag.kind === 'resize') {
      drag.beat = p.beat;
    } else if (drag.kind === 'line') {
      // Select every event the stroke passes through.
      const g = geoRef.current!;
      const prev = drag.points[drag.points.length - 1];
      drag.points.push({ beat: p.beatF, px: p.px });
      const chart = useChartStore.getState().chart;
      const cols = currentColumns(chart);
      const [ax, ay] = [prev.px, g.beatToY(prev.beat)];
      for (const { event, column } of layerEvents(chart)) {
        if (drag.hits.has(event.id)) continue;
        const r = eventRect(g, cols, column, toFloat(event.start), toFloat(event.end));
        if (segmentHitsRect(ax, ay, p.px, p.py, r)) drag.hits.add(event.id);
      }
      useEditorStore.getState().selectEvents([...new Set([...drag.base, ...drag.hits])]);
    } else {
      drag.b1 = p.beatF;
      drag.c1 = p.column;
      const [b0, b1] = [Math.min(drag.b0, drag.b1), Math.max(drag.b0, drag.b1)];
      const [c0, c1] = [Math.min(drag.c0, drag.c1), Math.max(drag.c0, drag.c1)];
      const inside = layerEvents(useChartStore.getState().chart)
        .filter(
          ({ event, column }) =>
            column >= c0 && column <= c1 && toFloat(event.start) <= b1 && toFloat(event.end) >= b0,
        )
        .map(({ event }) => event.id);
      useEditorStore.getState().selectEvents([...new Set([...drag.base, ...inside])]);
    }
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    const charts = useChartStore.getState();
    const target = currentTarget(charts.chart);
    if (!drag || !target) return;
    const { owner, layerId } = target;

    if (drag.kind === 'move' && cmp(drag.dBeat, ZERO) !== 0) {
      charts.apply((c) => moveEvents(c, owner.id, layerId, drag.ids, drag.dBeat));
    } else if (drag.kind === 'resize') {
      charts.apply((c) => retimeEvents(c, owner.id, layerId, [drag.id], (ev) => resized(ev, drag)));
    }
  };

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (dragRef.current = null)}
        onPointerLeave={() => {
          hoverRef.current = null;
          setHover('events', null);
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      {!hasObjects && <p className={styles.empty}>Add an object to start editing events.</p>}
    </div>
  );
}

const easingOf = (id: number): Event<unknown>['easing'] => ({ kind: 'preset', id });

function resized<T extends Event<unknown>>(event: T, drag: Extract<Drag, { kind: 'resize' }>): T {
  return { ...event, [drag.edge]: drag.beat };
}

// Starts from the layer's current value so the curve stays continuous.
function createEvent(column: number, start: Beat, end: Beat, locked = false) {
  const charts = useChartStore.getState();
  const editor = useEditorStore.getState();
  const chart = charts.chart;
  const target = currentTarget(chart);
  if (!chart || !target) return;
  const { owner, layer, layerId } = target;
  const channel = columnsFor(owner)[column].channel;

  // Don't start inside an event; stop at the next one.
  const events = trackEvents(owner, layer, channel);
  if (events.some((e) => cmp(e.start, start) <= 0 && cmp(start, e.end) < 0)) return;
  const next = events.find((e) => cmp(e.start, start) > 0 && cmp(e.start, end) < 0);
  if (next) end = next.start;
  if (cmp(end, start) <= 0) return;

  const t = beatToSeconds(chart.bpmList, toFloat(start));
  const base = {
    id: createId(),
    start,
    end,
    easing: easingOf(editor.eventEasing),
    ...(locked && { locked }),
  };
  const value = trackValue(chart, channel, t);
  let item: EventItem;
  if (channel === 'value' || channel === 'font') {
    if (typeof value !== 'string') return;
    item = {
      channel,
      event: { ...base, from: value, to: value, ...(channel === 'font' && { locked: true }) },
    };
  } else if (channel === 'color') {
    if (!Array.isArray(value)) return;
    item = { channel, event: { ...base, from: value, to: value } };
  } else if (channel === 'start') {
    // Plays from the media's beginning.
    item = { channel, event: { ...base, from: 0, to: 0, locked: true } };
  } else if (channel === 'active') {
    // Noise fields: `from` is the ready flash length; shaders: 0 = chart only.
    const v = isNoise(owner) ? NOISE_READY_FLASH : 0;
    item = { channel, event: { ...base, from: v, to: v, locked: true } };
  } else if (channel === 'visible') {
    item = { channel, event: { ...base, from: 1, to: 1, locked: true } };
  } else {
    if (typeof value !== 'number') return;
    item = { channel, event: { ...base, from: value, to: value } };
  }
  charts.apply((c) => addEvent(c, owner.id, layerId, item));
  editor.selectEvents([item.event.id]);
}

// The current owner's value of a track at time t (one layer's value for layer channels).
function trackValue(
  chart: Chart,
  channel: TrackKey,
  t: number,
  target = currentTarget(chart),
): EventValue | null {
  if (!target) return null;
  const { owner, layer } = target;
  if (isShader(owner)) {
    if (channel === 'active') return Number(effectRuntime(owner, chart.bpmList).isActive(t));
    if (!isVarKey(channel)) return null;
    const key = channel.slice(4);
    const fallback = varDefaults(owner.shader)[key] ?? 0;
    return effectRuntime(owner, chart.bpmList).varValue(key, t, fallback);
  }
  if (isNoise(owner)) {
    const runtime = noiseRuntime(owner, chart.bpmList);
    if (channel === 'visible') return Number(runtime.isShown(t));
    if (channel === 'active') return Number(runtime.phaseAt(t).phase === 'active');
  }
  if (!layer || isVarKey(channel) || channel === 'active' || channel === 'visible') return null;
  const runtime = ownerRuntime(owner, chart.bpmList);
  if (channel === 'color') return 'colorAt' in runtime ? runtime.colorAt(t) : null;
  if (channel === 'value') return isText(owner) ? textRuntime(owner, chart.bpmList).textAt(t) : '';
  if (channel === 'font') return isText(owner) ? textRuntime(owner, chart.bpmList).fontAt(t) : '';
  if (channel === 'start') return ('mediaTime' in runtime && runtime.mediaTime(t)) || 0;
  return runtime.layerValue(owner.layers.indexOf(layer), channel, t);
}
