import type { Chart } from '@/features/chart/model/types';

export const PROJECT_SCHEMA_VERSION = 2;

export interface ProjectMeta {
  id: string;
  name: string;
  songName: string;
  artist: string;
  illustrator: string;
  charter: string;
  difficulty: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
}

export type AssetKind = 'audio' | 'illustration';

export interface ProjectAssets {
  audio?: Blob;
  illustration?: Blob;
}

// Media object files by asset id.
export type MediaBlobs = Record<string, Blob>;

// Font files by file name.
export type FontFiles = Record<string, Blob>;

// Custom shader sources by path ('/name.glsl').
export type ShaderSources = Record<string, string>;

export interface Project extends ProjectAssets {
  meta: ProjectMeta;
  chart: Chart;
  // Omitted on put = keep the stored media / shaders / fonts.
  media?: MediaBlobs;
  shaders?: ShaderSources;
  fonts?: FontFiles;
}

export type ImportFormat = 'phicreate' | 'official' | 'rpe';

export interface ImportResult {
  project: Project;
  format: ImportFormat;
  // Same chart with noise fields left unconverted; set when `project` has any.
  withoutNoise?: () => Project;
}

export type ProjectFormValues = Pick<
  ProjectMeta,
  'name' | 'artist' | 'illustrator' | 'charter' | 'difficulty'
> &
  ProjectAssets & { bpm: number };

export type NewProjectInput = ProjectFormValues & { lines: number };

export interface ProjectExport {
  format: 'phicreate-project';
  version: number;
  meta: ProjectMeta;
  chart: Chart;
  // Package file paths (PhiCreate zip only).
  files?: PackageFiles;
}

export interface PackageFile {
  path: string;
  type: string;
  // Original file name, if any.
  name?: string;
}

export interface PackageFiles {
  audio?: string;
  illustration?: string;
  // By asset id.
  media?: Record<string, PackageFile>;
  // By font file name.
  fonts?: Record<string, PackageFile>;
  // Shader path ('/name.glsl') -> package path.
  shaders?: Record<string, string>;
}
