import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BUILTIN_TEXTS, CHANNELS } from '@/features/chart/model/types';
import type { EventLayer } from '@/features/chart/model/types';
import { useChartStore } from '@/features/chart/runtime/useChartStore';
import { useSettingsStore } from '@/features/settings/useSettingsStore';
import { useEditorStore } from '../useEditorStore';
import styles from './Footer.module.css';

const CHANNEL_LABELS = {
  moveX: 'Move X',
  moveY: 'Move Y',
  rotate: 'Rotate',
  alpha: 'Alpha',
  speed: 'Speed',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
} as const;

type Row = [label: string, count: number];

function Stat({
  label,
  rows,
  hideEmpty,
  children,
}: {
  label: string;
  rows: Row[];
  hideEmpty?: boolean;
  children: ReactNode;
}) {
  const shown = hideEmpty ? rows.filter(([, count]) => count > 0) : rows;
  const hidden = rows.length - shown.length;
  return (
    <span className={styles.stat} aria-label={label}>
      {children}
      <span className={styles.popover} role="tooltip">
        {shown.map(([name, count]) => (
          <span key={name} className={styles.row}>
            <span>{name}</span>
            <span className={styles.count}>{count}</span>
          </span>
        ))}
        {hidden > 0 && (
          <span className={styles.note}>
            {hidden} {hidden === 1 ? 'type' : 'types'} with none are hidden
          </span>
        )}
      </span>
    </span>
  );
}

function FpsCounter() {
  const [fps, setFps] = useState(0);

  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let last = performance.now();
    const tick = (now: number) => {
      frames++;
      if (now - last >= 500) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <span className={styles.fps}>{fps} FPS</span>;
}

const layerCount = (layers: EventLayer[], channel: (typeof CHANNELS)[number]) =>
  layers.reduce((n, y) => n + y[channel].length, 0);

export function Footer() {
  const chart = useChartStore((s) => s.chart);
  const selected = useEditorStore((s) => s.selectedNoteIds.length);
  const showFps = useSettingsStore((s) => s.settings.showFps);
  const hasAudio = useEditorStore((s) => s.duration > 0);

  const lines = chart?.lines ?? [];
  const texts = chart?.texts ?? [];
  const media = chart?.media ?? [];
  const effects = chart?.effects ?? [];
  const noiseFields = chart?.noiseFields ?? [];

  const allNotes = lines.reduce((n, l) => n + l.notes.length, 0);
  const fakeNotes = lines.reduce((n, l) => n + l.notes.filter((x) => x.fake).length, 0);

  const ui = texts.filter((t) => t.builtin && BUILTIN_TEXTS.includes(t.builtin)).length;
  const objects = lines.length + texts.length + media.length + effects.length + noiseFields.length;

  const layered = [...lines, ...texts, ...media, ...noiseFields];
  const channelRows: Row[] = CHANNELS.map((c) => [
    CHANNEL_LABELS[c],
    layered.reduce((n, o) => n + layerCount(o.layers, c), 0),
  ]);
  const eventRows: Row[] = [
    ...channelRows,
    [
      'Color',
      lines.reduce((n, o) => n + o.color.length, 0) +
        texts.reduce((n, o) => n + o.color.length, 0) +
        media.reduce((n, o) => n + o.color.length, 0),
    ],
    ['Text', texts.reduce((n, t) => n + t.value.length, 0)],
    ['Media start', media.reduce((n, m) => n + m.starts.length, 0)],
    ['Visible', noiseFields.reduce((n, f) => n + f.visible.length, 0)],
    [
      'Active',
      noiseFields.reduce((n, f) => n + f.active.length, 0) +
        effects.reduce((n, e) => n + e.active.length, 0),
    ],
    [
      'Shader variable',
      effects.reduce((n, e) => n + Object.values(e.vars).reduce((k, v) => k + v.length, 0), 0),
    ],
  ];
  const events = eventRows.reduce((n, [, c]) => n + c, 0);

  return (
    <footer className={styles.footer}>
      <span className={styles.brand}>PhiCreate Beta</span>
      <Stat
        label="Notes breakdown"
        rows={[
          ['Real', allNotes - fakeNotes],
          ['Fake', fakeNotes],
        ]}
      >
        {allNotes} notes
      </Stat>
      <Stat
        hideEmpty
        label="Objects breakdown"
        rows={[
          ['Judgement lines', lines.length],
          ['UI elements', ui],
          ['Text', texts.length - ui],
          ['Media', media.length],
          ['Shaders', effects.length],
          ['Noise fields', noiseFields.length],
        ]}
      >
        {objects} objects
      </Stat>
      <Stat hideEmpty label="Events breakdown" rows={eventRows}>
        {events} events
      </Stat>
      <span className={styles.end}>
        {selected > 0 && <span>{selected} selected</span>}
        {!hasAudio && <span>No audio</span>}
        {showFps && <FpsCounter />}
      </span>
    </footer>
  );
}
