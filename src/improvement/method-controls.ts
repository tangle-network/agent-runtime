import type { OptimizationMethod, Scenario } from '@tangle-network/agent-eval/campaign'
import { ConfigError } from '../errors'
import type { ImproveCandidateValidationInput } from './improve-types'

const methodRuntimeControls = Symbol('agent-runtime.improvement.method-runtime-controls')

interface MethodRuntimeControls {
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

/**
 * Refuse an artifact descriptor set beside a method. agent-eval 2.0.0 hands a
 * `describeArtifact` given to `compareOptimizationMethods`, or carried on a method's input, to
 * the method's optimizer; there it would skip the redaction and evaluation identity
 * `officialGepa` and `officialSkillOpt` apply to their own descriptor.
 */
export function assertNoCallerArtifactDescriptor(input: object, label: string): void {
  if ((input as { describeArtifact?: unknown }).describeArtifact !== undefined) {
    throw new ConfigError(
      `${label}: describeArtifact belongs on the method, not beside it: officialGepa and officialSkillOpt redact what it returns and record it in their evaluation identity, and a native method takes it in its own configuration`,
    )
  }
}
