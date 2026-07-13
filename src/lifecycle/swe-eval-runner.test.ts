import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AgenticSurface } from '../runtime'
import type { SweEvalTask } from './swe-eval-runner'

// One synthetic held-out instance's controls. `delayMs` DESCENDS with input
// order so, at concurrency >= n, drives COMPLETE in the reverse of input order —
// any pool that appended rows by completion order (instead of input order) would
// scramble the returned rows[] and fail the deep-equal below.
interface Fixture {
  kind: 'patch' | 'empty'
  appendLen: number
  usd: number
  shots: number
  tokens: { input: number; output: number }
  resolved: boolean
  delayMs: number
}
const FIXTURES: Record<string, Fixture> = {
  t1: {
    kind: 'patch',
    appendLen: 10,
    usd: 0.011,
    shots: 1,
    tokens: { input: 100, output: 40 },
    resolved: true,
    delayMs: 50,
  },
  t2: {
    kind: 'patch',
    appendLen: 20,
    usd: 0.022,
    shots: 2,
    tokens: { input: 200, output: 80 },
    resolved: false,
    delayMs: 40,
  },
  t3: {
    kind: 'empty',
    appendLen: 0,
    usd: 0.033,
    shots: 1,
    tokens: { input: 300, output: 120 },
    resolved: false,
    delayMs: 30,
  },
  t4: {
    kind: 'patch',
    appendLen: 40,
    usd: 0.044,
    shots: 3,
    tokens: { input: 400, output: 160 },
    resolved: true,
    delayMs: 20,
  },
  t5: {
    kind: 'patch',
    appendLen: 50,
    usd: 0.055,
    shots: 2,
    tokens: { input: 500, output: 200 },
    resolved: true,
    delayMs: 10,
  },
}
const TASK_IDS = Object.keys(FIXTURES)

// Mutable control the mocked drive reads at CALL time (repos are built in
// beforeAll, after the module graph loads).
const state = {
  repos: {} as Record<string, string>,
  inFlight: 0,
  maxInFlight: 0,
}
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// Mock ONLY the model call. `runAgentic` drives the real proxy.score() (which
// shells `git diff` over each task's temp repo, the honest capture path), tracks
// peak in-flight count, and returns per-task-distinct cost/shots/tokens.
const runAgentic = vi.fn(
  async (args: {
    surface: AgenticSurface
    task: { id: string }
  }): Promise<{ usd: number; shots: number; tokens: { input: number; output: number } }> => {
    const fx = FIXTURES[args.task.id] as Fixture
    state.inFlight += 1
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight)
    try {
      await delay(fx.delayMs)
      // The refine strategy scores once before the surface closes; emulate that
      // single call so the runner captures this task's diff.
      await args.surface.score(
        { id: args.task.id, systemPrompt: '', userPrompt: '' },
        { id: state.repos[args.task.id] as string, surface: 'swe' },
      )
      return { usd: fx.usd, shots: fx.shots, tokens: fx.tokens }
    } finally {
      state.inFlight -= 1
    }
  },
)

vi.mock('../runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime')>()
  return { ...actual, runAgentic }
})

const { sweEvalRunner } = await import('./swe-eval-runner')

const judge = vi.fn(async (task: SweEvalTask) => ({
  resolved: (FIXTURES[task.id] as Fixture).resolved,
}))

const tasks: SweEvalTask[] = TASK_IDS.map((id) => ({ id, prompt: `fix ${id}` }))
const profile: AgentProfile = { name: 'test', prompt: { systemPrompt: 'seed' } }

// A minimal domain surface; runAgentic is mocked so open/tools/call/close are
// never reached — only score() matters and the proxy overrides it.
const environment: AgenticSurface = {
  name: 'swe-fake',
  open: async () => ({ id: 'h', surface: 'swe' }),
  tools: async () => [],
  call: async () => '',
  score: async () => ({ passes: 0, total: 1, errored: 0 }),
  close: async () => {},
}

const baseOpts = {
  environment,
  tasks,
  judge,
  seedPrompt: 'seed',
  routerBaseUrl: 'http://unused',
  routerKey: 'k',
  model: 'test-model',
}

async function runOnce(concurrency?: number): Promise<{
  composite: number
  costUsd: number
  rows: unknown
  maxInFlight: number
}> {
  state.inFlight = 0
  state.maxInFlight = 0
  runAgentic.mockClear()
  judge.mockClear()
  const runner = sweEvalRunner({
    ...baseOpts,
    ...(concurrency === undefined ? {} : { concurrency }),
  })
  const res = await runner(profile)
  return {
    composite: res.composite,
    costUsd: res.costUsd,
    rows: (res.details as { rows: unknown }).rows,
    maxInFlight: state.maxInFlight,
  }
}

let root: string
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'swe-eval-conc-'))
  for (const id of TASK_IDS) {
    const dir = join(root, id)
    mkdirSync(dir, { recursive: true })
    execFileSync('git', ['init', '-q', dir])
    const g = (a: string[]) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' })
    g(['config', 'user.email', 't@e.com'])
    g(['config', 'user.name', 'T'])
    writeFileSync(join(dir, 'file.txt'), 'a\nb\nc\n')
    g(['add', '-A'])
    g(['commit', '-q', '-m', 'init'])
    const fx = FIXTURES[id] as Fixture
    if (fx.kind === 'patch') {
      // an unstaged modification → a non-empty `git diff`
      writeFileSync(join(dir, 'file.txt'), `a\nb\nc\n${'x'.repeat(fx.appendLen)}\n`)
    }
    state.repos[id] = dir
  }
})
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

describe('sweEvalRunner bounded concurrency', () => {
  it('concurrency > 1 yields identical composite, cost, and per-task rows as concurrency = 1', async () => {
    const serial = await runOnce(1)
    const parallel = await runOnce(5)

    // The invariant: the concurrent path is byte-for-byte the serial path.
    expect(parallel.composite).toBe(serial.composite)
    expect(parallel.costUsd).toBe(serial.costUsd)
    expect(parallel.rows).toEqual(serial.rows)

    // Non-trivial: three of five instances resolve (proves the judge ran and the
    // patch/empty mix is scored), not a degenerate all-zero tie.
    expect(serial.composite).toBeCloseTo(3 / 5, 10)
    const rows = serial.rows as Array<{ id: string; resolved: boolean; patchBytes: number }>
    // rows[] preserved in INPUT order despite reverse completion order.
    expect(rows.map((r) => r.id)).toEqual(['t1', 't2', 't3', 't4', 't5'])
    expect(rows.map((r) => r.resolved)).toEqual([true, false, false, true, true])
    // t3 produced no diff → judge skipped → zero patch bytes; the rest captured.
    expect(rows[2]?.patchBytes).toBe(0)
    expect(rows[0]?.patchBytes).toBeGreaterThan(0)

    // The concurrent run actually parallelized (peak 5 in flight) while the
    // serial run never had more than one drive live.
    expect(serial.maxInFlight).toBe(1)
    expect(parallel.maxInFlight).toBe(5)

    // Every distinct id was driven exactly once (never the same id twice — the
    // Docker-judge container-name safety condition). `runOnce` clears the mocks,
    // so these are the parallel run's calls alone.
    const driven = runAgentic.mock.calls.map(([a]) => a.task.id)
    expect(driven.slice().sort()).toEqual(TASK_IDS.slice().sort())
    expect(new Set(driven).size).toBe(driven.length)
    const judged = judge.mock.calls.map(([t]) => t.id)
    expect(new Set(judged).size).toBe(judged.length)
  })

  it('defaults to serial and clamps concurrency < 1, still identical rows', async () => {
    const serial = await runOnce(1)
    const def = await runOnce(undefined)
    const zero = await runOnce(0)
    expect(def.maxInFlight).toBe(1)
    expect(zero.maxInFlight).toBe(1)
    expect(def.rows).toEqual(serial.rows)
    expect(zero.rows).toEqual(serial.rows)
    expect(def.costUsd).toBe(serial.costUsd)
  })

  it('caps peak in-flight at the task count when concurrency exceeds it', async () => {
    const wide = await runOnce(100)
    expect(wide.maxInFlight).toBe(TASK_IDS.length)
  })
})
