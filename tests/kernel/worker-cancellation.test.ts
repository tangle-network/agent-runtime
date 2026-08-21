/**
 * Acknowledged worker cancellation (#758): the run-layout `cancelWorker` contract applied by the
 * coordination driver's turn-loop acknowledger.
 *
 * Every test runs the REAL runtime path — scripted brain, real `Scope` spawns, a real file-backed
 * spawn journal in the same run directory the cancellation records live in — and reads the
 * durable layout the way an external client would.
 */

import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** One scripted turn as the raw shape a `ToolLoopChat` returns — for a brain that decides its
 *  next turn from live durable state instead of a fixed sequence. */
const turnOf = (turn: ScriptedTurn) => scriptedBrain([turn])([], [])

/** Append journal events for one tree the way any durable writer does — the seam a slow teardown
 *  in another process writes its terminal record through. */
function appendJournalLines(file: string, root: string, events: SpawnEvent[]): void {
  const lines = events.map((event) => `${JSON.stringify({ kind: 'event', root, event })}\n`)
  appendFileSync(file, lines.join(''), 'utf8')
}

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

  it('a worker that is already gone acknowledges not_live, and an unmatched one expires not_live at run end — never success', async () => {
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
    // The unmatched reference was never applied, so run end EXPIRES it: `not_live` with the
    // run-over detail — a reader can tell run-over from in-progress, it can never abort a
    // future spawn that happens to match, and it never reads as success.
    const ghost = readWorkerCancellation(dir, 'op-ghost')
    expect(ghost?.effect).toBe('not_live')
    expect(ghost?.detail).toContain('run ended before the request was applied')
    expect(ghost?.terminated).toEqual([])
    expect(cancelWorker(dir, 'ghost', 'op-ghost')).toEqual(ghost)
  })

  it('a nested descendant is applied by the owning manager and no other writer', async () => {
    // Exact node ids route by OWNERSHIP: the manager whose own id is the node's parent applies
    // the request — at any depth. The root (default 'run' scope) skips a deeper id entirely, so
    // one operation can only ever have one writer.
    const dir = runDir()
    const blobs = new InMemoryResultBlobStore()
    const journal = new FileSpawnJournal(join(dir, 'spawn-journal.jsonl'))

    let d1Aborts = 0
    let markStarted: (() => void) | undefined
    const descendantLive = new Promise<void>((resolveGate) => {
      markStarted = resolveGate
    })
    const makeAgent = (p: AgentProfile): Agent<unknown, unknown> => {
      if (p.metadata?.kind === 'lead') {
        // The lead polls its own turn boundaries until its acknowledger has applied the
        // operation, pulls the settle, and lets one more boundary reconcile it.
        const leadChat: ToolLoopChat = async () => {
          const record = readWorkerCancellation(dir, 'op-deep')
          if (record === undefined) {
            await sleep(5)
            return turnOf({ toolCalls: [{ name: 'list_questions', arguments: {} }] })
          }
          if (record.effect === 'cancel_requested') return turnOf(awaitTurn)
          return turnOf({ content: 'lead stopping' })
        }
        const first = scriptedBrain([{ toolCalls: spawnCall('d1') }])
        let leadCall = 0
        const chat: ToolLoopChat = async (messages, tools, context) => {
          const index = leadCall
          leadCall += 1
          if (index === 0) return first(messages, tools, context)
          return leadChat(messages, tools, context)
        }
        return driverChild(
          testAgentProfile('lead'),
          driverAgent(
            driverOpts('lead', chat, makeAgent, blobs, {
              maxTurns: 40,
              controlDir: dir,
              controlScope: 'subtree',
            }),
          ),
          journal,
        )
      }
      return hangingLeaf('d1', {
        onStart: () => markStarted?.(),
        onAbort: () => {
          d1Aborts += 1
        },
      })
    }

    let call = 0
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
      awaitTurn,
      { content: 'stopping' },
    ])
    const rootChat: ToolLoopChat = async (messages, tools, context) => {
      const index = call
      call += 1
      if (index === 1) {
        await descendantLive
        cancelWorker(dir, 'run-deep:s0:s0', 'op-deep', { source: 'test' })
        // Wait for the OWNING manager (the lead) to acknowledge before pulling its settle.
        while (readWorkerCancellation(dir, 'op-deep')?.effect !== 'cancelled') await sleep(5)
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

    const record = readWorkerCancellation(dir, 'op-deep')
    expect(record?.effect).toBe('cancelled')
    expect(record?.workerId).toBe('run-deep:s0:s0')
    expect(record?.terminated).toEqual(['run-deep:s0:s0'])
    // Exactly one abort reached the descendant, and the lead itself was never cancelled: the
    // one owning manager applied the operation and nothing else wrote.
    expect(d1Aborts).toBe(1)
    const tree = (await journal.loadTree('run-deep')) as SpawnEvent[]
    expect(tree.some((e) => e.kind === 'settled' && e.id === 'run-deep:s0')).toBe(true)
  })

  it('a label reference is answered only by the root', async () => {
    // Both the root and a nested manager have a live worker labelled 'dup'. Ownership gives
    // label/profile-name references to the root alone, so exactly one worker is aborted and
    // exactly one acknowledgement is written — no two-writer race.
    const dir = runDir()
    const blobs = new InMemoryResultBlobStore()
    const journal = new FileSpawnJournal(join(dir, 'spawn-journal.jsonl'))

    let leadDupAborts = 0
    let leadDupAbortsAtCancel: number | undefined
    let started = 0
    let markStarted: (() => void) | undefined
    const bothDupsLive = new Promise<void>((resolveGate) => {
      markStarted = () => {
        started += 1
        if (started >= 2) resolveGate()
      }
    })
    const makeAgent = (p: AgentProfile): Agent<unknown, unknown> => {
      if (p.metadata?.kind === 'lead') {
        const leadBrain = scriptedBrain([
          { toolCalls: spawnCall('dup', 'lead-dup') },
          awaitTurn, // repeats — the lead holds its dup until the run tears down
        ])
        return driverChild(
          testAgentProfile('lead'),
          driverAgent(
            driverOpts('lead', leadBrain, makeAgent, blobs, {
              controlDir: dir,
              controlScope: 'subtree',
            }),
          ),
          journal,
        )
      }
      if (p.metadata?.kind === 'lead-dup') {
        return hangingLeaf('lead-dup', {
          onStart: () => markStarted?.(),
          onAbort: () => {
            leadDupAborts += 1
          },
        })
      }
      return hangingLeaf('root-dup', { onStart: () => markStarted?.() })
    }

    const spawnTurn: ScriptedTurn = {
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
        ...(spawnCall('dup', 'root-dup') ?? []),
      ],
    }
    // The acknowledger runs at TURN BOUNDARIES, so the brain polls the durable record across
    // turns rather than blocking inside one.
    let call = 0
    const rootChat: ToolLoopChat = async () => {
      const index = call
      call += 1
      if (index === 0) return turnOf(spawnTurn)
      if (index === 1) {
        await bothDupsLive
        cancelWorker(dir, 'dup', 'op-dup', { source: 'test' })
        return turnOf({ toolCalls: [{ name: 'list_questions', arguments: {} }] })
      }
      const record = readWorkerCancellation(dir, 'op-dup')
      if (record?.effect === 'cancelled') {
        leadDupAbortsAtCancel ??= leadDupAborts
        return turnOf({ content: 'stopping' })
      }
      // Pull the aborted worker's settlement so the next boundary can reconcile it.
      return turnOf(awaitTurn)
    }

    const root = driverAgent(
      driverOpts('root', rootChat, makeAgent, blobs, { controlDir: dir, maxTurns: 40 }),
    )
    await createSupervisor<unknown, unknown>().run(root, 'x', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'run-label',
      journal,
      blobs,
      executors: withDriverExecutor(createExecutorRegistry()),
      maxDepth: 4,
    })

    const record = readWorkerCancellation(dir, 'op-dup')
    expect(record?.effect).toBe('cancelled')
    // The ROOT's direct child answered the label; the nested manager's identically labelled
    // worker was untouched when the acknowledgement landed.
    expect(record?.workerId).toBe('run-label:s1')
    expect(record?.terminated).toEqual(['run-label:s1'])
    expect(leadDupAbortsAtCancel).toBe(0)
  })

  it('a cancel_requested on the final pass reads unknown with the run-over detail', async () => {
    // The abort goes out on the post-drain pass, so its settle can never be observed before act
    // returns. Run end closes the record as `unknown` — not in progress, never a success.
    const dir = runDir()
    const blobs = new InMemoryResultBlobStore()
    const journal = new FileSpawnJournal(join(dir, 'spawn-journal.jsonl'))
    let markStarted: (() => void) | undefined
    const workerLive = new Promise<void>((resolveGate) => {
      markStarted = resolveGate
    })
    const makeAgent = (_p: AgentProfile) => hangingLeaf('a', { onStart: () => markStarted?.() })

    const script = scriptedBrain([{ toolCalls: spawnCall('a') }, { content: 'stopping' }])
    let call = 0
    const chat: ToolLoopChat = async (messages, tools, context) => {
      const index = call
      call += 1
      if (index === 1) {
        // Written during the FINAL brain turn: no later turn boundary exists, so the post-drain
        // pass is the one that applies it.
        await workerLive
        cancelWorker(dir, 'a', 'op-late', { source: 'test' })
      }
      return script(messages, tools, context)
    }
    const root = driverAgent(driverOpts('root', chat, makeAgent, blobs, { controlDir: dir }))
    await createSupervisor<unknown, unknown>().run(root, 'x', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'run-late',
      journal,
      blobs,
      executors: createExecutorRegistry(),
      maxDepth: 2,
    })

    const record = readWorkerCancellation(dir, 'op-late')
    expect(record?.effect).toBe('unknown')
    expect(record?.detail).toContain('run ended before termination was observed')
    expect(record?.terminated).toEqual([])
  })

  it('a descendant dying of its own cause between the request and the abort is not named', async () => {
    // The terminated window opens at the ABORT-ISSUE instant (the acknowledger's own observedAt
    // on the cancel_requested record), never the client clock: a descendant that dies of its own
    // cause after the request was appended but before the abort went out is excluded.
    const dir = runDir()
    const blobs = new InMemoryResultBlobStore()
    const journal = new FileSpawnJournal(join(dir, 'spawn-journal.jsonl'))

    let dieOfOwnCause: (() => void) | undefined
    const selfDeathGate = new Promise<void>((resolveGate) => {
      dieOfOwnCause = resolveGate
    })
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
          { toolCalls: [...(spawnCall('d-self', 'self') ?? []), ...(spawnCall('d-hang') ?? [])] },
          awaitTurn, // pulls d-self's own death, then holds until the cascade
        ])
        return driverChild(
          testAgentProfile('lead'),
          driverAgent(driverOpts('lead', leadBrain, makeAgent, blobs)),
          journal,
        )
      }
      if (kind === 'self') {
        // Dies of its OWN cause when the test opens the gate — no abort involved.
        const executor: Executor<unknown> = {
          runtime: 'router',
          execute(): Promise<ExecutorResult<unknown>> {
            markStarted?.()
            return selfDeathGate.then(() => Promise.reject(new Error('own cause')))
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
        const spec: AgentSpec = { profile: testAgentProfile('d-self'), harness: null, executor }
        return { name: 'd-self', act: async () => ({}), executorSpec: spec } as Agent<
          unknown,
          unknown
        > & { executorSpec: AgentSpec }
      }
      return hangingLeaf('d-hang', { onStart: () => markStarted?.() })
    }

    let call = 0
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
      awaitTurn, // the cancelled lead settles down
      { content: 'stopping' },
    ])
    const rootChat: ToolLoopChat = async (messages, tools, context) => {
      const index = call
      call += 1
      if (index === 1) {
        await leadWorkersLive
        cancelWorker(dir, 'lead', 'op-window', { reason: 'window test', source: 'test' })
        // d-self dies of its own cause AFTER the request exists but BEFORE the abort is issued
        // (the abort can only go out at the next turn boundary, after this call returns).
        dieOfOwnCause?.()
        const journalFile = join(dir, 'spawn-journal.jsonl')
        for (;;) {
          const raw = existsSync(journalFile) ? readFileSync(journalFile, 'utf8') : ''
          if (raw.includes('"run-window:s0:s0"') && raw.includes('"down"')) break
          await sleep(5)
        }
        // Strictly separate the own-cause death from the abort instant at ISO-ms resolution.
        await sleep(10)
      }
      return rootScript(messages, tools, context)
    }

    const root = driverAgent(driverOpts('root', rootChat, makeAgent, blobs, { controlDir: dir }))
    await createSupervisor<unknown, unknown>().run(root, 'x', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'run-window',
      journal,
      blobs,
      executors: withDriverExecutor(createExecutorRegistry()),
      maxDepth: 4,
    })

    const record = readWorkerCancellation(dir, 'op-window')
    expect(record?.effect).toBe('cancelled')
    // The cascade took the lead and its still-live worker; the pre-abort own-cause death is not
    // attributed to this operation.
    expect(record?.terminated).toEqual(['run-window:s0', 'run-window:s0:s1'])
  })

  it('a descendant whose teardown journals late is named on a later pass', async () => {
    // In-process, a nested tree drains before its lead settles — but the journal is a durable
    // file a slow teardown (or another process) completes late. The acknowledger re-reads the
    // journal while the manager still turns and GROWS the terminated set instead of freezing it
    // at the first write.
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
          awaitTurn, // repeats — the lead never stops on its own
        ])
        return driverChild(
          testAgentProfile('lead'),
          driverAgent(driverOpts('lead', leadBrain, makeAgent, blobs)),
          journal,
        )
      }
      return hangingLeaf('d1', { onStart: () => markStarted?.() })
    }

    const spawnTurn: ScriptedTurn = {
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
    }
    let terminatedAtFirstWrite: ReadonlyArray<string> | undefined
    let call = 0
    const rootChat: ToolLoopChat = async () => {
      const index = call
      call += 1
      if (index === 0) return turnOf(spawnTurn)
      if (index === 1) {
        await descendantLive
        cancelWorker(dir, 'lead', 'op-grow', { source: 'test' })
        return turnOf({ toolCalls: [{ name: 'list_questions', arguments: {} }] })
      }
      const record = readWorkerCancellation(dir, 'op-grow')
      if (record?.effect !== 'cancelled') return turnOf(awaitTurn)
      if (terminatedAtFirstWrite === undefined) {
        terminatedAtFirstWrite = record.terminated
        // The late teardown journal: a subtree node whose spawn and terminal records land in the
        // lead's tree AFTER the operation already read `cancelled` — the durable evidence a slow
        // teardown appends once the lead's own settlement was already observed.
        appendJournalLines(join(dir, 'spawn-journal.jsonl'), 'run-grow/run-grow:s0', [
          {
            kind: 'spawned',
            id: 'run-grow:s0:s9',
            parent: 'run-grow:s0',
            label: 'slow',
            budget: { maxIterations: 1, maxTokens: 10 },
            runtime: 'router',
            seq: 900,
            at: new Date().toISOString(),
          },
          {
            kind: 'settled',
            id: 'run-grow:s0:s9',
            status: 'down',
            reason: 'slow teardown',
            spent: { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
            seq: 901,
            at: new Date().toISOString(),
          },
        ])
        return turnOf({ toolCalls: [{ name: 'list_questions', arguments: {} }] })
      }
      return turnOf({ content: 'stopping' })
    }

    const root = driverAgent(
      driverOpts('root', rootChat, makeAgent, blobs, { controlDir: dir, maxTurns: 40 }),
    )
    await createSupervisor<unknown, unknown>().run(root, 'x', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'run-grow',
      journal,
      blobs,
      executors: withDriverExecutor(createExecutorRegistry()),
      maxDepth: 4,
    })

    expect(terminatedAtFirstWrite).toEqual(['run-grow:s0', 'run-grow:s0:s0'])
    const record = readWorkerCancellation(dir, 'op-grow')
    expect(record?.effect).toBe('cancelled')
    expect(record?.terminated).toEqual(['run-grow:s0', 'run-grow:s0:s0', 'run-grow:s0:s9'])
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
