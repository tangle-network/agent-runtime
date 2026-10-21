import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { FileCoordinationLog } from '../../src/runtime/supervise/coordination-log'
import type { DriverAgentOptions } from '../../src/runtime/supervise/driver-agent-options'
import { driverAgent } from '../../src/runtime/supervise/driver-brain-agent'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import type { ToolLoopChat } from '../../src/runtime/tool-loop'
import { scriptedBrain } from './scripted-brain'
import { testAgentProfile } from './test-agent-profile'

// ── Offline scripted leaf worker (no network/sandbox/LLM) ────────────────────────
interface WorkerScript {
  readonly out: unknown
  readonly tokens: { input: number; output: number }
  readonly iterations: number
  readonly score: number
}

function workerExecutor(s: WorkerScript, onTeardown?: () => void, delayMs = 0): Executor<unknown> {
  const events: UsageEvent[] = []
  for (let i = 0; i < s.iterations; i += 1) events.push({ kind: 'iteration' })
  events.push({ kind: 'tokens', input: s.tokens.input, output: s.tokens.output })
  return {
    runtime: 'router',
    execute() {
      return (async function* () {
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
        for (const ev of events) yield ev
      })()
    },
    teardown: () => {
      onTeardown?.()
      return Promise.resolve({ destroyed: true })
    },
    resultArtifact(): ExecutorResult<unknown> {
      return {
        outRef: `w:${JSON.stringify(s.out)}`,
        out: s.out,
        verdict: { valid: true, score: s.score },
        spent: { iterations: s.iterations, tokens: { ...s.tokens }, usd: 0, ms: 0 },
      }
    },
  }
}

function workerLeaf(
  name: string,
  s: WorkerScript,
  onTeardown?: () => void,
  delayMs = 0,
): Agent<unknown, unknown> {
  const spec: AgentSpec = {
    profile: testAgentProfile(name),
    harness: null,
    executor: workerExecutor(s, onTeardown, delayMs),
  }
  return { name, act: async () => s.out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

const perWorker: Budget = { maxIterations: 4, maxTokens: 1000 }

const spawnOnly = ['spawn_worker'] as const

function driverOpts(
  name: string,
  brain: ToolLoopChat,
  makeWorkerAgent: (p: AgentProfile) => Agent<unknown, unknown>,
): DriverAgentOptions {
  return {
    name,
    brain,
    blobs: SHARED_BLOBS,
    makeWorkerAgent,
    perWorker,
    toolNames: spawnOnly,
    systemPrompt: `drive the worker to do: <task>`,
    maxTurns: 8,
  }
}

// One shared blob store so observe/finalize reads settled outputs across the whole tree.
let SHARED_BLOBS = new InMemoryResultBlobStore()

const dummyWorker = (_p: AgentProfile): Agent<unknown, unknown> =>
  workerLeaf('w', { out: {}, tokens: { input: 0, output: 0 }, iterations: 0, score: 0 })

it('recovers an accepted direct result after the driver dies before it settles', async () => {
  SHARED_BLOBS = new InMemoryResultBlobStore()
  const journal = new InMemorySpawnJournal()
  const runId = 'direct-submit-recovery'
  const rootIdentity = {
    profileDigest: canonicalCandidateDigest({ name: 'direct-submit-recovery-root' }),
    taskDigest: canonicalCandidateDigest({ task: 'solve it' }),
  }
  const logDir = await mkdtemp(join(tmpdir(), 'direct-submit-recovery-'))
  const log = new FileCoordinationLog(join(logDir, 'coordination.jsonl'))
  let checks = 0
  let resumedBrainCalls = 0
  const deliverable = {
    check: (result: unknown) => {
      checks += 1
      return (result as { answer?: unknown }).answer === 42
    },
  }
  try {
    const interrupted = driverAgent({
      ...driverOpts(
        'root',
        scriptedBrain([
          { toolCalls: [{ name: 'submit_result', arguments: { result: { answer: 42 } } }] },
        ]),
        dummyWorker,
      ),
      toolNames: ['submit_result'],
      deliverable,
      onEvent: (_event, record) => log.append(runId, record, 'root'),
      // The submission acknowledgement has returned to the driver. Throw before the root scope
      // settles to model a coordinator process that dies in exactly that window.
      onAcceptedSubmission: () => {
        throw new Error('simulated coordinator loss after accepted submission')
      },
    })
    const first = await createSupervisor<unknown, unknown>().run(interrupted, 'solve it', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId,
      journal,
      blobs: SHARED_BLOBS,
      executors: createExecutorRegistry(),
      rootIdentity,
      maxDepth: 2,
      now: () => 0,
    })
    expect(first.kind).toBe('no-winner')

    const priorCoordination = await log.load(runId, 'root')
    expect(priorCoordination.records.map((record) => record.event.type)).toEqual(['submission'])

    const resumed = driverAgent({
      ...driverOpts(
        'root',
        async () => {
          resumedBrainCalls += 1
          throw new Error('a recovered accepted result must not call the driver again')
        },
        dummyWorker,
      ),
      toolNames: ['submit_result'],
      deliverable,
      priorCoordination,
    })
    const second = await createSupervisor<unknown, unknown>().run(resumed, 'solve it', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId,
      journal,
      blobs: SHARED_BLOBS,
      executors: createExecutorRegistry(),
      rootIdentity,
      maxDepth: 2,
      resume: true,
      now: () => 0,
    })

    expect(second.kind).toBe('winner')
    if (second.kind === 'winner') expect(second.out).toEqual({ answer: 42 })
    expect(checks).toBe(1)
    expect(resumedBrainCalls).toBe(0)
  } finally {
    await rm(logDir, { recursive: true, force: true })
  }
})
