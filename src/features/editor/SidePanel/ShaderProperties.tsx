import type { ShaderEffect } from '@/features/chart/model/types';
import { patchEffect, type EffectPatch } from '@/features/chart/runtime/commands';
import { useChartStore } from '@/features/chart/runtime/useChartStore';
import {
  EXTRA_NAMES,
  PHIRA_NAMES,
  PRESET_NAMES,
  shaderSource,
  shaderUniforms,
  useShaderLibrary,
} from '@/features/shaders/library';
import { shaderError } from '@/features/shaders/pipeline';
import { parseNumber } from '@/lib/number';
import { CommitInput } from '../CommitInput';
import { Row, Section } from './fields';
import styles from './SidePanel.module.css';

export function ShaderProperties({ effect }: { effect: ShaderEffect }) {
  const apply = useChartStore((s) => s.apply);
  const custom = useShaderLibrary((s) => s.custom);
  const patch = (p: EffectPatch) => apply((c) => patchEffect(c, effect.id, p));
  const source = shaderSource(effect.shader);
  const error = source ? shaderError(source) : null;
  const uniforms = shaderUniforms(effect.shader);

  // One object per shader.
  const taken = new Set(
    useChartStore.getState().chart?.effects.flatMap((e) => (e.id === effect.id ? [] : [e.shader])),
  );

  // An imported effect may reference a file that isn't in the project.
  const options = [...new Set([...Object.keys(custom), effect.shader])].filter(
    (s) => !PRESET_NAMES.includes(s),
  );

  const presetGroup = (label: string, names: string[]) => (
    <optgroup label={label}>
      {names.map((name) => (
        <option key={name} value={name} disabled={taken.has(name)}>
          {name}
        </option>
      ))}
    </optgroup>
  );

  return (
    <Section title="Shader properties">
      <div className={styles.props}>
        <Row label="Name">
          <CommitInput
            value={effect.name}
            onCommit={(name) => {
              if (!name.trim()) return false;
              patch({ name: name.trim() });
            }}
          />
        </Row>
        <Row label="Shader">
          <select value={effect.shader} onChange={(e) => patch({ shader: e.target.value })}>
            {presetGroup('Phira presets', PHIRA_NAMES)}
            {presetGroup('Extra presets (bundled on export)', EXTRA_NAMES)}
            {options.length > 0 && (
              <optgroup label="Custom">
                {options.map((path) => (
                  <option key={path} value={path} disabled={taken.has(path)}>
                    {path.slice(1)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Row>
        {!source && (
          <p className={styles.muted}>Shader file not found. Add it in the Library to preview.</p>
        )}
        {error && <pre className={styles.error}>{error}</pre>}
        <Row label="Order">
          <CommitInput
            value={String(effect.order)}
            inputMode="decimal"
            title="Lower renders first"
            onCommit={(text) => {
              const order = parseNumber(text);
              if (order === null) return false;
              patch({ order });
            }}
          />
        </Row>
        <p className={styles.muted}>
          {`Set when it runs (and whether it covers the UI) in the Active column${
            uniforms.length ? `; animate ${uniforms.map((u) => u.name).join(', ')}` : ''
          } in the event grid.`}
        </p>
      </div>
    </Section>
  );
}
