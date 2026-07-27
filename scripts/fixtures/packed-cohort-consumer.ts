import {
  pairedSignTest,
  type AnalystFinding,
  type CostLedgerHandle,
} from '@tangle-network/agent-eval'
import { inMemoryCampaignStorage } from '@tangle-network/agent-eval/campaign'
import type {
  AgentProfileImprovementExperimentExecutionInput,
  DispatchContext,
  JudgeConfig,
  Scenario,
} from '@tangle-network/agent-eval/contract'
import {
  defineReadinessSpec,
  type KnowledgeReadinessSpec,
} from '@tangle-network/agent-knowledge'
import type {
  AgentProfile,
  AgentProfileImprovementRunReceipt,
  Sha256Digest,
} from '@tangle-network/agent-interface'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import type {
  ImproveMethodFactory,
  ReadonlyAgentProfile,
} from '@tangle-network/agent-runtime'
import {
  proposeAgentProfileImprovement,
  verifyAgentImprovementProposal,
} from '@tangle-network/agent-runtime/intelligence'
import { loadAgentImprovementProposalFixture } from '@tangle-network/agent-runtime/testing'

interface PackedScenario extends Scenario {
  kind: 'packed-cohort'
}

const scenarios: PackedScenario[] = Array.from({ length: 12 }, (_, index) => ({
  id: `packed-${index}`,
  kind: 'packed-cohort',
}))

const finding: AnalystFinding = {
  schema_version: '1.0.0',
  finding_id: 'packed-cohort-finding',
  analyst_id: 'packed-cohort',
  produced_at: '2026-07-27T00:00:00.000Z',
  severity: 'high',
  area: 'prompt',
  claim: 'The baseline omits the required response.',
  evidence_refs: [{ kind: 'span', uri: 'span://packed-span' }],
  recommended_action: 'Return the required response.',
  confidence: 1,
  subject: 'agent-profile:prompt.systemPrompt',
}

const runCandidate = async (
  profile: ReadonlyAgentProfile,
  _scenario: PackedScenario,
  context: DispatchContext,
): Promise<string> => {
  const paid = await context.cost.runPaidCall({
    channel: 'agent',
    actor: 'packed-cohort',
    model: 'deterministic-packed-cohort@1',
    maximumCharge: { externallyEnforcedMaximumUsd: 0.0001 },
    execute: async () => profile.prompt?.systemPrompt ?? '',
    receipt: () => ({
      model: 'deterministic-packed-cohort@1',
      inputTokens: 1,
      outputTokens: 1,
      actualCostUsd: 0.0001,
    }),
  })
  if (!paid.succeeded) throw paid.error
  return paid.value
}

const judge: JudgeConfig<string, PackedScenario> = {
  name: 'packed-cohort-exact-response',
  dimensions: [{ key: 'quality', description: 'The required response is present.' }],
  score: ({ artifact }) => {
    const score = artifact === 'CANDIDATE' ? 1 : 0
    return { dimensions: { quality: score }, composite: score, notes: '' }
  },
}

const method: ImproveMethodFactory<PackedScenario, string> = (context) => ({
  name: 'packed-cohort-deterministic-method',
  async optimize() {
    if (
      !context.findings.some(
        (item) => (item as { finding_id?: string }).finding_id === finding.finding_id,
      )
    ) {
      throw new Error('analysis finding did not reach the optimization method')
    }
    return {
      winnerSurface: 'CANDIDATE',
      cost: { totalCostUsd: 0, accountingComplete: true, incompleteReasons: [] },
    }
  },
})

const profile: AgentProfile = {
  name: 'packed-cohort-profile',
  prompt: { systemPrompt: 'BASELINE' },
}

const stateDigest = ({
  identity,
  profile: value,
}: {
  identity: string
  profile: AgentProfile
}): Sha256Digest => canonicalCandidateDigest({ identity, definition: value })

const signed = <T extends Record<string, unknown>>(material: T) => ({
  ...material,
  digest: canonicalCandidateDigest(material),
})

const evidence = (kind: string, identity: string) => ({
  kind,
  identity,
  digest: canonicalCandidateDigest({ kind, identity }),
})

function measurementReceipt(
  input: AgentProfileImprovementExperimentExecutionInput,
  score: number,
): AgentProfileImprovementRunReceipt {
  const executionId = `${input.arm}-${input.runCell.repetition}`
  const startedAtMs = input.runCell.repetition * 1_000
  return signed({
    kind: 'agent-profile-improvement-run' as const,
    digestAlgorithm: 'rfc8785-sha256' as const,
    executionId,
    executionRef: input.experiment.executionRef,
    runCell: input.runCell,
    runRecord: evidence('agent-eval-run-record', executionId),
    billing: [evidence('platform-billing', `bill-${executionId}`)] as [
      ReturnType<typeof evidence>,
    ],
    timing: {
      startedAtMs,
      endedAtMs: startedAtMs + 100,
      durationMs: 100,
    },
    steps: 1,
    resolvedModel: input.task.model,
    limits: input.task.limits,
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      modelCalls: 1,
      costUsdNanos: 100,
      costProvenance: 'observed' as const,
    },
    trace: {
      evidence: evidence('platform-trace', `trace-${executionId}`),
      eventCount: 2,
      modelCallCount: 1,
    },
    output: evidence('platform-output', `output-${executionId}`),
    outcome: { status: 'succeeded' as const },
    grading: {
      grader: input.task.grader,
      evidence: evidence('agent-eval-grading', `grade-${executionId}`),
      timing: {
        startedAtMs: startedAtMs + 100,
        endedAtMs: startedAtMs + 110,
        durationMs: 10,
      },
      usage: {
        inputTokens: 2,
        outputTokens: 1,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        modelCalls: 1,
        costUsdNanos: 10,
        costProvenance: 'observed' as const,
      },
      score,
      passed: true,
      dimensions: [{ name: 'quality', score }],
    },
  })
}

const readiness: KnowledgeReadinessSpec = defineReadinessSpec({
  id: 'packed-cohort',
  description: 'The packed knowledge package is executable.',
  query: 'packed knowledge package',
  requiredFor: ['packed-consumer'],
  confidenceNeeded: 0.5,
  minSources: 1,
  minHits: 1,
})
if (readiness.id !== 'packed-cohort') {
  throw new Error('packed Knowledge readiness contract changed')
}

const signTest = pairedSignTest([1, 1, 1], 'greater')
if (signTest.pValue !== 0.125) {
  throw new Error(`packed Eval sign test returned ${signTest.pValue}`)
}

const template = loadAgentImprovementProposalFixture()
if (template.evaluation.kind !== 'agent-profile-improvement-measured-comparison') {
  throw new Error('packed Runtime proposal fixture has the wrong evaluation kind')
}
const templateTask = template.evaluation.experiment.benchmark.tasks[0]
if (!templateTask) throw new Error('packed Runtime proposal fixture has no task')
const { digest: _taskDigest, ...task } = templateTask
const sourceIdentity = 'packed-profile'
const sourceDigest = stateDigest({ identity: sourceIdentity, profile })
const executionDigest = canonicalCandidateDigest({ executable: 'packed-cohort-consumer' })
const executed: Array<{ arm: 'baseline' | 'candidate'; prompt: string | undefined }> = []

const result = await proposeAgentProfileImprovement({
  runId: 'packed-cohort-proposal',
  budgetUsd: 1,
  source: {
    kind: 'platform-agent-profile',
    sourceIdentity,
    sourceDigest,
    sourceRevision: 1,
  },
  profile,
  stateDigest,
  analysis: {
    registry: {
      list: () => [{ id: 'packed-cohort' }],
      run: async () => ({
        run_id: 'packed-cohort-proposal',
        correlation_id: 'packed-cohort-proposal',
        started_at: '2026-07-27T00:00:00.000Z',
        ended_at: '2026-07-27T00:00:01.000Z',
        findings: [finding],
        per_analyst: [],
        total_cost_usd: 0,
        total_cost_provenance: { kind: 'observed' as const, usd: 0 },
      }),
    },
    inputs: {},
    findingsStore: null,
  },
  improvement: {
    surface: 'prompt',
    method,
    trainScenarios: scenarios.slice(0, 4),
    selectionScenarios: scenarios.slice(4, 8),
    testScenarios: scenarios.slice(8),
    judges: [judge],
    runDir: 'mem://packed-cohort',
    storage: inMemoryCampaignStorage(),
    resamples: 40,
    confidence: 0.95,
  },
  benchmark: {
    tasks: [task],
    reps: 3,
    seeds: [41, 42, 43],
    policy: template.evaluation.experiment.policy,
  },
  executor: {
    executionRef: {
      kind: 'agent-profile-improvement-execution-ref',
      identity: 'packed-cohort-consumer',
      digest: executionDigest,
    },
    optimize: runCandidate,
    measure: async (input) => {
      executed.push({ arm: input.arm, prompt: input.profile.prompt?.systemPrompt })
      return measurementReceipt(input, input.arm === 'candidate' ? 1 : 0)
    },
  },
  now: () => new Date('2026-07-27T00:02:00.000Z'),
})

try {
  const proposal = verifyAgentImprovementProposal(result.proposal)
  if (proposal.evaluation.kind !== 'agent-profile-improvement-measured-comparison') {
    throw new Error('packed Runtime produced the wrong proposal kind')
  }
  if (
    proposal.evaluation.overall.baseline !== 0 ||
    proposal.evaluation.overall.candidate !== 1 ||
    proposal.evaluation.overall.n !== 3
  ) {
    throw new Error('packed Runtime proposal lost the deterministic measured lift')
  }
  if (
    proposal.changedSurfaces.length !== 1 ||
    proposal.changedSurfaces[0] !== 'prompt' ||
    executed.length !== 6
  ) {
    throw new Error('packed Runtime proposal did not execute the exact profile pair')
  }
  process.stdout.write(
    `${JSON.stringify({
      proposalKind: proposal.evaluation.kind,
      baseline: proposal.evaluation.overall.baseline,
      candidate: proposal.evaluation.overall.candidate,
      pairs: proposal.evaluation.overall.n,
      executions: executed.length,
      changedSurfaces: proposal.changedSurfaces,
      evalSignTestPValue: signTest.pValue,
      knowledgeReadinessId: readiness.id,
    })}\n`,
  )
} finally {
  await result.improvement.dispose()
}
