import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { cmp, format, parse, toFloat } from '@/features/chart/model/beat';
import { isColor, parseColor, toHex } from '@/features/chart/model/color';
import { ease, rawCurve } from '@/features/chart/model/easing';
import {
  DEFAULT_FONT,
  isNoise,
  isShader,
  type Color,
  type ColorEvent,
  type Easing,
  type Event,
  type NumEvent,
  type TextEvent,
  type TrackKey,
} from '@/features/chart/model/types';
import {
  cutEvents,
  findOwner,
  passEvents,
  randomEvents,
  removeEvents,
  retimeEvents,
  splitEvents,
  stickEvents,
  swapEvents,
  updateColorEvents,
  updateEvents,
  updateTextEvents,
} from '@/features/chart/runtime/commands';
import { useChartStore } from '@/features/chart/runtime/useChartStore';
import { useLibraryStore } from '@/features/library/useLibraryStore';
import { parseNumber } from '@/lib/number';
import { CommitInput } from '../CommitInput';
import { columnsFor, ownerEvents } from '../events';
import { playback } from '../playback/playback';
import { beatToMusicTime, musicTimeToBeat } from '../time';
import { useEditorStore } from '../useEditorStore';
import { EasingSelect } from './EasingSelect';
import { Check, Row } from './fields';
import styles from './SidePanel.module.css';

// Edits the selected events; mixed values show blank and apply to all on commit.
export function EventProperties() {
  const [sampling, setSampling] = useState(false);
  const ownerId = useEditorStore((s) => s.selectedObjectId ?? s.selectedLineId);
  const ids = useEditorStore((s) => s.selectedEventIds);
  const layerId = useEditorStore((s) => s.selectedLayerId);
  const owner = useChartStore((s) =>
    s.chart && ownerId ? findOwner(s.chart, ownerId) : undefined,
  );
  const apply = useChartStore((s) => s.apply);
  const library = useLibraryStore((s) => s.fonts);
  const layer =
    owner && !isShader(owner)
      ? (owner.layers.find((y) => y.id === layerId) ?? owner.layers[0])
      : null;

  const selected = owner ? ownerEvents(owner, layer).filter((x) => ids.includes(x.event.id)) : [];
  if (!owner || !selected.length) {
    return <p className={styles.muted}>No event selected.</p>;
  }
  const targetLayer = layer?.id ?? null;

  // Numeric events (channels, media starts), text value events and color events.
  const nums = selected.flatMap((x) =>
    x.channel === 'value' || x.channel === 'font' || x.channel === 'color' ? [] : [x.event],
  );
  const texts = selected.flatMap((x) => (x.channel === 'value' ? [x.event] : []));
  const fonts = selected.flatMap((x) => (x.channel === 'font' ? [x.event] : []));
  const rangesOnly = selected.every((x) => x.channel === 'active' || x.channel === 'visible');
  const startsOnly = selected.every((x) => x.channel === 'start');
  // Noise field active ranges keep the ready flash length in `from`.
  const flashes = isNoise(owner) && selected.every((x) => x.channel === 'active');
  // Shader active ranges: 1 = covers the UI too.
  const scopes = isShader(owner) && selected.every((x) => x.channel === 'active');
  const colors = selected.flatMap((x) => (x.channel === 'color' ? [x.event] : []));
  const events: Event<number | string | Color>[] = [...nums, ...texts, ...fonts, ...colors];
  const fontsOnly = fonts.length === events.length;
  const noCurve = rangesOnly || fontsOnly || startsOnly;
  const textsOnly = texts.length === events.length;
  // Library fonts, plus any name a deleted font left in an event.
  const fontNames = [
    ...new Set([DEFAULT_FONT, ...Object.keys(library), ...fonts.map((e) => e.from)]),
  ].filter(Boolean);
  const retime = (fn: <T>(e: Event<T>) => Event<T>) =>
    apply((c) => retimeEvents(c, owner.id, targetLayer, ids, fn));
  // One history entry for every event kind.
  const update = (
    numFn: (e: NumEvent) => NumEvent,
    textFn: (e: TextEvent) => TextEvent,
    colorFn: (e: ColorEvent) => ColorEvent,
  ) =>
    apply((c) => {
      const next = updateTextEvents(
        updateEvents(c, owner.id, targetLayer, ids, numFn),
        owner.id,
        targetLayer,
        ids,
        textFn,
      );
      return updateColorEvents(next, owner.id, targetLayer, ids, colorFn);
    });
  const shared = <T,>(get: (e: Event<number | string | Color>) => T) =>
    events.every((e) => get(e) === get(events[0])) ? get(events[0]) : undefined;
  const show = (v: number | string | Color) => (isColor(v) ? toHex(v) : String(v));
  const single = selected.length === 1 ? selected[0] : null;
  const easing = shared((e) => (e.easing.kind === 'preset' ? e.easing.id : -1));
  const clipL = shared((e) => (e.easing.kind === 'preset' ? (e.easing.clip?.[0] ?? 0) : 0)) ?? 0;
  const clipR = shared((e) => (e.easing.kind === 'preset' ? (e.easing.clip?.[1] ?? 1) : 1)) ?? 1;

  const set = <T,>(e: Event<T>, key: 'from' | 'to', v: T): Event<T> =>
    e.locked ? { ...e, from: v, to: v } : { ...e, [key]: v };

  const field = (key: 'from' | 'to', label: string) => {
    const value = shared((e) => show(e[key]));
    const commit = (text: string) => {
      const v = parseNumber(text);
      const color = parseColor(text);
      if ((nums.length && v === null) || (colors.length && !color)) return false;
      update(
        (e) => (v === null ? e : set(e, key, v)),
        (e) => set(e, key, text),
        (e) => (color ? set(e, key, color) : e),
      );
    };
    const input = (
      <CommitInput
        value={value ?? ''}
        placeholder="—"
        inputMode={texts.length || fonts.length || colors.length ? 'text' : 'decimal'}
        onCommit={commit}
      />
    );
    return (
      <Row label={label}>
        {colors.length === events.length ? (
          <span className={styles.colorField}>
            <ColorPicker key={value} value={value ?? '#ffffff'} onCommit={commit} />
            {input}
          </span>
        ) : (
          input
        )}
      </Row>
    );
  };

  const onCut = () => {
    const editor = useEditorStore.getState();
    const time = editor.playing ? playback.time : editor.time;
    const nextIds: string[] = [];
    apply((c) =>
      cutEvents(
        c,
        owner.id,
        targetLayer,
        ids,
        editor.division,
        musicTimeToBeat(c, time),
        nextIds,
      ),
    );
    if (nextIds.length) editor.selectEvents(nextIds);
  };

  const onSplit = () => {
    const editor = useEditorStore.getState();
    const time = editor.playing ? playback.time : editor.time;
    const nextIds: string[] = [];
    apply((c) =>
      splitEvents(
        c,
        owner.id,
        targetLayer,
        ids,
        editor.division,
        musicTimeToBeat(c, time),
        nextIds,
      ),
    );
    if (nextIds.length) editor.selectEvents(nextIds);
  };

  const onDelete = () => {
    apply((c) => removeEvents(c, owner.id, targetLayer, ids));
    useEditorStore.getState().selectEvents([]);
  };

  const onCommitClip = (l: number, r: number) =>
    retime((e) => {
      if (e.easing.kind !== 'preset') return e;
      const clip: [number, number] | undefined = l === 0 && r === 1 ? undefined : [l, r];
      return { ...e, easing: { kind: 'preset', id: e.easing.id, ...(clip && { clip }) } };
    });

  return (
    <div className={styles.props}>
      <p className={styles.muted}>
        {single ? columnsFor(owner)[single.column].label : `${selected.length} events selected`}
      </p>
      {single && (
        <>
          <Row label="Start">
            <CommitInput
              value={format(single.event.start)}
              onCommit={(text) => {
                const start = parse(text);
                if (!start || cmp(start, single.event.end) >= 0) return false;
                retime((e) => ({ ...e, start }));
              }}
            />
          </Row>
          <Row label="End">
            <CommitInput
              value={format(single.event.end)}
              onCommit={(text) => {
                const end = parse(text);
                if (!end || cmp(end, single.event.start) <= 0) return false;
                retime((e) => ({ ...e, end }));
              }}
            />
          </Row>
        </>
      )}
      {flashes && field('from', 'Ready flash (s)')}
      {scopes && (
        <Check
          label="Cover UI (global)"
          checked={shared((e) => e.from === 1) ?? false}
          onChange={(global) => {
            const v = Number(global);
            update(
              (e) => ({ ...e, from: v, to: v }),
              (e) => e,
              (e) => e,
            );
          }}
        />
      )}
      {fontsOnly && (
        <Row label="Font">
          <select
            value={shared((e) => String(e.from)) ?? ''}
            onChange={(e) => {
              const font = e.target.value;
              const fn = (ev: TextEvent): TextEvent => ({ ...ev, from: font, to: font });
              update((n) => n, fn, (c) => c);
            }}
          >
            {shared((e) => String(e.from)) === undefined && <option value="">—</option>}
            {fontNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Row>
      )}
      {/* Shader active ranges, noise field ranges and fonts have timing only. */}
      {!rangesOnly && !fontsOnly && (
        <>
          {field('from', 'From')}
          {field('to', 'To')}
          <Check
            label="Locked (from = to)"
            checked={shared((e) => !!e.locked) ?? false}
            onChange={(locked) => {
              const fn = <T,>(e: Event<T>): Event<T> =>
                locked ? { ...e, locked, to: e.from } : { ...e, locked };
              update(fn, fn, fn);
            }}
          />
          <Row label="Easing">
            <EasingSelect
              value={easing === -1 ? undefined : easing}
              extra={easing === -1 ? 'Bézier' : undefined}
              onChange={(id) =>
                retime((e) => ({
                  ...e,
                  easing: {
                    kind: 'preset',
                    id,
                    ...(e.easing.kind === 'preset' && e.easing.clip && { clip: e.easing.clip }),
                  },
                }))
              }
            />
          </Row>
        </>
      )}

      <div className={styles.toolGrid}>
        <Button
          size="sm"
          disabled={noCurve}
          title="Fill start value from the previous event's end value"
          onClick={() => apply((c) => stickEvents(c, owner.id, targetLayer, ids))}
        >
          Stick
        </Button>
        <Button
          size="sm"
          disabled={noCurve}
          title="Subdivide into linear segments at the current grid division"
          onClick={onCut}
        >
          Cut
        </Button>
        <Button
          size="sm"
          disabled={noCurve || textsOnly}
          title="Randomize end value"
          onClick={() => apply((c) => randomEvents(c, owner.id, targetLayer, ids))}
        >
          Rand
        </Button>
        <Button
          size="sm"
          disabled={noCurve || textsOnly}
          title="Extrapolate from the previous two events"
          onClick={() => apply((c) => passEvents(c, owner.id, targetLayer, ids))}
        >
          Pass
        </Button>
        <Button
          size="sm"
          variant={sampling && !noCurve && !textsOnly ? 'primary' : 'secondary'}
          disabled={noCurve || textsOnly}
          title="Interactive value sampler"
          onClick={() => setSampling((v) => !v)}
        >
          Sample
        </Button>
        <Button
          size="sm"
          disabled={noCurve}
          title="Swap start and end values"
          onClick={() => apply((c) => swapEvents(c, owner.id, targetLayer, ids))}
        >
          Swap
        </Button>
        <Button
          size="sm"
          disabled={noCurve}
          title="Split selected events into two at the playhead while preserving the curve"
          onClick={onSplit}
        >
          Split
        </Button>
        <Button size="sm" variant="danger" title="Delete selected events" onClick={onDelete}>
          Delete
        </Button>
      </div>

      {sampling && !noCurve && !textsOnly && (
        <SamplePanel
          key={`${ids.join(',')}:${shared((e) => show(e.from)) ?? 'm'}:${shared((e) => show(e.to)) ?? 'm'}`}
          channel={selected[0].channel}
          fromVal={events[0].from}
          toVal={events[0].to}
          locked={shared((e) => !!e.locked) ?? false}
          singleBeat={single ? [toFloat(single.event.start), toFloat(single.event.end)] : null}
          onCommitNum={(key, v) =>
            update(
              (e) => set(e, key, v),
              (e) => e,
              (e) => e,
            )
          }
          onCommitColor={(key, c) =>
            update(
              (e) => e,
              (e) => e,
              (e) => set(e, key, c),
            )
          }
        />
      )}

      {!noCurve && (
        <EasingCurve
          key={`${ids.join(',')}:${easing ?? 'm'}:${clipL}:${clipR}`}
          easing={events[0].easing}
          presetId={easing && easing > 0 ? easing : undefined}
          clipL={clipL}
          clipR={clipR}
          onCommit={onCommitClip}
        />
      )}
    </div>
  );
}

function EasingCurve({
  easing,
  presetId,
  clipL,
  clipR,
  onCommit,
}: {
  easing: Easing;
  presetId: number | undefined;
  clipL: number;
  clipR: number;
  onCommit: (l: number, r: number) => void;
}) {
  const [range, setRange] = useState<[number, number]>([clipL, clipR]);
  const [l, r] = range;
  const id = presetId ?? (easing.kind === 'preset' ? easing.id : undefined);
  const sample = (t: number) => (id ? rawCurve(id, t) : ease(easing, t));

  const steps = 64;
  const fullPts = Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return `${(t * 200).toFixed(1)},${(100 - sample(t) * 100).toFixed(1)}`;
  }).join(' ');

  const clipPts = Array.from({ length: steps + 1 }, (_, i) => {
    const t = l + (r - l) * (i / steps);
    return `${(t * 200).toFixed(1)},${(100 - sample(t) * 100).toFixed(1)}`;
  }).join(' ');

  const lx = l * 200;
  const rx = r * 200;
  const ry = 100 - sample(r) * 100;

  return (
    <div className={styles.curveBox}>
      <svg className={styles.curveSvg} viewBox="-14 -20 228 140" aria-label="Easing curve">
        {/* Horizontal axis */}
        <path
          d="M 0 100 L 204 100 M 199 95 L 204 100 L 199 105"
          fill="none"
          stroke="var(--c-text-muted)"
          strokeWidth="1.5"
        />
        {/* Full unclipped curve */}
        {(l > 0 || r < 1) && (
          <polyline
            points={fullPts}
            fill="none"
            stroke="var(--c-border)"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
        )}
        {/* Active clipped curve */}
        <polyline
          points={clipPts}
          fill="none"
          stroke="var(--c-accent)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Left endpoint marker with arrow */}
        <path
          d={`M ${lx} 100 L ${lx} 0 M ${lx - 5} 5 L ${lx} 0 L ${lx + 5} 5`}
          fill="none"
          stroke="var(--c-text)"
          strokeWidth="1.5"
        />
        {/* Right endpoint marker */}
        <line
          x1={rx}
          y1={100}
          x2={rx}
          y2={ry}
          stroke="var(--c-accent-hover)"
          strokeWidth="1.8"
        />
      </svg>

      {id !== undefined && (
        <>
          <label className={styles.clipRow}>
            <span>L</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={l}
              onChange={(e) => {
                const nextL = Math.min(Number(e.target.value), Math.round((r - 0.01) * 100) / 100);
                setRange([nextL, r]);
              }}
              onPointerUp={() => onCommit(l, r)}
              onKeyUp={() => onCommit(l, r)}
            />
            <span className={styles.clipValue}>{l.toFixed(2)}</span>
          </label>
          <label className={styles.clipRow}>
            <span>R</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={r}
              onChange={(e) => {
                const nextR = Math.max(Number(e.target.value), Math.round((l + 0.01) * 100) / 100);
                setRange([l, nextR]);
              }}
              onPointerUp={() => onCommit(l, r)}
              onKeyUp={() => onCommit(l, r)}
            />
            <span className={styles.clipValue}>{r.toFixed(2)}</span>
          </label>
        </>
      )}
    </div>
  );
}

function sampleBounds(channel: TrackKey): [number, number, number] {
  if (channel === 'alpha') return [0, 255, 1];
  if (channel === 'speed') return [-20, 20, 0.1];
  if (channel === 'rotate') return [-360, 360, 1];
  if (channel === 'scaleX' || channel === 'scaleY') return [0, 4, 0.05];
  if (channel === 'moveY') return [-450, 450, 1];
  if (channel === 'moveX') return [-675, 675, 1];
  return [0, 2, 0.01];
}

function SamplePanel({
  channel,
  fromVal,
  toVal,
  locked,
  singleBeat,
  onCommitNum,
  onCommitColor,
}: {
  channel: TrackKey;
  fromVal: number | string | Color;
  toVal: number | string | Color;
  locked: boolean;
  singleBeat: [number, number] | null;
  onCommitNum: (key: 'from' | 'to', v: number) => void;
  onCommitColor: (key: 'from' | 'to', v: Color) => void;
}) {
  const seekAt = (end: boolean) => {
    const chart = useChartStore.getState().chart;
    const editor = useEditorStore.getState();
    if (!chart || !singleBeat || editor.playing) return;
    editor.seek(beatToMusicTime(chart, end ? singleBeat[1] : singleBeat[0]));
  };

  if (isColor(fromVal) && isColor(toVal)) {
    return (
      <ColorSample
        fromVal={fromVal}
        toVal={toVal}
        locked={locked}
        onSeek={seekAt}
        onCommit={onCommitColor}
      />
    );
  }

  const [min, max, step] = sampleBounds(channel);
  const [from, setFrom] = useState(typeof fromVal === 'number' ? fromVal : 0);
  const [to, setTo] = useState(typeof toVal === 'number' ? toVal : 0);

  return (
    <div className={styles.sampleBox}>
      <label className={styles.clipRow}>
        <span>From</span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={from}
          onChange={(e) => {
            const v = Number(e.target.value);
            setFrom(v);
            if (locked) setTo(v);
            seekAt(false);
          }}
          onPointerUp={() => onCommitNum('from', from)}
          onKeyUp={() => onCommitNum('from', from)}
        />
        <span className={styles.sampleValue}>{from}</span>
      </label>
      <label className={styles.clipRow}>
        <span>To</span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={to}
          disabled={locked}
          onChange={(e) => {
            setTo(Number(e.target.value));
            seekAt(true);
          }}
          onPointerUp={() => onCommitNum('to', to)}
          onKeyUp={() => onCommitNum('to', to)}
        />
        <span className={styles.sampleValue}>{to}</span>
      </label>
    </div>
  );
}

function ColorSample({
  fromVal,
  toVal,
  locked,
  onSeek,
  onCommit,
}: {
  fromVal: Color;
  toVal: Color;
  locked: boolean;
  onSeek: (end: boolean) => void;
  onCommit: (key: 'from' | 'to', v: Color) => void;
}) {
  const [from, setFrom] = useState<Color>(fromVal);
  const [to, setTo] = useState<Color>(toVal);
  const channels = ['R', 'G', 'B'] as const;

  return (
    <div className={styles.sampleBox}>
      {channels.map((ch, i) => (
        <label key={`f-${ch}`} className={styles.clipRow}>
          <span>From {ch}</span>
          <input
            type="range"
            min={0}
            max={255}
            step={1}
            value={from[i]}
            onChange={(e) => {
              const next = [...from] as Color;
              next[i] = Number(e.target.value);
              setFrom(next);
              if (locked) setTo(next);
              onSeek(false);
            }}
            onPointerUp={() => onCommit('from', from)}
            onKeyUp={() => onCommit('from', from)}
          />
          <span className={styles.clipValue}>{from[i]}</span>
        </label>
      ))}
      {!locked &&
        channels.map((ch, i) => (
          <label key={`t-${ch}`} className={styles.clipRow}>
            <span>To {ch}</span>
            <input
              type="range"
              min={0}
              max={255}
              step={1}
              value={to[i]}
              onChange={(e) => {
                const next = [...to] as Color;
                next[i] = Number(e.target.value);
                setTo(next);
                onSeek(true);
              }}
              onPointerUp={() => onCommit('to', to)}
              onKeyUp={() => onCommit('to', to)}
            />
            <span className={styles.clipValue}>{to[i]}</span>
          </label>
        ))}
    </div>
  );
}

// Native picker; commits once when the picker closes, not on every drag. Remount (key) to reset.
function ColorPicker({ value, onCommit }: { value: string; onCommit: (hex: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  useEffect(() => {
    const el = ref.current!;
    const onChange = () => commitRef.current(el.value);
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);
  return <input ref={ref} type="color" defaultValue={value} />;
}
