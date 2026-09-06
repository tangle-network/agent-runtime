/**
 * Regression coverage for the published loops optimization suite — the measurement
 * invariants the flywheel's evidence rests on:
 *   - harness-VERIFIED scoring: a strategy body cannot fabricate its score/resolved;
 *     the deliverable carries what its brokered shots actually achieved (keep-best).
 *   - the empty-messages rule: `messages: []` means FRESH — it must not blank the
 *     worker's system/task prompt.
 *   - assertStrategyContract: authored modules carry only the loops import and no
 *     out-of-band escape (fs/network/process/eval) that would break author blindness
 *     or the conserved compute dose.
 *   - promotionGate: deterministic seeded verdict, minimum-evidence floor, CI margin.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { heldoutSignificance } from '@tangle-network/agent-eval/campaign'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemoryCorpus } from '../../src/runtime/personify/corpus'
import { promotionGate } from '../../src/runtime/promotion-gate'
import {
  type BenchmarkReport,
  type BenchmarkTaskRow,
  runBenchmark,
} from '../../src/runtime/run-benchmark'
import {
  type AgenticOptions,
  type AgenticSurface,
  type AgenticTask,
  defineStrategy,
  refine,
  runAgentic,
} from '../../src/runtime/strategy'
import {
  assertStrategyContract,
  authorStrategy,
  strategyAuthorContract,
} from '../../src/runtime/strategy-author'
import { testAgentProfile } from './test-agent-profile'

// ── Fixtures ──────────────────────────────────────────────────────────────────────

const task: AgenticTask = {
  id: 'task-1',
  systemPrompt: 'You operate the fixture surface.',
  userPrompt: 'Bring the artifact to the target state.',
}

/** An in-memory surface whose score is whatever the test sets per handle. */
function fixtureSurface(
  scoreOf: (handleId: string) => { passes: number; total: number },
): AgenticSurface {
  let seq = 0
  return {
    name: 'fixture',
    async open() {
      seq += 1
      return { id: `h-${seq}`, surface: 'fixture' }
    },
    async tools() {
      return []
    },
    async call() {
      return 'ok'
    },
    async score(_t, handle) {
      const s = scoreOf(handle.id)
      return { passes: s.passes, total: s.total, errored: 0 }
    },
    async close() {},
  }
}

interface CapturedChatRequest {
  messages: Array<{ role: string; content: string }>
}

/** Stub the router endpoint runShot fetches: one assistant turn, no tool calls. */
function stubRouter(): CapturedChatRequest[] {
  const captured: CapturedChatRequest[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: { body?: string }) => {
      const request = JSON.parse(init?.body ?? '{}') as CapturedChatRequest & { model?: string }
      captured.push(request)
      const body = {
        choices: [{ message: { content: 'DONE' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        model: request.model,
      }
      // Both response-reading styles: runShot uses json(); agent-eval's llm-client
      // reads text() — a stub missing either silently downs the analyst leaf.
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => body,
        text: async () => JSON.stringify(body),
      }
    }),
  )
  return captured
}

function memoryComplete(
  capturedWorkers: CapturedChatRequest[],
): NonNullable<AgenticOptions['complete']> {
  return async (body) => {
    const req = body as CapturedChatRequest & { model?: string }
    const text = req.messages.map((m) => m.content).join('\n')
    if (text.includes('TRACE (in order;')) {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                findings: [
                  {
                    area: 'process',
                    severity: 'medium',
                    claim: 'the trace shows the worker guessed before reading priority',
                    recommended_action: 'Read the ticket priority before selecting SLA',
                    audience: 'agent',
                    confidence: 0.9,
                  },
                ],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 7, completion_tokens: 3 },
        model: req.model,
      }
    }
    capturedWorkers.push(req)
    return {
      choices: [{ message: { content: 'DONE' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      model: req.model,
    }
  }
}

const worker = {
  routerBaseUrl: 'http://router.test/v1',
  routerKey: 'test-key',
  workerProfile: testAgentProfile('strategy-worker', {
    harness: 'cli-base',
    model: { provider: 'offline', default: 'test-model' },
    prompt: { systemPrompt: task.systemPrompt },
  }),
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── Harness-verified scoring ──────────────────────────────────────────────────────

describe('defineStrategy harness-verified scoring', () => {
  it('a body that does nothing and self-reports a perfect score scores 0', async () => {
    const surface = fixtureSurface(() => ({ passes: 1, total: 1 }))
    const lying = defineStrategy('lying', async () => ({
      score: 1,
      resolved: true,
      completions: 0,
      progression: [1],
      shots: 0,
    }))
    const result = await runAgentic({ surface, task, ...worker, strategy: lying, budget: 2 })
    expect(result.score).toBe(0)
    expect(result.resolved).toBe(false)
  })

  it('a body that under-reports still carries its real best checkpoint (keep-best)', async () => {
    stubRouter()
    const surface = fixtureSurface(() => ({ passes: 1, total: 2 }))
    const sandbagging = defineStrategy('sandbagging', async ({ shot }) => {
      const out = await shot()
      expect(out?.score).toBeCloseTo(0.5)
      return { score: 0, resolved: false, completions: 1, progression: [0], shots: 1 }
    })
    const result = await runAgentic({ surface, task, ...worker, strategy: sandbagging, budget: 2 })
    expect(result.score).toBeCloseTo(0.5)
  })
})

// ── The empty-messages rule ───────────────────────────────────────────────────────

describe('shot messages handling', () => {
  it('messages: [] is FRESH — the worker still gets the system + task prompts', async () => {
    const captured = stubRouter()
    const surface = fixtureSurface(() => ({ passes: 0, total: 1 }))
    const emptyMessages = defineStrategy('empty-messages', async ({ shot }) => {
      await shot({ messages: [] })
      return { score: 0, resolved: false, completions: 1, progression: [0], shots: 1 }
    })
    await runAgentic({ surface, task, ...worker, strategy: emptyMessages, budget: 1 })
    expect(captured.length).toBeGreaterThan(0)
    const first = captured[0] as CapturedChatRequest
    expect(first.messages[0]).toMatchObject({ role: 'system', content: task.systemPrompt })
    expect(first.messages[1]?.content).toContain(task.userPrompt)
  })
})

// ── Active in-context memory read-back ───────────────────────────────────────────

describe('refine corpus read-back', () => {
  function twoShotSurface(): AgenticSurface {
    let scoreCalls = 0
    return fixtureSurface(() => {
      scoreCalls += 1
      return scoreCalls === 1 ? { passes: 0, total: 1 } : { passes: 1, total: 1 }
    })
  }

  it('injects trace-derived corpus facts into the next active attempt when opted in', async () => {
    const corpus = new InMemoryCorpus()
    const capturedWorkers: CapturedChatRequest[] = []
    const result = await runAgentic({
      surface: twoShotSurface(),
      task,
      ...worker,
      complete: memoryComplete(capturedWorkers),
      strategy: refine,
      budget: 3,
      innerTurns: 1,
      corpus,
      corpusTags: ['fixture-itsm'],
      corpusReadback: { minConfidence: 0.5, maxFacts: 1 },
    })

    expect(result.resolved).toBe(true)
    expect(capturedWorkers).toHaveLength(2)
    const secondShot = capturedWorkers[1]?.messages.map((m) => m.content).join('\n')
    expect(secondShot).toContain('Relevant learned facts from prior attempts')
    expect(secondShot).toContain('Read the ticket priority before selecting SLA')
    const stored = await corpus.query({ tags: ['fixture-itsm', 'audience:agent'] })
    expect(stored).toHaveLength(1)
  })

  it('keeps corpus read-back disabled by default even when the observer writes facts', async () => {
    const corpus = new InMemoryCorpus()
    const capturedWorkers: CapturedChatRequest[] = []
    await runAgentic({
      surface: twoShotSurface(),
      task,
      ...worker,
      complete: memoryComplete(capturedWorkers),
      strategy: refine,
      budget: 3,
      innerTurns: 1,
      corpus,
      corpusTags: ['fixture-itsm'],
    })

    expect(capturedWorkers).toHaveLength(2)
    const secondShot = capturedWorkers[1]?.messages.map((m) => m.content).join('\n')
    expect(secondShot).not.toContain('Relevant learned facts from prior attempts')
    expect(await corpus.query({ tags: ['fixture-itsm', 'audience:agent'] })).toHaveLength(1)
  })
})

// ── Idempotent close (authored bodies double-close, often as floating promises) ───

describe('strategy surface close', () => {
  it('double-close is a no-op; the domain close runs exactly once', async () => {
    stubRouter()
    let closes = 0
    const surface: AgenticSurface = {
      name: 'close-counter',
      async open() {
        return { id: 'h-1', surface: 'close-counter' }
      },
      async tools() {
        return []
      },
      async call() {
        return 'ok'
      },
      async score() {
        return { passes: 1, total: 2, errored: 0 }
      },
      async close() {
        closes += 1
        if (closes > 1) throw new Error('domain close called twice')
      },
    }
    const doubleCloser = defineStrategy('double-closer', async ({ surface: s, task: t, shot }) => {
      const handle = await s.open(t)
      try {
        await shot({ handle })
      } finally {
        await s.close(handle)
        await s.close(handle)
      }
      return { score: 0, resolved: false, completions: 1, progression: [0], shots: 1 }
    })
    const result = await runAgentic({ surface, task, ...worker, strategy: doubleCloser, budget: 2 })
    expect(closes).toBe(1)
    expect(result.score).toBeCloseTo(0.5)
  })
})

// ── The authored-module contract lint ─────────────────────────────────────────────

describe('assertStrategyContract', () => {
  const clean = `import { defineStrategy } from '@tangle-network/agent-runtime/kernel'
export default defineStrategy('ok', async ({ shot }) => {
  const out = await shot()
  return { score: out?.score ?? 0, resolved: false, completions: 1, progression: [], shots: 1 }
})`

  it('accepts a module that honors the contract', () => {
    expect(() => assertStrategyContract(clean)).not.toThrow()
  })

  it.each([
    ["import { readFileSync } from 'node:fs'\nexport default 1", 'foreign import'],
    ["const fs = require('node:fs')", 'require()'],
    ["const m = await import('node:net')", 'import()'],
    ['eval("1+1")', 'eval()'],
    ['const f = new Function("return 1")', 'new Function()'],
    ['process.env.TANGLE_API_KEY', 'process access'],
    ['globalThis.fetch("http://x")', 'globalThis access'],
    ['await fetch("http://router/chat")', 'network access'],
    ['const p = "child_process"', 'node builtin'],
  ])('rejects %s', (code) => {
    expect(() => assertStrategyContract(code)).toThrow(/authored code rejected/)
  })
})

// ── The promotion gate ────────────────────────────────────────────────────────────

function reportWith(rows: Array<{ id: string; inc?: number; cand?: number }>): BenchmarkReport {
  const cell = (score: number) => ({
    score,
    resolved: score >= 1,
    progression: [score],
    usd: 0,
    ms: 0,
    tokens: { input: 0, output: 0 },
  })
  const perTask: BenchmarkTaskRow[] = rows.map((r) => ({
    taskId: r.id,
    ...(r.inc !== undefined && r.cand !== undefined
      ? { cells: { incumbent: cell(r.inc), candidate: cell(r.cand) } }
      : { error: 'infra' }),
  }))
  return { n: rows.length, excluded: 0, perStrategy: {}, perTask, pareto: [] }
}

describe('promotionGate', () => {
  it('identical champion never promotes', () => {
    const v = promotionGate({
      report: reportWith([{ id: 't1', inc: 0.5, cand: 0.5 }]),
      incumbent: 'candidate',
      candidate: 'candidate',
    })
    expect(v.promoted).toBe(false)
    expect(v.reason).toBe('identical-champion')
  })

  it('throws when no task carries both cells (fail loud, not a soft zero)', () => {
    expect(() =>
      promotionGate({
        report: reportWith([{ id: 't1' }]),
        incumbent: 'incumbent',
        candidate: 'candidate',
      }),
    ).toThrow(/no holdout task/)
  })

  it('below the evidence floor: few-tasks, never promoted', () => {
    const rows = [1, 2, 3].map((i) => ({ id: `t${i}`, inc: 0.2, cand: 0.9 }))
    const v = promotionGate({
      report: reportWith(rows),
      incumbent: 'incumbent',
      candidate: 'candidate',
    })
    expect(v.promoted).toBe(false)
    expect(v.reason).toBe('few-tasks')
    expect(v.n).toBe(3)
  })

  it('a consistent real lift at n=12 promotes; the verdict is deterministic', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      id: `t${i}`,
      inc: 0.3 + (i % 3) * 0.05,
      cand: 0.6 + (i % 3) * 0.05,
    }))
    const report = reportWith(rows)
    const a = promotionGate({ report, incumbent: 'incumbent', candidate: 'candidate' })
    const b = promotionGate({ report, incumbent: 'incumbent', candidate: 'candidate' })
    expect(a.promoted).toBe(true)
    expect(a.reason).toBe('significant')
    expect(a.lift.mean).toBeCloseTo(0.3)
    expect(b).toEqual(a)
  })

  it('reports the paired binary decision interval instead of bootstrap diagnostics', () => {
    const before = Array<number>(20).fill(0)
    const after = Array.from({ length: 20 }, (_, i) => (i < 12 ? 1 : 0))
    const cellIds = before.map((_, i) => `t${i}`)
    const report = reportWith(cellIds.map((id, i) => ({ id, inc: before[i]!, cand: after[i]! })))
    const significance = heldoutSignificance({ before, after, cellIds })
    const verdict = promotionGate({
      report,
      incumbent: 'incumbent',
      candidate: 'candidate',
    })

    expect(verdict.promoted).toBe(true)
    expect(verdict.lift.low).toBe(significance.decision.low)
    expect(verdict.lift.high).toBe(significance.decision.high)
    expect(verdict.lift.low).not.toBe(significance.bootstrap.low)
    expect(verdict.lift.high).not.toBe(significance.bootstrap.high)
  })

  it('symmetric noise does not promote (CI includes zero)', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      id: `t${i}`,
      inc: 0.5,
      cand: i % 2 === 0 ? 0.6 : 0.4,
    }))
    const v = promotionGate({
      report: reportWith(rows),
      incumbent: 'incumbent',
      candidate: 'candidate',
    })
    expect(v.promoted).toBe(false)
    expect(v.reason).toBe('no-margin')
  })
})

// ── The author/optimizer addressability surface ───────────────────────────────────

describe('addressable optimization coordinates', () => {
  it('the author contract teaches a shot profile that changes the actual worker', async () => {
    const captured = stubRouter()
    const profile = testAgentProfile('strategy-author', {
      harness: 'cli-base',
      model: { provider: 'offline', default: 'author-model' },
    })
    const code = `import { defineStrategy } from '@tangle-network/agent-runtime/kernel'
export default defineStrategy('specialist', async ({ shot, opts }) => {
  await shot({ profile: { ...opts.workerProfile, name: 'researcher',
    model: { ...opts.workerProfile.model, default: 'specialist-model' },
    prompt: { ...opts.workerProfile.prompt, systemPrompt: 'SPECIALIST_INSTRUCTION' } } })
  return { score: 0, resolved: false, completions: 1, progression: [], shots: 1 }
})`
    const { strategy } = await authorStrategy({
      profile,
      executor: {
        backend: 'router',
        routerBaseUrl: 'http://router.test/v1',
        routerKey: 'test-key',
        complete: async (request) => {
          const prompt = JSON.stringify(request.messages)
          expect(prompt).toContain('steer?, profile?, tools?')
          expect(prompt).toContain('opts.workerProfile')
          expect(prompt).not.toContain('persona?')
          return {
            choices: [{ message: { content: `\`\`\`ts\n${code}\n\`\`\`` } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
            model: profile.model?.default,
          }
        },
      },
      environmentName: 'fixture',
      lossesJson: '[]',
      budget: 1,
      outDir: mkdtempSync(join(tmpdir(), 'authored-profile-test-')),
    })
    await runAgentic({
      surface: fixtureSurface(() => ({ passes: 1, total: 1 })),
      task,
      ...worker,
      strategy,
      budget: 1,
    })
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({ model: 'specialist-model' })
    expect(captured[0]!.messages).toContainEqual({
      role: 'system',
      content: 'SPECIALIST_INSTRUCTION',
    })
  })

  it('analystProfile routes the critique call to the critic model, not the worker', async () => {
    const captured = stubRouter()
    const surface = fixtureSurface(() => ({ passes: 0, total: 1 }))
    const critiqued = defineStrategy('critiqued', async ({ shot, critique }) => {
      const out = await shot()
      if (out) await critique(out.messages)
      return { score: 0, resolved: false, completions: 1, progression: [0], shots: 1 }
    })
    await runAgentic({
      surface,
      task,
      ...worker,
      analystProfile: testAgentProfile('strategy-critic', {
        harness: 'cli-base',
        model: { provider: 'offline', default: 'critic-model' },
      }),
      strategy: critiqued,
      budget: 2,
    })
    const models = captured.map((r) => (r as { model?: string }).model)
    expect(models).toContain('test-model')
    expect(models).toContain('critic-model')
  })

  it('runBenchmark passes lifecycle hooks through to every cell', async () => {
    stubRouter()
    const surface = fixtureSurface(() => ({ passes: 1, total: 1 }))
    const events: string[] = []
    const oneShot = defineStrategy('one-shot', async ({ shot }) => {
      await shot()
      return { score: 0, resolved: false, completions: 1, progression: [0], shots: 1 }
    })
    await runBenchmark({
      environment: surface,
      tasks: [task],
      worker,
      strategies: [oneShot],
      budget: 1,
      concurrency: 1,
      hooks: { onEvent: (e) => void events.push(e.type) },
    })
    expect(events.length).toBeGreaterThan(0)
  })

  it('authorStrategy uses a caller-supplied contract (the meta-optimization coordinate)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'authored-test-'))
    const seen: string[] = []
    const module = [
      "export default { name: 'noop', driver: () => ({ name: 'noop', act: async () => ({ kind: 'done', deliverable: {} }) }) }",
    ].join('\n')
    const profile = testAgentProfile('strategy-author', {
      harness: 'cli-base',
      model: { provider: 'offline', default: 'author-model' },
    })
    const executor = {
      backend: 'router' as const,
      routerBaseUrl: 'http://router.test/v1',
      routerKey: 'test-key',
      complete: async (body: Record<string, unknown>) => {
        const messages = body.messages as Array<{ content: string }>
        seen.push(messages.map((m) => m.content).join('\n'))
        return {
          choices: [{ message: { content: `\`\`\`ts\n${module}\n\`\`\`` } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          model: 'author-model',
        }
      },
    }
    const { strategy } = await authorStrategy({
      profile,
      executor,
      contract: 'CUSTOM CONTRACT vNEXT',
      environmentName: 'fixture',
      lossesJson: '[]',
      budget: 2,
      outDir: dir,
    })
    expect(seen.join('\n')).toContain('CUSTOM CONTRACT vNEXT')
    expect(strategy.name).toBe('noop')
  })
})

// ── Shot-level tool selection (restriction-only) ──────────────────────────────────

describe('shot tool selection', () => {
  const twoToolSurface = (): AgenticSurface & { seen: string[][] } => {
    const seen: string[][] = []
    return {
      name: 'two-tool',
      seen,
      async open() {
        return { id: 'h-1', surface: 'two-tool' }
      },
      async tools() {
        return [
          { type: 'function', function: { name: 'read_thing', parameters: {} } },
          { type: 'function', function: { name: 'write_thing', parameters: {} } },
        ]
      },
      async call() {
        return 'ok'
      },
      async score() {
        return { passes: 0, total: 1, errored: 0 }
      },
      async close() {},
    }
  }

  it('a shot sees only its selected tools', async () => {
    const captured = stubRouter()
    const surface = twoToolSurface()
    const focused = defineStrategy('focused', async ({ shot }) => {
      await shot({ tools: ['read_thing'] })
      return { score: 0, resolved: false, completions: 1, progression: [0], shots: 1 }
    })
    await runAgentic({
      surface,
      task,
      ...worker,
      workerProfile: testAgentProfile('focused-worker', {
        harness: 'cli-base',
        model: { provider: 'offline', default: 'test-model' },
        prompt: { systemPrompt: task.systemPrompt },
        tools: { read_thing: true },
      }),
      strategy: focused,
      budget: 1,
    })
    const body = captured[0] as { tools?: Array<{ function: { name: string } }> }
    expect(body.tools?.map((t) => t.function.name)).toEqual(['read_thing'])
  })

  it('unknown tool names fail loud (a typo must not become an unrestricted shot)', async () => {
    stubRouter()
    const surface = twoToolSurface()
    const typo = defineStrategy('typo', async ({ shot }) => {
      const out = await shot({ tools: ['read_thing', 'wirte_thing'] })
      return { score: out?.score ?? 0, resolved: false, completions: 0, progression: [], shots: 1 }
    })
    const result = await runAgentic({ surface, task, ...worker, strategy: typo, budget: 1 })
    // The shot goes down (executor threw) → null → verified score stays 0.
    expect(result.score).toBe(0)
  })
})

// ── Per-strategy isolation: one broken candidate cannot poison the field ──────────

describe('runBenchmark per-strategy isolation', () => {
  it('a throwing strategy scores an honest zero; the field keeps its cells', async () => {
    stubRouter()
    const surface = fixtureSurface(() => ({ passes: 1, total: 2 }))
    const healthy = defineStrategy('healthy', async ({ shot }) => {
      const out = await shot()
      return { score: out?.score ?? 0, resolved: false, completions: 1, progression: [], shots: 1 }
    })
    const poisoned = defineStrategy('poisoned', async ({ shot }) => {
      const out = await shot({ tools: ['hallucinated_tool'] })
      if (!out) throw new Error('explore shot failed')
      return { score: out.score, resolved: false, completions: 1, progression: [], shots: 1 }
    })
    const report = await runBenchmark({
      environment: surface,
      tasks: [task],
      worker,
      strategies: [healthy, poisoned],
      budget: 2,
      concurrency: 1,
    })
    const row = report.perTask[0]
    expect(row?.cells?.healthy?.score).toBeCloseTo(0.5)
    expect(row?.cells?.poisoned?.score).toBe(0)
    expect(row?.errors?.poisoned).toMatch(/explore shot failed|no result/)
    expect(report.excluded).toBe(0)
    expect(report.perStrategy.healthy?.score).toBeCloseTo(0.5)
  })
})

// ── Per-task tool introspection ────────────────────────────────────────────────────

describe('listTools', () => {
  it('a strategy body reads the task-specific toolset (names + descriptions only)', async () => {
    stubRouter()
    const surface: AgenticSurface = {
      name: 'introspect',
      async open() {
        return { id: 'h-1', surface: 'introspect' }
      },
      async tools() {
        return [
          {
            type: 'function',
            function: { name: 'read_state', description: 'Read it.', parameters: { secret: true } },
          },
        ]
      },
      async call() {
        return 'ok'
      },
      async score() {
        return { passes: 0, total: 1, errored: 0 }
      },
      async close() {},
    }
    let listed: Array<{ name: string; description?: string }> = []
    const introspector = defineStrategy(
      'introspector',
      async ({ surface: s, task: t, listTools, shot }) => {
        const handle = await s.open(t)
        try {
          listed = await listTools(handle)
          await shot({ handle, tools: listed.map((x) => x.name) })
        } finally {
          await s.close(handle)
        }
        return { score: 0, resolved: false, completions: 1, progression: [0], shots: 1 }
      },
    )
    await runAgentic({ surface, task, ...worker, strategy: introspector, budget: 1 })
    expect(listed).toEqual([{ name: 'read_state', description: 'Read it.' }])
    expect(JSON.stringify(listed)).not.toContain('secret')
  })

  it('the author contract teaches introspection over hardcoding', () => {
    expect(strategyAuthorContract).toContain('listTools')
    expect(strategyAuthorContract).toContain('VARY PER TASK')
    // Authors copy the canonical template verbatim; if it omits listTools from the
    // destructure, every tool-introspecting body is a ReferenceError.
    expect(strategyAuthorContract).toMatch(/critique, listTools \}/)
  })
})

// ── Non-inferiority promotion (the cost objective) ─────────────────────────────────

describe('promotionGate non-inferiority', () => {
  const costReport = (
    rows: Array<{
      id: string
      incScore: number
      candScore: number
      incUsd: number
      candUsd: number
      candUsdKnown?: boolean
    }>,
  ): BenchmarkReport => ({
    n: rows.length,
    excluded: 0,
    perStrategy: {},
    perTask: rows.map((r) => ({
      taskId: r.id,
      cells: {
        incumbent: {
          score: r.incScore,
          resolved: false,
          progression: [],
          usd: r.incUsd,
          ms: 0,
          tokens: { input: 0, output: 0 },
        },
        candidate: {
          score: r.candScore,
          resolved: false,
          progression: [],
          usd: r.candUsd,
          ...(r.candUsdKnown !== undefined ? { usdKnown: r.candUsdKnown } : {}),
          ms: 0,
          tokens: { input: 0, output: 0 },
        },
      },
    })),
    pareto: [],
  })

  it('same quality at half the cost PROMOTES', () => {
    const scoreDeltas = [-0.018, -0.012, -0.008, -0.004, 0, 0.006, 0.011, -0.006]
    const costSavings = [0.011, 0.014, 0.016, 0.013, 0.018, 0.015, 0.012, 0.017]
    const rows = Array.from({ length: 24 }, (_, i) => {
      const incScore = 0.48 + (i % 7) * 0.055
      const incUsd = 0.024 + (i % 5) * 0.0014
      return {
        id: `t${i}`,
        incScore,
        candScore: incScore + scoreDeltas[i % scoreDeltas.length]!,
        incUsd,
        candUsd: incUsd - costSavings[i % costSavings.length]!,
      }
    })
    const v = promotionGate({
      report: costReport(rows),
      incumbent: 'incumbent',
      candidate: 'candidate',
      mode: 'non-inferiority',
    })
    expect(v.promoted).toBe(true)
    expect(v.reason).toBe('non-inferior-and-cheaper')
    expect(v.costSavings?.low).toBeGreaterThan(0)
    expect(v.latency).toBeDefined()
  })

  it('refuses to call a candidate cheaper when its dollars were never measured', () => {
    // The same inputs that PROMOTE above, with one arm's dollars marked unmeasured. `usdKnown:
    // false` means `usd` is a floor, and `Spend.usdKnown` states the rule: an unknown amount must
    // not be treated as a measurement "when enforcing a dollar-denominated comparison or limit".
    // Promotion on cost savings is exactly that comparison.
    const scoreDeltas = [-0.018, -0.012, -0.008, -0.004, 0, 0.006, 0.011, -0.006]
    const costSavings = [0.011, 0.014, 0.016, 0.013, 0.018, 0.015, 0.012, 0.017]
    const rows = Array.from({ length: 24 }, (_, i) => {
      const incScore = 0.48 + (i % 7) * 0.055
      const incUsd = 0.024 + (i % 5) * 0.0014
      return {
        id: `t${i}`,
        incScore,
        candScore: incScore + scoreDeltas[i % scoreDeltas.length]!,
        incUsd,
        candUsd: incUsd - costSavings[i % costSavings.length]!,
        // Only the first task is unmeasured; one unmeasured pair is enough to void the comparison.
        ...(i === 0 ? { candUsdKnown: false } : {}),
      }
    })
    const v = promotionGate({
      report: costReport(rows),
      incumbent: 'incumbent',
      candidate: 'candidate',
      mode: 'non-inferiority',
    })
    expect(v.promoted).toBe(false)
    expect(v.reason).toBe('cost-unknown')
    expect(v.costUnknownTasks).toEqual(['t0'])
    // The refusal replaces the cost verdict rather than reporting one built on the same numbers.
    expect(v.costSavings).toBeUndefined()
  })

  it('cheaper but score-inferior beyond tolerance LOSES', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      id: `t${i}`,
      incScore: 0.7,
      candScore: 0.55,
      incUsd: 0.028,
      candUsd: 0.013,
    }))
    const v = promotionGate({
      report: costReport(rows),
      incumbent: 'incumbent',
      candidate: 'candidate',
      mode: 'non-inferiority',
    })
    expect(v.promoted).toBe(false)
    expect(v.reason).toBe('non-inferiority-unproven')
  })

  it('same quality at the same cost is NOT a promotion', () => {
    const scoreDeltas = [-0.006, -0.002, 0.003, 0.008, 0.012, 0.005]
    const costSavings = [-0.0018, 0.0012, -0.0007, 0.0005, 0.0017, -0.0011]
    const rows = Array.from({ length: 24 }, (_, i) => {
      const incScore = 0.5 + (i % 6) * 0.06
      const incUsd = 0.018 + (i % 5) * 0.0012
      return {
        id: `t${i}`,
        incScore,
        candScore: incScore + scoreDeltas[i % scoreDeltas.length]!,
        incUsd,
        candUsd: incUsd - costSavings[i % costSavings.length]!,
      }
    })
    const v = promotionGate({
      report: costReport(rows),
      incumbent: 'incumbent',
      candidate: 'candidate',
      mode: 'non-inferiority',
    })
    expect(v.promoted).toBe(false)
    expect(v.reason).toBe('not-cheaper')
  })

  it('the verdict is deterministic', () => {
    const scoreDeltas = [-0.01, -0.006, -0.002, 0.003, 0.007, 0.011]
    const costSavings = [0.014, 0.016, 0.018, 0.013, 0.017, 0.015]
    const rows = Array.from({ length: 24 }, (_, i) => {
      const incScore = 0.47 + (i % 7) * 0.058
      const incUsd = 0.027 + (i % 5) * 0.0013
      return {
        id: `t${i}`,
        incScore,
        candScore: incScore + scoreDeltas[i % scoreDeltas.length]!,
        incUsd,
        candUsd: incUsd - costSavings[i % costSavings.length]!,
      }
    })
    const report = costReport(rows)
    const a = promotionGate({
      report,
      incumbent: 'incumbent',
      candidate: 'candidate',
      mode: 'non-inferiority',
    })
    const b = promotionGate({
      report,
      incumbent: 'incumbent',
      candidate: 'candidate',
      mode: 'non-inferiority',
    })
    expect(b).toEqual(a)
    expect(a.promoted).toBe(true)
  })
})

// ── The raw analyst channel (verdict-shaped steering survives) ─────────────────────

describe('consult', () => {
  it('the instruction reaches the analyst verbatim and the raw reply returns intact', async () => {
    const captured = stubRouter()
    const surface = fixtureSurface(() => ({ passes: 0, total: 1 }))
    let reply: string | null = null
    const controller = defineStrategy('controller', async ({ shot, consult }) => {
      const out = await shot()
      if (out)
        reply = await consult(out.messages, 'Reply with EXACTLY: VERDICT: STOP confidence=0.9')
      return { score: 0, resolved: false, completions: 1, progression: [0], shots: 1 }
    })
    await runAgentic({ surface, task, ...worker, strategy: controller, budget: 2 })
    // The consult call is the SECOND router request; its system prompt is the raw instruction.
    const consultReq = captured[1] as { messages?: Array<{ role: string; content: string }> }
    const instruction = consultReq?.messages?.find((message) =>
      message.content.includes('VERDICT: STOP'),
    )
    expect(instruction?.content).toContain('VERDICT: STOP')
    // The stubbed model replies 'DONE'; consult returns it verbatim (no findings filter).
    expect(reply).toBe('DONE')
  })
})

describe('advisory-field normalization', () => {
  it('a body omitting progression/completions/shots yields a well-formed cell', async () => {
    stubRouter()
    const surface = fixtureSurface(() => ({ passes: 1, total: 2 }))
    const sloppy = defineStrategy('sloppy', async ({ shot }) => {
      await shot()
      // An authored body returning only the verified-overridden fields.
      return { score: 0, resolved: false } as never
    })
    const report = await runBenchmark({
      environment: surface,
      tasks: [task],
      worker,
      strategies: [sloppy],
      budget: 1,
      concurrency: 1,
    })
    const cell = report.perTask[0]?.cells?.sloppy
    expect(cell?.progression).toEqual([])
    expect(cell?.score).toBeCloseTo(0.5)
  })
})
