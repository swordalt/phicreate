import { create } from 'zustand';

const BASE = `${import.meta.env.BASE_URL}assets/shaders/`;

// Preset shaders mirrored from Phira (prpr/src/core/shaders), keyed by Phira name.
export const PHIRA_NAMES = [
  'chromatic',
  'circleBlur',
  'fisheye',
  'glitch',
  'grayscale',
  'noise',
  'pixel',
  'radialBlur',
  'shockwave',
  'vignette',
];

// Extra presets: PhiEdit's Phira ports ('color_shift_pr.glsl' → 'colorShift'). Phira lacks them,
// so RPE exports bundle them as '/<file>'.
const EXTRA_FILES = [
  'bokeh_pr',
  'burn_pr',
  'camera_pr',
  'color_shift_pr',
  'distortion_pr',
  'emboss_pr',
  'flare_pr',
  'flip_pr',
  'flowing_pr',
  'fog_pr',
  'glow_effect_pr',
  'heat_distortion_pr',
  'hologram_pr',
  'image_noise_pr',
  'kaleidoscope_pr',
  'lightning_pr',
  'liquid_pr',
  'neon_pr',
  'night_vision_pr',
  'oil_painting_pr',
  'old_tv_pr',
  'rain_pr',
  'rainbow_pr',
  'rays_pr',
  'scanline_pr',
  'snow_pr',
  'sobel_pr',
  'two_tone_pr',
  'underwater_pr',
  'wave_pr',
];

const baseName = (path: string) => path.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
const camel = (s: string) => s.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());

// Extra preset name → extra.json path ('/bokeh_pr.glsl').
const EXTRA_PATHS: Record<string, string> = Object.fromEntries(
  EXTRA_FILES.map((file) => [camel(file.replace(/_pr$/, '')), `/${file}.glsl`]),
);

export const EXTRA_NAMES = Object.keys(EXTRA_PATHS);
export const PRESET_NAMES = [...PHIRA_NAMES, ...EXTRA_NAMES];

// Filled by loadPresetShaders().
export const PRESET_SHADERS: Record<string, string> = {};

let loading: Promise<void> | null = null;

// Loaded once; await before reading presets.
export function loadPresetShaders() {
  const fetchInto = async (name: string, url: string) => {
    const res = await fetch(url);
    if (res.ok) PRESET_SHADERS[name] = await res.text();
  };
  loading ??= Promise.all([
    ...PHIRA_NAMES.map((name) => fetchInto(name, `${BASE}phira/${name}.glsl`)),
    ...Object.entries(EXTRA_PATHS).map(([name, path]) => fetchInto(name, `${BASE}extra${path}`)),
  ])
    .catch(() => undefined)
    .then(() => undefined);
  return loading;
}

// Shader name as written to extra.json: extra presets become their bundled file.
export const rpeShader = (shader: string) => EXTRA_PATHS[shader] ?? shader;

const EXTRA_BY_PATH = new Map(Object.entries(EXTRA_PATHS).map(([name, path]) => [path, name]));

// Source of a bundled extra preset by extra.json path ('/bokeh_pr.glsl').
export const bundledShader = (path: string) => {
  const name = EXTRA_BY_PATH.get(path);
  return name ? PRESET_SHADERS[name] : undefined;
};

// 'bokeh_pr', 'Bokeh' or 'heatDistortion' all match their extra preset.
const matchKey = (name: string) => name.replace(/_pr$/i, '').replace(/_/g, '').toLowerCase();
const EXTRA_KEYS = new Map(EXTRA_NAMES.map((name) => [matchKey(name), name]));

// Imported extra.json shader: the matching extra preset, else unchanged.
export const nativeShader = (shader: string) =>
  EXTRA_KEYS.get(matchKey(baseName(shader))) ?? shader;

export const SHADER_ACCEPT = '.glsl,.frag,.txt';

// Custom shaders as referenced by effects: '/name.glsl'.
export const isCustomShader = (shader: string) => shader.startsWith('/');
export const customShaderPath = (fileName: string) => `/${fileName.replace(/^.*[\\/]/, '')}`;

// Custom shader sources of the open project, keyed by path ('/name.glsl').
export const useShaderLibrary = create<{ custom: Record<string, string> }>(() => ({ custom: {} }));

export const setCustomShaders = (custom: Record<string, string>) =>
  useShaderLibrary.setState({ custom });

export const putCustomShader = (path: string, source: string) =>
  useShaderLibrary.setState((s) => ({ custom: { ...s.custom, [path]: source } }));

export const removeCustomShader = (path: string) =>
  useShaderLibrary.setState((s) => {
    const custom = { ...s.custom };
    delete custom[path];
    return { custom };
  });

export const renameCustomShader = (from: string, to: string) =>
  useShaderLibrary.setState((s) => {
    if (!(from in s.custom)) return s;
    const custom = { ...s.custom, [to]: s.custom[from] };
    delete custom[from];
    return { custom };
  });

export const shaderSource = (shader: string): string | undefined =>
  isCustomShader(shader) ? useShaderLibrary.getState().custom[shader] : PRESET_SHADERS[shader];

export interface ShaderUniform {
  name: string;
  // 1 = float, 2–4 = vecN.
  size: number;
  // From the `// %a, b%` comment (Phira); zeros otherwise.
  value: number[];
}

// Set by the renderer.
export const BUILTIN_UNIFORMS = new Set(['time', 'screenSize', 'UVScale', 'screenTexture']);

const UNIFORM_RE =
  /uniform\s+(?:(?:lowp|mediump|highp)\s+)?(float|vec[234])\s+(\w+)\s*;([^\r\n]*)/g;

const uniformCache = new Map<string, ShaderUniform[]>();

// Editable uniforms of a shader source.
export function parseUniforms(source: string): ShaderUniform[] {
  let list = uniformCache.get(source);
  if (list) return list;
  list = [...source.matchAll(UNIFORM_RE)]
    .filter(([, , name]) => !BUILTIN_UNIFORMS.has(name))
    .map(([, type, name, comment]) => {
      const size = type === 'float' ? 1 : Number(type.slice(3));
      const parts = comment
        .match(/%([^%]+)%/)?.[1]
        .split(',')
        .map(Number);
      const value =
        parts?.length === size && parts.every(Number.isFinite) ? parts : Array(size).fill(0);
      return { name, size, value };
    });
  uniformCache.set(source, list);
  return list;
}

// vec4 is a color (as in Phira); other vectors use xyz.
export const componentNames = (size: number) =>
  size === 1 ? [''] : size === 4 ? ['r', 'g', 'b', 'a'] : ['x', 'y', 'z'].slice(0, size);

// Var keys of a uniform: 'power', or 'offset.x', 'offset.y'.
export const uniformKeys = (u: Pick<ShaderUniform, 'name' | 'size'>) =>
  componentNames(u.size).map((c) => (c ? `${u.name}.${c}` : u.name));

export const shaderUniforms = (shader: string) => {
  const source = shaderSource(shader);
  return source ? parseUniforms(source) : [];
};

// Default value per var key.
export function varDefaults(shader: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const u of shaderUniforms(shader)) uniformKeys(u).forEach((k, i) => (out[k] = u.value[i]));
  return out;
}
