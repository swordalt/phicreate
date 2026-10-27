import { create } from 'zustand';
import { createId } from '@/lib/id';
import { setBaseBpm } from '@/features/chart/runtime/commands';
import { createChart } from '@/features/chart/model/defaults';
import { projectRepo } from './projectRepo';
import { createProject } from './projectFactory';
import type { NewProjectInput, Project, ProjectFormValues, ProjectMeta } from './types';

export type MetaPatch = Partial<
  Pick<ProjectMeta, 'name' | 'artist' | 'illustrator' | 'charter' | 'difficulty'>
>;

interface ProjectState {
  projects: ProjectMeta[];
  loaded: boolean;
  selectedId: string | null;
  load: () => Promise<void>;
  select: (id: string | null) => void;
  create: (input: NewProjectInput) => Promise<ProjectMeta>;
  add: (project: Project) => Promise<void>;
  update: (id: string, values: ProjectFormValues) => Promise<void>;
  patchMeta: (id: string, patch: MetaPatch) => Promise<ProjectMeta | undefined>;
  duplicate: (id: string, mode?: 'copy' | 'remix') => Promise<void>;
  remove: (id: string) => Promise<void>;
  touch: (id: string) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  loaded: false,
  selectedId: null,

  async load() {
    set({ projects: await projectRepo.listMeta(), loaded: true });
  },

  select(id) {
    set({ selectedId: id });
  },

  async create(input) {
    const project = createProject(input);
    await get().add(project);
    return project.meta;
  },

  async add(project) {
    await projectRepo.put(project);
    set((s) => ({ projects: [project.meta, ...s.projects], selectedId: project.meta.id }));
  },

  async update(id, values) {
    const source = await projectRepo.get(id);
    if (!source || !values.name.trim()) return;
    const name = values.name.trim();
    const meta: ProjectMeta = {
      ...source.meta,
      name,
      songName: name,
      artist: values.artist.trim(),
      illustrator: values.illustrator.trim(),
      charter: values.charter.trim(),
      difficulty: values.difficulty.trim(),
      updatedAt: Date.now(),
    };
    await projectRepo.put({
      meta,
      chart: setBaseBpm(source.chart, values.bpm),
      audio: values.audio ?? source.audio,
      illustration: values.illustration ?? source.illustration,
    });
    set((s) => ({ projects: [meta, ...s.projects.filter((p) => p.id !== id)] }));
  },

  async patchMeta(id, patch) {
    const source = await projectRepo.getMeta(id);
    if (!source) return;
    const meta: ProjectMeta = {
      ...source,
      ...patch,
      songName: patch.name ?? source.songName,
      updatedAt: Date.now(),
    };
    await projectRepo.updateMeta(meta);
    set((s) => ({ projects: [meta, ...s.projects.filter((p) => p.id !== id)] }));
    return meta;
  },

  async duplicate(id, mode = 'copy') {
    const source = await projectRepo.get(id);
    if (!source) return;
    const now = Date.now();
    const meta: ProjectMeta = {
      ...source.meta,
      id: createId(),
      name: `${source.meta.name} (${mode})`,
      createdAt: now,
      updatedAt: now,
    };
    if (mode === 'remix') {
      // Only BPM changes, metadata and audio / illustration carry over.
      await get().add({
        meta,
        chart: {
          ...createChart(120, 1),
          offsetMs: source.chart.offsetMs,
          bpmList: structuredClone(source.chart.bpmList),
        },
        audio: source.audio,
        illustration: source.illustration,
      });
      return;
    }
    await get().add({
      meta,
      chart: structuredClone(source.chart),
      audio: source.audio,
      illustration: source.illustration,
      media: await projectRepo.getMedia(id),
      shaders: await projectRepo.getShaders(id),
      fonts: await projectRepo.getFonts(id),
    });
  },

  async touch(id) {
    const meta = get().projects.find((p) => p.id === id);
    if (!meta) return;
    const next = { ...meta, updatedAt: Date.now() };
    await projectRepo.updateMeta(next);
    set((s) => ({ projects: [next, ...s.projects.filter((p) => p.id !== id)] }));
  },

  async remove(id) {
    await projectRepo.remove(id);
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    }));
  },
}));
