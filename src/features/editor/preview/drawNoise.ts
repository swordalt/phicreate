import type { Color, NoiseField } from '@/features/chart/model/types';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@/features/chart/model/defaults';
import type { NoisePhase, NoiseState } from '@/features/chart/runtime/scene';
import { renderNoiseEffect, type DevicePoint, type NoiseShapes } from './noiseEffect';

// Flat look after rpe-next: dim while disabled, brighter while active, tinted edges.
const DISABLED_FILL: [number, number, number, number] = [127, 35, 35, 0.4];
const ACTIVE_FILL: [number, number, number, number] = [182, 60, 60, 0.667];
const EDGE_FILL: [number, number, number, number] = [255, 84, 84, 1];
const SELECTED_COLOR = '#39ff14';
// Edge thickness in device pixels.
const EDGE = 2;
const PHASES: NoisePhase[] = ['disabled', 'ready', 'active'];

type Point = [number, number];
type Shown = { field: NoiseField; state: NoiseState };

export interface NoiseViewport {
  cx: number;
  cy: number;
  scale: number;
  scaleX: number;
}

// Corners in screen space; positions stretch like lines (x by scaleX, y by scale).
function corners(field: NoiseField, s: NoiseState, vp: NoiseViewport): Point[] {
  const hw = (field.size[0] * s.scaleX) / 2;
  const hh = (field.size[1] * s.scaleY) / 2;
  // Positive rotation is clockwise on screen.
  const a = (-s.rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([dx, dy]) => {
    const x = s.x + dx * cos - dy * sin;
    const y = s.y + dx * sin + dy * cos;
    return [vp.cx + x * vp.scaleX, vp.cy - y * vp.scale];
  });
}

function quad(ctx: CanvasRenderingContext2D, points: Point[]) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

// Adds a field as a subpath. Mirrored fields are wound the same way so nonzero fills union.
function addQuad(
  ctx: CanvasRenderingContext2D,
  field: NoiseField,
  s: NoiseState,
  vp: NoiseViewport,
) {
  const points = corners(field, s, vp);
  if (s.scaleX * s.scaleY < 0) points.reverse();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
}

const lerp = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
const rgba = ([r, g, b, a]: number[]) =>
  `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;

// Moves a native red shade to `color`'s hue, keeping its value and saturation (Phira).
function palette([r, g, b, a]: number[], color: Color) {
  const [cr, cg, cb] = color.map((v) => v / 255);
  if (color[0] === 255 && color[1] === 84 && color[2] === 84) return [r, g, b, a];
  const high = Math.max(cr, cg, cb);
  const low = Math.min(cr, cg, cb);
  const delta = high - low;
  if (delta < 1e-5) return [r * high, r * high, r * high, a];
  const sat = Math.min(
    1,
    Math.max(0, ((1 - g / Math.max(r, 1e-5)) * (delta / high)) / (1 - 84 / 255)),
  );
  return [...[cr, cg, cb].map((c) => r * high * (1 + ((c - low) / delta - 1) * sat)), a];
}

let buffers: HTMLCanvasElement[] | null = null;

// Mask, scratch, layer and paint canvases matching the target's backing size.
function getBuffers(target: HTMLCanvasElement) {
  buffers ??= [0, 1, 2, 3].map(() => document.createElement('canvas'));
  for (const c of buffers) {
    if (c.width !== target.width || c.height !== target.height) {
      c.width = target.width;
      c.height = target.height;
    }
  }
  return buffers.map((c) => c.getContext('2d')!);
}

function clear(ctx: CanvasRenderingContext2D) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

// Fills `src`'s coverage with each field's color (`shade` of it); fields grow so edges outside take the nearest.
function tint(
  dst: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  items: Shown[],
  vp: NoiseViewport,
  transform: DOMMatrix,
  shade: (color: Color) => string,
) {
  clear(dst);
  dst.setTransform(transform);
  const grow = (EDGE * 3) / Math.max(Math.hypot(transform.a, transform.b), 1e-6);
  // Normal fields paint over subtract ones.
  const order = [...items].sort((a, b) => Number(!a.field.subtract) - Number(!b.field.subtract));
  for (const g of [grow, 0]) {
    for (const { field, state } of order) {
      dst.fillStyle = shade(state.color);
      quad(dst, g ? expand(corners(field, state, vp), g) : corners(field, state, vp));
      dst.fill();
    }
  }
  dst.setTransform(1, 0, 0, 1, 0, 0);
  dst.globalCompositeOperation = 'destination-in';
  dst.drawImage(src, 0, 0);
  dst.globalCompositeOperation = 'source-over';
}

// Pushes each corner of a convex quad outward by `d` along both of its edges.
function expand(q: Point[], d: number): Point[] {
  const away = (p: Point, o: Point): Point => {
    const len = Math.hypot(p[0] - o[0], p[1] - o[1]);
    return len > 1e-6 ? [(p[0] - o[0]) / len, (p[1] - o[1]) / len] : [0, 0];
  };
  return q.map((p, i) => {
    const u = away(p, q[(i + 3) % 4]);
    const v = away(p, q[(i + 1) % 4]);
    return [p[0] + (u[0] + v[0]) * d, p[1] + (u[1] + v[1]) * d];
  });
}

// Leaves only the mask's boundary: mask minus its erosion (white).
function edges(dst: CanvasRenderingContext2D, mask: HTMLCanvasElement) {
  clear(dst);
  dst.drawImage(mask, 0, 0);
  dst.globalCompositeOperation = 'destination-in';
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx || dy) dst.drawImage(mask, dx * EDGE, dy * EDGE);
    }
  }
  dst.globalCompositeOperation = 'xor';
  dst.drawImage(mask, 0, 0);
  dst.globalCompositeOperation = 'source-over';
}

// Pixel-aligned device-space box around the shown fields (padded for edges and antialiasing).
function bounds(
  groups: { normal: Shown[]; subtract: Shown[] }[],
  vp: NoiseViewport,
  m: DOMMatrix,
  canvas: HTMLCanvasElement,
): [number, number, number, number] | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const g of groups) {
    for (const { field, state } of [...g.normal, ...g.subtract]) {
      for (const [px, py] of corners(field, state, vp)) {
        const dx = m.a * px + m.c * py + m.e;
        const dy = m.b * px + m.d * py + m.f;
        x0 = Math.min(x0, dx);
        y0 = Math.min(y0, dy);
        x1 = Math.max(x1, dx);
        y1 = Math.max(y1, dy);
      }
    }
  }
  const pad = EDGE + 2;
  const left = Math.max(0, Math.floor(x0) - pad);
  const top = Math.max(0, Math.floor(y0) - pad);
  const right = Math.min(canvas.width, Math.ceil(x1) + pad);
  const bottom = Math.min(canvas.height, Math.ceil(y1) + pad);
  // NaN coordinates: fall back to the whole canvas.
  if ([x0, y0, x1, y1].some(Number.isNaN)) return [0, 0, canvas.width, canvas.height];
  return right > left && bottom > top ? [left, top, right - left, bottom - top] : null;
}

// Shaded look; false when unsupported.
function drawOriginal(
  ctx: CanvasRenderingContext2D,
  groups: { normal: Shown[]; subtract: Shown[] }[],
  vp: NoiseViewport,
  time: number,
) {
  const m = ctx.getTransform();
  const device = ([x, y]: Point): DevicePoint => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
  const shapes = (list: Shown[]) =>
    list.map(({ field, state }) => ({
      points: corners(field, state, vp).map(device),
      color: state.color,
    }));
  const byPhase = Object.fromEntries(
    PHASES.map((phase, i) => [
      phase,
      { normal: shapes(groups[i].normal), subtract: shapes(groups[i].subtract) },
    ]),
  ) as Record<NoisePhase, NoiseShapes>;
  const hw = (CANVAS_WIDTH * vp.scaleX) / 2;
  const hh = (CANVAS_HEIGHT * vp.scale) / 2;
  const [fx0, fy0] = device([vp.cx - hw, vp.cy - hh]);
  const [fx1, fy1] = device([vp.cx + hw, vp.cy + hh]);
  const frame = { x: fx0, y: fy0, w: fx1 - fx0, h: fy1 - fy0 };
  return renderNoiseEffect(ctx, byPhase, frame, time);
}

// Normal fields union; subtract fields flip coverage (parity). Later phases cover earlier ones.
// `time` (chart seconds) selects the original shaded look; null draws the simplified one.
export function drawNoiseFields(
  ctx: CanvasRenderingContext2D,
  fields: Shown[],
  vp: NoiseViewport,
  selectedId: string | null,
  time: number | null = null,
) {
  // One pass: group shown fields by phase and track each phase's strongest mix.
  const groups = PHASES.map(() => ({ normal: [] as Shown[], subtract: [] as Shown[], mix: 0 }));
  let selected: Shown | undefined;
  let any = false;
  for (const item of fields) {
    const { field, state: s } = item;
    if (field.id === selectedId) selected = item;
    if (!s.phase || s.scaleX === 0 || s.scaleY === 0) continue;
    const group = groups[PHASES.indexOf(s.phase)];
    (field.subtract ? group.subtract : group.normal).push(item);
    group.mix = Math.max(group.mix, s.mix);
    any = true;
  }
  const original = any && time !== null && drawOriginal(ctx, groups, vp, time);
  const transform = ctx.getTransform();
  const rect = any && !original ? bounds(groups, vp, transform, ctx.canvas) : null;
  if (rect) {
    const [x, y, w, h] = rect;
    const bufs = getBuffers(ctx.canvas);
    const [mask, scratch, layer, paint] = bufs;
    // Everything drawn stays inside rect; clip the full-canvas compositing to it.
    for (const b of bufs) {
      clear(b);
      b.save();
      b.beginPath();
      b.rect(x, y, w, h);
      b.clip();
    }
    for (const { normal, subtract, mix } of groups) {
      if (!normal.length && !subtract.length) continue;
      clear(mask);
      mask.setTransform(transform);
      mask.fillStyle = '#fff';
      // Batched: union of normal fields, then subtract fields flip coverage by parity.
      if (normal.length) {
        mask.beginPath();
        for (const { field, state } of normal) addQuad(mask, field, state, vp);
        mask.fill('nonzero');
      }
      if (subtract.length) {
        mask.globalCompositeOperation = 'xor';
        mask.beginPath();
        for (const { field, state } of subtract) addQuad(mask, field, state, vp);
        mask.fill('evenodd');
        mask.globalCompositeOperation = 'source-over';
      }
      // Cut what this phase covers out of the phases below.
      layer.globalCompositeOperation = 'destination-out';
      layer.drawImage(mask.canvas, 0, 0);
      layer.globalCompositeOperation = 'source-over';
      const items = [...normal, ...subtract];
      const fill = lerp(DISABLED_FILL, ACTIVE_FILL, mix);
      tint(paint, mask.canvas, items, vp, transform, (c) => rgba(palette(fill, c)));
      layer.drawImage(paint.canvas, 0, 0);
      edges(scratch, mask.canvas);
      tint(paint, scratch.canvas, items, vp, transform, (c) => rgba(palette(EDGE_FILL, c)));
      layer.globalAlpha = 0.6 + 0.4 * mix;
      layer.drawImage(paint.canvas, 0, 0);
      layer.globalAlpha = 1;
    }
    for (const b of bufs) b.restore();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer.canvas, x, y, w, h, x, y, w, h);
    ctx.restore();
  }

  // Outline the selected field even while hidden.
  if (selected && selected.state.scaleX !== 0 && selected.state.scaleY !== 0) {
    const points = corners(selected.field, selected.state, vp);
    ctx.save();
    ctx.strokeStyle = SELECTED_COLOR;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    quad(ctx, points);
    ctx.stroke();
    ctx.setLineDash([]);
    const x = vp.cx + selected.state.x * vp.scaleX;
    const y = vp.cy - selected.state.y * vp.scale;
    ctx.beginPath();
    ctx.moveTo(x - 8, y);
    ctx.lineTo(x + 8, y);
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x, y + 8);
    ctx.stroke();
    ctx.restore();
  }
}
