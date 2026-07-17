import type { BenchmarkEvaluation } from '@tangle-network/agent-eval'
import type {
  AgentCandidateBenchmarkGraderIdentity,
  AgentCandidateFixedSpend,
  AgentCandidateTermination,
} from '@tangle-network/agent-interface'

import { readVerifiedArtifact } from './artifacts'
import { canonicalCandidateDigest, immutableCandidateValue, sha256Bytes } from './digest'
import type {
  AgentCandidateBenchmarkGraderPort,
  AgentCandidateOutputArtifactPort,
  VerifiedAgentCandidateTaskOutcome,
} from './types'

export interface BoundAgentCandidateBenchmarkRun {
  readonly grader: AgentCandidateBenchmarkGraderIdentity
  readonly grading: {
    readonly usage: AgentCandidateFixedSpend
    readonly timing: {
      readonly startedAtMs: number
      readonly endedAtMs: number
      readonly durationMs: number
    }
  }
  readonly evaluation: BenchmarkEvaluation
  readonly evidence: Uint8Array
}

/**
 * Admit verified grader bytes to the evaluator runner and reject any result
 * that is not bound to those bytes, the exact task outcome, and its raw output.
 */
export async function runBoundCandidateBenchmarkGrader(input: {
  executionId: string
  termination: AgentCandidateTermination
  outcome: VerifiedAgentCandidateTaskOutcome
  expectedGrader: AgentCandidateBenchmarkGraderIdentity
  grader: AgentCandidateBenchmarkGraderPort
  artifacts: AgentCandidateOutputArtifactPort
  signal?: AbortSignal
}): Promise<BoundAgentCandidateBenchmarkRun> {
  input.signal?.throwIfAborted()
  const descriptor = snapshotGraderDescriptor(input.grader, input.expectedGrader)
  const implementationBytes = await readVerifiedArtifact(descriptor.artifact, input.artifacts)
  if (implementationBytes.byteLength === 0) {
    throw new Error('candidate benchmark grader implementation cannot be empty')
  }
  const expectedImplementationDigest = sha256Bytes(implementationBytes)
  const termination = immutableCandidateValue(input.termination)
  const run = input.grader.run
  const startedAtMs = Date.now()
  const result = await run(
    Object.freeze({
      executionId: input.executionId,
      termination,
      outcome: input.outcome,
      implementation: detachedImplementation(implementationBytes),
      signal: input.signal ?? new AbortController().signal,
    }),
  )
  const endedAtMs = Math.max(startedAtMs, Date.now())
  input.signal?.throwIfAborted()
  assertExactRunnerResult(result)

  const evidence = Uint8Array.from(result.evidence)
  const outputDigest = sha256Bytes(evidence)
  if (result.binding.implementationDigest !== expectedImplementationDigest) {
    throw new Error(
      'candidate benchmark grader executed implementation digest does not match its verified artifact',
    )
  }
  if (result.binding.taskOutcomeDigest !== input.outcome.evidence.digest) {
    throw new Error(
      'candidate benchmark grader task outcome digest does not match verified outcome',
    )
  }
  if (result.binding.outputDigest !== outputDigest) {
    throw new Error('candidate benchmark grader raw output digest does not match returned evidence')
  }

  return Object.freeze({
    grader: descriptor,
    grading: immutableCandidateValue({
      usage: emptyFixedSpend(),
      timing: {
        startedAtMs,
        endedAtMs,
        durationMs: endedAtMs - startedAtMs,
      },
    }),
    evaluation: result.evaluation,
    evidence,
  })
}

function snapshotGraderDescriptor(
  grader: AgentCandidateBenchmarkGraderPort,
  expected: AgentCandidateBenchmarkGraderIdentity,
): BoundAgentCandidateBenchmarkRun['grader'] {
  if (!grader.name || !grader.version) {
    throw new Error('candidate benchmark grader name and version must be non-empty')
  }
  const actual = {
    name: grader.name,
    version: grader.version,
    format: 'tangle-grader' as const,
    artifact: grader.artifact,
  }
  if (canonicalCandidateDigest(actual) !== canonicalCandidateDigest(expected)) {
    throw new Error('candidate benchmark grader does not match the signed task grader')
  }
  return immutableCandidateValue(expected)
}

function emptyFixedSpend(): AgentCandidateFixedSpend {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    modelCalls: 0,
    costUsdNanos: 0,
  }
}

function detachedImplementation(bytes: Uint8Array): {
  readonly byteLength: number
  readonly bytes: Uint8Array
} {
  const stored = Uint8Array.from(bytes)
  return Object.freeze({
    byteLength: stored.byteLength,
    get bytes(): Uint8Array {
      return Uint8Array.from(stored)
    },
  })
}

function assertExactRunnerResult(
  value: unknown,
): asserts value is Awaited<ReturnType<AgentCandidateBenchmarkGraderPort['run']>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('candidate benchmark grader result must be an object')
  }
  const result = value as Record<string, unknown>
  const keys = Object.keys(result).sort()
  if (
    keys.length !== 3 ||
    keys[0] !== 'binding' ||
    keys[1] !== 'evaluation' ||
    keys[2] !== 'evidence'
  ) {
    throw new Error('candidate benchmark grader returned unknown or missing fields')
  }
  if (!(result.evidence instanceof Uint8Array)) {
    throw new Error('candidate benchmark grader evidence must be bytes')
  }
  if (
    result.binding === null ||
    typeof result.binding !== 'object' ||
    Array.isArray(result.binding)
  ) {
    throw new Error('candidate benchmark grader binding must be an object')
  }
  const bindingKeys = Object.keys(result.binding).sort()
  if (
    bindingKeys.length !== 3 ||
    bindingKeys[0] !== 'implementationDigest' ||
    bindingKeys[1] !== 'outputDigest' ||
    bindingKeys[2] !== 'taskOutcomeDigest'
  ) {
    throw new Error('candidate benchmark grader binding returned unknown or missing fields')
  }
}
