import { useState } from 'react';
import { Button } from '@/components/ui';
import { parse, toFloat } from '@/features/chart/model/beat';
import type { Chart } from '@/features/chart/model/types';
import {
  EVENT_ATTRS,
  MULTI_OPS,
  NOTE_ATTRS,
  isTimeAttr,
  multiEditEvents,
  multiEditNotes,
  parseSequence,
  type EventAttr,
  type EventTarget,
  type MultiOp,
  type NoteAttr,
  type Ramp,
} from '@/features/chart/runtime/multiEdit';
import { useChartStore } from '@/features/chart/runtime/useChartStore';
import { parseNumber } from '@/lib/number';
import { useEditorStore } from '../useEditorStore';
import { EasingSelect } from './EasingSelect';
import { Row } from './fields';
import styles from './SidePanel.module.css';

const NOTE_LABELS: Record<NoteAttr, string> = {
  x: 'X',
  speed: 'Speed',
  size: 'Size',
  yOffset: 'Y offset',
  visibleTime: 'Visible time',
  alpha: 'Alpha',
  start: 'Start time',
  end: 'End time',
  line: 'Line (index)',
};

const TARGET_LABELS: Record<EventTarget, string> = {
  moveX: 'X',
  moveY: 'Y',
  rotate: 'Rotation',
  alpha: 'Alpha',
  speed: 'Speed',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
  all: 'All',
};

const EVENT_LABELS: Record<EventAttr, string> = {
  values: 'Start & end values',
  from: 'Start value',
  to: 'End value',
  start: 'Start time',
  end: 'End time',
  easing: 'Easing',
};

interface RampDraft {
  lower: string;
  upper: string;
  op: MultiOp;
  easing: number;
  sequence: string;
}

const INITIAL: RampDraft = { lower: '0', upper: '0', op: 'add', easing: 1, sequence: '1' };

// Time attributes accept beats ("1:1/2"); null if any field is malformed.
function toRamp(d: RampDraft, time: boolean): Ramp | null {
  const num = (text: string) => {
    if (!time) return parseNumber(text);
    const beat = parse(text);
    return beat && toFloat(beat);
  };
  const lower = num(d.lower);
  const upper = num(d.upper);
  const sequence = parseSequence(d.sequence);
  if (lower === null || upper === null || !sequence) return null;
  return { lower, upper, op: d.op, easing: d.easing, sequence };
}

function OptionSelect<T extends string>({
  value,
  options,
  labels,
  onChange,
}: {
  value: T;
  options: readonly T[];
  labels?: Record<T, string>;
  onChange: (v: T) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o} value={o}>
          {labels?.[o] ?? o}
        </option>
      ))}
    </select>
  );
}

// Shared bounds / operation / easing / sequence fields plus the Apply button.
function RampForm({
  time,
  onApply,
}: {
  time: boolean;
  // Returns false when nothing changed.
  onApply: (ramp: Ramp) => boolean;
}) {
  const [draft, setDraft] = useState(INITIAL);
  const [status, setStatus] = useState('');
  const patch = (p: Partial<RampDraft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setStatus('');
  };
  const apply = () => {
    const ramp = toRamp(draft, time);
    if (!ramp) return setStatus('Invalid value.');
    try {
      setStatus(onApply(ramp) ? '' : 'No change (or edits would overlap).');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <Row label="Lower bound">
        <input
          value={draft.lower}
          inputMode="decimal"
          onChange={(e) => patch({ lower: e.target.value })}
        />
      </Row>
      <Row label="Upper bound">
        <input
          value={draft.upper}
          inputMode="decimal"
          onChange={(e) => patch({ upper: e.target.value })}
        />
      </Row>
      <Row label="Operation">
        <OptionSelect value={draft.op} options={MULTI_OPS} onChange={(op) => patch({ op })} />
      </Row>
      <Row label="Easing">
        <EasingSelect value={draft.easing} onChange={(easing) => patch({ easing })} />
      </Row>
      <Row label="Sequence">
        <input
          value={draft.sequence}
          placeholder="1 -1"
          title="Multipliers applied in turn to each item, repeating"
          onChange={(e) => patch({ sequence: e.target.value })}
        />
      </Row>
      <Button size="sm" variant="primary" onClick={apply}>
        Apply
      </Button>
      {status && <p className={styles.error}>{status}</p>}
    </>
  );
}

// Applies `fn` as one history entry; false when the chart didn't change.
function applyChart(fn: (c: Chart) => Chart) {
  const before = useChartStore.getState().chart;
  useChartStore.getState().apply(fn);
  return useChartStore.getState().chart !== before;
}

export function MultiNoteEdit() {
  const [attr, setAttr] = useState<NoteAttr>('x');
  return (
    <div className={styles.props}>
      <Row label="Attribute">
        <OptionSelect value={attr} options={NOTE_ATTRS} labels={NOTE_LABELS} onChange={setAttr} />
      </Row>
      <RampForm
        time={isTimeAttr(attr)}
        onApply={(ramp) => {
          const { selectedLineId, selectedNoteIds } = useEditorStore.getState();
          if (!selectedLineId) return false;
          return applyChart((c) => multiEditNotes(c, selectedLineId, selectedNoteIds, attr, ramp));
        }}
      />
    </div>
  );
}

const TARGETS = Object.keys(TARGET_LABELS) as EventTarget[];

export function MultiEventEdit() {
  const [target, setTarget] = useState<EventTarget>('all');
  const [attr, setAttr] = useState<EventAttr>('values');
  return (
    <div className={styles.props}>
      <Row label="Target">
        <OptionSelect
          value={target}
          options={TARGETS}
          labels={TARGET_LABELS}
          onChange={setTarget}
        />
      </Row>
      <Row label="Attribute">
        <OptionSelect value={attr} options={EVENT_ATTRS} labels={EVENT_LABELS} onChange={setAttr} />
      </Row>
      <RampForm
        time={isTimeAttr(attr)}
        onApply={(ramp) => {
          const s = useEditorStore.getState();
          const ownerId = s.selectedObjectId ?? s.selectedLineId;
          if (!ownerId) return false;
          return applyChart((c) =>
            multiEditEvents(c, ownerId, s.selectedLayerId, s.selectedEventIds, target, attr, ramp),
          );
        }}
      />
    </div>
  );
}
