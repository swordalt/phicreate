import { useEffect, useState } from 'react';
import { Button, Modal, Toggle } from '@/components/ui';
import { FORMAT_LABELS, getChartStats } from '../chartStats';
import type { ImportResult } from '../types';
import styles from './ImportConfirmModal.module.css';

export interface ImportOptions {
  // Keep converted rpe-next noise fields.
  noise: boolean;
}

interface ImportConfirmModalProps {
  result: ImportResult | null;
  onConfirm: (options: ImportOptions) => void;
  onCancel: () => void;
}

const yesNo = (v: boolean) => (v ? 'Yes' : 'No');

export function ImportConfirmModal({ result, onConfirm, onCancel }: ImportConfirmModalProps) {
  const [noise, setNoise] = useState(true);
  useEffect(() => setNoise(true), [result]);
  const hasNoise = result?.format === 'rpe' && result.project.chart.noiseFields.length > 0;
  const rows: [string, string | number][] = [];
  if (result) {
    const { project, format } = result;
    const s = getChartStats(project);
    const { name, artist, charter, difficulty } = project.meta;
    const bpm = s.bpmMin === s.bpmMax ? `${s.bpmMin}` : `${s.bpmMin} – ${s.bpmMax}`;
    rows.push(
      ['Format', FORMAT_LABELS[format]],
      ['Name', name],
      ['Artist', artist || '—'],
      ['Charter', charter || '—'],
      ['Difficulty', difficulty || '—'],
      ['BPM', bpm],
      ['Judge lines', s.lines],
      [
        'Notes',
        `${s.notes} (${s.noteTypes.tap} tap, ${s.noteTypes.drag} drag, ${s.noteTypes.hold} hold, ${s.noteTypes.flick} flick)`,
      ],
      ['Fake notes', s.fakeNotes],
      ['Line events', s.events],
      ['Texts / media / effects', `${s.texts} / ${s.media} / ${s.effects}`],
      ['Block areas', s.noiseFields],
      ['Audio', yesNo(s.hasAudio)],
      ['Illustration', yesNo(s.hasIllustration)],
    );
  }

  return (
    <Modal
      open={!!result}
      title="Is this the right chart?"
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onConfirm({ noise })}>
            Import
          </Button>
        </>
      }
    >
      <dl className={styles.list}>
        {rows.map(([label, value]) => (
          <div key={label} className={styles.row}>
            <dt className={styles.label}>{label}</dt>
            <dd className={styles.value}>{value}</dd>
          </div>
        ))}
      </dl>
      {hasNoise && (
        <div className={styles.options}>
          <Toggle
            label="Convert noise fields"
            hint="RPE-Next block areas. Link groups and noise layers are dropped."
            checked={noise}
            onChange={setNoise}
          />
        </div>
      )}
    </Modal>
  );
}
