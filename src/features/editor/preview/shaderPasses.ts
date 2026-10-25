import type { Chart } from '@/features/chart/model/types';
import { effectRuntime } from '@/features/chart/runtime/scene';
import { shaderSource, shaderUniforms, uniformKeys } from '@/features/shaders/library';
import type { ShaderPass } from '@/features/shaders/pipeline';

export interface ActivePasses {
  // Chart only (under the UI), then the whole frame.
  chart: ShaderPass[];
  global: ShaderPass[];
}

export const NO_PASSES: ActivePasses = { chart: [], global: [] };

// Effects active at chart time t, by order (ties keep list order).
export function activePasses(chart: Chart, t: number): ActivePasses {
  const out: ActivePasses = { chart: [], global: [] };
  const active = chart.effects
    .map((effect, i) => {
      const runtime = effectRuntime(effect, chart.bpmList);
      return { effect, i, runtime, range: runtime.rangeAt(t) };
    })
    .filter(({ range }) => range)
    .sort((a, b) => a.effect.order - b.effect.order || a.i - b.i);
  for (const { effect, runtime, range } of active) {
    const source = shaderSource(effect.shader);
    if (!source) continue;
    const uniforms: ShaderPass['uniforms'] = {};
    for (const u of shaderUniforms(effect.shader)) {
      uniforms[u.name] = uniformKeys(u).map((key, k) => runtime.varValue(key, t, u.value[k]));
    }
    (range!.global ? out.global : out.chart).push({ source, uniforms });
  }
  return out;
}
