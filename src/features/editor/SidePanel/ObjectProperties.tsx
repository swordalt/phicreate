import { useState } from 'react';
import {
  addLayer,
  findOwner,
  lineDescendants,
  patchNoiseField,
  patchOwner,
  removeLayer,
  setMediaFile,
  type NoisePatch,
  type OwnerPatch,
} from '@/features/chart/runtime/commands';
import {
  CHANNELS,
  isLine,
  isMedia,
  isNoise,
  isPlayable,
  isShader,
  isText,
  MEDIA_FITS,
  type MediaFit,
  type MediaObject,
  type NoiseField,
} from '@/features/chart/model/types';
import { HOLD_Z, NOTE_Z } from '@/features/chart/model/zOrder';
import { useChartStore } from '@/features/chart/runtime/useChartStore';
import { fileName, withExt } from '@/features/library/fileNames';
import { useLibraryStore } from '@/features/library/useLibraryStore';
import { parseNumber } from '@/lib/number';
import { getMedia, loadMedia, mediaKindOf } from '../preview/media';
import { CommitInput } from '../CommitInput';
import { useEditorStore } from '../useEditorStore';
import { Check, Row, Section } from './fields';
import { ShaderProperties } from './ShaderProperties';
import styles from './SidePanel.module.css';

// Properties of the object selected in the objects sidebar.
export function ObjectProperties() {
  const ownerId = useEditorStore((s) => s.selectedObjectId ?? s.selectedLineId);
  const chart = useChartStore((s) => s.chart);
  const apply = useChartStore((s) => s.apply);
  const owner = chart && ownerId ? findOwner(chart, ownerId) : undefined;

  if (!chart || !owner) {
    return (
      <Section title="Object properties">
        <p className={styles.muted}>No object selected.</p>
      </Section>
    );
  }

  if (isShader(owner)) return <ShaderProperties effect={owner} />;

  const text = isText(owner) ? owner : null;
  const media = isMedia(owner) ? owner : null;
  const line = isLine(owner) ? owner : null;
  const noise = isNoise(owner) ? owner : null;
  // Owners with z order and anchor.
  const placed = isNoise(owner) ? null : owner;
  const ui = !!text?.builtin;
  const patch = (p: OwnerPatch) => apply((c) => patchOwner(c, owner.id, p));
  const number = (key: 'zOrder' | 'size', min?: number) => (value: string) => {
    const v = parseNumber(value);
    if (v === null || (min !== undefined && v < min)) return false;
    patch({ [key]: v });
  };
  const anchorAt = (i: 0 | 1) => (value: string) => {
    const v = parseNumber(value);
    if (v === null || !placed) return false;
    const anchor: [number, number] = [placed.anchor[0], placed.anchor[1]];
    anchor[i] = v;
    patch({ anchor });
  };
  const blocked = line ? lineDescendants(chart.lines, line.id) : new Set<string>();

  return (
    <Section
      title={
        ui
          ? owner.name
          : line
            ? 'Line properties'
            : media
              ? 'Media properties'
              : noise
                ? 'Noise field properties'
                : 'Text properties'
      }
    >
      <div className={styles.props}>
        {!ui && (
          <Row label="Name">
            <CommitInput
              value={owner.name}
              onCommit={(name) => {
                if (!name.trim()) return false;
                patch({ name: name.trim() });
              }}
            />
          </Row>
        )}
        <Row label="Parent line">
          <select
            value={owner.parentId ?? ''}
            onChange={(e) => patch({ parentId: e.target.value || null })}
          >
            <option value="">None</option>
            {chart.lines
              .filter((l) => !blocked.has(l.id))
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        </Row>
        <Check
          label="Rotate with parent"
          checked={owner.rotateWithParent}
          onChange={(rotateWithParent) => patch({ rotateWithParent })}
        />
        {line && (
          <Check
            label="Cover notes"
            checked={line.isCover}
            onChange={(isCover) => patch({ isCover })}
          />
        )}
        {line && chart.lineGroups.length > 0 && (
          <Row label="Group">
            <select
              value={line.groupId ?? ''}
              onChange={(e) => patch({ groupId: e.target.value || null })}
            >
              <option value="">None</option>
              {chart.lineGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Row>
        )}
        {placed && (
          <>
            <Row label="Z order">
              <CommitInput
                value={String(placed.zOrder)}
                inputMode="decimal"
                title={`Higher draws on top. Holds draw above ${HOLD_Z}, other notes above ${NOTE_Z}; equal values keep list order.`}
                onCommit={number('zOrder')}
              />
            </Row>
            <Row label="Anchor X">
              <CommitInput
                value={String(placed.anchor[0])}
                inputMode="decimal"
                title="0 = left, 1 = right"
                onCommit={anchorAt(0)}
              />
            </Row>
            <Row label="Anchor Y">
              <CommitInput
                value={String(placed.anchor[1])}
                inputMode="decimal"
                title="0 = bottom, 1 = top"
                onCommit={anchorAt(1)}
              />
            </Row>
          </>
        )}
        {text && (
          <Row label={text.builtin === 'pause' || text.builtin === 'bar' ? 'Height' : 'Font size'}>
            <CommitInput
              value={String(text.size)}
              inputMode="decimal"
              onCommit={number('size', 1)}
            />
          </Row>
        )}
        {media && <MediaFields media={media} />}
        {noise && <NoiseFields field={noise} />}
      </div>
      <Layers ownerId={owner.id} />
    </Section>
  );
}

const FIT_LABELS: Record<MediaFit, string> = {
  none: 'None',
  cover: 'Cover (crop)',
  inside: 'Inside',
  stretch: 'Stretch',
};

function MediaFields({ media }: { media: MediaObject }) {
  const apply = useChartStore((s) => s.apply);
  const [status, setStatus] = useState<string | null>(null);
  const library = useLibraryStore((s) => s.media);
  const loaded = getMedia(media.assetId);

  // Uses a library file; a first pick names the object.
  const assignFile = async (assetId: string | null) => {
    if (!assetId) return apply((c) => setMediaFile(c, media.id, { kind: null, assetId: null }));
    const blob = library[assetId];
    const kind = blob && mediaKindOf(blob.type);
    if (!kind) return setStatus('Unsupported file type.');
    setStatus('Loading…');
    if (!(await loadMedia(assetId, blob))) return setStatus('Could not decode this file.');
    setStatus(null);
    const base = fileName(blob, '').replace(/\.[^.]+$/, '');
    const name = media.assetId || !base ? undefined : base;
    apply((c) => setMediaFile(c, media.id, { kind, assetId, ...(name && { name }) }));
  };

  return (
    <>
      <Row label="File">
        <select
          value={media.assetId ?? ''}
          onChange={(e) => void assignFile(e.target.value || null)}
        >
          <option value="">None</option>
          {media.assetId && !library[media.assetId] && (
            <option value={media.assetId}>Missing file</option>
          )}
          {Object.entries(library).map(([assetId, blob]) => (
            <option key={assetId} value={assetId}>
              {fileName(blob, withExt(assetId, blob))}
            </option>
          ))}
        </select>
      </Row>
      {status && <p className={styles.muted}>{status}</p>}
      <Row label="Type">
        <span>{media.kind ?? 'None'}</span>
      </Row>
      {loaded && (
        <Row label="Size">
          <span title="Pixels = canvas units at scale 1, as in RPE">
            {loaded.width} × {loaded.height}
          </span>
        </Row>
      )}
      <Row label="Fit to frame">
        <select
          value={media.fit ?? 'none'}
          title="None = 1 pixel per canvas unit"
          onChange={(e) =>
            apply((c) => patchOwner(c, media.id, { fit: e.target.value as MediaFit }))
          }
        >
          {MEDIA_FITS.map((f) => (
            <option key={f} value={f}>
              {FIT_LABELS[f]}
            </option>
          ))}
        </select>
      </Row>
      {isPlayable(media.kind) && (
        <>
          <Check
            label="Loop"
            checked={media.loop}
            onChange={(loop) => apply((c) => patchOwner(c, media.id, { loop }))}
          />
          <Check
            label="Only while playing"
            checked={!!media.playingOnly}
            onChange={(playingOnly) => apply((c) => patchOwner(c, media.id, { playingOnly }))}
          />
        </>
      )}
    </>
  );
}

function NoiseFields({ field }: { field: NoiseField }) {
  const apply = useChartStore((s) => s.apply);
  const patch = (p: NoisePatch) => apply((c) => patchNoiseField(c, field.id, p));
  const sizeAt = (i: 0 | 1) => (value: string) => {
    const v = parseNumber(value);
    if (v === null || v <= 0) return false;
    const size: [number, number] = [field.size[0], field.size[1]];
    size[i] = v;
    patch({ size });
  };
  // Base-layer start position (before move events).
  const originAt = (key: 'moveX' | 'moveY') => (value: string) => {
    const v = parseNumber(value);
    if (v === null) return false;
    patch({ defaults: { ...field.defaults, [key]: v } });
  };

  return (
    <>
      <Row label="Width">
        <CommitInput value={String(field.size[0])} inputMode="decimal" onCommit={sizeAt(0)} />
      </Row>
      <Row label="Height">
        <CommitInput value={String(field.size[1])} inputMode="decimal" onCommit={sizeAt(1)} />
      </Row>
      <Row label="Origin X">
        <CommitInput
          value={String(field.defaults?.moveX ?? 0)}
          inputMode="decimal"
          title="Center before move events"
          onCommit={originAt('moveX')}
        />
      </Row>
      <Row label="Origin Y">
        <CommitInput
          value={String(field.defaults?.moveY ?? 0)}
          inputMode="decimal"
          title="Center before move events"
          onCommit={originAt('moveY')}
        />
      </Row>
      <Check
        label="Subtract"
        checked={field.subtract}
        onChange={(subtract) => patch({ subtract })}
      />
    </>
  );
}

function Layers({ ownerId }: { ownerId: string }) {
  const selectedLayerId = useEditorStore((s) => s.selectedLayerId);
  const selectLayer = useEditorStore((s) => s.selectLayer);
  const layers = useChartStore((s) => {
    const owner = s.chart && ownerId ? findOwner(s.chart, ownerId) : undefined;
    return owner && !isShader(owner) ? owner.layers : undefined;
  });
  const apply = useChartStore((s) => s.apply);
  if (!layers) return null;
  const activeId = layers.some((y) => y.id === selectedLayerId) ? selectedLayerId : layers[0]?.id;

  return (
    <>
      <div className={styles.header}>
        <h2>Event layers</h2>
        <span className={styles.actions}>
          <button
            type="button"
            title="Add layer"
            onClick={() => apply((c) => addLayer(c, ownerId))}
          >
            +
          </button>
        </span>
      </div>
      <ul className={styles.list}>
        {layers.map((y, i) => (
          <li
            key={y.id}
            className={y.id === activeId ? styles.selected : undefined}
            onClick={() => selectLayer(y.id)}
          >
            <span>{y.name}</span>
            <span className={styles.count}>
              {CHANNELS.reduce((n, c) => n + y[c].length, 0)}
              {i > 0 && (
                <button
                  type="button"
                  className={styles.inlineAction}
                  title="Delete layer"
                  onClick={(e) => {
                    e.stopPropagation();
                    apply((c) => removeLayer(c, ownerId, y.id));
                    if (y.id === activeId) selectLayer(null);
                  }}
                >
                  ×
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
