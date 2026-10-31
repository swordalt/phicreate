// Shared render loop with an optional frame rate cap.
// 0 = display refresh rate, Infinity = uncapped, otherwise frames per second.

type FrameCallback = (now: number) => void;

const callbacks = new Set<FrameCallback>();
// Absorbs rAF timestamp jitter when gating frames.
const TOLERANCE_MS = 1;

let cap = 0;
let raf = 0;
let prevRaf = 0;
let displayInterval = 1000 / 60;
let last = 0;
let ticking = false;
const channel = new MessageChannel();

const interval = () => (cap > 0 ? 1000 / cap : 0);

// Caps faster than the display can't be reached through rAF.
const useTimer = () => cap === Infinity || (cap > 0 && interval() < displayInterval * 0.9);

function run(now: number) {
  const step = interval();
  if (now - last < step - TOLERANCE_MS) return false;
  // Advance on a fixed grid so caps between refresh multiples average out.
  last = step && now - last < step * 2 ? last + step : now;
  for (const cb of callbacks) cb(now);
  return true;
}

function onRaf(now: number) {
  raf = requestAnimationFrame(onRaf);
  if (prevRaf) displayInterval += (now - prevRaf - displayInterval) * 0.1;
  prevRaf = now;
  if (!useTimer()) run(now);
  else if (!ticking) {
    ticking = true;
    onTick();
  }
}

function onTick() {
  if (!raf || !useTimer() || document.hidden) {
    ticking = false;
    return;
  }
  const now = performance.now();
  run(now);
  const wait = last + interval() - performance.now();
  if (wait > 4) setTimeout(onTick, wait - 1);
  else channel.port2.postMessage(null);
}
channel.port1.onmessage = onTick;

export function setFrameCap(fps: number) {
  cap = fps;
}

// Calls `cb` every rendered frame; returns an unsubscribe function.
export function onFrame(cb: FrameCallback) {
  callbacks.add(cb);
  if (!raf) {
    prevRaf = 0;
    raf = requestAnimationFrame(onRaf);
  }
  return () => {
    callbacks.delete(cb);
    if (callbacks.size || !raf) return;
    cancelAnimationFrame(raf);
    raf = 0;
  };
}
