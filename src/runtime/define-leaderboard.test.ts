import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentEnvironmentEvent } from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import {
  defineLeaderboard,
  type LeaderboardIterationInfo,
  type LeaderboardRunContext,
} from './define-leaderboard'
import { inProcessEnvironmentProvider } from './in-process-environment-provider'

interface FakeCase {
  id: string
  answer: string
}

const CASES: FakeCase[] = [
  { id: 'case-alpha', answer: 'ALPHA-42' },
  { id: 'case-beta', answer: 'BETA-7' },
]

/** Offline provider that echoes the embedded answer and records model usage. */
function fakeProvider() {
  return inProcessEnvironmentProvider({
    onTurn: (prompt): AgentEnvironmentEvent[] => {
      const answer = /answer=(\S+)/.exec(prompt)?.[1] ?? 'missing'
      return [
        {
          type: 'llm_call',
          data: { tokensIn: 12, tokensOut: 6, costUsd: 0.002 },
          usage: { inputTokens: 12, outputTokens: 6, cost: 0.002 },
        },
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
    providers: { inproc: fakeProvider },
    export: async () => {}, // silence the default table print in tests
    ...overrides,
  })
}

const AXIS = [
  '--provider',
  'inproc',
  '--harnesses',
  'opencode',
  '--models',
  'test-model@2026-01-01',
]

describe('defineLeaderboard', () => {
  it('runs the matrix end-to-end offline and scores every (profile, case) cell', async () => {
    const result = await board().run([...AXIS])

    expect(result.records).toHaveLength(2)
    expect(Object.keys(result.byScenario).sort()).toEqual(['case-alpha', 'case-beta'])
    const summaries = Object.values(result.byProfile)
    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.meanComposite).toBe(1)
    expect(summaries[0]?.model).toBe('test-model@2026-01-01')
    // The provider's llm_call events make this a metered run.
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

  it('rejects removed runner aliases', async () => {
    await expect(
      board().run([
        '--provider',
        'inproc',
        '--harnesses',
        'claude',
        '--models',
        'test-model@2026-01-01',
      ]),
    ).rejects.toThrow('invalid harness "claude"')
  })

  it('stamps a snapshot onto bare model ids (RunRecord identity requirement)', async () => {
    const result = await board().run([
      '--provider',
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
    const throwingProvider = inProcessEnvironmentProvider({
      onTurn: (prompt): AgentEnvironmentEvent[] => {
        if (attempts++ === 0) throw new Error('upstream harness terminated')
        const answer = /answer=(\S+)/.exec(prompt)?.[1] ?? 'missing'
        return [
          {
            type: 'llm_call',
            data: { tokensIn: 12, tokensOut: 6, costUsd: 0.002 },
            usage: { inputTokens: 12, outputTokens: 6, cost: 0.002 },
          },
          { type: 'result', data: { finalText: `final answer=${answer}` } },
        ]
      },
    })
    const shots: Array<{ id: string; info: LeaderboardIterationInfo | undefined }> = []
    await board({
      providers: { inproc: () => throwingProvider },
      shots: 2,
      onCellEvents: (_events, c, info) => {
        shots.push({ id: c.id, info })
      },
    }).run([...AXIS, '--cases', 'case-alpha'])

    expect(shots).toHaveLength(2)
    expect(shots[0]?.info).toEqual({ index: 0, error: 'upstream harness terminated' })
    expect(shots[1]?.info).toEqual({ index: 1, verdict: { score: 1 } })
  })

  it('pins HARNESS_NATIVE_MODEL-snapped cells via the resolveModel seam', async () => {
    // claude-code is vendor-locked to anthropic/*; a moonshot model snaps the
    // axis to the 'default' sentinel, and the RunRecord then REQUIRES a
    // dispatch-reported served model.
    const snappedAxis = [
      '--provider',
      'inproc',
      '--harnesses',
      'claude-code',
      '--models',
      'moonshot/kimi-k2@2026-01-01',
    ]
    await expect(board().run([...snappedAxis, '--cases', 'case-alpha'])).rejects.toThrow(
      /paid-call receipt/,
    )

    const result = await board({
      resolveModel: (events) => {
        // The served model rides the provider's usage events.
        const call = events.find((e) => (e as { type: string }).type === 'llm_call')
        return call ? 'kimi-k2@2026-01-01' : undefined
      },
    }).run([...snappedAxis, '--cases', 'case-alpha'])
    expect(result.records[0]?.model).toBe('kimi-k2@2026-01-01')
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
      parseOutput: (events): Structured => {
        const final = events.find((e) => (e as { type: string }).type === 'result') as
          | { data?: { finalText?: string } }
          | undefined
        const text = final?.data?.finalText ?? ''
        return { answer: /answer=(\S+)/.exec(text)?.[1] ?? '', confidence: 0.9 }
      },
      score: (output, c) => (output.answer === c.answer ? output.confidence : 0),
      providers: { inproc: fakeProvider },
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
    expect(args.provider).toBe('inproc')
    expect(args.harnesses).toBe('opencode')
  })

  it("fails clearly when the default 'cli-bridge' provider has no bearer token", async () => {
    const bridgeBearer = process.env.BRIDGE_BEARER
    const cliBridgeBearer = process.env.CLI_BRIDGE_BEARER
    delete process.env.BRIDGE_BEARER
    delete process.env.CLI_BRIDGE_BEARER
    try {
      await expect(
        defineLeaderboard<FakeCase>({
          name: 'no-provider',
          cases: CASES,
          prompt: (c) => c.id,
          score: () => 0,
        }).run(['--models', 'm@1']),
      ).rejects.toThrow(/provider 'cli-bridge' needs BRIDGE_BEARER or CLI_BRIDGE_BEARER/)
    } finally {
      if (bridgeBearer === undefined) delete process.env.BRIDGE_BEARER
      else process.env.BRIDGE_BEARER = bridgeBearer
      if (cliBridgeBearer === undefined) delete process.env.CLI_BRIDGE_BEARER
      else process.env.CLI_BRIDGE_BEARER = cliBridgeBearer
    }
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
    }).toBenchmarkAdapter()
    await expect(dup.preflight()).rejects.toThrow(/duplicate case id/)
  })
})
