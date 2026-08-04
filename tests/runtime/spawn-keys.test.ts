/**
 * Semantic spawn keys (`Scope.spawn(agent, task, { key })`) — the four states a keyed assignment
 * can be in, in-process. The cross-process ones (a key committed by a DEAD coordinator) are proven
 * over a real process kill in `resume-aware-driver.test.ts`; this pins the state machine itself.
 *
 * Unkeyed spawns are position-identified and always run — a key is opt-in identity, so nothing
 * about the default path changes.
 */

import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
  Scope,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { testAgentProfile } from '../kernel/test-agent-profile'

/** Counts its own executions so "did this key run again?" is a number, not an inference. `gate`,
 *  when given, holds the worker open until the test releases it — a deterministic stand-in for a
 *  long-running worker, with no reliance on abort semantics to end the test. */
function countingLeaf(name: string, out: string, runs: { n: number }, gate?: Promise<void>) {
  const executor: Executor<string> = {
    runtime: 'router',
    execute(): AsyncIterable<UsageEvent> {
      runs.n += 1
      return (async function* () {
        yield { kind: 'iteration' } as UsageEvent
        yield { kind: 'tokens', input: 5, output: 5 } as UsageEvent
        if (gate) await gate
      })()
    },
    teardown: async () => ({ destroyed: true }),
    resultArtifact: (): ExecutorResult<string> => ({
      outRef: `k:${name}`,
      out,
      verdict: { score: 1, valid: true },
      spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
    }),
  }
  const spec: AgentSpec = {
    profile: testAgentProfile(name),
    harness: null,
    executor: executor as Executor<unknown>,
  }
  return { name, act: async () => out, executorSpec: spec } as Agent<unknown, string> & {
    executorSpec: AgentSpec
  }
}

async function runRoot(act: (task: unknown, scope: Scope<string>) => Promise<string>) {
  return await createSupervisor<unknown, string>().run({ name: 'root', act }, 'task', {
    budget: { maxIterations: 50, maxTokens: 100_000 },
    runId: 'keys',
    journal: new InMemorySpawnJournal(),
    blobs: new InMemoryResultBlobStore(),
    executors: createExecutorRegistry(),
    now: () => 0,
  })
}

const childBudget = { maxIterations: 5, maxTokens: 10_000 }

describe('semantic spawn keys', () => {
  it('a key that already settled done resolves to the committed result and spends nothing', async () => {
    const runs = { n: 0 }
    // Observations are collected inside `act` and asserted OUTSIDE it: a failing expectation
    // inside a root act is swallowed into a `no-winner`, which hides the real message.
    const seen: Record<string, unknown> = {}
    const result = await runRoot(async (task, scope) => {
      const first = scope.spawn(countingLeaf('a', 'A', runs), task, {
        budget: childBudget,
        label: 'a',
        key: 'assignment-1',
      })
      seen.firstOk = first.ok
      // Drive it to settlement, then ask for the SAME assignment again.
      seen.firstSettled = (await scope.next())?.kind

      const freeBefore = scope.budget.tokensLeft
      const again = scope.spawn(countingLeaf('a', 'A', runs), task, {
        budget: childBudget,
        label: 'a',
        key: 'assignment-1',
      })
      seen.priorState = again.ok ? again.prior?.state : `refused:${again.reason}`
      seen.runsAfter = runs.n
      seen.freeUnchanged = scope.budget.tokensLeft === freeBefore
      seen.resolvedOut =
        again.ok && again.prior?.state === 'completed' ? again.prior.settled.out : null
      // It resolves to the same node, not a second one wearing the same key.
      seen.sameNode = again.ok && first.ok && again.handle.id === first.handle.id
      return 'done'
    })
    expect(result.kind).toBe('winner')
    expect(seen.firstOk).toBe(true)
    expect(seen.firstSettled).toBe('done')
    expect(seen.priorState).toBe('completed')
    // Nothing ran a second time and nothing was reserved — the prior settlement IS the result.
    expect(seen.runsAfter).toBe(1)
    expect(seen.freeUnchanged).toBe(true)
    expect(seen.resolvedOut).toBe('A')
    expect(seen.sameNode).toBe(true)
  })

  it('a key that is still LIVE is refused — the same assignment never runs twice at once', async () => {
    const runs = { n: 0 }
    let release = (): void => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    const seen: { reason?: string; runsAtRefusal?: number } = {}
    const result = await runRoot(async (task, scope) => {
      const first = scope.spawn(countingLeaf('h', 'H', runs, gate), task, {
        budget: childBudget,
        label: 'h',
        key: 'assignment-1',
      })
      expect(first.ok).toBe(true)
      const dup = scope.spawn(countingLeaf('h', 'H', runs, gate), task, {
        budget: childBudget,
        label: 'h',
        key: 'assignment-1',
      })
      seen.reason = dup.ok === false ? dup.reason : 'accepted'
      // The refusal is fail-CLOSED: the duplicate never started and never reserved budget.
      seen.runsAtRefusal = runs.n
      release()
      await scope.next()
      return 'done'
    })
    expect(result.kind).toBe('winner')
    expect(seen.reason).toBe('duplicate-key')
    // The first execution waits for its identity append, so the duplicate can be refused before
    // either worker body starts. The admitted original still runs exactly once afterward.
    expect(seen.runsAtRefusal).toBe(0)
    expect(runs.n).toBe(1)
  })

  it('refuses a completed key when the requested profile or task changes', async () => {
    const runs = { n: 0 }
    const seen: Record<string, unknown> = {}
    await runRoot(async (_task, scope) => {
      const first = scope.spawn(countingLeaf('original', 'A', runs), 'task A', {
        budget: childBudget,
        label: 'assignment',
        key: 'same-key',
      })
      expect(first.ok).toBe(true)
      await scope.next()
      const freeBefore = scope.budget.tokensLeft
      const changed = scope.spawn(countingLeaf('changed', 'B', runs), 'task B', {
        budget: childBudget,
        label: 'assignment',
        key: 'same-key',
      })
      seen.reason = changed.ok ? 'accepted' : changed.reason
      seen.freeUnchanged = scope.budget.tokensLeft === freeBefore
      return 'done'
    })
    expect(seen).toEqual({ reason: 'key-conflict', freeUnchanged: true })
    expect(runs.n).toBe(1)
  })

  it('two different keys are two assignments; unkeyed spawns are never deduplicated', async () => {
    const runs = { n: 0 }
    await runRoot(async (task, scope) => {
      scope.spawn(countingLeaf('a', 'A', runs), task, {
        budget: childBudget,
        label: 'a',
        key: 'k1',
      })
      scope.spawn(countingLeaf('b', 'B', runs), task, {
        budget: childBudget,
        label: 'b',
        key: 'k2',
      })
      // Same agent, same task, NO key — the default path, which always runs.
      scope.spawn(countingLeaf('c', 'C', runs), task, { budget: childBudget, label: 'c' })
      scope.spawn(countingLeaf('c', 'C', runs), task, { budget: childBudget, label: 'c' })
      for (let s = await scope.next(); s !== null; s = await scope.next());
      expect(runs.n).toBe(4)
      return 'done'
    })
  })

  it('a key whose prior attempt settled DOWN spawns fresh and reports the retry explicitly', async () => {
    const runs = { n: 0 }
    const failing: Agent<unknown, string> & { executorSpec: AgentSpec } = (() => {
      const executor: Executor<string> = {
        runtime: 'router',
        execute(): AsyncIterable<UsageEvent> {
          runs.n += 1
          return (async function* () {
            yield { kind: 'iteration' } as UsageEvent
            throw new Error('worker exploded')
          })()
        },
        teardown: async () => ({ destroyed: true }),
        resultArtifact: (): ExecutorResult<string> => {
          throw new Error('never delivered')
        },
      }
      const spec: AgentSpec = {
        profile: testAgentProfile('f'),
        harness: null,
        executor: executor as Executor<unknown>,
      }
      return { name: 'f', act: async () => 'F', executorSpec: spec } as Agent<unknown, string> & {
        executorSpec: AgentSpec
      }
    })()

    await runRoot(async (task, scope) => {
      scope.spawn(failing, task, { budget: childBudget, label: 'f', key: 'flaky' })
      const settled = await scope.next()
      expect(settled?.kind).toBe('down')

      const retry = scope.spawn(countingLeaf('f2', 'F2', runs), task, {
        budget: childBudget,
        label: 'f2',
        key: 'flaky',
      })
      if (!retry.ok) throw new Error(`expected a fresh spawn, got ${retry.reason}`)
      // A failed key is retryable — but the retry is DECLARED, never a silent duplicate.
      expect(retry.prior?.state).toBe('retried')
      expect(retry.prior?.state === 'retried' ? retry.prior.reason : '').toContain('exploded')
      await scope.next()
      return 'done'
    })
  })
})
