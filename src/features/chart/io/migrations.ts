import { createChart, withDefaults } from '../model/defaults';
import type { Chart } from '../model/types';
import { ABOVE_NOTES } from '../model/zOrder';

// Pre-PCC stub shape.
interface LegacyChart {
  bpm?: number;
  offsetMs?: number;
  judgeLines?: unknown[];
}

// v1 texts and media drew below every line (z < 0) or above notes (z >= 0).
const lift = <T extends { zOrder: number }>(o: T): T =>
  (o.zOrder ?? 0) >= 0 ? { ...o, zOrder: (o.zOrder ?? 0) + ABOVE_NOTES } : o;

const migrations: Record<number, (old: Chart) => Chart> = {
  1: (c) => ({
    ...c,
    formatVersion: 2,
    texts: (c.texts ?? []).map(lift),
    media: (c.media ?? []).map(lift),
  }),
};

export function migrateChart(raw: unknown): Chart {
  const data = (raw ?? {}) as Partial<Chart> & LegacyChart;
  let chart: Chart;
  if (typeof data.formatVersion !== 'number') {
    chart = createChart(data.bpm ?? 120, data.judgeLines?.length ?? 1);
    chart.offsetMs = data.offsetMs ?? 0;
  } else {
    chart = data as Chart;
    for (let v = chart.formatVersion; migrations[v]; v++) chart = migrations[v](chart);
  }
  return withDefaults(chart);
}
