/**
 * Acknowledged RUN-scoped cancellation (#862): `cancelRun` over the run layout, applied by the
 * root manager's turn loop and recorded by the `supervise()` settle path.
 *
 * Every test runs the REAL `supervise()` path — scripted brain, real `Scope` spawns, a real
 * file-backed run directory — and reads the durable layout the way an external client would.
 */

import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it } from 'vitest'
import { cancelRun, readRunCancellation } from '../../src/runtime/supervise/run-layout'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import type { ToolLoopChat } from '../../src/runtime/tool-loop'
import { supervise } from '../helpers/runtime-with-test-brain'
import { scriptedBrain } from './scripted-brain'
import { testAgentProfile } from './test-agent-profile'

const budget: Budget = { maxIterations: 100, maxTokens: 100_000 }
const rootProfile = (): AgentProfile => testAgentProfile('root', { harness: 'cli-base' })
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** A worker that runs until its per-child signal aborts — so the run is genuinely live when the
 *  cancel lands, and the cascade is what ends it. */
function hangingLeaf(name: string, onStart?: () => void): Agent<unknown, unknown> {
  const executor: Executor<unknown> = {
    runtime: 'router',
    execute(_task: unknown, signal: AbortSignal): Promise<ExecutorResult<unknown>> {
      onStart?.()
      return new Promise((_, reject) => {
        const fail = () => reject(new Error('aborted'))
        if (signal.aborted) {
          fail()
          return
        }
        signal.addEventListener('abort', fail, { once: true })
      })
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: (): ExecutorResult<unknown> => ({
      outRef: 'never',
      out: {},
      verdict: { valid: false, score: 0 },
      spent: { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
    }),
  }
  const spec: AgentSpec = { profile: testAgentProfile(name), harness: null, executor }
  return { name, act: async () => ({}), executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

function deliveringLeaf(name: string, out: unknown): Agent<unknown, unknown> {
  const executor: Executor<unknown> = {
    runtime: 'router',
    execute() {
      return (async function* () {
        yield { kind: 'iteration' } as UsageEvent
        yield { kind: 'tokens', input: 5, output: 5 } as UsageEvent
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: (): ExecutorResult<unknown> => ({
      outRef: `w:${name}`,
      out,
      verdict: { valid: true, score: 1 },
      spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
    }),
  }
  const spec: AgentSpec = { profile: testAgentProfile(name), harness: null, executor }
  return { name, act: async () => out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

const dirs: string[] = []
async function runDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'run-cancel-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('acknowledged run-scoped cancellation (#862)', () => {
  it('a live run reads cancel_requested, then cancelled once it reaches its aborted terminal state', async () => {
    const dir = await runDir()
    let markLive: (() => void) | undefined
    const workerLive = new Promise<void>((resolve) => {
      markLive = resolve
    })
    const script = scriptedBrain([
      { toolCalls: [{ name: 'spawn_worker', arguments: { profile: {}, task: 'go', label: 'w' } }] },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { content: 'done' },
    ])
    let call = 0
    let requestedEffect: string | undefined
    const brain: ToolLoopChat = async (messages, tools, context) => {
      const index = call
      call += 1
      if (index === 1) {
        await workerLive
        expect(cancelRun(dir, 'op-run', { reason: 'operator', source: 'test' }).effect).toBe(
          'unknown',
        )
      }
      if (index === 2) {
        // The abort was issued at the previous turn boundary, so the durable record already
        // states it — before the run's own terminal state is known.
        requestedEffect = readRunCancellation(dir, 'op-run')?.effect
      }
      return script(messages, tools, context)
    }

    const result = await supervise(rootProfile(), 'solve it', {
      budget,
      makeWorkerAgent: () => hangingLeaf('w', () => markLive?.()),
      runId: 'cancel-run',
      runDir: dir,
      brain,
    })

    expect(requestedEffect).toBe('cancel_requested')
    expect(result.kind).toBe('no-winner')
    if (result.kind === 'no-winner') expect(result.reason).toBe('aborted')
    // A reconnecting client derives everything from the directory: the terminal effect is
    // `cancelled`, and repeating the operation is a pure lookup.
    const record = readRunCancellation(dir, 'op-run')
    expect(record?.effect).toBe('cancelled')
    expect(cancelRun(dir, 'op-run', { reason: 'operator', source: 'test' })).toEqual(record)
  })

  it('a run that settles on its own despite the request reads not_live, never success', async () => {
    const dir = await runDir()
    const script = scriptedBrain([
      { toolCalls: [{ name: 'spawn_worker', arguments: { profile: {}, task: 'go', label: 'w' } }] },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { content: 'done' },
    ])
    let call = 0
    const brain: ToolLoopChat = async (messages, tools, context) => {
      const index = call
      call += 1
      // Written on the LAST brain turn: the run finishes before the driver can apply it.
      if (index === 2) cancelRun(dir, 'op-late', { source: 'test' })
      return script(messages, tools, context)
    }

    const result = await supervise(rootProfile(), 'solve it', {
      budget,
      makeWorkerAgent: () => deliveringLeaf('w', { answer: 42 }),
      runId: 'late-run',
      runDir: dir,
      brain,
    })

    expect(result.kind).toBe('winner')
    const record = readRunCancellation(dir, 'op-late')
    expect(record?.effect).toBe('not_live')
    expect(record?.detail).toContain('run ended')
  })

  it('a request written after the run ended is never answered as success', async () => {
    const dir = await runDir()
    const script = scriptedBrain([
      { toolCalls: [{ name: 'spawn_worker', arguments: { profile: {}, task: 'go', label: 'w' } }] },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { content: 'done' },
    ])
    const result = await supervise(rootProfile(), 'solve it', {
      budget,
      makeWorkerAgent: () => deliveringLeaf('w', { answer: 42 }),
      runId: 'over-run',
      runDir: dir,
      brain: script,
    })
    expect(result.kind).toBe('winner')

    // Nothing is live to apply it and no process will answer: `unknown` is the honest state, and
    // the client can see the run is over from the same layout.
    const queued = cancelRun(dir, 'op-after', { source: 'test' })
    expect(queued.effect).toBe('unknown')
    expect(readRunCancellation(dir, 'op-after')).toBeUndefined()
  })

  it('one run carries one run-scoped operation: a second operationId fails loud', async () => {
    const dir = await runDir()
    cancelRun(dir, 'op-first', { source: 'test' })
    expect(() => cancelRun(dir, 'op-second', { source: 'test' })).toThrow(/already pending/u)
    // The first operation still reads as itself.
    expect(cancelRun(dir, 'op-first', { source: 'test' }).operationId).toBe('op-first')
  })

  it('the TUI run-cancel key writes the same acknowledged request the runtime reads', async () => {
    const dir = await runDir()
    // The TUI mints a UUID operation and writes through `cancelRun` — the same call this test
    // makes — so the operator's cancel is the acknowledged contract, not an unread file.
    const operationId = randomUUID()
    const queued = cancelRun(dir, operationId, {
      reason: 'operator requested cancel from TUI',
      source: 'agent-runtime-top',
    })
    expect(queued.effect).toBe('unknown')

    let markLive: (() => void) | undefined
    const workerLive = new Promise<void>((resolve) => {
      markLive = resolve
    })
    const script = scriptedBrain([
      { toolCalls: [{ name: 'spawn_worker', arguments: { profile: {}, task: 'go', label: 'w' } }] },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { content: 'done' },
    ])
    const brain: ToolLoopChat = async (messages, tools, context) => {
      await Promise.race([workerLive, sleep(50)])
      return script(messages, tools, context)
    }
    const result = await supervise(rootProfile(), 'solve it', {
      budget,
      makeWorkerAgent: () => hangingLeaf('w', () => markLive?.()),
      runId: 'tui-run',
      runDir: dir,
      brain,
    })

    expect(result.kind).toBe('no-winner')
    if (result.kind === 'no-winner') expect(result.reason).toBe('aborted')
    expect(readRunCancellation(dir, operationId)?.effect).toBe('cancelled')
  })
})
