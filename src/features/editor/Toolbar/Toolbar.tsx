import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Button,
  DownloadIcon,
  FolderIcon,
  FullscreenIcon,
  IconButton,
  SettingsIcon,
} from '@/components/ui';
import { lineDescendants, patchOwner, setLineAnchor } from '@/features/chart/runtime/commands';
import { useChartStore } from '@/features/chart/runtime/useChartStore';
import { LibraryModal } from '@/features/library/LibraryModal/LibraryModal';
import { useLibraryStore } from '@/features/library/useLibraryStore';
import { ExportModal } from '@/features/projects/ExportModal/ExportModal';
import { projectRepo } from '@/features/projects/projectRepo';
import { SettingsModal } from '@/features/settings/SettingsModal/SettingsModal';
import { parseNumber } from '@/lib/number';
import { CommitInput } from '../CommitInput';
import { useEditorStore } from '../useEditorStore';
import { ASPECTS, MAX_DIVISION, MAX_FOV, MIN_FOV, PLAYBACK_RATES } from '../types';
import { togglePreviewFullscreen } from '../preview/PreviewCanvas';
import { NoteDefaultsModal } from './NoteDefaultsModal';
import styles from './Toolbar.module.css';

const SAVE_LABELS = { saved: 'Saved', unsaved: 'Unsaved', saving: 'Saving…' };

export function Toolbar() {
  return (
    <header className={styles.toolbar}>
      <SongSection />
      <EditorSection />
      <PlaybackSection />
    </header>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function SongSection() {
  const projectName = useEditorStore((s) => s.projectName);
  const saveStatus = useEditorStore((s) => s.saveStatus);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // Stored project with the editor's (possibly unsaved) chart.
  const loadProject = async () => {
    const { chart } = useChartStore.getState();
    const { projectId } = useLibraryStore.getState();
    const project = projectId ? await projectRepo.get(projectId) : undefined;
    return project && chart ? { ...project, chart } : null;
  };

  return (
    <section className={`${styles.section} ${styles.song}`}>
      <div className={styles.songRow}>
        <Link to="/" className={styles.back} title="Back to projects">
          ←
        </Link>
        <span className={styles.name}>{projectName}</span>
      </div>
      <div className={styles.songRow}>
        <span className={styles.save}>{SAVE_LABELS[saveStatus]}</span>
        <div className={styles.actions}>
          <IconButton label="Library" onClick={() => setLibraryOpen(true)}>
            <FolderIcon />
          </IconButton>
          <IconButton label="Export project" onClick={() => setExportOpen(true)}>
            <DownloadIcon />
          </IconButton>
          <IconButton label="Settings" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon />
          </IconButton>
        </div>
      </div>
      <LibraryModal open={libraryOpen} onClose={() => setLibraryOpen(false)} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} load={loadProject} />
    </section>
  );
}

const parseAnchor = (text: string): [number, number] | null => {
  const parts = text
    .trim()
    .split(/[\s,]+/)
    .map(parseNumber);
  return parts.length === 2 && parts[0] !== null && parts[1] !== null ? [parts[0], parts[1]] : null;
};

function EditorSection() {
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const division = useEditorStore((s) => s.division);
  const lanes = useEditorStore((s) => s.lanes);
  const snapX = useEditorStore((s) => s.snapX);
  const snapY = useEditorStore((s) => s.snapY);
  const set = useEditorStore((s) => s.set);
  const selectedId = useEditorStore((s) => s.selectedLineId);
  const selectedObjectId = useEditorStore((s) => s.selectedObjectId);
  const lines = useChartStore((s) => s.chart?.lines);
  const texts = useChartStore((s) => s.chart?.texts);
  const media = useChartStore((s) => s.chart?.media);
  const noiseFields = useChartStore((s) => s.chart?.noiseFields);
  const apply = useChartStore((s) => s.apply);
  const line = lines?.find((l) => l.id === selectedId);
  const owner =
    line ??
    texts?.find((t) => t.id === selectedObjectId) ??
    media?.find((m) => m.id === selectedObjectId) ??
    noiseFields?.find((f) => f.id === selectedObjectId);
  const blocked = lines && line ? lineDescendants(lines, line.id) : new Set<string>();

  return (
    <section className={`${styles.section} ${styles.labeled}`}>
      <span className={styles.title}>Editing</span>
      <div className={styles.row}>
        <div className={styles.stack}>
          <label className={styles.inline}>
            <span>Snap X</span>
            <CommitInput
              className={styles.narrow}
              value={String(lanes)}
              inputMode="numeric"
              onCommit={(text) => {
                const v = parseNumber(text);
                if (!v || v < 1 || v > 64) return false;
                set({ lanes: Math.round(v) });
              }}
            />
            <input
              type="checkbox"
              title="Snap X"
              checked={snapX}
              onChange={(e) => set({ snapX: e.target.checked })}
            />
          </label>
          <label className={styles.inline}>
            <span>Snap Y</span>
            <CommitInput
              className={styles.narrow}
              title="Divisions per beat"
              value={String(division)}
              inputMode="numeric"
              onCommit={(text) => {
                const v = parseNumber(text);
                if (!v || v < 1 || v > MAX_DIVISION) return false;
                set({ division: Math.round(v) });
              }}
            />
            <input
              type="checkbox"
              title="Snap Y"
              checked={snapY}
              onChange={(e) => set({ snapY: e.target.checked })}
            />
          </label>
        </div>

        <Button onClick={() => setDefaultsOpen(true)}>Note defaults</Button>
        <NoteDefaultsModal open={defaultsOpen} onClose={() => setDefaultsOpen(false)} />

        <Field label="Parent">
          <select
            value={owner?.parentId ?? ''}
            disabled={!owner}
            onChange={(e) => {
              const parentId = e.target.value || null;
              if (owner) apply((c) => patchOwner(c, owner.id, { parentId }));
            }}
          >
            <option value="">None</option>
            {lines
              ?.filter((l) => !blocked.has(l.id))
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        </Field>

        <Field label="Anchor">
          <CommitInput
            disabled={!line}
            title="x y: 0 = left / bottom, 1 = right / top"
            value={line ? line.anchor.join(' ') : ''}
            onCommit={(text) => {
              const anchor = parseAnchor(text);
              if (!anchor || !line) return false;
              apply((c) => setLineAnchor(c, line.id, anchor));
            }}
          />
        </Field>
      </div>
    </section>
  );
}

function PlaybackSection() {
  const rate = useEditorStore((s) => s.rate);
  const aspect = useEditorStore((s) => s.aspect);
  const fov = useEditorStore((s) => s.fov);
  const shaders = useEditorStore((s) => s.shaders);
  const showUI = useEditorStore((s) => s.showUI);
  const showText = useEditorStore((s) => s.showText);
  const showMedia = useEditorStore((s) => s.showMedia);
  const showNoise = useEditorStore((s) => s.showNoise);
  const set = useEditorStore((s) => s.set);
  const setRate = useEditorStore((s) => s.setRate);
  const aspectIndex = ASPECTS.findIndex((a) => a.value === aspect);

  return (
    <section className={`${styles.section} ${styles.labeled}`}>
      <span className={styles.title}>Preview</span>
      <div className={styles.row}>
        <Field label="Speed">
          <span className={styles.pair}>
            <select
              value={PLAYBACK_RATES.includes(rate) ? rate : ''}
              onChange={(e) => setRate(Number(e.target.value))}
            >
              {!PLAYBACK_RATES.includes(rate) && <option value="">Custom</option>}
              {PLAYBACK_RATES.map((s) => (
                <option key={s} value={s}>
                  {s}x
                </option>
              ))}
            </select>
          </span>
        </Field>

        <Field label="Aspect ratio">
          <select
            value={aspectIndex}
            onChange={(e) => set({ aspect: ASPECTS[Number(e.target.value)].value })}
          >
            {ASPECTS.map((a, i) => (
              <option key={a.label} value={i}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Field of view">
          <CommitInput
            className={styles.narrow}
            title="1 = normal; smaller zooms in, larger shows out of bounds"
            value={String(fov)}
            inputMode="decimal"
            onCommit={(text) => {
              const v = parseNumber(text);
              if (!v || v < MIN_FOV || v > MAX_FOV) return false;
              set({ fov: v });
            }}
          />
        </Field>

        <Field label="Shaders">
          <input
            type="checkbox"
            title="Preview shader effects"
            checked={shaders}
            onChange={(e) => set({ shaders: e.target.checked })}
          />
        </Field>
        <Field label="UI Elements">
          <input
            type="checkbox"
            title="Show UI elements"
            checked={showUI}
            onChange={(e) => set({ showUI: e.target.checked })}
          />
        </Field>
        <Field label="Text">
          <input
            type="checkbox"
            title="Show text"
            checked={showText}
            onChange={(e) => set({ showText: e.target.checked })}
          />
        </Field>
        <Field label="Media">
          <input
            type="checkbox"
            title="Show media"
            checked={showMedia}
            onChange={(e) => set({ showMedia: e.target.checked })}
          />
        </Field>
        <Field label="Noise Fields">
          <input
            type="checkbox"
            title="Show noise fields"
            checked={showNoise}
            onChange={(e) => set({ showNoise: e.target.checked })}
          />
        </Field>
        <IconButton label="Fullscreen preview (F)" onClick={togglePreviewFullscreen}>
          <FullscreenIcon />
        </IconButton>
      </div>
    </section>
  );
}
