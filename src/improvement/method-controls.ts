import type { OptimizationMethod, Scenario } from '@tangle-network/agent-eval/campaign'
import type { ImproveCandidateValidationInput } from './improve-types'

const methodRuntimeControls = Symbol('agent-runtime.improvement.method-runtime-controls')

export interface MethodRuntimeControls {
  costAttribution: 'optimizer-run'
  validateCandidate: (input: ImproveCandidateValidationInput) => void
}

type ControlledOptimizationMethod<TScenario extends Scenario, TArtifact> = OptimizationMethod<
  TScenario,
  TArtifact
> & {
  [methodRuntimeControls]?: MethodRuntimeControls
}

export function withMethodRuntimeControls<TScenario extends Scenario, TArtifact>(
  method: OptimizationMethod<TScenario, TArtifact>,
  controls: MethodRuntimeControls,
): OptimizationMethod<TScenario, TArtifact> {
  return Object.freeze({
    ...method,
    [methodRuntimeControls]: Object.freeze({ ...controls }),
  })
}

export function methodRuntimeControlsOf<TScenario extends Scenario, TArtifact>(
  method: OptimizationMethod<TScenario, TArtifact>,
): MethodRuntimeControls | undefined {
  return (method as ControlledOptimizationMethod<TScenario, TArtifact>)[methodRuntimeControls]
}
