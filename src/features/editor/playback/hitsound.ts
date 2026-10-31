import type { NoteType } from '@/features/chart/model/types';
import { getAudioContext } from './audioContext';

const BASE = `${import.meta.env.BASE_URL}assets/phigros/SE/`;
const SOUNDS = ['tap', 'drag', 'flick'] as const;
type Sound = (typeof SOUNDS)[number];

let volume = 0.5;
let ctx: AudioContext | null = null;
let gain: GainNode | null = null;
const buffers = new Map<Sound, AudioBuffer>();
let loading = false;

export const soundFor = (type: NoteType): Sound =>
  type === 'drag' ? 'drag' : type === 'flick' ? 'flick' : 'tap';

// Fetches and decodes the samples once, only while hitsounds are audible.
function loadSounds() {
  if (loading || !ctx || volume <= 0) return;
  loading = true;
  const c = ctx;
  for (const name of SOUNDS) {
    void fetch(`${BASE}${name[0].toUpperCase()}${name.slice(1)}.wav`)
      .then((r) => r.arrayBuffer())
      .then((data) => c.decodeAudioData(data))
      .then((buffer) => buffers.set(name, buffer))
      .catch(() => undefined);
  }
}

// Must run after a user gesture.
export function primeHitsound() {
  if (!ctx) {
    ctx = getAudioContext();
    gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(ctx.destination);
  }
  loadSounds();
  void ctx.resume();
}

export function setHitsoundVolume(value: number) {
  volume = value;
  if (gain) gain.gain.value = value;
  loadSounds();
}

export function playHitsound(sound: Sound) {
  const buffer = buffers.get(sound);
  if (!ctx || !gain || !buffer) return;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(gain);
  src.start();
}
