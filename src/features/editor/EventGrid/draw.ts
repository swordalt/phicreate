import { toFloat } from '@/features/chart/model/beat';
import { ease } from '@/features/chart/model/easing';
import { isColor, toCss, toHex } from '@/features/chart/model/color';
import type { Color, Event } from '@/features/chart/model/types';
import type { GridGeometry } from '../grid/geometry';
import { drawFooterStrip, drawHeaderStrip, FOOTER_HEIGHT, type Palette } from '../grid/timeGrid';
import type { EventColumn } from '../types';

const PAD = 3;

export const columnWidth = (g: GridGeometry, columns: EventColumn[]) =>
  (g.x1 - g.x0) / columns.length;

export function columnAt(g: GridGeometry, columns: EventColumn[], px: number) {
  const c = Math.floor((px - g.x0) / columnWidth(g, columns));
  return Math.max(0, Math.min(columns.length - 1, c));
}

export function eventRect(
  g: GridGeometry,
  columns: EventColumn[],
  column: number,
  start: number,
  end: number,
) {
  const w = columnWidth(g, columns);
  const left = g.x0 + column * w + PAD;
  return { left, right: left + w - PAD * 2, top: g.beatToY(end), bottom: g.beatToY(start) };
}

export type EventValue = number | string | Color;

export const formatValue = (v: EventValue) =>
  typeof v === 'string' ? v : isColor(v) ? toHex(v) : String(Math.round(v * 1000) / 1000);

interface EventStyle {
  selected?: boolean;
  ghost?: boolean;
  // Easing curve inside the block.
  curve?: boolean;
  // Replaces the value text.
  label?: string;
}

export function drawEvent(
  ctx: CanvasRenderingContext2D,
  g: GridGeometry,
  columns: EventColumn[],
  column: number,
  e: Pick<Event<EventValue>, 'start' | 'end' | 'from' | 'to' | 'easing' | 'locked'>,
  { selected, ghost, curve = true, label }: EventStyle = {},
  dBeat = 0,
) {
  const r = eventRect(g, columns, column, toFloat(e.start) + dBeat, toFloat(e.end) + dBeat);
  if (r.bottom < 0 || r.top > g.height) return;
  const { color } = columns[column];
  const w = r.right - r.left;
  const h = r.bottom - r.top;

  // Color events show their own gradient.
  const colors = isColor(e.from) && isColor(e.to) ? [e.from, e.to] : null;
  ctx.globalAlpha = ghost ? 0.25 : colors ? (selected ? 1 : 0.85) : selected ? 0.55 : 0.32;
  if (colors && h > 0) {
    const grad = ctx.createLinearGradient(0, r.bottom, 0, r.top);
    grad.addColorStop(0, toCss(colors[0]));
    grad.addColorStop(1, toCss(colors[1]));
    ctx.fillStyle = grad;
  } else ctx.fillStyle = color;
  ctx.fillRect(r.left, r.top, w, h);
  ctx.globalAlpha = ghost ? 0.7 : 1;
  ctx.strokeStyle = selected ? '#fff' : color;
  ctx.lineWidth = selected ? 2 : 1;
  if (ghost) ctx.setLineDash([4, 3]);
  ctx.strokeRect(r.left + 0.5, r.top + 0.5, w - 1, h - 1);
  ctx.setLineDash([]);

  // Easing curve: value runs left → right, time runs bottom → top.
  if (curve && h > 6 && typeof e.from === 'number' && typeof e.to === 'number') {
    const from = e.from;
    const to = e.to;
    const lo = Math.min(from, to);
    const span = Math.max(from, to) - lo;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let k = 0; k <= 24; k++) {
      const p = k / 24;
      const v = from + (to - from) * ease(e.easing, p);
      const x = span ? r.left + 4 + ((v - lo) / span) * (w - 8) : r.left + w / 2;
      const y = r.bottom - p * h;
      if (k) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }

  if (!ghost) {
    ctx.fillStyle = '#fff';
    if (colors) {
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 3;
    }
    ctx.font = '11px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'left';
    if (
      label ||
      e.locked ||
      (typeof e.from !== 'number' && formatValue(e.from) === formatValue(e.to))
    ) {
      ctx.textBaseline = 'middle';
      ctx.fillText(label ?? formatValue(e.from), r.left + 4, r.top + h / 2, w - 8);
    } else if (h > 30) {
      ctx.textBaseline = 'bottom';
      ctx.fillText(formatValue(e.from), r.left + 4, r.bottom - 3, w - 8);
      ctx.textBaseline = 'top';
      ctx.fillText(formatValue(e.to), r.left + 4, r.top + 3, w - 8);
    } else if (h > 12) {
      ctx.textBaseline = 'middle';
      ctx.fillText(`${formatValue(e.from)}→${formatValue(e.to)}`, r.left + 4, r.top + h / 2, w - 8);
    }
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
}

export function drawHeader(
  ctx: CanvasRenderingContext2D,
  g: GridGeometry,
  p: Palette,
  info: string,
) {
  drawHeaderStrip(ctx, g, p);
  const cx = (g.x0 + g.x1) / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.fillStyle = p.accent;
  ctx.fillText('Events', cx, 11);
  ctx.font = '11px ui-monospace, Consolas, monospace';
  ctx.fillStyle = p.muted;
  ctx.fillText(info, cx, 25);
}

// Column names with this layer's value at the playhead.
export function drawFooter(
  ctx: CanvasRenderingContext2D,
  g: GridGeometry,
  p: Palette,
  columns: EventColumn[],
  values: EventValue[],
) {
  const w = columnWidth(g, columns);
  drawFooterStrip(ctx, g, p);
  const top = g.height - FOOTER_HEIGHT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  columns.forEach((c, i) => {
    const cx = g.x0 + w * (i + 0.5);
    ctx.font = '11px ui-monospace, Consolas, monospace';
    ctx.fillStyle = p.muted;
    ctx.fillText(formatValue(values[i]), cx, top + 11, w - 6);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = c.color;
    ctx.fillText(c.label, cx, top + 25, w - 6);
  });
}
