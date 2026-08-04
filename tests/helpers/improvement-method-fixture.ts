import {
  makeProposalFinding,
  minimumPairsForPairedDeltaTest,
  type ProposalFinding,
} from '@tangle-network/agent-eval'
import { inMemoryCampaignStorage } from '@tangle-network/agent-eval/campaign'
import type { DispatchContext, JudgeConfig, Scenario } from '@tangle-network/agent-eval/contract'

import { canonicalCandidateDigest } from '../../src/candidate-execution/digest'
import {
  agentCandidateProfileAsAgentProfile,
  freezeGenericAgentCandidateProfile,
} from '../../src/candidate-execution/profile'
import type { ImproveMethodFactory, ReadonlyAgentProfile } from '../../src/improvement'
import {
  type AgentImprovementExperimentMaterial,
  proposeAgentImprovement,
} from '../../src/intelligence/improvement-cycle'
import { redigestCandidateBundle } from './candidate-execution-fixture'
import {
  type CandidateExperimentFixture,
  createCandidateExperimentFixture,
} from './candidate-experiment-fixture'

export const improvementFinding: ProposalFinding = makeProposalFinding({
  analyst_id: 'improvement',
  proposal_origin: 'production',
  severity: 'high',
  area: 'prompt',
  claim: 'The agent omits the required answer.',
  evidence_refs: [{ kind: 'span', uri: 'span-1' }],
  recommended_action: 'Return the measured answer.',
  confidence: 0.9,
  subject: 'agent-profile:prompt.systemPrompt',
  produced_at: '2026-07-10T00:00:00.000Z',
})

export interface ImprovementScenario extends Scenario {
  kind: 'improvement-test'
}

const improvementScenarios: ImprovementScenario[] = Array.from(
  { length: 8 + minimumPairsForPairedDeltaTest(0.95) },
  (_, index) => ({
    id: `improvement-${index}`,
    kind: 'improvement-test',
  }),
)
const improvementTrain = improvementScenarios.slice(0, 4)
const improvementSelection = improvementScenarios.slice(4, 8)
const improvementTest = improvementScenarios.slice(8)

const improvementAgent = async (
  profile: ReadonlyAgentProfile,
  _scenario: ImprovementScenario,
  context: DispatchContext,
): Promise<string> => {
  const paid = await context.cost.runPaidCall({
    channel: 'agent',
    actor: 'improvement-cycle-test',
    model: 'deterministic-test@2026-07-01',
    maximumCharge: { externallyEnforcedMaximumUsd: 0.0001 },
    execute: async () => profile.prompt?.systemPrompt ?? '',
    receipt: () => ({
      model: 'deterministic-test@2026-07-01',
      inputTokens: 1,
      outputTokens: 1,
      actualCostUsd: 0.0001,
    }),
  })
  if (!paid.succeeded) throw paid.error
  return paid.value
}

const improvementJudge: JudgeConfig<string, ImprovementScenario> = {
  name: 'exact-prompt',
  dimensions: [{ key: 'quality', description: 'Candidate prompt selected.' }],
  score: ({ artifact }) => {
    const composite = artifact === 'PROMOTED' ? 1 : 0
    return { dimensions: { quality: composite }, composite, notes: '' }
  },
}

export const improvementMethod: ImproveMethodFactory<ImprovementScenario, string> = (context) => ({
  name: 'deterministic-complete-method',
  async optimize() {
    if (
      !context.findings.some(
        (item) => (item as { finding_id?: string }).finding_id === improvementFinding.finding_id,
      )
    ) {
      throw new Error('analysis findings did not reach the optimization method')
    }
    return {
      winnerSurface: 'PROMOTED',
      cost: {
        totalCostUsd: 0,
        costProvenance: { kind: 'observed', usd: 0 },
        accountingComplete: true,
        incompleteReasons: [],
      },
    }
  },
})

export function improvementOptions() {
  return {
    surface: 'prompt' as const,
    executionRef: canonicalCandidateDigest({
      agent: Function.prototype.toString.call(improvementAgent),
      judge: Function.prototype.toString.call(improvementJudge.score),
      method: Function.prototype.toString.call(improvementMethod),
    }),
    method: improvementMethod,
    trainScenarios: improvementTrain,
    selectionScenarios: improvementSelection,
    testScenarios: improvementTest,
    judges: [improvementJudge],
    agent: improvementAgent,
    runDir: `mem://improvement-cycle-${Math.random()}`,
    storage: inMemoryCampaignStorage(),
    resamples: 40,
    confidence: 0.95,
  }
}

export function candidateExperimentMaterial(
  experiment: CandidateExperimentFixture['experiment'],
): AgentImprovementExperimentMaterial {
  const { candidateLineage: _candidateLineage, digest: _digest, ...material } = experiment
  return material
}

export async function proposeTestMethodImprovement(
  runId: string,
  method: ImproveMethodFactory<ImprovementScenario, string>,
  configureProfile?: (profile: ReturnType<typeof agentCandidateProfileAsAgentProfile>) => void,
) {
  const seed = createCandidateExperimentFixture()
  const profile = agentCandidateProfileAsAgentProfile(seed.experiment.baseline.profile)
  configureProfile?.(profile)
  const baseline = redigestCandidateBundle(seed.experiment.baseline, {
    profile: freezeGenericAgentCandidateProfile(profile),
  })
  let measured: CandidateExperimentFixture | undefined
  return proposeAgentImprovement({
    runId,
    profile,
    analysis: {
      registry: {
        list: () => [{ id: 'improvement' }],
        run: async () => ({
          run_id: runId,
          correlation_id: runId,
          started_at: '2026-07-10T00:00:00.000Z',
          ended_at: '2026-07-10T00:00:01.000Z',
          findings: [improvementFinding],
          per_analyst: [],
          total_cost_usd: 0,
          total_cost_provenance: { kind: 'observed', usd: 0 },
        }),
      },
      inputs: {},
      findingsStore: null,
    },
    improvement: { ...improvementOptions(), method },
    buildExperiment: ({ improvement }) => {
      if (!improvement.candidate.profile) throw new Error('expected a profile candidate')
      const candidate = redigestCandidateBundle(baseline, {
        profile: freezeGenericAgentCandidateProfile(improvement.candidate.profile),
      })
      measured = createCandidateExperimentFixture({ baseline, candidate })
      return candidateExperimentMaterial(measured.experiment)
    },
    placeCell: (input) => {
      if (!measured) throw new Error('experiment was not built')
      return measured.placeCell(input)
    },
    now: () => new Date('2026-07-10T01:00:00.000Z'),
  })
}
