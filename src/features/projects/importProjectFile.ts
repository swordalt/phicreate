import { strFromU8 } from 'fflate';
import { isOfficialChart } from '@/features/chart/io/official/types';
import { isPecText } from '@/features/chart/io/pec/fromPec';
import { isRpeChart } from '@/features/chart/io/rpe/types';
import { unzipAsync } from '@/lib/zip';
import { PROJECT_FILE } from './exportProject';
import { fromExport } from './projectFactory';
import {
  importChartFiles,
  mimeOf,
  officialToProject,
  pecToProject,
  rpeToProject,
  withNoiseOption,
} from './importRpe';
import { named } from './projectRepo';
import type { ImportResult, PackageFile, ProjectExport } from './types';

export const IMPORT_ACCEPT = '.json,.pec,.pez,.zip,application/json,application/zip';

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return null;
  }
};

// PhiCreate ZIP (project.json + audio, illustration, media, fonts and shaders).
function phicreatePackage(files: Record<string, Uint8Array>): ImportResult | null {
  const data = files[PROJECT_FILE] && parse(strFromU8(files[PROJECT_FILE]));
  const project = fromExport(data);
  if (!project) return null;
  const blob = (path?: string, type = path ? mimeOf(path) : '') =>
    path && files[path] ? new Blob([files[path].slice()], { type }) : undefined;
  const fileBlob = (file: PackageFile) => {
    const b = blob(file.path, file.type);
    return b && file.name ? named(b, file.name) : b;
  };
  const index = (data as ProjectExport).files ?? {};
  project.audio = blob(index.audio);
  project.illustration = blob(index.illustration);

  project.media = {};
  for (const [assetId, file] of Object.entries(index.media ?? {})) {
    const b = fileBlob(file);
    if (b) project.media[assetId] = b;
  }
  project.fonts = {};
  for (const [name, file] of Object.entries(index.fonts ?? {})) {
    const b = blob(file.path, file.type);
    if (b) project.fonts[name] = b;
  }
  project.shaders = {};
  for (const [shader, path] of Object.entries(index.shaders ?? {})) {
    if (files[path]) project.shaders[shader] = strFromU8(files[path]);
  }
  return { project, format: 'phicreate' };
}

// PhiCreate, RPE or official JSON, or a PhiCreate / PEZ / ZIP package.
export async function importProjectFile(file: File): Promise<ImportResult | null> {
  const plain = /\.(json|pec)$/i.test(file.name);
  // PEC is sniffed by content; it is often named .json.
  const text = plain ? await file.text() : '';
  if (plain && isPecText(text)) return { project: pecToProject(text), format: 'pec' };
  if (!plain) {
    let files: Record<string, Uint8Array>;
    try {
      files = await unzipAsync(new Uint8Array(await file.arrayBuffer()));
    } catch {
      return null;
    }
    return phicreatePackage(files) ?? importChartFiles(files);
  }
  const data = parse(text);
  const project = fromExport(data);
  if (project) return { project, format: 'phicreate' };
  if (isOfficialChart(data)) return { project: officialToProject(data), format: 'official' };
  if (!isRpeChart(data)) return null;
  return withNoiseOption((noise) => rpeToProject(data, {}, {}, {}, undefined, {}, { noise }));
}
