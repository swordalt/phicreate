import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LandingPage } from '@/pages/LandingPage/LandingPage';
import { EditorPage } from '@/pages/EditorPage/EditorPage';
import { useProjectStore } from '@/features/projects/useProjectStore';
import { useSettingsStore } from '@/features/settings/useSettingsStore';
import { frameCapFps } from '@/features/settings/types';
import { setFrameCap } from '@/lib/frameLoop';

function useBootstrap() {
  const uiScale = useSettingsStore((s) => s.settings.uiScale);
  const frameCap = useSettingsStore((s) => frameCapFps(s.settings));

  useEffect(() => {
    void (async () => {
      await Promise.all([useProjectStore.getState().load(), useSettingsStore.getState().load()]);
      // Restore last selection if it still exists.
      const { lastProjectId } = useSettingsStore.getState().settings;
      const { projects, select } = useProjectStore.getState();
      if (lastProjectId && projects.some((p) => p.id === lastProjectId)) select(lastProjectId);
    })();
  }, []);

  useEffect(() => {
    document.documentElement.style.zoom = String(Number(uiScale) / 100);
  }, [uiScale]);

  useEffect(() => setFrameCap(frameCap), [frameCap]);
}

export function App() {
  useBootstrap();
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/editor/:projectId" element={<EditorPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
