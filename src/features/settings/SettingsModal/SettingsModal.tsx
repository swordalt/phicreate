import { useState, type ReactNode } from 'react';
import {
  Button,
  DownloadIcon,
  EyeIcon,
  Modal,
  PencilIcon,
  Segmented,
  Select,
  Slider,
  SlidersIcon,
  Toggle,
  TrashIcon,
  UploadIcon,
  VolumeIcon,
} from '@/components/ui';
import { clearAppData, exportAppData, importAppData } from '@/features/backup/appDataBackup';
import { useProjectStore } from '@/features/projects/useProjectStore';
import { downloadBlob, pickFile } from '@/lib/file';
import { useSettingsStore } from '../useSettingsStore';
import type { HitEffects, JudgeStatus, Language, NoiseQuality, SelectMode, Settings, UiScale } from '../types';
import styles from './SettingsModal.module.css';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type Tab = 'general' | 'audio' | 'editing' | 'preview';

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'general', label: 'General', icon: <SlidersIcon /> },
  { id: 'audio', label: 'Audio', icon: <VolumeIcon /> },
  { id: 'editing', label: 'Editing', icon: <PencilIcon /> },
  { id: 'preview', label: 'Preview', icon: <EyeIcon /> },
];

const LARGE_ARCHIVE_MB = 100;

const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [{ value: 'en', label: 'English' }];

const SCALE_OPTIONS: { value: UiScale; label: string }[] = [
  { value: '90', label: '90%' },
  { value: '100', label: '100%' },
  { value: '110', label: '110%' },
  { value: '125', label: '125%' },
];

const SELECT_OPTIONS: { value: SelectMode; label: string }[] = [
  { value: 'box', label: 'Box' },
  { value: 'line', label: 'Line' },
];

const NOISE_OPTIONS: { value: NoiseQuality; label: string }[] = [
  { value: 'simplified', label: 'Simplified' },
  { value: 'original', label: 'Original' },
];

const HIT_OPTIONS: { value: HitEffects; label: string }[] = [
  { value: 'always', label: 'Always' },
  { value: 'preview', label: 'Preview only' },
  { value: 'never', label: 'Never' },
];

const JUDGE_OPTIONS: { value: JudgeStatus; label: string }[] = [
  { value: 'ap', label: 'AP' },
  { value: 'fc', label: 'FC' },
  { value: 'none', label: 'None' },
];

const percent = (v: number) => `${Math.round(v * 100)}%`;

type Update = (patch: Partial<Settings>) => void;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>{title}</h3>
      <div className={styles.rows}>{children}</div>
    </section>
  );
}

function DataSection() {
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  };

  const exportData = () =>
    run(async () => {
      const archive = await exportAppData();
      downloadBlob(archive, 'phicreate-backup.zip');
      const mb = archive.size / 1024 / 1024;
      setMessage(
        mb >= LARGE_ARCHIVE_MB
          ? `Exported ${mb.toFixed(0)} MB. For large libraries, exporting individual projects from Manage may be more efficient.`
          : 'Data exported.',
      );
    });

  const importData = () =>
    run(async () => {
      const file = await pickFile('.zip,application/zip');
      if (!file) return;
      if (await importAppData(file)) {
        await Promise.all([useProjectStore.getState().load(), useSettingsStore.getState().load()]);
        setMessage('Data imported.');
      } else setMessage('Not a valid PhiCreate backup archive.');
    });

  // Reload so no open editor autosaves the deleted project back.
  const deleteData = () =>
    run(async () => {
      await clearAppData();
      window.location.replace(import.meta.env.BASE_URL);
    });

  return (
    <Section title="Data">
      <p className={styles.note}>
        All projects and settings are stored locally in this browser. Imported projects overwrite
        ones with the same id.
      </p>
      <div className={styles.actions}>
        <Button size="sm" onClick={exportData} disabled={busy}>
          <DownloadIcon /> Export data
        </Button>
        <Button size="sm" onClick={importData} disabled={busy}>
          <UploadIcon /> Import data
        </Button>
        {!confirming && (
          <Button size="sm" variant="danger" onClick={() => setConfirming(true)} disabled={busy}>
            <TrashIcon /> Delete data
          </Button>
        )}
      </div>
      {confirming && (
        <div className={styles.confirm}>
          <span>Delete every project and setting? This cannot be undone.</span>
          <div className={styles.actions}>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" onClick={deleteData} disabled={busy}>
              Delete everything
            </Button>
          </div>
        </div>
      )}
      {message && <span className={styles.message}>{message}</span>}
    </Section>
  );
}

function GeneralTab({ settings, update }: { settings: Settings; update: Update }) {
  return (
    <>
      <Section title="Interface">
        <Select
          label="Language"
          value={settings.language}
          options={LANGUAGE_OPTIONS}
          onChange={(language) => update({ language })}
        />
        <Select
          label="UI scale"
          value={settings.uiScale}
          options={SCALE_OPTIONS}
          onChange={(uiScale) => update({ uiScale })}
        />
        <Toggle
          label="Show FPS counter"
          hint="Shown in the editor footer."
          checked={settings.showFps}
          onChange={(showFps) => update({ showFps })}
        />
      </Section>
      <DataSection />
    </>
  );
}

function AudioTab({ settings, update }: { settings: Settings; update: Update }) {
  return (
    <Section title="Volume">
      <Slider
        label="Music"
        value={settings.musicVolume}
        format={percent}
        onChange={(musicVolume) => update({ musicVolume })}
      />
      <Slider
        label="Hitsounds"
        hint="Set to 0% to mute hitsounds."
        value={settings.hitsoundVolume}
        format={percent}
        onChange={(hitsoundVolume) => update({ hitsoundVolume })}
      />
    </Section>
  );
}

function EditingTab({ settings, update }: { settings: Settings; update: Update }) {
  return (
    <Section title="Grid">
      <Toggle
        label="Event trajectory curves"
        hint="Draw each event's easing curve in the event grid."
        checked={settings.eventCurves}
        onChange={(eventCurves) => update({ eventCurves })}
      />
      <Segmented
        label="Multi-select"
        hint="Drag a box, or draw a line through notes and events."
        value={settings.selectMode}
        options={SELECT_OPTIONS}
        onChange={(selectMode) => update({ selectMode })}
      />
      <Toggle
        label="Bearing marker"
        hint="Mark the selected object's origin, pointing up along its rotation."
        checked={settings.bearingMarker}
        onChange={(bearingMarker) => update({ bearingMarker })}
      />
    </Section>
  );
}

function PreviewTab({ settings, update }: { settings: Settings; update: Update }) {
  return (
    <>
      <Section title="Rendering">
        <Select
          label="Noise field quality"
          hint="Original matches the game's shaded look but is slower."
          value={settings.noiseQuality}
          options={NOISE_OPTIONS}
          onChange={(noiseQuality) => update({ noiseQuality })}
        />
        <Toggle
          label="Blur background"
          hint="Blur the illustration behind the chart."
          checked={settings.backgroundBlur}
          onChange={(backgroundBlur) => update({ backgroundBlur })}
        />
        <Toggle
          label="Highlight simultaneous notes"
          hint="Use highlight textures for notes that share a hit time."
          checked={settings.highlightSimultaneous}
          onChange={(highlightSimultaneous) => update({ highlightSimultaneous })}
        />
        <Toggle
          label="Highlight selection"
          hint="Tint the selected judge line green and outline the selected noise field."
          checked={settings.highlightSelected}
          onChange={(highlightSelected) => update({ highlightSelected })}
        />
      </Section>
      <Section title="Color">
        <Segmented
          label="AP/FC indicator"
          hint="Default color of judge lines without a color event."
          value={settings.judgeStatus}
          options={JUDGE_OPTIONS}
          onChange={(judgeStatus) => update({ judgeStatus })}
        />
      </Section>
      <Section title="Effects">
        <Segmented
          label="Hit effects"
          hint="Preview only hides them under the editing grid."
          value={settings.hitEffects}
          options={HIT_OPTIONS}
          onChange={(hitEffects) => update({ hitEffects })}
        />
      </Section>
    </>
  );
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const reset = useSettingsStore((s) => s.reset);
  const [tab, setTab] = useState<Tab>('general');

  const content = { settings, update };

  return (
    <Modal
      open={open}
      title="Settings"
      onClose={onClose}
      width={760}
      footer={
        <>
          <Button variant="ghost" onClick={reset}>
            Reset to defaults
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className={styles.layout}>
        <nav className={styles.nav} role="tablist" aria-orientation="vertical">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={styles.tab}
              onClick={() => setTab(t.id)}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
        <div className={styles.panel} role="tabpanel">
          {tab === 'general' && <GeneralTab {...content} />}
          {tab === 'audio' && <AudioTab {...content} />}
          {tab === 'editing' && <EditingTab {...content} />}
          {tab === 'preview' && <PreviewTab {...content} />}
        </div>
      </div>
    </Modal>
  );
}
