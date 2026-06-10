/**
 * Evolution-engine invariants:
 *   - generations author from train losses; the promotion decision runs on a DISJOINT
 *     holdout slice drawn only after all authoring (the no-adaptive-reuse rule);
 *   - a genuinely better authored strategy displaces the incumbent and promotes;
 *   - author failures are recorded per candidate, never silent, and an all-failed run
 *     throws instead of reporting a no-op evolution;
 *   - cost-aware champion selection: within the score band, the cheapest wins;
 *   - every authored artifact carries its description length (gzip bits).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BenchmarkReport } from '../../src/runtime/run-benchmark'
import type { AgenticSurface, AgenticTask } from '../../src/runtime/strategy'
import { sample } from '../../src/runtime/strategy'
import { runStrategyEvolution, selectChampion } from '../../src/runtime/strategy-evolution'

// ── Fixtures ──────────────────────────────────────────────────────────────────────

/** Deterministic surface: score = shots taken on the handle, capped at 2 of 2 — one
 *  worker pass per shot is observable via tools() calls. Depth (2 shots, one handle)
 *  scores 1.0; breadth (fresh handle per shot) scores 0.5. */
function shotCountingSurface(): AgenticSurface {
  const shotsByHandle = new Map<string, number>()
  let seq = 0
  return {
    name: 'shot-counter',
    async open() {
      seq += 1
      const id = `h-${seq}`
      shotsByHandle.set(id, 0)
      return { id, surface: 'shot-counter' }
    },
    async tools(_t, handle) {
      shotsByHandle.set(handle.id, (shotsByHandle.get(handle.id) ?? 0) + 1)
      return []
    },
    async call() {
      return 'ok'
    },
    async score(_t, handle) {
      return { passes: Math.min(shotsByHandle.get(handle.id) ?? 0, 2), total: 2, errored: 0 }
    },
    async close() {},
  }
}

const twoShotDepthModule = `import { defineStrategy } from '@tangle-network/agent-runtime/loops'
export default defineStrategy('two-shot-depth', async ({ surface, task, shot }) => {
  const handle = await surface.open(task)
  const progression: number[] = []
  let completions = 0
  try {
    const first = await shot({ handle })
    if (first) { completions += first.completions; progression.push(first.score) }
    const second = await shot({ handle, messages: first?.messages })
    if (second) { completions += second.completions; progression.push(second.score) }
  } finally {
    await surface.close(handle)
  }
  const score = progression.length ? Math.max(...progression) : 0
  return { score, resolved: score >= 1, completions, progression, shots: progression.length }
})`

const oneShotModule = `import { defineStrategy } from '@tangle-network/agent-runtime/loops'
export default defineStrategy('one-shot', async ({ shot }) => {
  const out = await shot()
  return { score: out?.score ?? 0, resolved: false, completions: out?.completions ?? 0, progression: [out?.score ?? 0], shots: 1 }
})`

/** A scripted author: each chat() call pops the next reply. */
function scriptedChat(replies: string[]) {
  const seen: string[] = []
  let i = 0
  const chat = {
    chat: async (req: { messages: Array<{ content: string }> }) => {
      seen.push(req.messages.map((m) => m.content).join('\n'))
      const reply = replies[Math.min(i, replies.length - 1)] as string
      i += 1
      return { content: reply }
    },
  }
  return { chat: chat as never, seen }
}

const fenced = (code: string) => `\`\`\`ts\n${code}\n\`\`\``

function stubWorkerRouter(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'DONE' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    })),
  )
}

const worker = {
  routerBaseUrl: 'http://router.test/v1',
  routerKey: 'test-key',
  model: 'test-model',
}

const sliceTasks = (calls: Array<{ offset: number; n: number }>) => {
  return async (offset: number, n: number): Promise<AgenticTask[]> => {
    calls.push({ offset, n })
    return Array.from({ length: n }, (_, i) => ({
      id: `task-${offset + i}`,
      systemPrompt: 'fixture',
      userPrompt: 'reach the target',
    }))
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── selectChampion ────────────────────────────────────────────────────────────────

describe('selectChampion', () => {
  const report = (
    perStrategy: Record<string, { score: number; usd: number }>,
  ): BenchmarkReport => ({
    n: 1,
    excluded: 0,
    perStrategy: Object.fromEntries(
      Object.entries(perStrategy).map(([k, v]) => [k, { ...v, resolved: 0, ms: 0 }]),
    ),
    perTask: [],
    pareto: [],
  })

  it('costAware: within the band, the cheapest wins', () => {
    const r = report({
      pricey: { score: 0.631, usd: 0.028 },
      thrifty: { score: 0.625, usd: 0.013 },
      weak: { score: 0.4, usd: 0.001 },
    })
    const pick = selectChampion(r, ['pricey', 'thrifty', 'weak'], 'costAware', 0.01)
    expect(pick.name).toBe('thrifty')
  })

  it('score: the best mean score wins regardless of cost', () => {
    const r = report({
      pricey: { score: 0.631, usd: 0.028 },
      thrifty: { score: 0.625, usd: 0.013 },
    })
    expect(selectChampion(r, ['pricey', 'thrifty'], 'score', 0.01).name).toBe('pricey')
  })
})

// ── The full loop ─────────────────────────────────────────────────────────────────

describe('runStrategyEvolution', () => {
  it('a better authored strategy displaces the incumbent and promotes on a fresh slice', async () => {
    stubWorkerRouter()
    const { chat } = scriptedChat([fenced(twoShotDepthModule)])
    const sliceCalls: Array<{ offset: number; n: number }> = []
    const report = await runStrategyEvolution({
      environment: shotCountingSurface(),
      tasks: sliceTasks(sliceCalls),
      trainN: 8,
      holdoutN: 8,
      worker,
      author: { chat, model: 'author-model' },
      budget: 3,
      concurrency: 2,
      generations: 1,
      populationSize: 1,
      baselines: [sample],
      outDir: mkdtempSync(join(tmpdir(), 'evolution-test-')),
    })

    expect(report.gen0Champion.name).toBe('sample')
    expect(report.finalChampion.name).toBe('two-shot-depth')
    expect(report.verdict.promoted).toBe(true)
    expect(report.verdict.reason).toBe('significant')
    // The no-adaptive-reuse rule: train = [0, 8), holdout = [8, …) — disjoint by offset.
    expect(sliceCalls).toEqual([
      { offset: 0, n: 8 },
      { offset: 8, n: 8 },
    ])
    // Lineage + description length recorded on the authored node.
    const node = report.archive.find((n) => n.name === 'two-shot-depth')
    expect(node?.source).toBe('authored')
    expect(node?.parent).toBe('sample')
    expect(node?.gzipBits).toBeGreaterThan(0)
    expect(report.trajectory.map((t) => t.champion)).toEqual(['sample', 'two-shot-depth'])
  })

  it('author failures are recorded per candidate; surviving candidates still compete', async () => {
    stubWorkerRouter()
    const { chat } = scriptedChat(['no code block here', fenced(oneShotModule)])
    const report = await runStrategyEvolution({
      environment: shotCountingSurface(),
      tasks: sliceTasks([]),
      trainN: 8,
      holdoutN: 8,
      worker,
      author: { chat },
      budget: 3,
      generations: 1,
      populationSize: 2,
      baselines: [sample],
      outDir: mkdtempSync(join(tmpdir(), 'evolution-test-')),
    })
    const gen1 = report.generations[0]
    expect(gen1?.candidates).toHaveLength(2)
    expect(gen1?.candidates[0]?.error).toMatch(/no code block/)
    expect(gen1?.candidates[1]?.name).toBe('one-shot')
  })

  it('throws when every author attempt fails — no silent no-op evolution', async () => {
    stubWorkerRouter()
    const { chat } = scriptedChat(['still no code'])
    await expect(
      runStrategyEvolution({
        environment: shotCountingSurface(),
        tasks: sliceTasks([]),
        trainN: 4,
        holdoutN: 4,
        worker,
        author: { chat },
        budget: 2,
        generations: 1,
        populationSize: 1,
        baselines: [sample],
        outDir: mkdtempSync(join(tmpdir(), 'evolution-test-')),
      }),
    ).rejects.toThrow(/every author attempt failed/)
  })

  it('colliding authored names are disambiguated and both keep distinct report cells', async () => {
    stubWorkerRouter()
    // Both candidates emit the SAME strategy name — the second must be renamed and
    // both must carry their own cells in the generation report.
    const { chat } = scriptedChat([fenced(oneShotModule), fenced(oneShotModule)])
    const report = await runStrategyEvolution({
      environment: shotCountingSurface(),
      tasks: sliceTasks([]),
      trainN: 4,
      holdoutN: 4,
      worker,
      author: { chat },
      budget: 2,
      generations: 1,
      populationSize: 2,
      baselines: [sample],
      outDir: mkdtempSync(join(tmpdir(), 'evolution-test-')),
    })
    const gen1 = report.generations[0]
    const names = gen1?.candidates.map((c) => c.name)
    expect(names).toEqual(['one-shot', 'one-shot-g1c2'])
    expect(gen1?.report.perStrategy['one-shot']).toBeDefined()
    expect(gen1?.report.perStrategy['one-shot-g1c2']).toBeDefined()
    const renamed = report.archive.find((n) => n.name === 'one-shot-g1c2')
    expect(renamed?.score).toBeGreaterThan(0)
  })

  it('the author is shown the tournament field and a divergence instruction', async () => {
    stubWorkerRouter()
    const { chat, seen } = scriptedChat([fenced(oneShotModule)])
    await runStrategyEvolution({
      environment: shotCountingSurface(),
      tasks: sliceTasks([]),
      trainN: 4,
      holdoutN: 4,
      worker,
      author: { chat },
      budget: 2,
      generations: 1,
      populationSize: 1,
      baselines: [sample],
      outDir: mkdtempSync(join(tmpdir(), 'evolution-test-')),
    })
    expect(seen[0]).toContain('STRATEGIES ALREADY IN THE TOURNAMENT')
    expect(seen[0]).toContain('sample (baseline')
  })
})

// ── Band-aware scoring ────────────────────────────────────────────────────────────

import { discriminatingMeans, pickChampion } from '../../src/runtime/strategy-evolution'

/** Difficulty by task id: 'easy-*' tasks score 1.0 for ANY strategy; others score by
 *  shots-on-handle capped at 2 (depth 1.0, breadth 0.5) — the middle band. */
function difficultySurface(): AgenticSurface {
  const shotsByHandle = new Map<string, number>()
  const taskByHandle = new Map<string, string>()
  let seq = 0
  return {
    name: 'difficulty',
    async open(task) {
      seq += 1
      const id = `h-${seq}`
      shotsByHandle.set(id, 0)
      taskByHandle.set(id, task.id)
      return { id, surface: 'difficulty' }
    },
    async tools(_t, handle) {
      shotsByHandle.set(handle.id, (shotsByHandle.get(handle.id) ?? 0) + 1)
      return []
    },
    async call() {
      return 'ok'
    },
    async score(_t, handle) {
      if (taskByHandle.get(handle.id)?.startsWith('easy-'))
        return { passes: 2, total: 2, errored: 0 }
      return { passes: Math.min(shotsByHandle.get(handle.id) ?? 0, 2), total: 2, errored: 0 }
    },
    async close() {},
  }
}

describe('band-aware scoring', () => {
  it('discriminatingMeans drops zero-spread tasks; null when every task ties', () => {
    const cell = (score: number) => ({
      score,
      resolved: false,
      progression: [score],
      usd: 0.01,
      ms: 0,
      tokens: { input: 0, output: 0 },
    })
    const report: BenchmarkReport = {
      n: 3,
      excluded: 0,
      perStrategy: {},
      perTask: [
        { taskId: 'sat', cells: { a: cell(1), b: cell(1) } },
        { taskId: 'band1', cells: { a: cell(0.2), b: cell(0.8) } },
        { taskId: 'band2', cells: { a: cell(0.4), b: cell(0.6) } },
      ],
      pareto: [],
    }
    const means = discriminatingMeans(report, ['a', 'b'])
    expect(means?.a.score).toBeCloseTo(0.3)
    expect(means?.b.score).toBeCloseTo(0.7)
    const allTied: BenchmarkReport = {
      ...report,
      perTask: [{ taskId: 'sat', cells: { a: cell(1), b: cell(1) } }],
    }
    expect(discriminatingMeans(allTied, ['a', 'b'])).toBeNull()
    // The pick over band means flips vs diluted full means when saturation dominates.
    expect(pickChampion(means ?? {}, ['a', 'b'], 'score', 0.01).name).toBe('b')
  })

  it('holdout band screening keeps only headroom tasks; estimand recorded', async () => {
    stubWorkerRouter()
    const { chat } = scriptedChat([fenced(twoShotDepthModule)])
    const mixed = (offset: number, n: number): Promise<AgenticTask[]> =>
      Promise.resolve(
        Array.from({ length: n }, (_, i) => {
          const idx = offset + i
          return {
            id: idx % 2 === 0 ? `easy-${idx}` : `band-${idx}`,
            systemPrompt: 'fixture',
            userPrompt: 'reach the target',
          }
        }),
      )
    const report = await runStrategyEvolution({
      environment: difficultySurface(),
      tasks: mixed,
      trainN: 6,
      holdoutN: 4,
      worker,
      author: { chat },
      budget: 3,
      generations: 1,
      populationSize: 1,
      baselines: [sample],
      band: { holdoutPoolN: 10 },
      minPairedTasks: 4,
      outDir: mkdtempSync(join(tmpdir(), 'evolution-test-')),
    })
    expect(report.band?.screened).toBe(10)
    expect(report.band?.inBand).toBe(5)
    for (const row of report.holdout.perTask) expect(row.taskId.startsWith('band-')).toBe(true)
    expect(report.verdict.promoted).toBe(true)
  })

  it('throws loudly when the pool has too few headroom tasks', async () => {
    stubWorkerRouter()
    const { chat } = scriptedChat([fenced(oneShotModule)])
    const allEasy = (offset: number, n: number): Promise<AgenticTask[]> =>
      Promise.resolve(
        Array.from({ length: n }, (_, i) => ({
          id: `easy-${offset + i}`,
          systemPrompt: 'fixture',
          userPrompt: 'reach the target',
        })),
      )
    await expect(
      runStrategyEvolution({
        environment: difficultySurface(),
        tasks: allEasy,
        trainN: 4,
        holdoutN: 4,
        worker,
        author: { chat },
        budget: 2,
        generations: 1,
        populationSize: 1,
        baselines: [sample],
        band: { holdoutPoolN: 8 },
        outDir: mkdtempSync(join(tmpdir(), 'evolution-test-')),
      }),
    ).rejects.toThrow(/headroom/)
  })
})

describe('tool catalog', () => {
  it('the author is shown the domain tool names', async () => {
    stubWorkerRouter()
    const { chat, seen } = scriptedChat([fenced(oneShotModule)])
    const surface = shotCountingSurface()
    const withTools: AgenticSurface = {
      ...surface,
      async tools(t, h) {
        await surface.tools(t, h)
        return [
          {
            type: 'function',
            function: {
              name: 'inspect_state',
              description: 'Read the artifact state.',
              parameters: {},
            },
          },
        ]
      },
    }
    await runStrategyEvolution({
      environment: withTools,
      tasks: sliceTasks([]),
      trainN: 4,
      holdoutN: 4,
      worker,
      author: { chat },
      budget: 2,
      generations: 1,
      populationSize: 1,
      baselines: [sample],
      outDir: mkdtempSync(join(tmpdir(), 'evolution-test-')),
    })
    expect(seen[0]).toContain('AVAILABLE DOMAIN TOOLS')
    expect(seen[0]).toContain('inspect_state — Read the artifact state.')
  })
})

// ── Leakage-bounded authoring + reproducer certification (arXiv:2606.11045) ───────

describe('lossesDetail binary', () => {
  it('the author sees pass/fail only — no scores, no progressions', async () => {
    stubWorkerRouter()
    const { chat, seen } = scriptedChat([fenced(oneShotModule)])
    await runStrategyEvolution({
      environment: shotCountingSurface(),
      tasks: sliceTasks([]),
      trainN: 4,
      holdoutN: 4,
      worker,
      author: { chat },
      budget: 2,
      generations: 1,
      populationSize: 1,
      baselines: [sample],
      lossesDetail: 'binary',
      outDir: mkdtempSync(join(tmpdir(), 'evolution-test-')),
    })
    const prompt = seen[0] ?? ''
    const lossesSection = prompt.slice(prompt.indexOf('BASELINE RESULTS'))
    expect(lossesSection).toContain('"resolved"')
    expect(lossesSection).not.toContain('"score"')
    expect(lossesSection).not.toContain('"progression"')
  })
})

describe('reproducer certification', () => {
  it('an authored champion that reproduces from its summary is marked reproducible', async () => {
    stubWorkerRouter()
    // Replies in order: candidate module, strategy summary, reproduced module.
    const { chat, seen } = scriptedChat([
      fenced(twoShotDepthModule),
      'Open one artifact, take two sequential shots on it, keep the best checkpoint.',
      fenced(twoShotDepthModule),
    ])
    const report = await runStrategyEvolution({
      environment: shotCountingSurface(),
      tasks: sliceTasks([]),
      trainN: 6,
      holdoutN: 6,
      worker,
      author: { chat },
      budget: 3,
      generations: 1,
      populationSize: 1,
      baselines: [sample],
      reproducerCheck: {},
      minPairedTasks: 6,
      outDir: mkdtempSync(join(tmpdir(), 'evolution-test-')),
    })
    expect(report.finalChampion.name).toBe('two-shot-depth')
    expect(report.reproduction?.reproducible).toBe(true)
    expect(report.reproduction?.gap).toBeCloseTo(0)
    // The reproducer prompt carries the summary, never the losses.
    const reproPrompt = seen[2] ?? ''
    expect(reproPrompt).toContain('IMPLEMENT EXACTLY THIS STRATEGY')
    expect(reproPrompt).not.toContain('"resolved"')
  })

  it('skipped when the champion is a baseline (nothing authored to certify)', async () => {
    stubWorkerRouter()
    const { chat } = scriptedChat([fenced(oneShotModule)])
    const report = await runStrategyEvolution({
      environment: shotCountingSurface(),
      tasks: sliceTasks([]),
      trainN: 4,
      holdoutN: 4,
      worker,
      author: { chat },
      budget: 2,
      generations: 1,
      populationSize: 1,
      baselines: [sample],
      champion: 'score',
      reproducerCheck: {},
      outDir: mkdtempSync(join(tmpdir(), 'evolution-test-')),
    })
    expect(report.reproduction).toBeUndefined()
  })
})
