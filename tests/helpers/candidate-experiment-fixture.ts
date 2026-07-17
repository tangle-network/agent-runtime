import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { InMemoryTraceStore } from '@tangle-network/agent-eval'
import {
  type CandidateExperimentExecutionInput,
  sealCandidateBenchmarkSuite,
  sealCandidateExperiment,
} from '@tangle-network/agent-eval/contract'
import type {
  AgentCandidateBundle,
  AgentCandidateExperiment,
  CandidateExecutionEvidence,
} from '@tangle-network/agent-interface'

import { InMemoryAgentCandidateExecutionClaimStore } from '../../src/candidate-execution/claim'
import { sha256Bytes } from '../../src/candidate-execution/digest'
import type { AgentCandidateExperimentCellPlacement } from '../../src/intelligence/improvement-cycle'
import {
  type CandidateExecutionFixture,
  candidateSha,
  createCandidateOutputExecutionFixture,
  createCandidateOutputFixture,
  emptyCandidateSnapshot,
  redigestCandidateBundle,
} from './candidate-execution-fixture'

const roots: string[] = []

export interface CandidateExperimentFixture {
  fixture: CandidateExecutionFixture
  experiment: AgentCandidateExperiment
  placeCell(input: CandidateExperimentExecutionInput): AgentCandidateExperimentCellPlacement
}

export interface CreateCandidateExperimentFixtureOptions {
  baseline?: AgentCandidateBundle
  candidate?: AgentCandidateBundle
  candidateSurface?: 'prompt' | 'memory'
  reps?: number
  scoreFor?: (input: CandidateExperimentExecutionInput) => number
  configureFixture?: (fixture: CandidateExecutionFixture) => void
}

export function cleanupCandidateExperimentFixtures(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}

export function createCandidateExperimentFixture(
  options: CreateCandidateExperimentFixtureOptions = {},
): CandidateExperimentFixture {
  const fixture = createCandidateOutputExecutionFixture('text/plain', 1_024)
  options.configureFixture?.(fixture)
  const baseline = options.baseline ?? fixture.bundle
  const candidate =
    options.candidate ??
    (options.candidateSurface === 'memory'
      ? redigestCandidateBundle(baseline, { memory: { mode: 'isolated', scope: 'task' } })
      : redigestCandidateBundle(baseline, {
          profile: {
            ...baseline.profile,
            prompt: {
              ...baseline.profile.prompt,
              systemPrompt: 'Return the exact measured answer.',
            },
          },
        }))
  const reps = options.reps ?? 3
  const seeds = Array.from({ length: reps }, (_, index) => 101 + index) as [number, ...number[]]
  const experiment = sealCandidateExperiment({
    kind: 'agent-candidate-experiment',
    digestAlgorithm: 'rfc8785-sha256',
    baseline,
    candidate,
    candidateLineage: { source: 'human' },
    benchmark: sealCandidateBenchmarkSuite({ tasks: [fixture.task.task], reps, seeds }),
    policy: {
      confidenceLevel: 0.95,
      resamples: 500,
      bootstrapSeed: 1_337,
      deltaThreshold: 0,
      minProductiveRuns: 3,
      budgetUsd: 1,
      criticalDimensions: ['quality'],
      regressionTolerance: 0.05,
    },
  })
  const memoryBefore = emptyCandidateSnapshot('experiment-memory-before')
  fixture.ports.memory.reset = async ({ preparationId, expiresAtMs }) => ({
    preparationId,
    accessDigest: candidateSha('8'),
    expiresAtMs,
    evidence: memoryBefore.manifest,
    emptyStateDigest: memoryBefore.digest,
    beforeState: memoryBefore,
  })
  fixture.ports.memory.activate = async ({ effectiveNamespace }) => ({
    env: { TANGLE_MEMORY_NAMESPACE: effectiveNamespace },
  })
  fixture.ports.memory.close = async () => ({ closed: true })

  return {
    fixture,
    experiment,
    placeCell(input) {
      const taskRoot = temporaryRoot('candidate-experiment-task-')
      const profileRoot = temporaryRoot('candidate-experiment-profile-')
      const traceStore = new InMemoryTraceStore()
      const outputs = createCandidateOutputFixture()
      const score = options.scoreFor?.(input) ?? (input.arm === 'candidate' ? 1 : 0)
      const output = Buffer.from(score === 1 ? 'strong' : 'weak', 'utf8')
      return {
        executionId: [
          'experiment',
          input.arm,
          input.benchmarkCell.taskIndex,
          input.benchmarkCell.repetition,
        ].join('-'),
        executionRoots: { taskRoot: '/workspace/task' },
        stagingRoots: { taskRoot, profileRoot },
        ports: fixture.ports,
        execution: {
          executor: {
            execute: async (request, context) => {
              const startedAt = 1_000 + input.benchmarkCell.repetition * 100
              await context.traceStore.appendRun({
                runId: request.trace.runId,
                scenarioId: request.benchmark.task.scenario.id,
                startedAt,
                endedAt: startedAt + 50,
                status: 'completed',
                tags: { ...request.trace.tags },
              })
              return {
                executionId: request.executionId,
                termination: { kind: 'exit' as const, exitCode: 0 },
              }
            },
            stop: async () => ({ stopped: true }),
            capture: async () => ({
              taskOutcome: { kind: 'output' as const, bytes: output },
              ...(input.bundle.memory.mode === 'isolated'
                ? {
                    memoryAfter: {
                      afterState: memoryBefore.material,
                      archive: Buffer.from('empty experiment memory', 'utf8'),
                    },
                  }
                : {}),
            }),
          },
          grader: {
            ...outputs.grader,
            run: async ({ implementation, outcome, signal }) => {
              signal.throwIfAborted()
              if (outcome.kind !== 'output') throw new Error('fixture grader requires output')
              const measured = Buffer.from(outcome.bytes).toString('utf8') === 'strong' ? 1 : 0
              const evidence = Buffer.from(JSON.stringify({ score: measured }), 'utf8')
              return {
                evaluation: {
                  score: measured,
                  passed: measured === 1,
                  dimensions: { quality: measured },
                  raw: {},
                },
                evidence,
                binding: {
                  implementationDigest: sha256Bytes(implementation.bytes),
                  taskOutcomeDigest: outcome.evidence.digest,
                  outputDigest: sha256Bytes(evidence),
                },
              }
            },
          },
          outputArtifacts: outputs.outputArtifacts,
          traceStore,
          claimStore: new InMemoryAgentCandidateExecutionClaimStore(),
        },
      }
    },
  }
}

export async function executeCandidateExperimentInput(
  input: CandidateExperimentExecutionInput,
  placeCell: CandidateExperimentFixture['placeCell'],
  execute: (
    input: CandidateExperimentExecutionInput & AgentCandidateExperimentCellPlacement,
  ) => Promise<CandidateExecutionEvidence>,
): Promise<CandidateExecutionEvidence> {
  return await execute({ ...input, ...placeCell(input) })
}

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}
