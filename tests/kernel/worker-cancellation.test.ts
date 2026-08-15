/**
 * Acknowledged worker cancellation (#758): the run-layout `cancelWorker` contract applied by the
 * coordination driver's turn-loop acknowledger.
 *
 * Every test runs the REAL runtime path — scripted brain, real `Scope` spawns, a real file-backed
 * spawn journal in the same run directory the cancellation records live in — and reads the
 * durable layout the way an external client would.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it } from 'vitest'
import { FileSpawnJournal, InMemoryResultBlobStore } from '../../src/durable/spawn-journal'
import type { CoordinationEvent } from '../../src/mcp/tools/coordination'
import {
  type DriverAgentOptions,
  driverAgent,
} from '../../src/runtime/supervise/coordination-driver'
import { driverChild, withDriverExecutor } from '../../src/runtime/supervise/driver-executor'
import {
  cancelWorker,
  readWorkerCancellation,
  readWorkerCancelRequests,
  workerCancelRequestsFile,
} from '../../src/runtime/supervise/run-layout'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  SpawnEvent,
} from '../../src/runtime/supervise/types'
import type { ToolLoopChat } from '../../src/runtime/tool-loop'
import { type ScriptedTurn, scriptedBrain } from './scripted-brain'
import { testAgentProfile } from './test-agent-profile'

const perWorker: Budget = { maxIterations: 4, maxTokens: 1000 }

/** A worker that runs until its per-child signal aborts, then settles down. */
function hangingLeaf(
  name: string,
  hooks: { onStart?: () => void; onAbort?: () => void } = {},
): Agent<unknown, unknown> {
  const executor: Executor<unknown> = {
    runtime: 'router',
    execute(_task: unknown, signal: AbortSignal): Promise<ExecutorResult<unknown>> {
      hooks.onStart?.()
      return new Promise((_, reject) => {
        const fail = () => {
          hooks.onAbort?.()
          reject(new Error('aborted'))
        }
        if (signal.aborted) {
          fail()
          return
        }
        signal.addEventListener('abort', fail, { once: true })
      })
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact(): ExecutorResult<unknown> {
      return {
        outRef: 'never',
        out: {},
        verdict: { valid: false, score: 0 },
        spent: { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
      }
    },
  }
  const spec: AgentSpec = { profile: testAgentProfile(name), harness: null, executor }
  return { name, act: async () => ({}), executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

/** A worker that settles `done` with a valid verdict the moment it runs. */
function doneLeaf(name: string, out: unknown): Agent<unknown, unknown> {
  const artifact: ExecutorResult<unknown> = {
    outRef: `w:${JSON.stringify(out)}`,
    out,
    verdict: { valid: true, score: 1 },
    spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
  }
  const executor: Executor<unknown> = {
    runtime: 'router',
    execute: () => Promise.resolve(artifact),
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: () => artifact,
  }
  const spec: AgentSpec = { profile: testAgentProfile(name), harness: null, executor }
  return { name, act: async () => out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

function driverOpts(
  name: string,
  brain: ToolLoopChat,
  makeWorkerAgent: (p: AgentProfile) => Agent<unknown, unknown>,
  blobs: InMemoryResultBlobStore,
  extra: Partial<DriverAgentOptions> = {},
): DriverAgentOptions {
  return {
    name,
    brain,
    blobs,
    makeWorkerAgent,
    perWorker,
    systemPrompt: 'drive',
    maxTurns: 12,
    ...extra,
  }
}

const dirs: string[] = []
function runDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'worker-cancel-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const spawnCall = (label: string, kind = 'hang'): ScriptedTurn['toolCalls'] => [
  { name: 'spawn_agent', arguments: { profile: { metadata: { kind } }, task: 'go', label } },
]
const awaitTurn: ScriptedTurn = { toolCalls: [{ name: 'await_event', arguments: {} }] }

describe('acknowledged worker cancellation (#758)', () => {
  it('repeating one operationId applies cancellation once and returns the same record', async () => {
    const dir = runDir()
    const blobs = new InMemoryResultBlobStore()
    const journal = new FileSpawnJournal(join(dir, 'spawn-journal.jsonl'))
    let abortCount = 0
    let markStarted: (() => void) | undefined
    const workerStarted = new Promise<void>((resolveGate) => {
      markStarted = resolveGate
    })
    const makeAgent = (_p: AgentProfile) =>
      hangingLeaf('a', {
        onStart: () => markStarted?.(),
        onAbort: () => {
          abortCount += 1
        },
      })

    const script = scriptedBrain([
      { toolCalls: spawnCall('a') },
      { toolCalls: [{ name: 'list_questions', arguments: {} }] },
      awaitTurn,
      { content: 'stopping' },
    ])
    let call = 0
    const chat: ToolLoopChat = async (messages, tools, context) => {
      const index = call
      call += 1
      if (index === 1) {
        // The worker is observably RUNNING before the operation is issued — twice, with one
        // operationId. The second call finds the pending request and appends nothing.
        await workerStarted
        const first = cancelWorker(dir, 'a', 'op-once', { reason: 'test', source: 'test' })
        expect(first.effect).toBe('unknown')
        const second = cancelWorker(dir, 'a', 'op-once')
        expect(second.requestedAt).toBe(first.requestedAt)
      }
      return script(messages, tools, context)
    }
    const root = driverAgent(driverOpts('root', chat, makeAgent, blobs, { controlDir: dir }))
    await createSupervisor<unknown, unknown>().run(root, 'x', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'run-once',
      journal,
      blobs,
      executors: createExecutorRegistry(),
      maxDepth: 2,
    })

    const acknowledged = readWorkerCancellation(dir, 'op-once')
    expect(acknowledged?.effect).toBe('cancelled')
    expect(acknowledged?.workerId).toBe('run-once:s0')
    expect(acknowledged?.terminated).toEqual(['run-once:s0'])
    expect(abortCount).toBe(1)

    // Repeating the operation AFTER acknowledgement is a pure lookup: the identical record comes
    // back, no new request line lands, and the abort count stays 1.
    const repeated = cancelWorker(dir, 'a', 'op-once')
    expect(repeated).toEqual(acknowledged)
    const requestLines = readFileSync(workerCancelRequestsFile(dir), 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
    expect(requestLines).toHaveLength(1)
    expect(readWorkerCancelRequests(dir)).toHaveLength(1)
    expect(abortCount).toBe(1)
  })

  it('cancelling one child leaves siblings running until they settle normally', async () => {
    const dir = runDir()
    const blobs = new InMemoryResultBlobStore()
    const journal = new FileSpawnJournal(join(dir, 'spawn-journal.jsonl'))
    // The keeper finishes only after the victim's abort fired — so it was LIVE through the
    // cancellation and its normal settlement afterwards is the isolation proof.
    let releaseKeeper: (() => void) | undefined
    const victimAborted = new Promise<void>((resolveGate) => {
      releaseKeeper = resolveGate
    })
    let markVictimStarted: (() => void) | undefined
    const victimStarted = new Promise<void>((resolveGate) => {
      markVictimStarted = resolveGate
    })
    const keeperOut = { answer: 'kept' }
    const makeAgent = (p: AgentProfile): Agent<unknown, unknown> => {
      if (p.metadata?.kind === 'victim') {
        return hangingLeaf('victim', {
          onStart: () => markVictimStarted?.(),
          onAbort: () => releaseKeeper?.(),
        })
      }
      const artifact: ExecutorResult<unknown> = {
        outRef: `w:${JSON.stringify(keeperOut)}`,
        out: keeperOut,
        verdict: { valid: true, score: 1 },
        spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
      }
      const executor: Executor<unknown> = {
        runtime: 'router',
        execute: async (_task, signal) => {
          if (signal.aborted) throw new Error('keeper aborted')
          await victimAborted
          if (signal.aborted) throw new Error('keeper aborted')
          return artifact
        },
        teardown: () => Promise.resolve({ destroyed: true }),
        resultArtifact: () => artifact,
      }
      const spec: AgentSpec = { profile: testAgentProfile('keeper'), harness: null, executor }
      return { name: 'keeper', act: async () => keeperOut, executorSpec: spec } as Agent<
        unknown,
        unknown
      > & { executorSpec: AgentSpec }
    }

    const script = scriptedBrain([
      {
        toolCalls: [
          ...(spawnCall('victim', 'victim') ?? []),
          ...(spawnCall('keeper', 'keeper') ?? []),
        ],
      },
      { toolCalls: [{ name: 'list_questions', arguments: {} }] },
      awaitTurn,
      awaitTurn,
      { content: 'stopping' },
    ])
    let call = 0
    const chat: ToolLoopChat = async (messages, tools, context) => {
      const index = call
      call += 1
      if (index === 1) {
        await victimStarted
        cancelWorker(dir, 'victim', 'op-sibling', { source: 'test' })
      }
      return script(messages, tools, context)
    }
    const root = driverAgent(driverOpts('root', chat, makeAgent, blobs, { controlDir: dir }))
    const result = await createSupervisor<unknown, unknown>().run(root, 'x', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'run-sibling',
      journal,
      blobs,
      executors: createExecutorRegistry(),
      maxDepth: 2,
    })

    // The sibling settled normally and won; the response names ONLY the cancelled worker.
    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') expect(result.out).toEqual(keeperOut)
    const record = readWorkerCancellation(dir, 'op-sibling')
    expect(record?.effect).toBe('cancelled')
    expect(record?.terminated).toEqual(['run-sibling:s0'])
    const tree = (await journal.loadTree('run-sibling')) as SpawnEvent[]
    expect(
      tree.some((e) => e.kind === 'settled' && e.id === 'run-sibling:s1' && e.status === 'done'),
    ).toBe(true)
  })

  it('cancelling a lead names every terminated descendant while a sibling subtree survives', async () => {
    const dir = runDir()
    const blobs = new InMemoryResultBlobStore()
    const journal = new FileSpawnJournal(join(dir, 'spawn-journal.jsonl'))

    // Gate: the cancel request is written only once BOTH of the lead's workers are live, so the
    // terminated set has real descendants to prove.
    let started = 0
    let markStarted: (() => void) | undefined
    const leadWorkersLive = new Promise<void>((resolveGate) => {
      markStarted = () => {
        started += 1
        if (started >= 2) resolveGate()
      }
    })

    const makeAgent = (p: AgentProfile): Agent<unknown, unknown> => {
      const kind = p.metadata?.kind
      if (kind === 'lead') {
        const leadBrain = scriptedBrain([
          { toolCalls: [...(spawnCall('d1') ?? []), ...(spawnCall('d2') ?? [])] },
          awaitTurn, // repeats forever — the lead never stops on its own
        ])
        return driverChild(
          testAgentProfile('lead'),
          driverAgent(driverOpts('lead', leadBrain, makeAgent, blobs)),
          journal,
        )
      }
      if (kind === 'peer') {
        const peerBrain = scriptedBrain([
          { toolCalls: spawnCall('peer-worker', 'peer-worker') },
          awaitTurn,
          { content: 'peer done' },
        ])
        return driverChild(
          testAgentProfile('peer'),
          driverAgent(driverOpts('peer', peerBrain, makeAgent, blobs)),
          journal,
        )
      }
      if (kind === 'peer-worker') return doneLeaf('peer-worker', { answer: 'peer' })
      return hangingLeaf(kind === 'hang' ? 'd' : String(kind), { onStart: () => markStarted?.() })
    }

    const rootScript = scriptedBrain([
      {
        toolCalls: [
          {
            name: 'spawn_agent',
            arguments: {
              profile: { metadata: { kind: 'lead' } },
              task: 'go',
              label: 'lead',
              // The lead's reservation must afford BOTH of its nested workers at the nested
              // per-worker default (1000 tokens each) plus its own inference.
              budget: { maxTokens: 10_000, maxIterations: 20 },
            },
          },
          ...(spawnCall('peer', 'peer') ?? []),
        ],
      },
      awaitTurn, // the peer subtree delivers
      awaitTurn, // the cancelled lead settles down
      { content: 'stopping' },
    ])
    let call = 0
    const rootChat: ToolLoopChat = async (messages, tools, context) => {
      const index = call
      call += 1
      if (index === 1) {
        await leadWorkersLive
        cancelWorker(dir, 'lead', 'op-lead', { reason: 'subtree test', source: 'test' })
      }
      return rootScript(messages, tools, context)
    }

    const root = driverAgent(driverOpts('root', rootChat, makeAgent, blobs, { controlDir: dir }))
    const result = await createSupervisor<unknown, unknown>().run(root, 'x', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'run-lead',
      journal,
      blobs,
      executors: withDriverExecutor(createExecutorRegistry()),
      maxDepth: 4,
    })

    const record = readWorkerCancellation(dir, 'op-lead')
    expect(record?.effect).toBe('cancelled')
    // The record names the SET the cascade terminated: the lead plus both nested workers.
    expect(record?.terminated).toEqual(['run-lead:s0', 'run-lead:s0:s0', 'run-lead:s0:s1'])
    // The sibling subtree survived and delivered through its own worker.
    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') expect(result.out).toEqual({ answer: 'peer' })
  })

  it('a reconnecting client reads the acknowledged result from the layout alone', async () => {
    const dir = runDir()
    const blobs = new InMemoryResultBlobStore()
    const journal = new FileSpawnJournal(join(dir, 'spawn-journal.jsonl'))
    const makeAgent = (_p: AgentProfile) => hangingLeaf('a')

    cancelWorker(dir, 'a', 'op-reconnect', { source: 'test' })
    const chat = scriptedBrain([{ toolCalls: spawnCall('a') }, awaitTurn, { content: 'stopping' }])
    const root = driverAgent(driverOpts('root', chat, makeAgent, blobs, { controlDir: dir }))
    await createSupervisor<unknown, unknown>().run(root, 'x', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'run-reconnect',
      journal,
      blobs,
      executors: createExecutorRegistry(),
      maxDepth: 2,
    })

    // A fresh client holds NOTHING in process — it derives everything from the directory.
    const read = readWorkerCancellation(dir, 'op-reconnect')
    expect(read?.effect).toBe('cancelled')
    expect(read?.worker).toBe('a')
    expect(read?.workerId).toBe('run-reconnect:s0')
    expect(read?.terminated).toEqual(['run-reconnect:s0'])
    // The one-export reconnect path answers identically: repeating the operation is a lookup.
    expect(cancelWorker(dir, 'a', 'op-reconnect')).toEqual(read)
  })

  it('a worker that is already gone acknowledges not_live, and an unknown one stays unknown — never success', async () => {
    const dir = runDir()
    const blobs = new InMemoryResultBlobStore()
    const journal = new FileSpawnJournal(join(dir, 'spawn-journal.jsonl'))
    const makeAgent = (_p: AgentProfile) => doneLeaf('w', { answer: 42 })

    // An operation naming a worker that never existed anywhere.
    cancelWorker(dir, 'ghost', 'op-ghost', { source: 'test' })

    const script = scriptedBrain([
      { toolCalls: spawnCall('w', 'worker') },
      awaitTurn,
      { toolCalls: [{ name: 'list_questions', arguments: {} }] },
      { content: 'stopping' },
    ])
    let call = 0
    const chat: ToolLoopChat = async (messages, tools, context) => {
      const index = call
      call += 1
      // Written only AFTER the worker settled done — the "process already gone" case.
      if (index === 2) cancelWorker(dir, 'w', 'op-gone', { source: 'test' })
      return script(messages, tools, context)
    }
    const root = driverAgent(driverOpts('root', chat, makeAgent, blobs, { controlDir: dir }))
    await createSupervisor<unknown, unknown>().run(root, 'x', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'run-gone',
      journal,
      blobs,
      executors: createExecutorRegistry(),
      maxDepth: 2,
    })

    const gone = readWorkerCancellation(dir, 'op-gone')
    expect(gone?.effect).toBe('not_live')
    expect(gone?.terminated).toEqual([])
    // The unknown reference was never answered: the durable layout holds no record and the
    // operation still reads `unknown` — neither ever reads as success.
    expect(readWorkerCancellation(dir, 'op-ghost')).toBeUndefined()
    expect(cancelWorker(dir, 'ghost', 'op-ghost').effect).toBe('unknown')
  })

  it('a request naming a nested descendant stays unanswered — cancel its lead instead', async () => {
    // The acknowledger resolves references against the root manager's DIRECT children only
    // (`DriverAgentOptions.controlDir`). This pins the boundary: an operation naming a live
    // nested descendant is neither acknowledged nor applied, across every acknowledger pass
    // including the post-drain one, and still reads `unknown` after the run — never a success.
    const dir = runDir()
    const blobs = new InMemoryResultBlobStore()
    const journal = new FileSpawnJournal(join(dir, 'spawn-journal.jsonl'))

    let markStarted: (() => void) | undefined
    const descendantLive = new Promise<void>((resolveGate) => {
      markStarted = resolveGate
    })
    const makeAgent = (p: AgentProfile): Agent<unknown, unknown> => {
      if (p.metadata?.kind === 'lead') {
        const leadBrain = scriptedBrain([
          { toolCalls: spawnCall('d1') },
          awaitTurn, // repeats forever — the lead never stops on its own
        ])
        return driverChild(
          testAgentProfile('lead'),
          driverAgent(driverOpts('lead', leadBrain, makeAgent, blobs)),
          journal,
        )
      }
      return hangingLeaf('d1', { onStart: () => markStarted?.() })
    }

    const rootScript = scriptedBrain([
      {
        toolCalls: [
          {
            name: 'spawn_agent',
            arguments: {
              profile: { metadata: { kind: 'lead' } },
              task: 'go',
              label: 'lead',
              budget: { maxTokens: 10_000, maxIterations: 20 },
            },
          },
        ],
      },
      { toolCalls: [{ name: 'list_questions', arguments: {} }] },
      { toolCalls: [{ name: 'list_questions', arguments: {} }] },
      { content: 'stopping' },
    ])
    let call = 0
    const rootChat: ToolLoopChat = async (messages, tools, context) => {
      const index = call
      call += 1
      if (index === 1) {
        await descendantLive
        cancelWorker(dir, 'run-deep:s0:s0', 'op-deep', { source: 'test' })
      }
      return rootScript(messages, tools, context)
    }

    const root = driverAgent(driverOpts('root', rootChat, makeAgent, blobs, { controlDir: dir }))
    await createSupervisor<unknown, unknown>().run(root, 'x', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'run-deep',
      journal,
      blobs,
      executors: withDriverExecutor(createExecutorRegistry()),
      maxDepth: 4,
    })

    expect(readWorkerCancellation(dir, 'op-deep')).toBeUndefined()
    expect(cancelWorker(dir, 'run-deep:s0:s0', 'op-deep').effect).toBe('unknown')
  })

  it('the cancelled worker reaches a terminal down state visible on the settle path', async () => {
    const dir = runDir()
    const blobs = new InMemoryResultBlobStore()
    const journal = new FileSpawnJournal(join(dir, 'spawn-journal.jsonl'))
    const makeAgent = (_p: AgentProfile) => hangingLeaf('a')
    const events: CoordinationEvent[] = []

    cancelWorker(dir, 'a', 'op-settle', { source: 'test' })
    const chat = scriptedBrain([{ toolCalls: spawnCall('a') }, awaitTurn, { content: 'stopping' }])
    const root = driverAgent(
      driverOpts('root', chat, makeAgent, blobs, {
        controlDir: dir,
        onEvent: (event) => {
          events.push(event)
        },
      }),
    )
    await createSupervisor<unknown, unknown>().run(root, 'x', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'run-settle',
      journal,
      blobs,
      executors: createExecutorRegistry(),
      maxDepth: 2,
    })

    // The settle path delivered a terminal `down` for the cancelled worker: on the coordination
    // bus AND as the durable journal record any replay reads.
    expect(
      events.some(
        (e) =>
          e.type === 'settled' && e.worker.id === 'run-settle:s0' && e.worker.status === 'down',
      ),
    ).toBe(true)
    const tree = (await journal.loadTree('run-settle')) as SpawnEvent[]
    expect(
      tree.some((e) => e.kind === 'settled' && e.id === 'run-settle:s0' && e.status === 'down'),
    ).toBe(true)
    expect(readWorkerCancellation(dir, 'op-settle')?.effect).toBe('cancelled')
  })
})
