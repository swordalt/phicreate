import type { NoteType } from '@/features/chart/model/types';

// Loaded once, drawn when ready.
const BASE = `${import.meta.env.BASE_URL}assets/phigros/Texture/`;

export const HIT_FRAMES = 31;
export const HIT_FRAME_SECONDS = 0.015;
export const HIT_DURATION = HIT_FRAMES * HIT_FRAME_SECONDS;

const HEADS: Record<NoteType, [normal: string, highlight: string]> = {
  tap: ['Tap', 'TapHL'],
  drag: ['Drag', 'DragHL'],
  flick: ['Flick', 'FlickHL'],
  hold: ['HoldHead', 'HoldHeadHL'],
};

const NAMES = [
  ...Object.values(HEADS).flat(),
  'Pause',
  'HoldBody',
  'HoldBodyHL',
  'HoldTail',
  'HoldTailHL',
  ...Array.from({ length: HIT_FRAMES }, (_, i) => `img-${i + 1}`),
];

const images = new Map<string, HTMLImageElement>();
const tints = new Map<string, HTMLCanvasElement>();
let loading: Promise<void> | null = null;

export function loadSkin() {
  loading ??= Promise.all(
    NAMES.map(async (name) => {
      const img = new Image();
      img.src = `${BASE}${name}.${name === 'Pause' ? 'svg' : 'png'}`;
      try {
        await img.decode();
        images.set(name, img);
      } catch {
        // Missing texture: renderer falls back to flat shapes.
      }
    }),
  ).then(() => undefined);
  return loading;
}

export const getImage = (name: string) => images.get(name);

export const headImage = (type: NoteType, highlight: boolean) =>
  images.get(HEADS[type][highlight ? 1 : 0]);

export const holdImages = (highlight: boolean) => ({
  body: images.get(highlight ? 'HoldBodyHL' : 'HoldBody'),
  end: images.get(highlight ? 'HoldTailHL' : 'HoldTail'),
  head: images.get(highlight ? 'HoldHeadHL' : 'HoldHead'),
});

const runs = new Map<string, [number, number][]>();

// Column ranges [start, end) where a texture row is fully opaque (cached).
export function opaqueRuns(img: HTMLImageElement, row: number) {
  const key = `${img.src}:${row}`;
  let result = runs.get(key);
  if (!result) {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, -row);
    const data = ctx.getImageData(0, 0, canvas.width, 1).data;
    result = [];
    let start = -1;
    for (let x = 0; x <= canvas.width; x++) {
      const opaque = x < canvas.width && data[x * 4 + 3] >= 250;
      if (opaque && start < 0) start = x;
      else if (!opaque && start >= 0) {
        result.push([start, x]);
        start = -1;
      }
    }
    runs.set(key, result);
  }
  return result;
}

// Multiplies a texture by a color (cached).
export function tinted(name: string, [r, g, b]: [number, number, number]) {
  const img = images.get(name);
  if (!img) return null;
  const key = `${name}:${r},${g},${b}`;
  let canvas = tints.get(key);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(img, 0, 0);
    tints.set(key, canvas);
  }
  return canvas;
}
