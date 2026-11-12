import type { CampaignScenarioIdentity } from '@tangle-network/agent-eval/campaign'
import { canonicalCandidateDigest } from '../candidate-execution/digest'

/** The outer exam cannot reuse an exact task already exposed to search. */
export function assertReleaseScenariosAreFresh(
  partitions: {
    readonly train: readonly CampaignScenarioIdentity[]
    readonly selection?: readonly CampaignScenarioIdentity[]
    readonly finalTest?: readonly CampaignScenarioIdentity[]
  },
  heldOutScenarios: readonly CampaignScenarioIdentity[],
): void {
  const optimizerScenarios = new Map<string, string>()
  for (const [partition, scenarios] of [
    ['train', partitions.train],
    ['selection', partitions.selection ?? []],
    ['final-test', partitions.finalTest ?? []],
  ] as const) {
    for (const scenario of scenarios)
      optimizerScenarios.set(canonicalCandidateDigest(scenario), partition)
  }
  const reused = heldOutScenarios
    .filter((scenario) => optimizerScenarios.has(canonicalCandidateDigest(scenario)))
    .map(
      (scenario) =>
        String(scenario.id) +
        ' (' +
        optimizerScenarios.get(canonicalCandidateDigest(scenario)) +
        ')',
    )
  if (reused.length > 0)
    throw new Error('release benchmark reuses optimizer scenario(s): [' + reused.join(', ') + ']')
}
