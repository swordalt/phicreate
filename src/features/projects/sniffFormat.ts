import { isPecText } from '@/features/chart/io/pec/fromPec';
import type { ImportFormat } from './types';

export const SNIFF_BYTES = 4096;

// 'json' = a JSON object the head can't identify (needs a full parse); null = not a chart.
export type Sniffed = ImportFormat | 'json' | null;

// Top-level keys that each format writes first.
const PHICREATE = /"format"\s*:\s*"phicreate-project"/;
const RPE = /"(BPMList|META)"\s*:|"RPEVersion"\s*:/;
const OFFICIAL = /"formatVersion"\s*:\s*\d/;

// Guesses a chart's format from the start of its text, without parsing it.
export function sniffFormat(head: string): Sniffed {
  const text = head.slice(0, SNIFF_BYTES);
  if (!/^﻿?\s*\{/.test(text)) return isPecText(text) ? 'pec' : null;
  if (PHICREATE.test(text)) return 'phicreate';
  if (RPE.test(text)) return 'rpe';
  if (OFFICIAL.test(text)) return 'official';
  return 'json';
}
