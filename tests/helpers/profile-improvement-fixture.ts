import type { AgentProfileImprovementExperimentExecutionInput } from '@tangle-network/agent-eval/contract'
import {
  type AgentImprovementEvaluation,
  type AgentProfile,
  type AgentProfileDiff,
  type AgentProfileImprovementRunReceipt,
  agentProfileImprovementMeasuredComparisonSchema,
  applyAgentProfileDiff,
  canonicalCandidateDigest,
  defineInlineResource,
  type SandboxSizePreset,
  type Sha256Digest,
} from '@tangle-network/agent-interface'

import {
  omitUndefinedObjectFields,
  parseExactAgentProfile,
} from '../../src/candidate-execution/profile'

function signed<T extends Record<string, unknown>>(material: T) {
  return { ...material, digest: canonicalCandidateDigest(material) }
}

function evidence(kind: string, identity: string) {
  return {
    kind,
    identity,
    digest: canonicalCandidateDigest({ kind, identity }),
  }
}

/** Build a receipt for the exact cell Runtime scheduled during a profile experiment. */
export function createProfileImprovementRunReceipt(
  input: AgentProfileImprovementExperimentExecutionInput,
  score: number,
): AgentProfileImprovementRunReceipt {
  const executionId = `${input.arm}-${input.runCell.taskIndex}-${input.runCell.repetition}`
  const startedAtMs = input.runCell.repetition * 1_000
  return signed({
    kind: 'agent-profile-improvement-run' as const,
    digestAlgorithm: 'rfc8785-sha256' as const,
    executionId,
    executionRef: input.experiment.executionRef,
    runCell: input.runCell,
    runRecord: evidence('agent-eval-run-record', executionId),
    billing: [evidence('platform-billing', `bill-${executionId}`)] as [ReturnType<typeof evidence>],
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
      eventCount: 4,
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

function exactProfile(profile: AgentProfile): AgentProfile {
  return parseExactAgentProfile(
    omitUndefinedObjectFields(profile, 'profile improvement fixture'),
    'profile improvement fixture',
  )
}

const grader = {
  name: 'profile-quality',
  version: '1',
  format: 'tangle-grader' as const,
  artifact: {
    locator: {
      kind: 's3' as const,
      bucket: 'agent-eval',
      key: 'graders/profile-quality.json',
      region: 'us-east-1',
    },
    sha256: canonicalCandidateDigest({ artifact: 'profile-quality' }),
    byteLength: 1,
  },
}

const model = {
  requested: 'anthropic/claude-sonnet-4-6',
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  snapshot: '2026-06-01',
  reasoningEffort: 'medium' as const,
}

const limits = {
  timeoutMs: 30_000,
  maxSteps: 10,
  maxModelCalls: 2,
  maxInputTokens: 1_000,
  maxOutputTokens: 1_000,
  maxCostUsd: 1,
}

export interface ProfileImprovementFixture {
  evaluation: AgentImprovementEvaluation
  baselineProfile: AgentProfile
  candidateProfile: AgentProfile
  recommendedSize: SandboxSizePreset
  stateDigest(profile: AgentProfile): Sha256Digest
}

/** A valid opaque profile comparison: it contains changes and state hashes, never profiles. */
export function createProfileImprovementFixture(): ProfileImprovementFixture {
  const task = signed({
    kind: 'agent-profile-improvement-task' as const,
    digestAlgorithm: 'rfc8785-sha256' as const,
    scenario: {
      id: 'support-case-1',
      kind: 'support-case',
      digest: canonicalCandidateDigest({ scenario: 'support-case-1' }),
    },
    grader,
    model,
    limits,
  })
  const suite = signed({
    kind: 'agent-profile-improvement-suite' as const,
    digestAlgorithm: 'rfc8785-sha256' as const,
    splitDigest: canonicalCandidateDigest({ split: 'profile-final' }),
    taskDigests: [task.digest] as [typeof task.digest],
    reps: 3,
    seeds: [11, 12, 13] as [number, number, number],
  })
  const change = [
    {
      kind: 'agent-profile-diff' as const,
      id: 'add-source-and-uncertainty',
      source: { kind: 'optimizer' as const, artifacts: ['traces://run/profile-improvement-1'] },
      set: {
        prompt: {
          systemPrompt: 'Answer directly, cite the source, and state uncertainty.',
        },
        resources: {
          skills: [defineInlineResource('sources.SKILL.md', 'Cite the evidence you use.')],
        },
      },
    },
  ] as const satisfies readonly AgentProfileDiff[]
  const baselineProfile: AgentProfile = {
    name: 'support-agent',
    prompt: { systemPrompt: 'Answer directly.' },
    tools: { Read: true },
    resources: {
      skills: [defineInlineResource('support.SKILL.md', 'Use the support case context.')],
    },
  }
  const candidateProfile = exactProfile(applyAgentProfileDiff(baselineProfile, change[0]))
  const recommendedSize: SandboxSizePreset = 'small'
  const stateDigest = (profile: AgentProfile): Sha256Digest =>
    canonicalCandidateDigest({ definition: exactProfile(profile), recommendedSize })
  const baseline = { stateDigest: stateDigest(baselineProfile) }
  const candidate = { stateDigest: stateDigest(candidateProfile) }
  const executionRef = {
    kind: 'agent-profile-improvement-execution-ref' as const,
    identity: 'profile-improvement-fixture-runner',
    digest: canonicalCandidateDigest({ executor: 'profile-improvement-fixture-runner' }),
  }
  const experiment = signed({
    kind: 'agent-profile-improvement-experiment' as const,
    digestAlgorithm: 'rfc8785-sha256' as const,
    source: {
      kind: 'platform-agent-profile',
      sourceIdentity: 'profile-support',
      sourceDigest: baseline.stateDigest,
      sourceRevision: 7,
    },
    executionRef,
    baseline,
    candidate,
    change,
    candidateLineage: {
      source: 'optimizer' as const,
      parentDigests: [baseline.stateDigest],
      runIds: ['profile-improvement-1'],
      developmentSplitDigest: canonicalCandidateDigest({ split: 'profile-development' }),
    },
    benchmark: { suite, tasks: [task] as [typeof task] },
    policy: {
      confidenceLevel: 0.95,
      resamples: 100,
      bootstrapSeed: 17,
      deltaThreshold: 0,
      minProductiveRuns: 3,
      criticalDimensions: [],
      regressionTolerance: 0,
    },
  })

  const receipt = (arm: 'baseline' | 'candidate', repetition: number, score: number) => {
    const runCell = signed({
      kind: 'agent-profile-improvement-run-cell' as const,
      experimentDigest: experiment.digest,
      arm,
      stateDigest: experiment[arm].stateDigest,
      suiteDigest: suite.digest,
      taskDigest: task.digest,
      taskIndex: 0,
      repetition,
      seed: suite.seeds[repetition],
      attempt: 1,
    })
    const executionId = `${arm}-${repetition}`
    return signed({
      kind: 'agent-profile-improvement-run' as const,
      digestAlgorithm: 'rfc8785-sha256' as const,
      executionId,
      executionRef,
      runCell,
      runRecord: evidence('agent-eval-run-record', executionId),
      billing: [evidence('platform-billing', `bill-${executionId}`)] as [
        ReturnType<typeof evidence>,
      ],
      timing: {
        startedAtMs: repetition * 1_000,
        endedAtMs: repetition * 1_000 + 100,
        durationMs: 100,
      },
      steps: 1,
      resolvedModel: task.model,
      limits: task.limits,
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
        eventCount: 4,
        modelCallCount: 1,
      },
      output: evidence('platform-output', `output-${executionId}`),
      outcome: { status: 'succeeded' as const },
      grading: {
        grader,
        evidence: evidence('agent-eval-grading', `grade-${executionId}`),
        timing: {
          startedAtMs: repetition * 1_000 + 100,
          endedAtMs: repetition * 1_000 + 110,
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

  const estimate = (baselineValue: number, candidateValue: number) => ({
    baseline: baselineValue,
    candidate: candidateValue,
    delta: candidateValue - baselineValue,
    confidenceInterval: {
      level: 0.95,
      lower: candidateValue - baselineValue - 0.1,
      upper: candidateValue - baselineValue + 0.1,
      method: 'paired-bootstrap' as const,
      statistic: 'mean' as const,
      resamples: 100,
    },
    n: 3,
  })
  const comparison = agentProfileImprovementMeasuredComparisonSchema.parse({
    kind: 'agent-profile-improvement-measured-comparison',
    experiment,
    measurements: [0, 1, 2].map((repetition) => ({
      baseline: receipt('baseline', repetition, 0.2),
      candidate: receipt('candidate', repetition, 0.6),
    })),
    overall: {
      name: 'composite',
      ...estimate(0.2, 0.6),
      direction: 'higher-is-better',
      unit: 'score',
    },
    objectives: [
      {
        kind: 'objective',
        name: 'quality',
        direction: 'higher-is-better',
        unit: 'score',
        availability: 'measured',
        ...estimate(0.2, 0.6),
      },
      {
        kind: 'dimension',
        objective: 'quality',
        name: 'quality',
        direction: 'higher-is-better',
        unit: 'score',
        availability: 'measured',
        ...estimate(0.2, 0.6),
      },
      {
        kind: 'cost',
        name: 'cost',
        direction: 'lower-is-better',
        unit: 'usd',
        availability: 'measured',
        ...estimate(0.00000011, 0.00000011),
      },
      {
        kind: 'latency',
        name: 'latency',
        direction: 'lower-is-better',
        unit: 'milliseconds',
        availability: 'measured',
        ...estimate(110, 110),
      },
    ],
    decision: {
      outcome: 'ship',
      reasons: ['paired comparison passed'],
      contributingChecks: [{ name: 'paired-significance', passed: true }],
    },
    power: {
      sufficient: true,
      n: 3,
      minimumDetectableDelta: 0.1,
      confidenceLevel: 0.95,
      scaleAssumed: true,
      sharedScorerChannel: true,
      reason: 'three paired held-out runs',
    },
    provenance: {
      kind: 'agent-eval-loop',
      schema: 'agent-eval/profile-matrix/v1',
      runId: 'profile-improvement-1',
      recordDigest: canonicalCandidateDigest({ record: 'profile-improvement-1' }),
      baselineContentHash: baseline.stateDigest,
      candidateContentHash: candidate.stateDigest,
    },
    diff: 'prompt: add source and uncertainty instructions',
    evaluation: {
      generationsExplored: 1,
      preparation: {
        wallDurationMs: 0,
        cost: { usd: 0, provenance: 'observed' as const },
      },
      measurement: {
        wallDurationMs: 0,
        workDurationMs: 660,
        cost: { usd: 0.00000066, provenance: 'observed' as const },
      },
      total: {
        wallDurationMs: 0,
        cost: { usd: 0.00000066, provenance: 'observed' as const },
      },
    },
  })
  return {
    evaluation: comparison,
    baselineProfile,
    candidateProfile,
    recommendedSize,
    stateDigest,
  }
}
