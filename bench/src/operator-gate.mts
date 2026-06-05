/**
 * Live OPERATOR-DRIVER gate runner on aec-bench — the non-blind topology arm.
 *
 * Per task the LLM operator (createOperatorDriverAgent) may spawn UP TO K solver workers (each = one
 * router solve + the deterministic verify.py grade), await their deployable verdicts, and STOP when
 * satisfied. The conserved budget pool caps it at K workers (equal-k vs random@K from aec-gate.mts);
 * the operator may use FEWER (less worker compute) at the cost of its own coordination tokens, which
 * are accounted separately. This answers the open gate on aec: does adaptive allocation under a
 * DEPLOYABLE verifier beat a blind draw at equal k?
 *
 * Workers are the keystone solve-and-grade leaf (benchSolveLeaf), reused — the operator's spawn_worker
 * `task` string is the per-worker strategy, mapped onto SolveTask { prompt: base + approach, instance }.
 * Fail loud: a router/judge throw rejects a worker (a `down` settlement), never a fabricated score.
 */

import {
  type AgentSpec,
  createSupervisor,
  type ExecutorContext,
  type ExecutorRegistry,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  type LeafExecutor,
} from '@tangle-network/agent-runtime/loops'
import { createOperatorDriverAgent } from '@tangle-network/agent-runtime/mcp'
import { createAecBenchAdapter } from './benchmarks/aec-bench'
import type { BenchTask } from './benchmarks/types'
import { type AttemptRecord, appendRunRecord, type RunRecord } from './corpus'
import { benchSolveLeaf, type BenchSolverOptions, type SolveTask } from './keystone-gate'
import { type RouterConfig, routerChatWithTools } from './router-client'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor
      cursor += 1
      if (i >= items.length) return
      out[i] = await fn(items[i] as T, i)
    }
  })
  await Promise.all(workers)
  return out
}

/** A registry whose every spawn is a fresh solve-and-grade leaf bound to THIS task. The operator's
 *  spawn_worker `task` string is the worker's strategy; we map it onto a SolveTask over the base
 *  prompt + the instance to grade against. Wrapping benchSolveLeaf reuses the deployable-judge path. */
function operatorWorkerRegistry(solverOpts: BenchSolverOptions, instance: BenchTask): ExecutorRegistry {
  return {
    register(): void {
      throw new Error('operatorWorkerRegistry: register unsupported (one solve-and-grade runtime)')
    },
    resolve<Out>(_spec: AgentSpec) {
      const factory = (spec: AgentSpec, ctx: ExecutorContext) => {
        const inner = benchSolveLeaf(solverOpts, spec, ctx)
        const wrapped: LeafExecutor<unknown> = {
          ...inner,
          execute: (task, signal) => {
            const strategy = typeof task === 'string' ? task : ''
            const prompt = strategy.length > 0 ? `${instance.prompt}\n\nApproach for this attempt: ${strategy}` : instance.prompt
            const solve: SolveTask = { prompt, instance }
            return inner.execute(solve, signal)
          },
        }
        return wrapped as LeafExecutor<Out>
      }
      return { succeeded: true as const, value: factory }
    },
  }
}

const operatorPrompt = [
  'You are an OPERATOR that leads a team of solver workers. You do NOT answer the task yourself — your',
  'ONLY way to produce a deliverable is to spawn workers and pick the best result. Every turn you MUST',
  'call a tool; you cannot reply in prose, and you cannot stop until at least one worker has completed.',
  'You have a budget of solver workers (spawn_worker). Each worker independently attempts the task with',
  'a STRATEGY you specify in its `task` field (e.g. "solve via energy balance", "use the small-angle',
  'approximation then check units"). After spawning, call await_next to read each worker’s DEPLOYABLE',
  'score in [0,1] (1.0 = fully correct per a deterministic checker). Lead with judgment:',
  '- Spawn workers with DIVERSE, well-reasoned strategies — do not repeat an approach that scored low.',
  '- If a worker scores 1.0, you are done. Otherwise spawn another with a DIFFERENT approach informed by',
  '  what you have seen.',
  '- Spawn intelligently, not frivolously — each worker costs budget, and spawning past it fails closed.',
  '- When you have a passing answer or have exhausted your budget, call stop with a one-line reason.',
].join(' ')

interface OperatorTaskResult {
  id: string
  resolved: boolean
  score: number
  workersUsed: number
  turns: number
  coordTokens: number
  attempts: AttemptRecord[]
}

async function runOperator(cfg: RouterConfig, adapter: ReturnType<typeof createAecBenchAdapter>, task: BenchTask, k: number): Promise<OperatorTaskResult> {
  const blobs = new InMemoryResultBlobStore()
  const solverOpts: BenchSolverOptions = { adapter, routerBaseUrl: cfg.routerBaseUrl, routerKey: cfg.routerKey, model: cfg.model, temperature: 0.7 }
  let coordTokens = 0

  const driver = createOperatorDriverAgent({
    systemPrompt: operatorPrompt,
    describeTask: () =>
      `${task.prompt}\n\nLead the solve: spawn_worker (its \`task\` field is that worker’s strategy), await_next to read each deployable score, and stop when you have the best answer or exhaust your budget of ${k} workers.`,
    chat: async (messages, tools) => {
      // tool_choice 'required' forbids bare prose — the operator must ACT each turn (no answering
      // the engineering question itself; its only deliverable is a worker's output).
      const r = await routerChatWithTools(cfg, messages, tools, { temperature: 0.3, toolChoice: 'required' })
      if (r.usage) coordTokens += r.usage.input + r.usage.output
      return { content: r.content, toolCalls: r.toolCalls }
    },
    blobs,
    makeWorkerAgent: () => ({ name: 'solver', executorSpec: { profile: { id: 'solver', model: cfg.model }, harness: null }, act: () => Promise.reject(new Error('leaf runs via executor')) }) as never,
    perWorker: { maxIterations: 1, maxTokens: 200_000 },
    maxTurns: k * 2 + 4,
    minWorkersBeforeStop: 1, // it cannot ship nothing — at least one solver must complete
  })

  const result = await createSupervisor<unknown, unknown>().run(driver, undefined, {
    // root maxIterations = k ⇒ at most k workers (equal-k ceiling). The operator may use fewer.
    budget: { maxIterations: k, maxTokens: 5_000_000 },
    runId: `operator:${task.id}`,
    journal: new InMemorySpawnJournal(),
    blobs,
    executors: operatorWorkerRegistry(solverOpts, task),
    maxDepth: 2,
  })

  if (result.kind !== 'winner') {
    // A no-winner is an honest 0-score outcome for this task (e.g. every worker errored), not a crash.
    return { id: task.id, resolved: false, score: 0, workersUsed: 0, turns: 0, coordTokens, attempts: [] }
  }
  const out = result.out as { resolved: boolean; score: number; turns: number; workers: Array<{ status: string; score?: number; valid?: boolean }> }
  const attempts: AttemptRecord[] = out.workers.map((w) => ({ id: 'solver', valid: w.valid ?? false, score: w.score ?? 0 }))
  return {
    id: task.id,
    resolved: out.resolved,
    score: out.score,
    workersUsed: out.workers.filter((w) => w.status === 'done').length,
    turns: out.turns,
    coordTokens,
    attempts,
  }
}

async function main(): Promise<void> {
  const n = Number(process.env.N ?? 5)
  const k = Number(process.env.K ?? 4)
  const model = process.env.WORKER_MODEL ?? 'gpt-5'
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('TANGLE_API_KEY')
  const concurrency = Number(process.env.CONCURRENCY ?? 4)
  const corpusPath = process.env.OPERATOR_CORPUS ?? '/tmp/aec-op.jsonl'
  if (!Number.isFinite(n) || n < 1) throw new Error(`N must be a positive integer, got ${process.env.N}`)
  if (!Number.isFinite(k) || k < 1) throw new Error(`K must be a positive integer, got ${process.env.K}`)

  const cfg: RouterConfig = { routerBaseUrl, routerKey, model }
  const adapter = createAecBenchAdapter()

  console.log(`=== aec-bench OPERATOR gate · N=${n} K=${k} model=${model} conc=${concurrency} ===`)
  await adapter.preflight()
  const tasks = await adapter.loadTasks({ limit: n })
  console.log(`loaded ${tasks.length} task(s): ${tasks.map((t) => t.id).join(', ')}`)
  console.log(`\n▶ operator@${k} (LLM driver, adaptive ≤${k} workers, deployable judge) → ${corpusPath}`)

  const results = await pool(tasks, concurrency, (task) => runOperator(cfg, adapter, task, k))

  let scoreSum = 0
  let resolvedCount = 0
  let workersSum = 0
  let coordSum = 0
  for (const r of results) {
    scoreSum += r.score
    if (r.resolved) resolvedCount += 1
    workersSum += r.workersUsed
    coordSum += r.coordTokens
    const record: RunRecord = {
      ts: new Date().toISOString(),
      benchmark: 'aec-bench',
      instanceId: r.id,
      condition: `operator@${k}`,
      model,
      blindResolved: r.attempts[0]?.valid === true,
      resolved: r.resolved, // the operator's OWN selection (it is the deployable selector)
      attempts: r.attempts,
      infraError: false,
    }
    await appendRunRecord(corpusPath, record)
    console.log(`  ${r.id}: ${r.resolved ? 'RESOLVED' : 'unresolved'}  score ${(r.score * 100).toFixed(0)}%  workers ${r.workersUsed}/${k}  turns ${r.turns}  coordTok ${r.coordTokens}`)
  }
  const nTasks = results.length || 1
  console.log(`\n  operator@${k}: selected-score ${((scoreSum / nTasks) * 100).toFixed(1)}%  resolve ${((resolvedCount / nTasks) * 100).toFixed(1)}%  (n=${results.length})`)
  console.log(`  compute: mean ${(workersSum / nTasks).toFixed(2)} workers/task (cap ${k})  ·  coordination ${Math.round(coordSum / nTasks)} tokens/task`)
  console.log('\n=== compare against the blind arms (same N,K) ===')
  console.log(`  npx tsx src/corpus-report.mts /tmp/aec-r.jsonl /tmp/aec-d.jsonl ${corpusPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
