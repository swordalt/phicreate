import { CHANNELS, type NoteType } from '@/features/chart/model/types';
import type { ImportFormat, Project } from './types';

export const FORMAT_LABELS: Record<ImportFormat, string> = {
  phicreate: 'PhiCreate',
  official: 'Phigros (official)',
  rpe: 'Re:PhiEdit',
  pec: 'PhiEdit',
};

export interface ChartStats {
  lines: number;
  notes: number;
  noteTypes: Record<NoteType, number>;
  fakeNotes: number;
  events: number;
  bpmMin: number;
  bpmMax: number;
  texts: number;
  media: number;
  effects: number;
  noiseFields: number;
  hasAudio: boolean;
  hasIllustration: boolean;
}

export function getChartStats({ chart, audio, illustration }: Project): ChartStats {
  const noteTypes: Record<NoteType, number> = { tap: 0, drag: 0, hold: 0, flick: 0 };
  let notes = 0;
  let fakeNotes = 0;
  let events = 0;
  for (const line of chart.lines) {
    for (const note of line.notes) {
      notes++;
      noteTypes[note.type]++;
      if (note.fake) fakeNotes++;
    }
    for (const layer of line.layers) for (const ch of CHANNELS) events += layer[ch].length;
  }
  const bpms = chart.bpmList.map((p) => p.bpm);
  return {
    lines: chart.lines.length,
    notes,
    noteTypes,
    fakeNotes,
    events,
    bpmMin: bpms.length ? Math.min(...bpms) : 0,
    bpmMax: bpms.length ? Math.max(...bpms) : 0,
    texts: chart.texts.length,
    media: chart.media.length,
    effects: chart.effects.length,
    noiseFields: chart.noiseFields.length,
    hasAudio: !!audio,
    hasIllustration: !!illustration,
  };
}
