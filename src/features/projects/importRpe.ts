import { strFromU8 } from 'fflate';
import { createId } from '@/lib/id';
import { named } from './projectRepo';
import { SNIFF_BYTES, sniffFormat } from './sniffFormat';
import { unzipAsync } from '@/lib/zip';
import {
  extraToEffects,
  extraToVideos,
  isRpeExtra,
  type RpeExtra,
} from '@/features/chart/io/rpe/extra';
import { officialToChart } from '@/features/chart/io/official/fromOfficial';
import { isOfficialChart, type OfficialChart } from '@/features/chart/io/official/types';
import { pecToChart } from '@/features/chart/io/pec/fromPec';
import { rpeToChart, type RpeImportOptions } from '@/features/chart/io/rpe/fromRpe';
import { markerKind, pngSize } from '@/features/chart/io/rpe/markers';
import { isRpeChart, rpeTexture, type RpeChart } from '@/features/chart/io/rpe/types';
import {
  PROJECT_SCHEMA_VERSION,
  type ImportResult,
  type MediaBlobs,
  type Project,
  type ProjectAssets,
  type ShaderSources,
} from './types';

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/mp4',
};

export const mimeOf = (path: string) => MIME[path.split('.').pop()?.toLowerCase() ?? ''] ?? '';

type Info = Record<string, string>;

// Phira's alternate info keys.
const INFO_ALIASES: Record<string, string> = {
  music: 'song',
  illustration: 'picture',
  image: 'picture',
  artist: 'composer',
  musician: 'composer',
  designer: 'charter',
};

// info.txt / info.yml: "Key: value" lines.
function parseInfo(text: string): Info {
  const info: Info = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([\w]+)\s*:\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    info[INFO_ALIASES[key] ?? key] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return info;
}

// Phira adds info.yml's offset (seconds) to the chart's.
function withInfoOffset(project: Project, info: Info): Project {
  const offset = Number(info.offset);
  if (Number.isFinite(offset)) project.chart.offsetMs += offset * 1000;
  return project;
}

// PhiEdit info.csv columns, as info keys.
const CSV_KEYS: Record<string, string> = {
  chart: 'chart',
  music: 'song',
  image: 'picture',
  name: 'name',
  level: 'level',
  illustrator: 'illustrator',
  designer: 'charter',
  composer: 'composer',
  artist: 'composer',
};

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') cell += text[++i];
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((r) => r.some((v) => v.trim()));
}

// info.csv: a header row, a translated header row, then one row per chart.
function parseInfoCsv(text: string): Info[] {
  const [header, , ...data] = csvRows(text.replace(/^\uFEFF/, ''));
  if (!header) return [];
  const keys = header.map((h) => CSV_KEYS[h.trim().toLowerCase()]);
  return data.map((row) => {
    const info: Info = {};
    keys.forEach((k, i) => {
      if (k && row[i]?.trim()) info[k] = row[i].trim();
    });
    return info;
  });
}

function parseJson(data: Uint8Array): unknown {
  try {
    return JSON.parse(strFromU8(data).replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

type ProjectMeta = Pick<
  Project['meta'],
  'name' | 'artist' | 'illustrator' | 'charter' | 'difficulty'
>;

function buildProject(
  meta: ProjectMeta,
  chart: Project['chart'],
  assets: ProjectAssets,
  media: MediaBlobs = {},
  shaders: ShaderSources = {},
): Project {
  const now = Date.now();
  return {
    meta: {
      id: createId(),
      ...meta,
      songName: meta.name,
      createdAt: now,
      updatedAt: now,
      schemaVersion: PROJECT_SCHEMA_VERSION,
    },
    chart,
    ...assets,
    media,
    shaders,
  };
}

// PEC charts carry no metadata; it comes from info.txt / info.yml.
export function pecToProject(text: string, info: Info = {}, assets: ProjectAssets = {}): Project {
  return buildProject(
    {
      name: (info.name || 'Untitled').trim(),
      artist: (info.composer || '').trim(),
      illustrator: (info.illustrator || '').trim(),
      charter: (info.charter || '').trim(),
      difficulty: (info.level || '').trim(),
    },
    pecToChart(text),
    assets,
  );
}

// Official charts carry no metadata; it comes from info.txt / info.yml.
export function officialToProject(
  src: OfficialChart,
  info: Info = {},
  assets: ProjectAssets = {},
): Project {
  return buildProject(
    {
      name: (info.name || 'Untitled').trim(),
      artist: (info.composer || '').trim(),
      illustrator: (info.illustrator || '').trim(),
      charter: (info.charter || '').trim(),
      difficulty: (info.level || '').trim(),
    },
    officialToChart(src),
    assets,
  );
}

// Without files (plain JSON), media objects are created empty.
// `files` = line textures and extra.json videos by path (noise marker textures only when not converted).
export function rpeToProject(
  rpe: RpeChart,
  info: Info = {},
  assets: ProjectAssets = {},
  files: Record<string, Blob> = {},
  extra?: RpeExtra,
  shaders: ShaderSources = {},
  options: RpeImportOptions = {},
): Project {
  const meta = rpe.META ?? {};
  const name = (info.name || meta.name || 'Untitled').trim();
  const ids: Record<string, string> = {};
  const media: MediaBlobs = {};
  for (const [name, blob] of Object.entries(files)) {
    ids[name] = createId();
    media[ids[name]] = named(blob, name.replace(/^.*[\\/]/, ''));
  }
  const lineIds = rpe.judgeLineList.map(() => createId());
  const chart = rpeToChart(rpe, ids, lineIds, options);
  if (extra) {
    chart.effects = extraToEffects(extra, chart.bpmList, shaders);
    const kept = new Set(chart.lines.map((l) => l.id));
    const parents = lineIds.map((id) => (kept.has(id) ? id : undefined));
    chart.media = [...chart.media, ...extraToVideos(extra, chart.bpmList, ids, parents)];
  }
  return buildProject(
    {
      name,
      artist: (info.composer || meta.composer || '').trim(),
      illustrator: (info.illustrator || meta.illustration || '').trim(),
      charter: (info.charter || meta.charter || '').trim(),
      difficulty: (info.level || meta.level || '').trim(),
    },
    chart,
    assets,
    media,
    shaders,
  );
}

// Reads a PEZ / ZIP chart package (RPE or official). Returns null if no chart is found.
export async function importChartPackage(file: Blob): Promise<ImportResult | null> {
  let files: Record<string, Uint8Array>;
  try {
    files = await unzipAsync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return null;
  }
  return importChartFiles(files);
}

// Unzipped PEZ / ZIP package.
export function importChartFiles(files: Record<string, Uint8Array>): ImportResult | null {
  const paths = Object.keys(files).filter((p) => !p.endsWith('/'));
  const lowerPaths = paths.map((p) => p.toLowerCase());
  const found = new Map<string, string | undefined>();
  const find = (name?: string) => {
    if (!name) return undefined;
    const lower = name.replace(/\\/g, '/').toLowerCase();
    if (!found.has(lower)) {
      found.set(lower, paths[lowerPaths.findIndex((p) => p === lower || p.endsWith(`/${lower}`))]);
    }
    return found.get(lower);
  };

  const infoPath = paths.find((p) => /(^|\/)info\.(txt|ya?ml)$/i.test(p));
  const csvPath = paths.find((p) => /(^|\/)info\.csv$/i.test(p));
  const csvInfos = !infoPath && csvPath ? parseInfoCsv(strFromU8(files[csvPath])) : [];
  let info = infoPath ? parseInfo(strFromU8(files[infoPath])) : (csvInfos[0] ?? {});

  const blob = (name?: string) => {
    const path = find(name);
    if (!path) return undefined;
    return new Blob([files[path] as Uint8Array<ArrayBuffer>], { type: mimeOf(path) });
  };

  let rpe: RpeChart | null = null;
  const chartPath = find(info.chart);
  // Sniffed by content: PEC is often named .json, and other JSON (extra.json, ...) isn't parsed.
  const candidates = (
    chartPath ? [chartPath] : paths.filter((p) => /\.(json|pec)$/i.test(p))
  ).map((p) => ({ p, kind: sniffFormat(strFromU8(files[p].subarray(0, SNIFF_BYTES))) }));
  // Identified charts first; unidentified JSON only as a fallback.
  const ordered = [
    ...candidates.filter((c) => c.kind === 'pec' || c.kind === 'rpe' || c.kind === 'official'),
    ...candidates.filter((c) => c.kind === 'json'),
  ];
  for (const { p, kind } of ordered) {
    if (kind === 'pec') {
      const base = p.replace(/^.*\//, '').toLowerCase();
      info = csvInfos.find((i) => i.chart?.toLowerCase() === base) ?? info;
      const project = pecToProject(strFromU8(files[p]), info, {
        audio: blob(info.song),
        illustration: blob(info.picture),
      });
      return { project: withInfoOffset(project, info), format: 'pec' };
    }
    const data = parseJson(files[p]);
    // Checked first: both formats have judgeLineList.
    if (kind !== 'rpe' && isOfficialChart(data)) {
      const project = officialToProject(data, info, {
        audio: blob(info.song),
        illustration: blob(info.picture),
      });
      return { project: withInfoOffset(project, info), format: 'official' };
    }
    if (kind !== 'official' && isRpeChart(data)) {
      rpe = data;
      break;
    }
  }
  if (!rpe) return null;

  // Noise marker textures only give their size, unless markers stay images.
  const mediaFiles: Record<string, Blob> = {};
  const markerFiles: Record<string, Blob> = {};
  const markerSizes: Record<string, [number, number]> = {};
  for (const line of rpe.judgeLineList) {
    const name = line && rpeTexture(line);
    if (!name || name in mediaFiles || name in markerFiles) continue;
    const file = blob(name);
    if (!file) continue;
    if (markerKind(name) === null) {
      mediaFiles[name] = file;
      continue;
    }
    markerFiles[name] = file;
    const size = pngSize(files[find(name)!]);
    if (size) markerSizes[name] = size;
  }

  // extra.json: video files, then custom shaders ('/name.glsl') for effects.
  const extraPath = paths.find((p) => /(^|\/)extra\.json$/i.test(p));
  const extraData = extraPath ? parseJson(files[extraPath]) : null;
  const extra = isRpeExtra(extraData) ? extraData : undefined;
  for (const video of extra?.videos ?? []) {
    const path = video?.path;
    const file = typeof path === 'string' && !(path in mediaFiles) && blob(path);
    if (file) mediaFiles[path] = file;
  }
  const shaders: ShaderSources = {};
  for (const effect of extra?.effects ?? []) {
    const shader = effect?.shader;
    if (typeof shader !== 'string' || !shader.startsWith('/') || shader in shaders) continue;
    const path = find(shader.slice(1));
    if (path) shaders[shader] = strFromU8(files[path]);
  }

  const assets = {
    audio: blob(info.song || rpe.META?.song),
    illustration: blob(info.picture || rpe.META?.background),
  };
  const build = (noise: boolean) =>
    withInfoOffset(
      rpeToProject(
        rpe!,
        info,
        assets,
        noise ? mediaFiles : { ...mediaFiles, ...markerFiles },
        extra,
        shaders,
        { noise, markerSizes },
      ),
      info,
    );
  return withNoiseOption(build);
}

// Converts with noise fields, offering the unconverted chart when there are any.
export function withNoiseOption(build: (noise: boolean) => Project): ImportResult {
  const project = build(true);
  return {
    project,
    format: 'rpe',
    ...(project.chart.noiseFields.length > 0 && { withoutNoise: () => build(false) }),
  };
}
