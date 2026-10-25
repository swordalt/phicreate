import { useEffect } from 'react';
import { removeEvents, removeNotes } from '@/features/chart/runtime/commands';
import { useChartStore } from '@/features/chart/runtime/useChartStore';
import { copySelection, pasteClipboard } from './clipboard';
import { useEditorStore } from './useEditorStore';
import { beatToMusicTime, musicTimeToBeat } from './time';
import { ownerEvents } from './events';
import { togglePreviewFullscreen } from './preview/PreviewCanvas';
import { currentLine, currentTarget } from './grid/useGridCanvas';

// Checkboxes don't take typed input, so shortcuts still fire while one is focused.
export const isTyping = (e: KeyboardEvent) =>
  e.target instanceof HTMLElement &&
  e.target.closest('input:not([type="checkbox"]), select, textarea') !== null;

export function useEditorShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const editor = useEditorStore.getState();
      const charts = useChartStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // Fullscreen preview only keeps play/pause, stepping and the fullscreen toggle.
      if (
        document.fullscreenElement &&
        !['f', 'arrowup', 'arrowdown'].includes(key) &&
        e.code !== 'Space'
      )
        return;

      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) charts.redo();
        else charts.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        charts.redo();
        return;
      }
      if (mod && key === 'a') {
        e.preventDefault();
        if (editor.activeGrid === 'events') {
          const target = currentTarget(charts.chart);
          const events = target ? ownerEvents(target.owner, target.layer) : [];
          editor.selectEvents(events.map((x) => x.event.id));
        } else {
          editor.selectNotes(currentLine(charts.chart)?.notes.map((n) => n.id) ?? []);
        }
        return;
      }
      if (mod && (key === 'c' || key === 'x')) {
        e.preventDefault();
        copySelection(key === 'x');
        return;
      }
      if (mod && key === 'v') {
        e.preventDefault();
        pasteClipboard();
        return;
      }
      if (mod) return;

      if (e.code === 'Space') {
        e.preventDefault();
        void editor.togglePlay();
      } else if (key === 'delete' || key === 'backspace') {
        const { selectedLineId, selectedNoteIds, selectedEventIds } = editor;
        if (editor.activeGrid === 'events') {
          const target = currentTarget(charts.chart);
          if (!target || !selectedEventIds.length) return;
          const { owner, layerId } = target;
          charts.apply((c) => removeEvents(c, owner.id, layerId, selectedEventIds));
          editor.selectEvents([]);
        } else if (selectedLineId && selectedNoteIds.length) {
          charts.apply((c) => removeNotes(c, selectedLineId, selectedNoteIds));
          editor.selectNotes([]);
        }
      } else if (key === 'arrowup' || key === 'arrowdown') {
        // Step one grid division.
        e.preventDefault();
        const chart = charts.chart;
        if (!chart) return;
        const step = 1 / editor.division;
        const beat = musicTimeToBeat(chart, editor.time);
        const snapped =
          key === 'arrowup'
            ? Math.floor(beat / step + 1e-6) * step + step
            : Math.ceil(beat / step - 1e-6) * step - step;
        editor.seek(beatToMusicTime(chart, snapped));
      } else if (key === 'i') {
        editor.set({ mode: 'preview' });
      } else if (key === 'f') {
        togglePreviewFullscreen();
      } else if (key === 'p') {
        editor.set({ mode: 'edit' });
      } else if (key === 'escape') {
        // Clears a selection first; with none, closes the object properties.
        if (editor.selectedNoteIds.length || editor.selectedEventIds.length) {
          editor.selectNotes([]);
          editor.selectEvents([]);
        } else {
          editor.set({ objectPanelOpen: false });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
