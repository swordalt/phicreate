import {
  CHANNELS,
  isMedia,
  isNoise,
  isPlayable,
  isShader,
  isText,
  isVarKey,
  type Event,
  type EventItem,
  type EventLayer,
  type EventOwner,
  type ShaderEffect,
  type Channel,
  type TrackKey,
} from '@/features/chart/model/types';
import { shaderUniforms, uniformKeys } from '@/features/shaders/library';
import {
  EVENT_COLUMNS,
  MEDIA_COLUMNS,
  NOISE_COLUMNS,
  PLAYABLE_COLUMNS,
  TEXT_COLUMNS,
  VAR_COLORS,
  type EventColumn,
} from './types';

const isChannel = (key: TrackKey): key is Channel => (CHANNELS as readonly string[]).includes(key);

const varColumnCache = new WeakMap<ShaderEffect, { source: unknown; columns: EventColumn[] }>();

const ACTIVE_COLUMN: EventColumn = { channel: 'active', label: 'Active', color: '#e6e6e6' };

// The active ranges, one column per uniform component, then vars the shader doesn't declare.
function varColumns(effect: ShaderEffect): EventColumn[] {
  const uniforms = shaderUniforms(effect.shader);
  const cached = varColumnCache.get(effect);
  if (cached?.source === uniforms) return cached.columns;
  const keys = uniforms.flatMap(uniformKeys);
  for (const key of Object.keys(effect.vars)) if (!keys.includes(key)) keys.push(key);
  const columns: EventColumn[] = [
    ACTIVE_COLUMN,
    ...keys.map((key, i) => ({
      channel: `var:${key}` as const,
      label: key,
      color: VAR_COLORS[i % VAR_COLORS.length],
    })),
  ];
  varColumnCache.set(effect, { source: uniforms, columns });
  return columns;
}

export function columnsFor(owner: EventOwner | null): EventColumn[] {
  if (owner && isShader(owner)) return varColumns(owner);
  if (owner && isText(owner)) return TEXT_COLUMNS;
  if (owner && isNoise(owner)) return NOISE_COLUMNS;
  if (owner && isMedia(owner)) return isPlayable(owner.kind) ? PLAYABLE_COLUMNS : MEDIA_COLUMNS;
  return EVENT_COLUMNS;
}

// Events of one track: a layer channel, the color, a text's values, a media's starts
// or a shader var. `layer` is null for shaders.
export function trackEvents(
  owner: EventOwner,
  layer: EventLayer | null,
  key: TrackKey,
): Event<unknown>[] {
  if (isShader(owner)) {
    if (key === 'active') return owner.active;
    return isVarKey(key) ? (owner.vars[key.slice(4)] ?? []) : [];
  }
  if (isNoise(owner)) {
    if (key === 'visible' || key === 'active' || key === 'color') return owner[key];
    return layer && isChannel(key) ? layer[key] : [];
  }
  if (!layer || isVarKey(key) || key === 'active' || key === 'visible') return [];
  if (key === 'color') return owner.color;
  if (key === 'value') return isText(owner) ? owner.value : [];
  if (key === 'font') return isText(owner) ? owner.font : [];
  if (key === 'start') return isMedia(owner) ? owner.starts : [];
  return layer[key];
}

// The layer's events (plus object-level tracks), tagged with their grid column.
export function ownerEvents(owner: EventOwner | null, layer: EventLayer | null) {
  if (!owner || (!layer && !isShader(owner))) return [];
  return columnsFor(owner).flatMap((c, column) =>
    trackEvents(owner, layer, c.channel).map(
      (event) => ({ channel: c.channel, event, column }) as EventItem & { column: number },
    ),
  );
}
