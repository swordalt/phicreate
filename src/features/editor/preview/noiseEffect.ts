// "Original" noise field look (after Phira's port of the official block renderer):
// low-res masks -> wobbling compose -> edge/glow dilation -> full-res fill with sparks and scene distortion.

import type { Color } from '@/features/chart/model/types';
import { NOISE_COLOR, type NoisePhase } from '@/features/chart/runtime/scene';

export type DevicePoint = [number, number];

export interface NoiseShape {
  points: DevicePoint[];
  color: Color;
}

export interface NoiseShapes {
  normal: NoiseShape[];
  subtract: NoiseShape[];
}

// Play frame in device pixels.
export interface NoiseFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PHASES: NoisePhase[] = ['active', 'ready', 'disabled'];
// Sizes are tuned for a 1080 px tall frame.
const REFERENCE_HEIGHT = 1080;
const MASK_CELL = 8;
const GLOW_WEIGHTS = [0.458568, 0.282861, 0.156589, 0.073059, 0.024948];
// Covers mask wobble plus the glow rings.
const MARGIN = 0.12;

const BASE = `${import.meta.env.BASE_URL}assets/shaders/noise/`;

// Fragment programs, each built from shared header / helper chunks plus its own file.
const PROGRAMS = {
  fill: ['header', 'fill'],
  paint: ['header', 'paint'],
  compose: ['header', 'displace', 'compose'],
  glow: ['header', 'glow'],
  final: ['header', 'displace', 'final'],
} as const;

type ProgramName = keyof typeof PROGRAMS;

interface Sources {
  vertex: string;
  fragments: Record<ProgramName, string>;
}

let sources: Sources | null = null;
let loading: Promise<void> | null = null;

function loadSources() {
  const chunk = (name: string) =>
    fetch(`${BASE}${name}.glsl`).then((r) => (r.ok ? r.text() : Promise.reject(new Error(name))));
  loading ??= (async () => {
    const names = ['vertex', 'header', 'displace', 'fill', 'paint', 'compose', 'glow', 'final'];
    const texts = await Promise.all(names.map(chunk));
    const files = Object.fromEntries(names.map((n, i) => [n, texts[i]]));
    const fragments = {} as Record<ProgramName, string>;
    for (const [name, parts] of Object.entries(PROGRAMS))
      fragments[name as ProgramName] = parts.map((p) => files[p]).join('\n');
    sources = { vertex: files.vertex, fragments };
  })().catch((e) => console.error('Noise shaders failed to load', e));
  return loading;
}

interface Program {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation>;
}

interface Target {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

// Tileable maps from the official renderer (via Phira).
const TEXTURE_BASE = `${import.meta.env.BASE_URL}assets/phigros/Texture/Noise/`;

class NoiseEffect {
  readonly canvas = document.createElement('canvas');
  private gl: WebGL2RenderingContext | null;
  private programs: Record<ProgramName, Program> | null = null;
  private quad: WebGLBuffer | null = null;
  private shapes: WebGLBuffer | null = null;
  private scene: WebGLTexture | null = null;
  private displace: WebGLTexture | null = null;
  private spark: WebGLTexture | null = null;
  private masks: Target[] = [];
  private composes: Target[] = [];
  private effects: Target[] = [];
  private colors: Target[] = [];

  constructor(private sources: Sources) {
    this.gl = this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: true,
    });
    const gl = this.gl;
    if (!gl) return;
    try {
      this.programs = {
        fill: this.link(sources.fragments.fill),
        paint: this.link(sources.fragments.paint),
        compose: this.link(sources.fragments.compose),
        glow: this.link(sources.fragments.glow),
        final: this.link(sources.fragments.final),
      };
    } catch (e) {
      console.error(e);
      this.gl = null;
      return;
    }
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.shapes = gl.createBuffer();
    this.scene = this.texture(gl.LINEAR, gl.CLAMP_TO_EDGE);
    this.displace = this.pattern('Displace.png');
    this.spark = this.pattern('Spark.png');
  }

  get supported() {
    return !!this.gl;
  }

  private link(fragment: string): Program {
    const gl = this.gl!;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader) ?? 'Noise shader compile error');
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, this.sources.vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(program, 0, 'position');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) ?? 'Noise shader link error');
    const uniforms = new Map<string, WebGLUniformLocation>();
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      const location = info && gl.getUniformLocation(program, info.name);
      if (info && location) uniforms.set(info.name, location);
    }
    return { program, uniforms };
  }

  private texture(filter: number, wrap: number) {
    const gl = this.gl!;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return texture;
  }

  // Neutral grey until the image loads.
  private pattern(name: string) {
    const gl = this.gl!;
    const texture = this.texture(gl.LINEAR, gl.REPEAT);
    const grey = new Uint8Array([128, 128, 128, 255]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, grey);
    const img = new Image();
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    };
    img.src = TEXTURE_BASE + name;
    return texture;
  }

  private target(list: Target[], i: number, w: number, h: number, filter: number) {
    const gl = this.gl!;
    let t = list[i];
    if (!t) {
      const texture = this.texture(filter, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer()!;
      t = list[i] = { texture, fbo, w: 0, h: 0 };
    }
    if (t.w !== w || t.h !== h) {
      gl.bindTexture(gl.TEXTURE_2D, t.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.texture, 0);
      t.w = w;
      t.h = h;
    }
    return t;
  }

  private use(name: keyof NonNullable<NoiseEffect['programs']>, values: Record<string, number[]>) {
    const gl = this.gl!;
    const { program, uniforms } = this.programs![name];
    gl.useProgram(program);
    for (const [key, v] of Object.entries(values)) {
      const location = uniforms.get(key);
      if (!location) continue;
      if (v.length === 1) gl.uniform1f(location, v[0]);
      else if (v.length === 2) gl.uniform2fv(location, v);
      else gl.uniform4fv(location, v);
    }
    return uniforms;
  }

  private bind(
    uniforms: Map<string, WebGLUniformLocation>,
    textures: Record<string, WebGLTexture>,
  ) {
    const gl = this.gl!;
    Object.entries(textures).forEach(([name, texture], unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      const location = uniforms.get(name);
      if (location) gl.uniform1i(location, unit);
    });
    gl.activeTexture(gl.TEXTURE0);
  }

  private into(target: Target | null, w: number, h: number) {
    const gl = this.gl!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.fbo ?? null);
    gl.viewport(0, 0, w, h);
  }

  private fullscreen() {
    const gl = this.gl!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Quads in device pixels as clip-space triangles.
  private drawQuads(quads: DevicePoint[][], w: number, h: number) {
    if (!quads.length) return;
    const gl = this.gl!;
    const data = new Float32Array(quads.length * 12);
    quads.forEach((q, i) => {
      const p = q.map(([x, y]) => [(x / w) * 2 - 1, 1 - (y / h) * 2]);
      data.set([...p[0], ...p[1], ...p[2], ...p[0], ...p[2], ...p[3]], i * 12);
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shapes);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, quads.length * 6);
  }

  render(
    ctx: CanvasRenderingContext2D,
    groups: Record<NoisePhase, NoiseShapes>,
    frame: NoiseFrame,
    time: number,
  ) {
    const gl = this.gl!;
    const source = ctx.canvas;
    const W = source.width;
    const H = source.height;
    if (!W || !H) return;

    // Device rect around all fields, padded for wobble and glow.
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const phase of PHASES) {
      for (const q of [...groups[phase].normal, ...groups[phase].subtract]) {
        for (const [x, y] of q.points) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
      }
    }
    if (![x0, y0, x1, y1].every(Number.isFinite)) {
      [x0, y0, x1, y1] = [0, 0, W, H];
    }
    const pad = MARGIN * Math.max(frame.w, frame.h);
    const rx = Math.max(0, Math.floor(x0 - pad));
    const ry = Math.max(0, Math.floor(y0 - pad));
    const rw = Math.min(W, Math.ceil(x1 + pad)) - rx;
    const rh = Math.min(H, Math.ceil(y1 + pad)) - ry;
    if (rw <= 0 || rh <= 0) return;

    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    const unit = Math.max(frame.h, 1) / REFERENCE_HEIGHT;
    const cell = Math.max(1, MASK_CELL * unit);
    const mw = Math.max(1, Math.ceil(W / cell));
    const mh = Math.max(1, Math.ceil(H / cell));
    // GL uv: origin bottom left.
    const frameUv = [frame.x / W, 1 - (frame.y + frame.h) / H, frame.w / W, frame.h / H];

    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);

    // Scene under the fields.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.scene);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    // Masks: r = normal union, g = subtract parity.
    PHASES.forEach((phase, i) => {
      const mask = this.target(this.masks, i, mw, mh, gl.NEAREST);
      this.into(mask, mw, mh);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.use('fill', {});
      gl.enable(gl.BLEND);
      gl.colorMask(true, false, false, false);
      gl.blendFunc(gl.ONE, gl.ONE);
      this.drawQuads(
        groups[phase].normal.map((s) => s.points),
        W,
        H,
      );
      gl.colorMask(false, true, false, false);
      gl.blendFunc(gl.ONE_MINUS_DST_COLOR, gl.ZERO);
      this.drawQuads(
        groups[phase].subtract.map((s) => s.points),
        W,
        H,
      );
      gl.colorMask(true, true, true, true);
      gl.disable(gl.BLEND);

      const compose = this.target(this.composes, i, mw, mh, gl.NEAREST);
      this.into(compose, mw, mh);
      const u = this.use('compose', {
        frame: frameUv,
        time: [time],
        wobble: [phase === 'active' ? 1 : 0],
      });
      this.bind(u, { mask: mask.texture, displaceMap: this.displace! });
      this.fullscreen();
    });

    // Edge and glow rings around active fields at twice the mask resolution.
    const ew = mw * 2;
    const eh = mh * 2;
    let prev = this.composes[0].texture;
    GLOW_WEIGHTS.forEach((weight, i) => {
      const out = this.target(this.effects, i % 2, ew, eh, gl.LINEAR);
      this.into(out, ew, eh);
      const u = this.use('glow', {
        texel: [1 / ew, 1 / eh],
        weight: [weight],
        first: [i === 0 ? 1 : 0],
      });
      this.bind(u, { prev, compose: this.composes[0].texture });
      this.fullscreen();
      prev = out.texture;
    });

    // Nearest field's tint: grown quads reach the glow, exact quads win inside.
    const tinted = PHASES.some((phase) =>
      [...groups[phase].normal, ...groups[phase].subtract].some(
        (s) => !s.color.every((v, k) => v === NOISE_COLOR[k]),
      ),
    );
    const colorMap = this.target(this.colors, 0, mw, mh, gl.LINEAR);
    if (tinted) {
      this.into(colorMap, mw, mh);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // Later phases and normal fields paint over.
      const order = [...PHASES]
        .reverse()
        .flatMap((phase) => [...groups[phase].subtract, ...groups[phase].normal]);
      for (const grow of [pad, 0]) {
        for (const s of order) {
          this.use('paint', { color: [...s.color.map((v) => v / 255), 1] });
          this.drawQuads([grow ? expand(s.points, grow) : s.points], W, H);
        }
      }
    }

    // Composite into the drawing buffer within the padded rect.
    this.into(null, W, H);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(rx, H - ry - rh, rw, rh);
    const u = this.use('final', {
      screen: [W, H],
      effectSize: [ew, eh],
      frame: frameUv,
      unit: [unit],
      time: [time],
      colored: [tinted ? 1 : 0],
    });
    this.bind(u, {
      scene: this.scene!,
      activeMask: this.composes[0].texture,
      readyMask: this.composes[1].texture,
      disabledMask: this.composes[2].texture,
      effect: prev,
      displaceMap: this.displace!,
      sparkMap: this.spark!,
      colorMap: colorMap.texture,
    });
    this.fullscreen();
    gl.disable(gl.SCISSOR_TEST);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(rx, ry, rw, rh);
    ctx.drawImage(this.canvas, rx, ry, rw, rh, rx, ry, rw, rh);
    ctx.restore();
  }
}

// Pushes each corner of a convex quad outward by `d` along both of its edges.
function expand(q: DevicePoint[], d: number): DevicePoint[] {
  const away = (p: DevicePoint, o: DevicePoint): DevicePoint => {
    const dx = p[0] - o[0];
    const dy = p[1] - o[1];
    const len = Math.hypot(dx, dy);
    return len > 1e-6 ? [dx / len, dy / len] : [0, 0];
  };
  return q.map((p, i) => {
    const u = away(p, q[(i + q.length - 1) % q.length]);
    const v = away(p, q[(i + 1) % q.length]);
    return [p[0] + (u[0] + v[0]) * d, p[1] + (u[1] + v[1]) * d];
  });
}

let effect: NoiseEffect | null = null;

// False when WebGL 2 is unavailable or the shaders are still loading (caller falls back to the
// simplified look).
export function renderNoiseEffect(
  ctx: CanvasRenderingContext2D,
  groups: Record<NoisePhase, NoiseShapes>,
  frame: NoiseFrame,
  time: number,
) {
  if (!sources) {
    void loadSources();
    return false;
  }
  effect ??= new NoiseEffect(sources);
  if (!effect.supported) return false;
  effect.render(ctx, groups, frame, time);
  return true;
}
