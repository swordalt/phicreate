import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@/features/chart/model/defaults';
import { toCss } from '@/features/chart/model/color';
import type { Chart, JudgeLine, MediaFit, TextObject } from '@/features/chart/model/types';
import { drawOrder, HOLD_Z, NOTE_Z, type Drawable } from '@/features/chart/model/zOrder';
import {
  createSampler,
  isNoteVisible,
  lineRuntime,
  noteState,
  sampleMedia,
  sampleNoiseFields,
  sampleTexts,
  setJudgeStatus,
  type JudgeStatus,
  type LineState,
  type NoteEntry,
} from '@/features/chart/runtime/scene';
import { ease } from '@/features/chart/model/easing';
import type { NoiseQuality } from '@/features/settings/types';
import { applyShaders, type ShaderPass } from '@/features/shaders/pipeline';
import { getBackground } from './background';
import { drawNoiseFields } from './drawNoise';
import { fontFamily } from './fonts';
import { frameFor } from './frameCache';
import { beginMediaFrame, getMedia, mediaFrame } from './media';
import { NO_PASSES, type ActivePasses } from './shaderPasses';
import { chartVariables, expandText, type ProjectInfo } from './variables';
import {
  getImage,
  headImage,
  HIT_DURATION,
  HIT_FRAME_SECONDS,
  HIT_FRAMES,
  holdImages,
  opaqueRuns,
  tinted,
} from './skin';

// Visual constants follow RPE's preview.
const NOTE_WIDTH = 175;
const LINE_WIDTH = 4000;
const LINE_HEIGHT = 7.5;
const SELECTED_LINE_COLOR = '#39ff14';
const BEARING_RADIUS = 10;
const BEARING_LENGTH = 30;
const HIT_COLOR: [number, number, number] = [255, 236, 160];
const HIT_SIZE = NOTE_WIDTH * 1.4;
const HIT_LIFETIME = Math.max(HIT_DURATION, 2 / 3);
const HOLD_HIT_INTERVAL = 20 / 120;
const HOLD_SEAM_OVERLAP = 1.5;
const BACKGROUND_ALPHA = 0.35;
const BAR_ALPHA = 0.55;
const FALLBACK_COLORS = { tap: '#0ac3ff', drag: '#f0ed69', flick: '#fe4365', hold: '#0ac3ff' };

export interface PreviewOptions {
  // Hits before this chart time get no effects (Infinity = none).
  effectsSince: number;
  hiddenLines?: Set<string>;
  aspect: number;
  fov: number;
  selectedLineId: string | null;
  // Outlines a selected noise field.
  selectedObjectId?: string | null;
  info: ProjectInfo;
  // Videos play along while true.
  playing: boolean;
  rate: number;
  // Song length in seconds, for the progress bar.
  duration: number;
  // Shader effects active at t.
  shaders?: ActivePasses;
  noiseQuality?: NoiseQuality;
  backgroundBlur?: boolean;
  highlightSimultaneous?: boolean;
  // Green selected line and selected noise field outline.
  highlightSelected?: boolean;
  // Resolves the {color} default line color.
  judgeStatus?: JudgeStatus;
  // Marks the selected object's origin and up direction.
  bearingMarker?: boolean;
  hideUI?: boolean;
  hideText?: boolean;
  hideMedia?: boolean;
  hideNoise?: boolean;
}

// The play frame is CANVAS_HEIGHT tall and CANVAS_HEIGHT * aspect wide, fitted then zoomed by 1 / fov.
// Sizes use `scale`; horizontal positions stretch by `scaleX` so the chart's width maps to the frame's.
export function previewViewport(width: number, height: number, aspect: number, fov: number) {
  const frameW = CANVAS_HEIGHT * aspect;
  const scale = Math.min(width / frameW, height / CANVAS_HEIGHT) / fov;
  const w = frameW * scale;
  const h = CANVAS_HEIGHT * scale;
  return {
    scale,
    scaleX: w / CANVAS_WIDTH,
    left: (width - w) / 2,
    top: (height - h) / 2,
    width: w,
    height: h,
  };
}

// Source rect that cover-fits an image into the given aspect.
function coverRect(img: { width: number; height: number }, aspect: number) {
  const w = Math.min(img.width, img.height * aspect);
  const h = w / aspect;
  return [(img.width - w) / 2, (img.height - h) / 2, w, h] as const;
}

const NO_IDS = new Set<string>();
const depthCache = new WeakMap<Chart, Drawable[]>();

function depthOrder(chart: Chart) {
  let order = depthCache.get(chart);
  if (!order) depthCache.set(chart, (order = drawOrder(chart)));
  return order;
}
const simultaneousCache = new WeakMap<Chart, Set<string>>();

// Notes sharing a hit time with another note get highlight textures.
function simultaneous(chart: Chart) {
  let set = simultaneousCache.get(chart);
  if (set) return set;
  const byTime = new Map<number, string[]>();
  for (const line of chart.lines) {
    for (const e of lineRuntime(line, chart.bpmList).notes) {
      const key = Math.round(e.start * 1e6);
      const ids = byTime.get(key);
      if (ids) ids.push(e.note.id);
      else byTime.set(key, [e.note.id]);
    }
  }
  set = new Set([...byTime.values()].filter((ids) => ids.length > 1).flat());
  simultaneousCache.set(chart, set);
  return set;
}

export function drawPreview(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  chart: Chart,
  t: number,
  {
    effectsSince,
    hiddenLines,
    aspect,
    fov,
    selectedLineId,
    selectedObjectId = null,
    info,
    playing,
    rate,
    duration,
    shaders = NO_PASSES,
    noiseQuality = 'simplified',
    backgroundBlur = true,
    highlightSimultaneous = true,
    highlightSelected = true,
    judgeStatus = 'ap',
    bearingMarker = false,
    hideUI = false,
    hideText = false,
    hideMedia = false,
    hideNoise = false,
  }: PreviewOptions,
) {
  setJudgeStatus(judgeStatus);
  const vp = previewViewport(width, height, aspect, fov);
  const { scale, scaleX } = vp;
  beginMediaFrame();
  const cx = width / 2;
  const cy = height / 2;

  ctx.save();
  // Zoomed out past 1, content outside the frame stays visible.
  if (fov <= 1) {
    ctx.beginPath();
    ctx.rect(vp.left, vp.top, vp.width, vp.height);
    ctx.clip();
  }
  ctx.fillStyle = '#111';
  ctx.fillRect(vp.left, vp.top, vp.width, vp.height);
  const bg = getBackground(backgroundBlur);
  if (bg) {
    ctx.globalAlpha = BACKGROUND_ALPHA;
    ctx.drawImage(bg, ...coverRect(bg, vp.width / vp.height), vp.left, vp.top, vp.width, vp.height);
    ctx.globalAlpha = 1;
  }

  const sample = createSampler(chart, t);
  const layers = depthOrder(chart);
  const order = layers.flatMap((d) =>
    d.kind === 'line' && !hiddenLines?.has(d.object.id) ? [{ line: d.object, i: d.index }] : [],
  );
  const highlight = highlightSimultaneous ? simultaneous(chart) : NO_IDS;

  const withLine = (state: Pick<LineState, 'x' | 'y' | 'rotation'>, draw: () => void) => {
    ctx.save();
    ctx.translate(cx + state.x * scaleX, cy - state.y * scale);
    ctx.rotate((state.rotation * Math.PI) / 180);
    draw();
    ctx.restore();
  };

  const texts = sampleTexts(chart, t, sample);
  const mediaItems = sampleMedia(chart, t, sample);
  const noise = chart.noiseFields.length
    ? sampleNoiseFields(chart, t, sample, selectedObjectId)
    : [];
  const vars = texts.length ? chartVariables(chart, t, info) : {};
  const drawShapeUI = (
    text: TextObject,
    state: ReturnType<typeof sampleTexts>[number]['state'],
  ) => {
    const alpha = Math.min(1, state.alpha / 255);
    if (alpha <= 0 || state.scaleX === 0 || state.scaleY === 0) return;
    const h = text.size * scale;
    const icon = text.builtin === 'pause' ? getImage('Pause') : null;
    const w =
      text.builtin === 'bar'
        ? CANVAS_WIDTH * scaleX
        : h * (icon ? icon.naturalWidth / icon.naturalHeight : 0.625);
    withLine(state, () => {
      ctx.scale(state.scaleX, state.scaleY);
      ctx.globalAlpha = alpha;
      const x = -text.anchor[0] * w;
      const y = -(1 - text.anchor[1]) * h;
      if (text.builtin === 'bar') {
        const progress = duration > 0 ? Math.min(1, Math.max(0, t / duration)) : 0;
        ctx.globalAlpha = alpha * BAR_ALPHA;
        ctx.fillStyle = toCss(state.color);
        ctx.fillRect(x, y, w * progress, h);
      } else if (icon) {
        const m = ctx.getTransform();
        const [pw, ph] = deviceSize(m, w, h);
        const img = frameFor(icon, icon.naturalWidth, icon.naturalHeight, pw, ph, state.color);
        ctx.drawImage(img, x, y, w, h);
      } else {
        ctx.fillStyle = toCss(state.color);
        ctx.fillRect(x, y, w * 0.35, h);
        ctx.fillRect(x + w * 0.65, y, w * 0.35, h);
      }
    });
  };
  const drawText = (index: number) => {
    const { text, state } = texts[index];
    if (text.builtin ? hideUI : hideText) return;
    if (text.builtin === 'pause' || text.builtin === 'bar') {
      drawShapeUI(text, state);
      return;
    }
    const scaled = text.alphaVar ? Number(vars[text.alphaVar] ?? 255) / 255 : 1;
    const alpha = Math.min(1, (state.alpha / 255) * scaled);
    const content = expandText(state.text, vars);
    if (!content || alpha <= 0 || state.scaleX === 0 || state.scaleY === 0) return;
    withLine(state, () => {
      const size = text.size * scale;
      ctx.scale(state.scaleX, state.scaleY);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = toCss(state.color);
      ctx.font = `${size}px ${fontFamily(state.font)}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const [ax, ay] = text.anchor;
      ctx.fillText(content, -ax * ctx.measureText(content).width, (ay - 0.5) * size);
    });
  };
  const drawMedia = (index: number) => {
    const { media, state } = mediaItems[index];
    const loaded = getMedia(media.assetId);
    if (!loaded || !loaded.width) return;
    // Synced even when hidden so videos stay on time.
    const frame = mediaFrame(loaded, state.mediaTime, media.loop, playing, rate);
    const alpha = Math.min(1, state.alpha / 255);
    if (hideMedia || !frame || alpha <= 0 || state.scaleX === 0 || state.scaleY === 0) return;
    if (media.playingOnly && !isPlaying(state.mediaTime, loaded.duration, media.loop)) return;
    withLine(state, () => {
      const [w, h] = mediaSize(loaded, media.fit, vp, scale);
      ctx.scale(state.scaleX, state.scaleY);
      const x = -media.anchor[0] * w;
      const y = -(1 - media.anchor[1]) * h;
      const m = ctx.getTransform();
      if (offscreen(m, x, y, w, h, ctx.canvas)) return;
      ctx.globalAlpha = alpha;
      const [pw, ph] = deviceSize(m, w, h);
      const img = frameFor(frame, loaded.width, loaded.height, pw, ph, state.color, loaded.video);
      ctx.drawImage(img, x, y, w, h);
    });
  };
  const drawLine = (line: JudgeLine, i: number) => {
    if (hiddenLines?.has(line.id)) return;
    const s = sample(i);
    const selected = highlightSelected && line.id === selectedLineId;
    const alpha = Math.min(1, s.alpha / 255);
    if (alpha <= 0 || s.scaleX === 0 || s.scaleY === 0) return;
    withLine(s, () => {
      ctx.scale(s.scaleX, s.scaleY);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = selected ? SELECTED_LINE_COLOR : toCss(s.color);
      const [ax, ay] = line.anchor;
      ctx.fillRect(
        -ax * LINE_WIDTH * scale,
        -(1 - ay) * LINE_HEIGHT * scale,
        LINE_WIDTH * scale,
        LINE_HEIGHT * scale,
      );
    });
  };
  const drawNotes = (holds: boolean) => {
    for (const { line, i } of order) {
      const s = sample(i);
      const runtime = lineRuntime(line, chart.bpmList);
      const radius = 1600 + Math.hypot(s.x, s.y);
      // Notes ending before t are never visible.
      const first = runtime.firstEndingFrom(t);
      if (first >= runtime.notes.length) continue;
      withLine(s, () => {
        for (let k = first; k < runtime.notes.length; k++) {
          const entry = runtime.notes[k];
          if ((entry.note.type === 'hold') !== holds || !isNoteVisible(entry, runtime, s, t))
            continue;
          drawNote(ctx, entry, s, t, scale, scaleX, radius, highlight.has(entry.note.id));
        }
      });
    }
  };
  const draw = (d: Drawable) => {
    if (d.kind === 'line') drawLine(d.object, d.index);
    else if (d.kind === 'text') drawText(d.index);
    else drawMedia(d.index);
    ctx.globalAlpha = 1;
  };

  // Chart shaders run under the UI, so the UI draws after them.
  const uiLast = shaders.chart.length > 0;
  const isUI = (d: Drawable) => d.kind === 'text' && !!d.object.builtin;

  // One depth pass (rpe-next): holds after objects at HOLD_Z, then notes and noise fields
  // after objects at NOTE_Z.
  let notePass = 0;
  const notesBelow = (z: number) => {
    if (notePass < 1 && z > HOLD_Z) {
      drawNotes(true);
      notePass = 1;
    }
    if (notePass < 2 && z > NOTE_Z) {
      drawNotes(false);
      if (!hideNoise && noise.length) {
        drawNoiseFields(
          ctx,
          noise,
          { cx, cy, scale, scaleX },
          highlightSelected ? selectedObjectId : null,
          noiseQuality === 'original' ? t : null,
        );
      }
      notePass = 2;
    }
  };
  for (const d of layers) {
    if (uiLast && isUI(d)) continue;
    notesBelow(d.object.zOrder);
    draw(d);
  }
  notesBelow(Infinity);

  // Hit effects
  if (Number.isFinite(effectsSince)) {
    const samplers = new Map<number, ReturnType<typeof createSampler>>();
    const sampleAt = (time: number) => {
      let s = samplers.get(time);
      if (!s) samplers.set(time, (s = createSampler(chart, time)));
      return s;
    };
    const from = Math.max(t - HIT_LIFETIME, effectsSince);
    for (const { line, i } of order) {
      const runtime = lineRuntime(line, chart.bpmList);
      // Hits need end > from and start <= t.
      for (let k = runtime.firstEndingFrom(from); k < runtime.notes.length; k++) {
        const entry = runtime.notes[k];
        if (runtime.sortedByStart && entry.start > t) break;
        if (entry.note.fake) continue;
        for (const time of hitTimes(entry, from, t)) {
          const s = sampleAt(time)(i);
          const n = noteState(entry, s, time);
          const a = (s.rotation * Math.PI) / 180;
          const nx = n.x * scaleX;
          const ny = n.y * scale;
          const x = cx + s.x * scaleX + nx * Math.cos(a) + ny * Math.sin(a);
          const y = cy - s.y * scale + nx * Math.sin(a) - ny * Math.cos(a);
          drawHit(ctx, x, y, t - time, scale, Math.round(time * 1000) + i * 65537);
        }
      }
    }
  }

  if (uiLast) {
    shade(ctx, vp, shaders.chart, t);
    for (const d of layers) if (isUI(d)) draw(d);
  }
  shade(ctx, vp, shaders.global, t);

  if (bearingMarker) {
    const lineIndex = chart.lines.findIndex((l) => l.id === selectedLineId);
    const target =
      lineIndex >= 0
        ? sample(lineIndex)
        : selectedObjectId
          ? [...texts, ...mediaItems, ...noise].find(
              (o) =>
                ('text' in o ? o.text : 'media' in o ? o.media : o.field).id === selectedObjectId,
            )?.state
          : undefined;
    if (target) withLine(target, () => drawBearing(ctx));
  }

  ctx.restore();

  if (fov > 1) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(vp.left + 0.5, vp.top + 0.5, vp.width, vp.height);
  }
}

const isPlaying = (time: number | null, duration: number, loop: boolean) =>
  time !== null && time >= 0 && (loop || duration <= 0 || time < duration);

// Draw size in pixels: RPE texture size (1 pixel = 1 canvas unit) or fitted to the play frame.
function mediaSize(
  media: { width: number; height: number },
  fit: MediaFit | undefined,
  vp: ReturnType<typeof previewViewport>,
  scale: number,
): [number, number] {
  if (!fit || fit === 'none') return [media.width * scale, media.height * scale];
  if (fit === 'stretch') return [vp.width, vp.height];
  const pick = fit === 'cover' ? Math.max : Math.min;
  const k = pick(vp.width / media.width, vp.height / media.height);
  return [media.width * k, media.height * k];
}

// Runs shaders over the play frame (device pixels).
function shade(
  ctx: CanvasRenderingContext2D,
  vp: ReturnType<typeof previewViewport>,
  passes: ShaderPass[],
  t: number,
) {
  if (!passes.length) return;
  const dpr = ctx.getTransform().a;
  const x = Math.max(0, vp.left * dpr);
  const y = Math.max(0, vp.top * dpr);
  const w = Math.min(ctx.canvas.width, (vp.left + vp.width) * dpr) - x;
  const h = Math.min(ctx.canvas.height, (vp.top + vp.height) * dpr) - y;
  applyShaders(ctx.canvas, { x, y, w, h }, passes, t);
}

// Size in device pixels of a w x h rect under m.
const deviceSize = (m: DOMMatrix, w: number, h: number) =>
  [Math.abs(w) * Math.hypot(m.a, m.b), Math.abs(h) * Math.hypot(m.c, m.d)] as const;

// True when the rect under m lies fully outside the canvas.
function offscreen(
  m: DOMMatrix,
  x: number,
  y: number,
  w: number,
  h: number,
  canvas: HTMLCanvasElement,
) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let k = 0; k < 4; k++) {
    const px = x + (k & 1 ? w : 0);
    const py = y + (k & 2 ? h : 0);
    const dx = m.a * px + m.c * py + m.e;
    const dy = m.b * px + m.d * py + m.f;
    minX = Math.min(minX, dx);
    maxX = Math.max(maxX, dx);
    minY = Math.min(minY, dy);
    maxY = Math.max(maxY, dy);
  }
  return maxX < 0 || maxY < 0 || minX > canvas.width || minY > canvas.height;
}

function hitTimes(entry: NoteEntry, from: number, to: number): number[] {
  if (entry.note.type !== 'hold')
    return entry.start > from && entry.start <= to ? [entry.start] : [];
  const times: number[] = [];
  const first = Math.max(0, Math.ceil((from - entry.start) / HOLD_HIT_INTERVAL));
  for (let k = first; ; k++) {
    const time = entry.start + k * HOLD_HIT_INTERVAL;
    if (time > to || time >= entry.end) break;
    if (time > from) times.push(time);
  }
  return times;
}

function drawNote(
  ctx: CanvasRenderingContext2D,
  entry: NoteEntry,
  line: LineState,
  t: number,
  scale: number,
  scaleX: number,
  radius: number,
  highlight: boolean,
) {
  const n = noteState(entry, line, t);
  if (n.alpha <= 0 || n.size === 0) return;
  if (Math.abs(n.y) > radius && Math.abs(n.tail) > radius) return;
  const width = NOTE_WIDTH * scale * n.size;
  const x = n.x * scaleX;
  const head = -n.y * scale;
  ctx.globalAlpha = Math.min(1, n.alpha);

  if (entry.note.type === 'hold') {
    drawHold(ctx, x, head, -n.tail * scale, width, highlight, n.showHead);
  } else if (n.showHead) {
    const img = headImage(entry.note.type, highlight);
    if (img) {
      const h = Math.max(5, (width * img.naturalHeight) / img.naturalWidth);
      ctx.drawImage(img, x - width / 2, head - h / 2, width, h);
    } else {
      ctx.fillStyle = FALLBACK_COLORS[entry.note.type];
      ctx.fillRect(x - width / 2, head - 2, width, 4);
    }
  }
  ctx.globalAlpha = 1;
}

function drawHold(
  ctx: CanvasRenderingContext2D,
  x: number,
  head: number,
  tail: number,
  width: number,
  highlight: boolean,
  showHead: boolean,
) {
  const { body, end, head: headImg } = holdImages(highlight);
  const length = Math.abs(tail - head);
  if (!body) {
    ctx.fillStyle = FALLBACK_COLORS.hold;
    ctx.globalAlpha *= 0.55;
    ctx.fillRect(x - width / 2, Math.min(head, tail), width, length);
    return;
  }
  const unit = width / body.naturalWidth;
  ctx.save();
  ctx.translate(x, head);
  ctx.scale(1, tail <= head ? 1 : -1);
  ctx.drawImage(body, -width / 2, -length, width, Math.max(1, length));
  if (end) {
    const w = end.naturalWidth * unit;
    const h = end.naturalHeight * unit;
    drawSeam(ctx, body, end, end.naturalHeight - 1, 0, unit, -length);
    ctx.drawImage(end, -w / 2, -length - h, w, h);
  }
  if (showHead && headImg) {
    const w = headImg.naturalWidth * unit;
    drawSeam(ctx, body, headImg, 0, body.naturalHeight - 1, unit, 0);
    ctx.drawImage(headImg, -w / 2, 0, w, headImg.naturalHeight * unit);
  }
  ctx.restore();
}

// Bridges the body/cap junction at `y` where both edges are opaque, hiding anti-aliasing seams.
function drawSeam(
  ctx: CanvasRenderingContext2D,
  body: HTMLImageElement,
  cap: HTMLImageElement,
  capRow: number,
  bodyRow: number,
  unit: number,
  y: number,
) {
  const offset = (body.naturalWidth - cap.naturalWidth) / 2;
  const inset = 0.5 / unit;
  const bodyRuns = opaqueRuns(body, bodyRow);
  for (const [ca, cb] of opaqueRuns(cap, capRow)) {
    for (const [ba, bb] of bodyRuns) {
      const a = Math.max(ca + offset, ba) + inset;
      const b = Math.min(cb + offset, bb) - inset;
      if (b <= a) continue;
      const x = (a - body.naturalWidth / 2) * unit;
      ctx.drawImage(
        body,
        a,
        bodyRow,
        b - a,
        1,
        x,
        y - HOLD_SEAM_OVERLAP,
        (b - a) * unit,
        HOLD_SEAM_OVERLAP * 2,
      );
    }
  }
}

function drawHit(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  age: number,
  scale: number,
  seed: number,
) {
  if (age < 0) return;
  const frame =
    age < HIT_DURATION ? Math.min(HIT_FRAMES, Math.floor(age / HIT_FRAME_SECONDS) + 1) : 0;
  const img = frame ? (tinted(`img-${frame}`, HIT_COLOR) ?? getImage(`img-${frame}`)) : null;
  const size = HIT_SIZE * scale;
  if (img) ctx.drawImage(img, x - size / 2, y - size / 2, size, size);

  // Particles
  if (age >= 2 / 3) return;
  const amount = ease({ kind: 'preset', id: 16 }, age * 1.5);
  const noteSize = NOTE_WIDTH * scale;
  ctx.fillStyle = `rgb(${HIT_COLOR.join(',')})`;
  ctx.globalAlpha = Math.max(0, 1 - age * 1.5);
  for (let k = 0; k < 4; k++) {
    const r = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
    const angle = (r - Math.floor(r)) * Math.PI * 2;
    const d = noteSize * 1.1 * amount;
    const half = noteSize * 0.075 * amount;
    ctx.fillRect(
      x + Math.cos(angle) * d - half,
      y + Math.sin(angle) * d - half,
      half * 2,
      half * 2,
    );
  }
  ctx.globalAlpha = 1;
}

// Ring at the origin with an arrow toward the object's local up.
function drawBearing(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.lineJoin = 'round';
  const path = () => {
    ctx.beginPath();
    ctx.arc(0, 0, BEARING_RADIUS, 0, Math.PI * 2);
    ctx.moveTo(0, -BEARING_RADIUS);
    ctx.lineTo(0, -BEARING_LENGTH);
    ctx.moveTo(-6, -BEARING_LENGTH + 7);
    ctx.lineTo(0, -BEARING_LENGTH);
    ctx.lineTo(6, -BEARING_LENGTH + 7);
  };
  path();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.lineWidth = 5;
  ctx.stroke();
  path();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
