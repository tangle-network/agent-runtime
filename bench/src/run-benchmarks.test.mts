/**
 * Offline test for the bench unifier: a stub adapter (in-memory tasks + deterministic judge) and a
 * stub shot prove the matrix expansion, the adapter-judged aggregation, the error accounting, and
 * the fail-loud guards — without a model, sandbox, or dataset. Run: `tsx bench/src/run-benchmarks.test.mts`.
 */
import assert from 'node:assert/strict'
import type { BenchmarkAdapter, BenchScore, BenchTask } from './benchmarks/types'
import { runBenchmarks, type BenchShot } from './run-benchmarks'

function stubAdapter(name: string, n: number): BenchmarkAdapter {
  const tasks: BenchTask[] = Array.from({ length: n }, (_, i) => ({
    id: `${name}-${i}`,
    prompt: `solve ${name} ${i}`,
    metadata: { gold: `GOLD-${name}-${i}` },
  }))
  return {
    name,
    preflight: async () => {},
    loadTasks: async (o) => {
      let t = tasks
      if (o?.ids) t = t.filter((x) => o.ids!.includes(x.id))
      if (o?.limit !== undefined) t = t.slice(0, o.limit)
      return t
    },
    judge: async (task, artifact): Promise<BenchScore> => {
      const gold = String(task.metadata?.gold)
      return { resolved: artifact === gold, score: artifact === gold ? 1 : 0 }
    },
    goldArtifact: async (task) => String(task.metadata?.gold),
  }
}

const REGISTRY: Record<string, BenchmarkAdapter> = { alpha: stubAdapter('alpha', 4), beta: stubAdapter('beta', 4) }
const resolveStub = (key: string): BenchmarkAdapter => {
  const a = REGISTRY[key]
  if (!a) throw new Error(`unknown benchmark: ${key}`)
  return a
}

/** A perfect cell returns each task's gold; a half cell solves even-indexed tasks; a broken cell throws. */
const shot: BenchShot = async ({ adapter, task, cell }) => {
  const gold = String(task.metadata?.gold)
  if (cell.label === 'broken') throw new Error('harness down')
  if (cell.label === 'perfect') return { artifact: gold, ok: true }
  const idx = Number(task.id.split('-').pop())
  return idx % 2 === 0 ? { artifact: gold, ok: true } : { artifact: 'WRONG', ok: true }
}

async function main(): Promise<void> {
  // Matrix: 2 benchmarks × 3 cells × 4 tasks = 24 shots.
  const report = await runBenchmarks({
    benchmarks: ['alpha', 'beta'],
    cells: [{ label: 'perfect', model: 'm' }, { label: 'half', model: 'm' }, { label: 'broken', model: 'm' }],
    routerBaseUrl: 'x',
    routerKey: 'x',
    runShot: shot,
    resolveAdapter: resolveStub,
  })

  assert.equal(report.perTask.length, 24, 'matrix expands to benchmarks × cells × tasks')
  assert.equal(report.rows.length, 6, 'one row per (benchmark × cell)')

  const row = (b: string, c: string) => report.rows.find((r) => r.benchmark === b && r.cell === c)!
  assert.equal(row('alpha', 'perfect').resolveRate, 1, 'perfect cell resolves every task')
  assert.equal(row('alpha', 'half').resolveRate, 0.5, 'half cell resolves the even tasks')
  assert.equal(row('alpha', 'half').meanScore, 0.5, 'mean graded score tracks resolveRate here')

  const broken = row('alpha', 'broken')
  assert.equal(broken.errored, 4, 'a throwing shot is errored, not scored')
  assert.equal(broken.resolved, 0, 'broken cell resolves nothing')
  assert.equal(broken.resolveRate, 0, 'errored shots leave resolveRate at 0 (denominator floored at 1)')

  // Leaderboard sort: within a benchmark, descending resolveRate.
  const alpha = report.rows.filter((r) => r.benchmark === 'alpha')
  assert.deepEqual(alpha.map((r) => r.cell), ['perfect', 'half', 'broken'], 'rows sorted by descending resolveRate')

  // Subset: ids + n restrict the task set.
  const subset = await runBenchmarks({
    benchmarks: ['alpha'],
    cells: [{ label: 'perfect', model: 'm' }],
    routerBaseUrl: 'x', routerKey: 'x', runShot: shot, resolveAdapter: resolveStub,
    ids: ['alpha-0', 'alpha-2'],
  })
  assert.equal(subset.perTask.length, 2, 'ids restrict the task subset')

  // reps multiply shots per task.
  const repped = await runBenchmarks({
    benchmarks: ['alpha'], cells: [{ label: 'perfect', model: 'm' }],
    routerBaseUrl: 'x', routerKey: 'x', runShot: shot, resolveAdapter: resolveStub, reps: 3, n: 2,
  })
  assert.equal(repped.perTask.length, 6, 'reps × tasks')

  // Looped cells feed safe failure feedback into the next attempt and stop once the judge passes.
  let prompts: string[] = []
  const retryShot: BenchShot = async ({ task, prompt }) => {
    prompts.push(prompt ?? task.prompt)
    return { artifact: prompts.length === 1 ? 'WRONG' : String(task.metadata?.gold), ok: true }
  }
  const oneShot = await runBenchmarks({
    benchmarks: ['alpha'], cells: [{ label: 'retrying', model: 'm' }],
    routerBaseUrl: 'x', routerKey: 'x', runShot: retryShot, resolveAdapter: resolveStub, n: 1,
  })
  assert.equal(oneShot.rows[0]!.resolveRate, 0, 'without the loop, the first bad attempt fails')
  prompts = []
  const looped = await runBenchmarks({
    benchmarks: ['alpha'], cells: [{ label: 'retrying', model: 'm' }],
    routerBaseUrl: 'x', routerKey: 'x', runShot: retryShot, resolveAdapter: resolveStub, n: 1, loopAttempts: 2,
  })
  assert.equal(looped.rows[0]!.resolveRate, 1, 'with loopAttempts=2, the retry can pass')
  assert.equal(prompts.length, 2, 'loop stops after the passing second attempt')
  assert.match(prompts[1]!, /Previous attempts and safe checker feedback/)
  assert.match(looped.perTask[0]!.detail ?? '', /"mode":"refine-loop"/)

  // A benchmark's detail may include hidden answer fields; those must never be fed back as hints.
  const leakyGold = 'SECRET-GOLD'
  const leaky: BenchmarkAdapter = {
    name: 'leaky',
    preflight: async () => {},
    loadTasks: async () => [{ id: 'leaky-0', prompt: 'Answer the hidden task.', metadata: { gold: leakyGold } }],
    judge: async (_task, artifact) => ({
      resolved: artifact === leakyGold,
      score: artifact === leakyGold ? 1 : 0,
      detail: JSON.stringify({ bestGold: leakyGold, expectedAnswer: leakyGold, publicHint: 'retry' }),
    }),
    goldArtifact: async () => leakyGold,
  }
  const leakyPrompts: string[] = []
  const leakyShot: BenchShot = async ({ prompt }) => {
    leakyPrompts.push(prompt ?? '')
    return { artifact: leakyPrompts.length === 1 ? 'WRONG' : leakyGold, ok: true }
  }
  await runBenchmarks({
    benchmarks: ['leaky'], cells: [{ label: 'retrying', model: 'm' }],
    routerBaseUrl: 'x', routerKey: 'x', runShot: leakyShot, resolveAdapter: () => leaky, loopAttempts: 2,
  })
  assert.equal(leakyPrompts.length, 2)
  assert.equal(leakyPrompts[1]!.includes(leakyGold), false, 'retry prompt redacts hidden gold fields')
  assert.match(leakyPrompts[1]!, /publicHint/)

  const runtime = await import('@tangle-network/agent-runtime/loops')
  if (runtime.openSandboxRun.toString().includes('beforeStart')) {
    // The default shot path supports benchmark-owned box setup/extract without real sandbox infra.
    const order: string[] = []
    const fakeClient = {
      async create() {
        return {
          id: 'box-default-shot',
          async exec(command: string, options?: { sessionId?: string }) {
            order.push(`exec:${command}:streams=${order.filter((x) => x.startsWith('stream:')).length}:session=${options?.sessionId ? 'yes' : 'no'}`)
            return { exitCode: 0, stdout: command === 'extract-patch' ? 'PATCH' : '', stderr: '' }
          },
          async *streamPrompt(_prompt: string, options?: { sessionId?: string }) {
            order.push(`stream:session=${options?.sessionId ? 'yes' : 'no'}`)
            yield { type: 'result', data: { finalText: 'fallback text' } }
          },
          async delete() {
            order.push('delete')
          },
        }
      },
      async criuStatus() {
        return { available: false }
      },
    }
    const boxAdapter: BenchmarkAdapter = {
      name: 'boxy',
      preflight: async () => {},
      loadTasks: async () => [{ id: 'boxy-0', prompt: 'edit repo', metadata: {} }],
      judge: async (_task, artifact) => ({ resolved: artifact === 'PATCH', score: artifact === 'PATCH' ? 1 : 0 }),
      goldArtifact: async () => 'PATCH',
      boxSetup: () => ({ command: 'setup-repo' }),
      boxExtract: () => ({ command: 'extract-patch' }),
    }
    const boxy = await runBenchmarks({
      benchmarks: ['boxy'],
      cells: [{ label: 'default-shot', model: 'm', backend: 'sandbox' }],
      routerBaseUrl: 'x',
      routerKey: 'x',
      resolveAdapter: () => boxAdapter,
      resolveClient: () => fakeClient as never,
    })
    assert.equal(boxy.rows[0]!.resolveRate, 1, 'boxExtract artifact is judged instead of fallback text')
    assert.deepEqual(
      order.slice(0, 3),
      ['exec:setup-repo:streams=0:session=yes', 'stream:session=yes', 'exec:extract-patch:streams=1:session=yes'],
      'setup runs before the prompt stream, extract runs after the prompt stream, both in the same session',
    )
  }

  // An unavailable benchmark (preflight throws) is skipped, not fatal; the sweep still runs the rest.
  const flaky: Record<string, BenchmarkAdapter> = {
    ok: stubAdapter('ok', 2),
    down: { ...stubAdapter('down', 2), preflight: async () => { throw new Error('no docker') } },
  }
  const mixed = await runBenchmarks({
    benchmarks: ['ok', 'down'], cells: [{ label: 'perfect', model: 'm' }],
    routerBaseUrl: 'x', routerKey: 'x', runShot: shot,
    resolveAdapter: (k) => { const a = flaky[k]; if (!a) throw new Error(`unknown: ${k}`); return a },
  })
  assert.equal(mixed.unavailable.length, 1, 'the unavailable benchmark is recorded')
  assert.equal(mixed.unavailable[0]!.benchmark, 'down')
  assert.ok(mixed.rows.every((r) => r.benchmark === 'ok'), 'only the available benchmark produced rows')

  // Judge self-verification: a miscalibrated judge (rejects its own gold) marks the bench unavailable.
  const miscalibrated: BenchmarkAdapter = { ...stubAdapter('mis', 2), judge: async () => ({ resolved: false, score: 0 }) }
  const guarded = await runBenchmarks({
    benchmarks: ['mis'], cells: [{ label: 'perfect', model: 'm' }],
    routerBaseUrl: 'x', routerKey: 'x', runShot: shot,
    resolveAdapter: () => miscalibrated, verifyJudge: true,
  })
  assert.equal(guarded.unavailable.length, 1, 'a judge that rejects its own gold is caught before spending')
  assert.equal(guarded.perTask.length, 0, 'no shots run against a miscalibrated judge')

  // Fail-loud guards.
  await assert.rejects(
    runBenchmarks({ benchmarks: [], cells: [{ label: 'x', model: 'm' }], routerBaseUrl: 'x', routerKey: 'x', runShot: shot, resolveAdapter: resolveStub }),
    /no benchmarks/,
  )
  await assert.rejects(
    runBenchmarks({ benchmarks: ['alpha'], cells: [], routerBaseUrl: 'x', routerKey: 'x', runShot: shot, resolveAdapter: resolveStub }),
    /no cells/,
  )
  await assert.rejects(
    runBenchmarks({ benchmarks: ['nope'], cells: [{ label: 'x', model: 'm' }], routerBaseUrl: 'x', routerKey: 'x', runShot: shot, resolveAdapter: resolveStub, verifyJudge: false }),
    /unknown benchmark/,
  )

  console.log('run-benchmarks.test: OK (24-shot matrix, subset, reps, unavailable-skip, judge self-check, guards)')
}

void main()
