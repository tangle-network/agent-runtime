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
import { afterEach, describe, expect, it, vi } from 'vitest'
import { promotionGate } from '../../src/runtime/promotion-gate'
import {
  type BenchmarkReport,
  type BenchmarkTaskRow,
  runBenchmark,
} from '../../src/runtime/run-benchmark'
import {
  type AgenticSurface,
  type AgenticTask,
  defineStrategy,
  runAgentic,
} from '../../src/runtime/strategy'
import {
  assertStrategyContract,
  authorStrategy,
  strategyAuthorContract,
} from '../../src/runtime/strategy-author'

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
      captured.push(JSON.parse(init?.body ?? '{}') as CapturedChatRequest)
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'DONE' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      }
    }),
  )
  return captured
}

const worker = {
  routerBaseUrl: 'http://router.test/v1',
  routerKey: 'test-key',
  model: 'test-model',
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
  const clean = `import { defineStrategy } from '@tangle-network/agent-runtime/loops'
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
  it('the author contract exposes persona (multi-agent strategies are authorable)', () => {
    expect(strategyAuthorContract).toContain('persona')
    expect(strategyAuthorContract).toContain('systemPrompt')
  })

  it('analystModel routes the critique call to the critic model, not the worker', async () => {
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
      analystModel: 'critic-model',
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
    const chat = {
      chat: async (req: { messages: Array<{ content: string }> }) => {
        seen.push(req.messages.map((m) => m.content).join('\n'))
        return { content: `\`\`\`ts\n${module}\n\`\`\`` }
      },
    } as unknown as Parameters<typeof authorStrategy>[0]['chat']
    const { strategy } = await authorStrategy({
      chat,
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
