import type { DefaultVerdict } from '@tangle-network/agent-eval'
import { describe, expect, it } from 'vitest'
import { dumbDriver, naiveDriver } from './steering-drivers'
import type { Iteration } from './types'

// A Task shape WITHOUT a `prompt` field, to prove the substrate builders make
// no assumption about how a Task carries its instruction: the caller's
// `applyContinuation` owns that fold.
interface Task {
  id: string
  instruction: string
}
type Output = { text: string }

const applyContinuation = (task: Task, continuation: string): Task => ({
  ...task,
  instruction: continuation,
})

function iter(verdict: DefaultVerdict | undefined, index = 0): Iteration<Task, Output> {
  return {
    index,
    task: { id: 't', instruction: 'orig' },
    agentRunName: 'agent',
    output: { text: 'out' },
    verdict,
    events: [],
    startedAt: 0,
    endedAt: 1,
    costUsd: 0,
    tokenUsage: { input: 0, output: 0 },
  }
}

const task: Task = { id: 't', instruction: 'do the thing' }

describe('naiveDriver — no-signal control', () => {
  const driver = naiveDriver<Task, Output>({
    continuation: 'keep going',
    applyContinuation,
    maxIterations: 3,
  })

  it('runs the original task at shot 0', async () => {
    expect(await driver.plan(task, [])).toEqual([task])
  })

  it('issues the fixed continuation regardless of the verdict findings', async () => {
    // A failing verdict packed with rich findings the driver MUST ignore.
    const failed = iter({
      valid: false,
      score: 0.1,
      notes: 'use foo() not bar()',
      scores: { x: 0.1 },
    })
    const planned = await driver.plan(task, [failed])
    expect(planned).toEqual([{ id: 't', instruction: 'keep going' }])
    // The continuation is independent of the verdict: a verdict-free history
    // yields the identical plan.
    const noVerdict = await driver.plan(task, [iter(undefined)])
    expect(noVerdict).toEqual([{ id: 't', instruction: 'keep going' }])
  })

  it('stops on a valid shot and at the shot cap', async () => {
    expect(await driver.plan(task, [iter({ valid: true, score: 1 })])).toEqual([])
    const capped = [iter(undefined, 0), iter(undefined, 1), iter(undefined, 2)]
    expect(await driver.plan(task, capped)).toEqual([])
  })
})

describe('dumbDriver — pass/fail-only control (leak-free firewall)', () => {
  const driver = dumbDriver<Task, Output>({
    onPass: 'looks good, confirm',
    onFail: 'failed, try again',
    applyContinuation,
    maxIterations: 3,
  })

  it('reads ONLY verdict.valid, never notes/scores', async () => {
    // Tripwire: a getter on `notes`/`scores` throws if the driver touches them.
    const trapVerdict = { valid: false, score: 0 } as DefaultVerdict
    Object.defineProperty(trapVerdict, 'notes', {
      get() {
        throw new Error('dumbDriver read verdict.notes — firewall breached')
      },
    })
    Object.defineProperty(trapVerdict, 'scores', {
      get() {
        throw new Error('dumbDriver read verdict.scores — firewall breached')
      },
    })
    const planned = await driver.plan(task, [iter(trapVerdict)])
    expect(planned).toEqual([{ id: 't', instruction: 'failed, try again' }])
  })

  it('treats a missing/undefined verdict as not-valid (total over the bit)', async () => {
    expect(await driver.plan(task, [iter(undefined)])).toEqual([
      { id: 't', instruction: 'failed, try again' },
    ])
  })

  it('stops the loop on a valid shot', async () => {
    expect(await driver.plan(task, [iter({ valid: true, score: 1 })])).toEqual([])
  })
})

describe('shared decide() — terminates exactly like refine', () => {
  const driver = dumbDriver<Task, Output>({
    onPass: 'p',
    onFail: 'f',
    applyContinuation,
    maxIterations: 3,
  })

  it('pick-winner when any shot is valid', () => {
    expect(
      driver.decide([iter({ valid: false, score: 0 }), iter({ valid: true, score: 1 }, 1)]),
    ).toBe('pick-winner')
  })

  it('refine while under the cap, fail at the cap', () => {
    expect(driver.decide([iter({ valid: false, score: 0 })])).toBe('refine')
    const capped = [iter(undefined, 0), iter(undefined, 1), iter(undefined, 2)]
    expect(driver.decide(capped)).toBe('fail')
  })
})
