import { strToU8, type Zippable } from 'fflate';
import { chartToOfficial, type FakeNotes } from '@/features/chart/io/official/toOfficial';
import { chartToRpe } from '@/features/chart/io/rpe/toRpe';
import { bundledShader, loadPresetShaders } from '@/features/shaders/library';
import { downloadBlob, toSafeFilename } from '@/lib/file';
import { zipAsync } from '@/lib/zip';
import { toExport } from './projectFactory';
import { projectRepo } from './projectRepo';
import type { PackageFiles, Project } from './types';

export type ExportFormat = 'phicreate' | 'rpe' | 'official';

export interface ExportOptions {
  format: ExportFormat;
  // Official: fake notes are unsupported.
  fakeNotes: FakeNotes;
  // RPE: noise fields only load in rpe-next.
  noiseFields: boolean;
}

const SUFFIXES: Record<ExportFormat, string> = {
  phicreate: 'phicreate',
  rpe: 'rpe',
  official: 'phigrosv3',
};

const CHART_FILE = 'chart.json';
export const PROJECT_FILE = 'project.json';

const EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/flac': 'flac',
  'audio/mp4': 'm4a',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

const extension = (blob: Blob, fallback: string) =>
  (blob instanceof File && /\.(\w+)$/.exec(blob.name)?.[1]) || EXTENSIONS[blob.type] || fallback;

const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

// Package file names, unique ignoring case.
function namer() {
  const used = new Set([CHART_FILE, PROJECT_FILE, 'info.txt', 'extra.json']);
  return (name: string) => {
    const clean = name.replace(/[\\/:*?"<>|]+/g, '_') || 'file';
    const [, stem, ext] = /^(.*?)(\.[^.]*)?$/.exec(clean) ?? [clean, clean, ''];
    let out = clean;
    for (let i = 1; used.has(out.toLowerCase()); i++) out = `${stem}-${i}${ext ?? ''}`;
    used.add(out.toLowerCase());
    return out;
  };
}

// Phira / RPE info.txt.
function infoText(project: Project, files: { song?: string; picture?: string }) {
  const { meta } = project;
  const line = (v: string) => v.replace(/[\r\n]+/g, ' ').trim();
  const fields = {
    Name: meta.name,
    Path: meta.id,
    Song: files.song ?? '',
    Picture: files.picture ?? '',
    Chart: CHART_FILE,
    Level: meta.difficulty,
    Composer: meta.artist,
    Charter: meta.charter,
    Illustrator: meta.illustrator,
  };
  return `#\n${Object.entries(fields)
    .map(([k, v]) => `${k}: ${line(v)}`)
    .join('\n')}\n`;
}

async function packageFiles(project: Project, unique: (name: string) => string) {
  const files: Zippable = {};
  const add = async (blob: Blob | undefined, name: string | undefined) => {
    if (!blob || !name) return undefined;
    const path = unique(name);
    files[path] = await bytes(blob);
    return path;
  };
  const { audio, illustration } = project;
  const song = await add(audio, audio && `song.${extension(audio, 'mp3')}`);
  const picture = await add(
    illustration,
    illustration && `illustration.${extension(illustration, 'png')}`,
  );
  return { files, add, song, picture };
}

const json = (data: unknown) => strToU8(JSON.stringify(data));

async function rpePackage(project: Project, options: ExportOptions) {
  const id = project.meta.id;
  const [media, shaders] = await Promise.all([
    project.media ?? projectRepo.getMedia(id),
    project.shaders ?? projectRepo.getShaders(id),
    loadPresetShaders(),
  ]);
  const unique = namer();
  const { files, add, song, picture } = await packageFiles(project, unique);

  const mediaPaths: Record<string, string> = {};
  for (const m of project.chart.media) {
    const blob = m.assetId ? media[m.assetId] : undefined;
    if (!blob || !m.assetId || m.assetId in mediaPaths) continue;
    const name = blob instanceof File ? blob.name : `${m.assetId}.${extension(blob, 'png')}`;
    mediaPaths[m.assetId] = (await add(blob, name))!;
  }

  const { rpe, extra } = chartToRpe(project.chart, {
    meta: project.meta,
    song,
    background: picture,
    mediaPaths,
    shaders,
    noise: options.noiseFields,
  });
  files[CHART_FILE] = json(rpe);
  if (extra) {
    files['extra.json'] = json(extra);
    for (const effect of extra.effects ?? []) {
      const source = shaders[effect.shader] ?? bundledShader(effect.shader);
      const path = effect.shader.slice(1);
      if (source && !(path in files)) files[path] = strToU8(source);
    }
  }
  files['info.txt'] = strToU8(infoText(project, { song, picture }));
  return files;
}

async function officialPackage(project: Project, options: ExportOptions) {
  const { files, song, picture } = await packageFiles(project, namer());
  files[CHART_FILE] = json(chartToOfficial(project.chart, options.fakeNotes));
  files['info.txt'] = strToU8(infoText(project, { song, picture }));
  return files;
}

// project.json + audio, illustration, media, fonts and shaders.
async function phicreatePackage(project: Project) {
  const id = project.meta.id;
  const [media, fonts, shaders] = await Promise.all([
    project.media ?? projectRepo.getMedia(id),
    project.fonts ?? projectRepo.getFonts(id),
    project.shaders ?? projectRepo.getShaders(id),
  ]);
  const { files, song, picture } = await packageFiles(project, namer());
  const index: PackageFiles = {
    audio: song,
    illustration: picture,
    media: {},
    fonts: {},
    shaders: {},
  };

  const addTo = async (dir: string, unique: (name: string) => string, blob: Blob, name: string) => {
    const path = `${dir}/${unique(name)}`;
    files[path] = await bytes(blob);
    return { path, type: blob.type, name: blob instanceof File ? blob.name : undefined };
  };
  const mediaName = namer();
  for (const [assetId, blob] of Object.entries(media)) {
    const name = blob instanceof File ? blob.name : `${assetId}.${extension(blob, 'png')}`;
    index.media![assetId] = await addTo('media', mediaName, blob, name);
  }
  const fontName = namer();
  for (const [name, blob] of Object.entries(fonts)) {
    index.fonts![name] = await addTo('fonts', fontName, blob, name);
  }
  const shaderName = namer();
  for (const [shader, source] of Object.entries(shaders)) {
    const path = `shaders/${shaderName(shader.replace(/^\//, ''))}`;
    files[path] = strToU8(source);
    index.shaders![shader] = path;
  }

  files[PROJECT_FILE] = json({ ...toExport(project), files: index });
  return files;
}

// Downloads the project as a <name>.<format>.zip package.
export async function exportProject(project: Project, options: ExportOptions) {
  const name = toSafeFilename(project.meta.name);
  const files =
    options.format === 'phicreate'
      ? await phicreatePackage(project)
      : options.format === 'rpe'
        ? await rpePackage(project, options)
        : await officialPackage(project, options);
  const data = await zipAsync(files);
  downloadBlob(
    new Blob([data.slice()], { type: 'application/zip' }),
    `${name}.${SUFFIXES[options.format]}.zip`,
  );
}
