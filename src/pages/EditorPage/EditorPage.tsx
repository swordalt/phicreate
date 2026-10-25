import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Chart } from '@/features/chart/model/types';
import { useChartStore } from '@/features/chart/runtime/useChartStore';
import { clearLibrary, loadLibrary, useLibraryStore } from '@/features/library/useLibraryStore';
import { projectRepo } from '@/features/projects/projectRepo';
import { useSettingsStore } from '@/features/settings/useSettingsStore';
import { loadPresetShaders, setCustomShaders } from '@/features/shaders/library';
import { Toolbar } from '@/features/editor/Toolbar/Toolbar';
import { EditorGrid } from '@/features/editor/EditorGrid/EditorGrid';
import { Footer } from '@/features/editor/Footer/Footer';
import { ProgressBar } from '@/features/editor/ProgressBar/ProgressBar';
import { ObjectsSidebar } from '@/features/editor/ObjectsSidebar/ObjectsSidebar';
import { SidePanel } from '@/features/editor/SidePanel/SidePanel';
import { playback } from '@/features/editor/playback/playback';
import { setBackground } from '@/features/editor/preview/background';
import { syncFonts } from '@/features/editor/preview/fonts';
import { clearMedia, loadMedia } from '@/features/editor/preview/media';
import { usePlaybackLoop } from '@/features/editor/playback/usePlaybackLoop';
import { useAutosave } from '@/features/editor/useAutosave';
import { useEditorShortcuts } from '@/features/editor/useEditorShortcuts';
import { useEditorStore } from '@/features/editor/useEditorStore';
import styles from './EditorPage.module.css';

// Decodes referenced media files; unused ones stay in the library.
async function loadProjectMedia(projectId: string, media: Chart['media']) {
  const used = new Set(media.flatMap((m) => (m.assetId ? [m.assetId] : [])));
  const blobs = await projectRepo.getMedia(projectId);
  for (const assetId of used) if (blobs[assetId]) void loadMedia(assetId, blobs[assetId]);
}

type LoadState = { status: 'loading' } | { status: 'missing' } | { status: 'ready' };

export function EditorPage() {
  const { projectId } = useParams();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useAutosave();
  usePlaybackLoop();
  useEditorShortcuts();

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const unsubFonts = useLibraryStore.subscribe((s) => syncFonts(s.fonts));
    setState({ status: 'loading' });
    // Presets are read synchronously while editing.
    void Promise.all([projectRepo.get(projectId), loadPresetShaders()]).then(([project]) => {
      if (cancelled) return;
      if (!project) return setState({ status: 'missing' });
      useChartStore.getState().load(projectId, project.chart);
      useEditorStore.getState().reset(project.chart.lines[0]?.id ?? null);
      useEditorStore
        .getState()
        .set({ projectName: project.meta.name, difficulty: project.meta.difficulty });
      playback.load(project.audio);
      void setBackground(project.illustration);
      void loadProjectMedia(projectId, project.chart.media);
      void loadLibrary(projectId);
      void projectRepo.getShaders(projectId).then((s) => !cancelled && setCustomShaders(s));
      useSettingsStore.getState().update({ lastProjectId: projectId });
      setState({ status: 'ready' });
    });
    return () => {
      cancelled = true;
      unsubFonts();
      syncFonts({});
      playback.unload();
      void setBackground();
      clearMedia();
      clearLibrary();
      setCustomShaders({});
    };
  }, [projectId]);

  if (state.status !== 'ready') {
    return (
      <div className={styles.message}>
        <p>{state.status === 'loading' ? 'Loading…' : 'Project not found.'}</p>
        <Link to="/">← Back to projects</Link>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Toolbar />
        <ProgressBar />
      </div>
      <div className={styles.body}>
        <ObjectsSidebar />
        <EditorGrid />
        <SidePanel />
      </div>
      <Footer />
    </div>
  );
}
