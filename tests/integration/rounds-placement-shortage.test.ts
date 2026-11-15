import { parseErrorResponse } from '@tangle-network/sandbox'
import { afterEach, expect, it, vi } from 'vitest'
import { inProcessSandboxClient, runAgentRounds } from '../../src/runtime'
import type { SandboxClient } from '../../src/runtime/types'

// What eu1 answered every create of delivery #7291's build stage, 2026-10-20 03:00-03:20Z. That
// stage missed its ready budget and the workflow reran its four finished stages.
const noRoom = () =>
  parseErrorResponse(
    503,
    JSON.stringify({
      error: 'No available hosts with capacity after 20000ms admission retry: memory full',
      code: 'CAPACITY_EXHAUSTED',
    }),
  )

afterEach(() => {
  vi.useRealTimers()
})

// Only the clock is fake: the shortage outlasts one 10 min ready budget in fake minutes.
it('waits out a placement shortage longer than one ready budget and runs each round once', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  const inputs: number[] = []
  const inner = inProcessSandboxClient({
    async onPrompt(prompt) {
      const { input } = JSON.parse(prompt) as { input: number }
      inputs.push(input)
      return [
        { type: 'result', data: { finalText: String(input * input) } },
        { type: 'done', data: { outcome: { type: 'completed' } } },
      ]
    },
  })
  let refusals = 0
  let shortageEndsAt: number | undefined
  const client: SandboxClient = {
    ...inner,
    async create(options, request) {
      // The second round finds no room for 11 min.
      if (inputs.length === 1) {
        shortageEndsAt ??= Date.now() + 11 * 60_000
        if (Date.now() < shortageEndsAt) {
          refusals += 1
          throw noRoom()
        }
      }
      return inner.create(options, request)
    },
  }
  const running = runAgentRounds<{ input: number; target: number }, number, 'continue' | 'done'>({
    task: { input: 2, target: 9 },
    maxIterations: 2,
    maxConcurrency: 1,
    driver: {
      async plan(task, history) {
        const previous = history.at(-1)
        return [{ ...task, input: previous ? previous.task.input + 1 : task.input }]
      },
      decide: (history) =>
        history.some((iteration) => iteration.verdict?.valid) ? 'done' : 'continue',
    },
    agentRun: {
      profile: {
        name: 'placement-shortage-worker',
        harness: 'opencode',
        model: { provider: 'offline', default: 'offline-test-model' },
      },
      taskToPrompt: JSON.stringify,
    },
    output: {
      parse(events) {
        const text = events.find((event) => event.type === 'result')?.data?.finalText
        if (typeof text !== 'string') throw new Error('worker did not return its output')
        return Number(text)
      },
    },
    validator: {
      async validate(output) {
        return { valid: output === 9, score: Number(output === 9) }
      },
    },
    ctx: { sandboxClient: client },
  })
  let settled = false
  running.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  while (!settled) {
    await vi.advanceTimersToNextTimerAsync()
    await new Promise((resolve) => setImmediate(resolve))
  }
  const result = await running

  expect(refusals).toBeGreaterThan(0)
  expect(Date.now() - (shortageEndsAt ?? Number.NaN)).toBeGreaterThanOrEqual(0)
  expect(result.decision).toBe('done')
  // The finished first round ran once; the second ran once, when room returned.
  expect(inputs).toEqual([2, 3])
  expect(
    result.iterations.map((iteration) => ({ output: iteration.output, error: iteration.error })),
  ).toEqual([
    { output: 4, error: undefined },
    { output: 9, error: undefined },
  ])
})
