import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DefaultVerdict } from '@tangle-network/agent-eval'
import type { SandboxEvent } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  defineLeaderboard,
  type LeaderboardIterationInfo,
  type LeaderboardRunContext,
  type LeaderboardScenario,
  naiveRetryDriver,
} from './define-leaderboard'
import { inProcessSandboxClient } from './in-process-sandbox-client'
import type { Iteration } from './types'

interface FakeCase {
  id: string
  answer: string
}

const CASES: FakeCase[] = [
  { id: 'case-alpha', answer: 'ALPHA-42' },
  { id: 'case-beta', answer: 'BETA-7' },
]

/** Offline backend: echoes the prompt's embedded answer + meters an llm_call,
 *  so the matrix integrity guard sees a real (non-stub) backend. */
function fakeBackend() {
  return inProcessSandboxClient({
    onPrompt: (prompt): SandboxEvent[] => {
      const answer = /answer=(\S+)/.exec(prompt)?.[1] ?? 'missing'
      return [
        { type: 'llm_call', data: { tokensIn: 12, tokensOut: 6, costUsd: 0.002 } },
        { type: 'result', data: { finalText: `final answer=${answer}` } },
      ]
    },
  })
}

function board(overrides: Partial<Parameters<typeof defineLeaderboard<FakeCase>>[0]> = {}) {
  return defineLeaderboard<FakeCase>({
    name: 'fake-board',
    cases: CASES,
    prompt: async (c) => `solve the task. answer=${c.answer}`,
    score: (output, c) => (output.includes(c.answer) ? 1 : 0),
    baseProfile: {
      name: 'fake-board',
      harness: 'opencode',
      model: { provider: 'offline', default: 'test-model@2026-01-01' },
    },
    backends: { inproc: fakeBackend },
    export: async () => {}, // silence the default table print in tests
    ...overrides,
  })
}

const AXIS = ['--backend', 'inproc', '--harnesses', 'opencode', '--models', 'test-model@2026-01-01']

describe('defineLeaderboard', () => {
  it('runs the matrix end-to-end offline and scores every (profile, case) cell', async () => {
    const result = await board().run([...AXIS])

    expect(result.records).toHaveLength(2)
    expect(Object.keys(result.byScenario).sort()).toEqual(['case-alpha', 'case-beta'])
    const summaries = Object.values(result.byProfile)
    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.meanComposite).toBe(1)
    expect(summaries[0]?.model).toBe('test-model@2026-01-01')
    // The fake backend's llm_call events were metered — the run is REAL, not a stub.
    expect(result.integrity.verdict).toBe('real')
    for (const r of result.records) expect(r.tokenUsage.input).toBeGreaterThan(0)
  })

  it('defaults to a FRESH run dir per invocation (no stale cell-cache reuse)', async () => {
    const dirs: string[] = []
    const b = board({
      export: async (_result, ctx: LeaderboardRunContext) => {
        dirs.push(ctx.runDir)
      },
    })
    await b.run([...AXIS, '--cases', 'case-alpha'])
    await b.run([...AXIS, '--cases', 'case-alpha'])
    expect(dirs).toHaveLength(2)
    expect(dirs[0]).not.toBe(dirs[1])
    for (const d of dirs) expect(d.startsWith(tmpdir())).toBe(true)
  })

  it('honors an explicit --run-dir (the opt-in resume path)', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'lb-explicit-'))
    let seen: string | undefined
    await board({
      export: async (_r, ctx) => {
        seen = ctx.runDir
      },
    }).run([...AXIS, '--cases', 'case-alpha', '--run-dir', runDir])
    expect(seen).toBe(runDir)
  })

  it('subsets cases via --cases and rejects unknown ids', async () => {
    const result = await board().run([...AXIS, '--cases', 'case-beta'])
    expect(result.records).toHaveLength(1)
    expect(Object.keys(result.byScenario)).toEqual(['case-beta'])

    await expect(board().run([...AXIS, '--cases', 'nope'])).rejects.toThrow(/unknown case "nope"/)
  })

  it('stamps a snapshot onto bare model ids (RunRecord identity requirement)', async () => {
    const result = await board().run([
      '--backend',
      'inproc',
      '--harnesses',
      'opencode',
      '--models',
      'test-model',
    ])
    expect(result.records[0]?.model).toBe('test-model@leaderboard')
  })

  it('wraps score() as the campaign judge, carrying dimensions and notes', async () => {
    const result = await board({
      score: (output, c) => ({
        composite: output.includes(c.answer) ? 0.5 : 0,
        dimensions: { exactness: 1 },
        notes: 'structured',
      }),
    }).run([...AXIS, '--cases', 'case-alpha'])
    expect(Object.values(result.byProfile)[0]?.meanComposite).toBe(0.5)
    const outcome = result.records[0]?.outcome as { searchScore?: number } | undefined
    expect(outcome?.searchScore).toBe(0.5)
  })

  it('feeds each cell raw events + case through onCellEvents (the metric-capture seam)', async () => {
    const seen: Array<{ id: string; types: string[] }> = []
    await board({
      onCellEvents: (events, c) => {
        seen.push({ id: c.id, types: events.map((e) => (e as { type: string }).type) })
      },
    }).run([...AXIS])
    expect(seen.map((s) => s.id).sort()).toEqual(['case-alpha', 'case-beta'])
    for (const s of seen) expect(s.types).toContain('llm_call')
  })

  it('carries per-shot index + verdict to onCellEvents, and error for THROWN shots', async () => {
    // Shot 0 throws before producing events; shot 1 succeeds. Before the
    // iteration-metadata seam, the thrown shot was invisible through the facade.
    let attempts = 0
    const throwingBackend = inProcessSandboxClient({
      onPrompt: (prompt): SandboxEvent[] => {
        if (attempts++ === 0) throw new Error('upstream harness terminated')
        const answer = /answer=(\S+)/.exec(prompt)?.[1] ?? 'missing'
        return [
          { type: 'llm_call', data: { tokensIn: 12, tokensOut: 6, costUsd: 0.002 } },
          { type: 'result', data: { finalText: `final answer=${answer}` } },
        ]
      },
    })
    const shots: Array<{ id: string; info: LeaderboardIterationInfo | undefined }> = []
    await board({
      backends: { inproc: () => throwingBackend },
      shots: 2,
      onCellEvents: (_events, c, info) => {
        shots.push({ id: c.id, info })
      },
    }).run([...AXIS, '--cases', 'case-alpha'])

    expect(shots).toHaveLength(2)
    expect(shots[0]?.info).toEqual({ index: 0, error: 'upstream harness terminated' })
    expect(shots[1]?.info).toEqual({ index: 1, verdict: { score: 1 } })
  })

  it('refuses a harness/model cell that expands to a runtime-selected marker before backend work', async () => {
    const snappedAxis = [
      '--backend',
      'inproc',
      '--harnesses',
      'claude-code',
      '--models',
      'moonshot/kimi-k2@2026-01-01',
    ]
    let backendFactories = 0
    let prompts = 0
    await expect(
      board({
        backends: {
          inproc: () => {
            backendFactories += 1
            return fakeBackend()
          },
        },
        prompt: (c) => {
          prompts += 1
          return `solve the task. answer=${c.answer}`
        },
        resolveModel: () => 'kimi-k2@2026-01-01',
      }).run([...snappedAxis, '--cases', 'case-alpha']),
    ).rejects.toThrow(/runtime-selected/)
    expect(backendFactories).toBe(0)
    expect(prompts).toBe(0)
  })

  it('does not make runtime-selected cells executable through the cli-bridge backend', async () => {
    let backendFactories = 0
    await expect(
      board({
        backends: {
          'cli-bridge': () => {
            backendFactories += 1
            return fakeBackend()
          },
        },
        resolveModel: () => 'kimi-k2@2026-01-01',
      }).run([
        '--backend',
        'cli-bridge',
        '--harnesses',
        'claude-code',
        '--models',
        'moonshot/kimi-k2@2026-01-01',
        '--cases',
        'case-alpha',
      ]),
    ).rejects.toThrow(/runtime-selected/)
    expect(backendFactories).toBe(0)
  })

  it('flows a structured TArtifact through parseOutput → score → records natively', async () => {
    interface Structured {
      answer: string
      confidence: number
    }
    const result = await defineLeaderboard<FakeCase, Structured>({
      name: 'structured-board',
      cases: CASES,
      prompt: async (c) => `solve the task. answer=${c.answer}`,
      baseProfile: {
        name: 'structured-board',
        harness: 'opencode',
        model: { provider: 'offline', default: 'test-model@2026-01-01' },
      },
      parseOutput: (events): Structured => {
        const final = events.find((e) => (e as { type: string }).type === 'result') as
          | { data?: { finalText?: string } }
          | undefined
        const text = final?.data?.finalText ?? ''
        return { answer: /answer=(\S+)/.exec(text)?.[1] ?? '', confidence: 0.9 }
      },
      score: (output, c) => (output.answer === c.answer ? output.confidence : 0),
      backends: { inproc: fakeBackend },
      export: async () => {},
    }).run([...AXIS, '--cases', 'case-alpha'])

    expect(Object.values(result.byProfile)[0]?.meanComposite).toBe(0.9)
  })

  it('parses spec.flags and surfaces every flag to the hooks via ctx.args', async () => {
    let args: Record<string, string | undefined> = {}
    await board({
      flags: { split: { default: 'dev', description: 'dataset split' } },
      setup: (ctx) => {
        args = ctx.args
      },
    }).run([...AXIS, '--cases', 'case-alpha', '--split', 'holdout'])
    expect(args.split).toBe('holdout')
    expect(args.backend).toBe('inproc')
    expect(args.harnesses).toBe('opencode')
  })

  it("fails loud on the default 'sandbox' backend with guidance to supply a real client", async () => {
    await expect(
      defineLeaderboard<FakeCase>({
        name: 'no-backend',
        cases: CASES,
        prompt: (c) => c.id,
        score: () => 0,
        baseProfile: {
          name: 'no-backend',
          harness: 'opencode',
          model: { provider: 'offline', default: 'm@1' },
        },
      }).run(['--models', 'm@1']),
    ).rejects.toThrow(/backends\.sandbox/)
  })

  it('toBenchmarkAdapter(): loadTasks/judge round-trip in the structural BenchmarkAdapter shape', async () => {
    const adapter = board().toBenchmarkAdapter()
    expect(adapter.name).toBe('fake-board')
    await adapter.preflight()

    const tasks = await adapter.loadTasks()
    expect(tasks.map((t) => t.id)).toEqual(['case-alpha', 'case-beta'])
    expect(tasks[0]?.prompt).toContain('answer=ALPHA-42')

    const pass = await adapter.judge(tasks[0] as { id: string; prompt: string }, 'final ALPHA-42')
    expect(pass).toMatchObject({ resolved: true, score: 1 })
    const fail = await adapter.judge(tasks[0] as { id: string; prompt: string }, 'wrong')
    expect(fail).toMatchObject({ resolved: false, score: 0 })

    const subset = await adapter.loadTasks({ ids: ['case-beta'] })
    expect(subset.map((t) => t.id)).toEqual(['case-beta'])
    expect(await adapter.goldArtifact(tasks[0] as { id: string; prompt: string })).toBeUndefined()

    // preflight fails loud on duplicate ids — the cheap corpus-integrity check.
    const dup = defineLeaderboard<FakeCase>({
      name: 'dup',
      cases: [CASES[0] as FakeCase, CASES[0] as FakeCase],
      prompt: (c) => c.id,
      score: () => 0,
      baseProfile: {
        name: 'dup',
        harness: 'opencode',
        model: { provider: 'offline', default: 'test-model@2026-01-01' },
      },
    }).toBenchmarkAdapter()
    await expect(dup.preflight()).rejects.toThrow(/duplicate case id/)
  })
})

// The no-signal retry floor: shot-0 plan, verbatim re-run, leak-free firewall.
// surviving loop-kernel steering control, and these tests hold the same observable contract its
// predecessor's suite held — shot-0 plan, verbatim re-run, the leak-free firewall (reads only
// `verdict.valid`), stop-on-valid, stop-at-cap, and the refine/pick-winner/fail decision set.
describe('naiveRetryDriver — the no-signal retry floor', () => {
  type Case = { id: string; answer: string }
  type Task = LeaderboardScenario<Case>
  const task: Task = { id: 't', kind: 'leaderboard-case', case: { id: 't', answer: 'A' } }
  const driver = naiveRetryDriver<Case, string>(3)

  function iter(verdict: DefaultVerdict | undefined, index = 0): Iteration<Task, string> {
    return {
      index,
      task,
      agentRunName: 'agent',
      output: 'out',
      verdict,
      events: [],
      startedAt: 0,
      endedAt: 1,
      costUsd: 0,
      tokenUsage: { input: 0, output: 0 },
    }
  }

  it('runs the original task at shot 0', async () => {
    expect(await driver.plan(task, [])).toEqual([task])
  })

  it('re-runs the SAME task verbatim, reading only verdict.valid (leak-free firewall)', async () => {
    // Tripwire: getters on `notes`/`scores` throw if the driver reads grader findings.
    const trapVerdict = { valid: false, score: 0 } as { valid: boolean; score: number }
    Object.defineProperty(trapVerdict, 'notes', {
      get() {
        throw new Error('naiveRetryDriver read verdict.notes — firewall breached')
      },
    })
    Object.defineProperty(trapVerdict, 'scores', {
      get() {
        throw new Error('naiveRetryDriver read verdict.scores — firewall breached')
      },
    })
    const planned = await driver.plan(task, [iter(trapVerdict)])
    expect(planned).toEqual([task])
    expect(planned[0]).toBe(task)
    // A verdict-free history plans identically: a missing verdict is not-valid, never a throw.
    expect(await driver.plan(task, [iter(undefined)])).toEqual([task])
  })

  it('stops on a valid shot and at the shot cap', async () => {
    expect(await driver.plan(task, [iter({ valid: true, score: 1 })])).toEqual([])
    const capped = [iter(undefined, 0), iter(undefined, 1), iter(undefined, 2)]
    expect(await driver.plan(task, capped)).toEqual([])
  })

  it('decides pick-winner when any shot is valid', () => {
    expect(
      driver.decide([iter({ valid: false, score: 0 }), iter({ valid: true, score: 1 }, 1)]),
    ).toBe('pick-winner')
  })

  it('decides refine while under the cap, fail at the cap', () => {
    expect(driver.decide([iter({ valid: false, score: 0 })])).toBe('refine')
    const capped = [iter(undefined, 0), iter(undefined, 1), iter(undefined, 2)]
    expect(driver.decide(capped)).toBe('fail')
  })
})
