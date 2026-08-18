import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createEvidenceReceipt,
  isIndependentEvidence,
  verifyEvidenceReceipt,
} from '@tangle-network/agent-eval/experiment'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { supervisePursuit } from '../../src/durable/supervise-pursuit'
import type { DriveHarness } from '../../src/runtime/supervise/supervisor-agent'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { testAgentProfile } from '../kernel/test-agent-profile'

const budget: Budget = { maxIterations: 100, maxTokens: 100_000 }
const perWorker: Budget = { maxIterations: 4, maxTokens: 1_000 }

function deliveringLeaf(name: string, out: unknown): Agent<unknown, unknown> {
  const executor: Executor<unknown> = {
    runtime: 'deterministic-integration-worker',
    execute() {
      return (async function* () {
        yield { kind: 'iteration' } as UsageEvent
        yield { kind: 'tokens', input: 5, output: 5 } as UsageEvent
        yield { kind: 'cost', usd: 0 } as UsageEvent
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: (): ExecutorResult<unknown> => ({
      outRef: `integration:${name}`,
      out,
      verdict: { valid: true, score: 1 },
      spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
    }),
  }
  const spec: AgentSpec = {
    profile: testAgentProfile(name),
    harness: null,
    executor,
  }
  return {
    name,
    act: async () => out,
    executorSpec: spec,
  } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
}

async function jsonRpc(url: string, method: string, params: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!response.ok) throw new Error(`coordination MCP returned ${response.status}`)
  return response.json()
}

describe('Runtime pursuit -> Eval evidence', () => {
  it('binds one real recursive Runtime execution to independently verifiable evidence', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'runtime-eval-pursuit-'))
    const pursuitId = 'pursuit:runtime-eval-e2e'
    const runId = 'run:runtime-eval-e2e:1'
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl }) => {
      await jsonRpc(coordinationMcpUrl, 'tools/call', {
        name: 'spawn_agent',
        arguments: {
          profile: testAgentProfile('evidence-worker'),
          task: 'produce the measured artifact',
        },
      })
      await jsonRpc(coordinationMcpUrl, 'tools/call', {
        name: 'await_event',
        arguments: { kinds: ['settled'] },
      })
      await jsonRpc(coordinationMcpUrl, 'tools/call', {
        name: 'stop',
        arguments: {},
      })
    }

    try {
      const executed = await supervisePursuit(
        testAgentProfile('evidence-root', {
          harness: 'opencode',
          prompt: { systemPrompt: 'Delegate once, wait for the result, then stop.' },
        }),
        'produce independently measurable output',
        {
          pursuitId,
          runId,
          runDir,
          budget,
          perWorker,
          driveHarness,
          makeWorkerAgent: () => deliveringLeaf('evidence-worker', { answer: 42 }),
        },
      )

      expect(executed.result.kind).toBe('winner')
      expect(executed.pursuit).toMatchObject({ pursuitId })
      expect(executed.pursuit.runs).toEqual([expect.objectContaining({ runId, status: 'done' })])
      expect(executed.pursuit.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            runId,
            label: 'evidence-worker',
            status: 'done',
            valid: true,
          }),
        ]),
      )

      const inputSetCommitment = canonicalCandidateDigest({
        suite: 'hidden-runtime-eval-e2e',
        version: 1,
      })
      const receipt = createEvidenceReceipt(
        {
          pursuitId,
          runId,
          candidateDigest: canonicalCandidateDigest({ candidate: { answer: 42 } }),
          evaluatorDigest: canonicalCandidateDigest({ evaluator: 'exact-answer@1' }),
          environmentDigest: canonicalCandidateDigest({ environment: 'deterministic-worker@1' }),
          inputSetCommitment,
          outputDigest: canonicalCandidateDigest({ output: { answer: 42 } }),
          resultDigest: canonicalCandidateDigest({ score: 1, passed: true }),
          authority: {
            kind: 'independent-evaluator',
            id: 'runtime-eval-e2e-checker@1',
          },
          observerDigest: executed.pursuit.chainTip,
        },
        {
          modelVersions: { evaluator: 'deterministic-exact-checker@1' },
          codeSha: canonicalCandidateDigest({ code: 'runtime-eval-e2e-checker@1' }),
          inputsHash: inputSetCommitment,
          createdAt: '2026-08-18T00:00:00.000Z',
        },
      )

      expect(verifyEvidenceReceipt(receipt)).toEqual({ valid: true })
      expect(isIndependentEvidence(receipt)).toBe(true)
      expect(receipt.binding).toMatchObject({
        pursuitId,
        runId,
        observerDigest: executed.pursuit.chainTip,
      })

      expect(
        verifyEvidenceReceipt({
          ...receipt,
          binding: {
            ...receipt.binding,
            observerDigest: canonicalCandidateDigest({ forged: 'observer' }),
          },
        }).valid,
      ).toBe(false)
    } finally {
      await rm(runDir, { recursive: true, force: true })
    }
  })
})
