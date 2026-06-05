/**
 * The LIVE operator driver over EnterpriseOps — the full-vision test on a hard, MULTI-TURN domain.
 *
 * Unlike the single-shot router benches (aec/finsearch), here every worker is a multi-turn agentic
 * EOPS rollout (open a seeded gym DB → tool loop over the MCP tools → score against the verifiers).
 * So the operator's full verb set fires: spawn_worker (a fresh rollout with a strategy), await_next
 * (read its deployable verifier score), run_analyst (a trace lens over the worker's transcript to
 * find what's unfinished — selector≠judge), steer/spawn-anew, stop. The conserved pool caps it at K
 * workers (equal-k vs the breadth best-of-K baseline).
 *
 * Baseline: runBreadthPersonified (the proven `fanout` best-of-K over the same surface) — blind
 * parallel compute with a deployable selector, no operator judgment. The question: does the
 * operator's adaptive allocation + analyst-informed selection beat blind best-of-K at equal K on a
 * domain with a correctable middle band (EOPS depth already showed +13.4pp)?
 */

import {
  type AgentSpec,
  type Budget,
  createSupervisor,
  type ExecutorContext,
  type ExecutorRegistry,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  type LeafExecutor,
} from '@tangle-network/agent-runtime/loops'
import { createOperatorDriverAgent, defaultAnalystKinds, makeAnalystRunner } from '@tangle-network/agent-runtime/mcp'
import {
  type AgenticOptions,
  type AgenticSurface,
  type AgenticTask,
  type ShotResult,
  type ShotTask,
  shotExecutor,
} from './agentic'
import { createEopsSurface, eopsTaskFromRow } from './agentic-eops'
import { runBreadthPersonified } from './agentic-personify'
import { type RouterConfig, routerChatWithTools } from './router-client'

const must = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`env ${k} is required`)
  return v
}

async function loadItsmTasks(n: number): Promise<AgenticTask[]> {
  const url =
    'https://datasets-server.huggingface.co/rows?dataset=ServiceNow-AI%2FEnterpriseOps-Gym' +
    `&config=oracle&split=itsm&offset=0&length=${n}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HF rows ${res.status}`)
  const body = (await res.json()) as { rows?: Array<{ row: Parameters<typeof eopsTaskFromRow>[0] }> }
  return (body.rows ?? []).slice(0, n).map(({ row }) => eopsTaskFromRow(row))
}

/** A registry whose every spawn is a FRESH EOPS rollout over the given task. The operator's
 *  spawn_worker `task` string is the per-worker strategy, mapped to a ShotTask steer; the worker
 *  opens its own seeded DB (best-of-K fresh rollouts). Wrapping shotExecutor reuses the surface
 *  tool-loop + the deployable verifier verdict. */
function operatorSurfaceRegistry(surface: AgenticSurface, task: AgenticTask, opts: AgenticOptions): ExecutorRegistry {
  return {
    register(): void {
      throw new Error('operatorSurfaceRegistry: register unsupported (one surface-shot runtime)')
    },
    resolve<Out>(_spec: AgentSpec) {
      const factory = (_s: AgentSpec, _ctx: ExecutorContext) => {
        const inner = shotExecutor(surface, opts) // fresh per spawn — no shared result slot
        const wrapped: LeafExecutor<unknown> = {
          ...inner,
          execute: (t, signal) => {
            const strategy = typeof t === 'string' ? t : ''
            const shot: ShotTask = strategy.length > 0 ? { task, steer: strategy } : { task }
            return inner.execute(shot, signal)
          },
        }
        return wrapped as LeafExecutor<Out>
      }
      return { succeeded: true as const, value: factory }
    },
  }
}

const operatorPrompt = [
  'You are an OPERATOR leading a team of EnterpriseOps workers. You do NOT touch the system yourself —',
  'your only way to make progress is to spawn workers and pick the best result. Every turn you MUST call',
  'a tool; you cannot reply in prose, and you cannot stop until at least one worker has completed.',
  'Each spawn_worker runs a FULL multi-turn rollout against a fresh copy of the environment, using the',
  'STRATEGY you put in its `task` field (e.g. "first list open incidents, then update each SLA field").',
  'Lead with judgment:',
  '- await_next to read each worker’s deployable score in [0,1] (1.0 = every verifier passed).',
  '- run_analyst (list_analysts for the menu) over a settled worker to diagnose WHAT it left unfinished',
  '  or did wrong from its trace — then spawn a new worker whose strategy fixes exactly that.',
  '- Do not repeat a strategy that scored low. Spawn intelligently, not frivolously — each worker costs',
  '  budget and spawning past it fails closed.',
  '- When a worker fully resolves, or you exhaust your budget, call stop with a one-line reason.',
].join(' ')

interface OperatorOutcome {
  resolved: boolean
  score: number
  workersUsed: number
  turns: number
  coordTokens: number
}

async function runOperator(cfg: RouterConfig, surface: AgenticSurface, task: AgenticTask, opts: AgenticOptions, k: number): Promise<OperatorOutcome> {
  const blobs = new InMemoryResultBlobStore()
  let coordTokens = 0
  const analystRunner = makeAnalystRunner(defaultAnalystKinds, { routerBaseUrl: cfg.routerBaseUrl, routerKey: cfg.routerKey, model: cfg.model })

  const driver = createOperatorDriverAgent({
    systemPrompt: operatorPrompt,
    describeTask: () =>
      `${task.systemPrompt}\n\nTASK: ${task.userPrompt}\n\nLead the solve: spawn_worker (its \`task\` field is that worker’s strategy), await_next to read each deployable score, run_analyst to diagnose an incomplete worker’s trace, and stop when a worker resolves or you exhaust your budget of ${k} workers.`,
    chat: async (messages, tools) => {
      const r = await routerChatWithTools(cfg, messages, tools, { temperature: 0.3, toolChoice: 'required' })
      if (r.usage) coordTokens += r.usage.input + r.usage.output
      return { content: r.content, toolCalls: r.toolCalls }
    },
    blobs,
    makeWorkerAgent: () => ({ name: 'eops-worker', executorSpec: { profile: { id: 'eops-worker', model: cfg.model }, harness: null }, act: () => Promise.reject(new Error('leaf runs via executor')) }) as never,
    perWorker: { maxIterations: (opts.innerTurns ?? 4) + 2, maxTokens: 2_000_000 } as Budget,
    maxTurns: k * 3 + 6,
    minWorkersBeforeStop: 1,
    maxWorkers: k, // HARD equal-k: exactly ≤K rollouts, regardless of refund-driven readmission
    exhaustUnlessResolved: true, // don't give up early — cover at least as much as blind best-of-K
    analystKinds: Object.values(defaultAnalystKinds).map((kk) => ({ id: kk.id, description: kk.description, area: kk.area })),
    runAnalyst: (kind, trace) => analystRunner(kind, trace, new Date().toISOString()),
  })

  const result = await createSupervisor<unknown, unknown>().run(driver, undefined, {
    // root iterations bound the total worker rollouts to K (each reserves innerTurns+2). Equal-k.
    budget: { maxIterations: k * ((opts.innerTurns ?? 4) + 2), maxTokens: 50_000_000 },
    runId: `operator-eops:${task.id}`,
    journal: new InMemorySpawnJournal(),
    blobs,
    executors: operatorSurfaceRegistry(surface, task, opts),
    maxDepth: 2,
  })
  if (result.kind !== 'winner') return { resolved: false, score: 0, workersUsed: 0, turns: 0, coordTokens }
  const out = result.out as { resolved: boolean; score: number; turns: number; workers: Array<{ status: string }> }
  return {
    resolved: out.resolved,
    score: out.score,
    workersUsed: out.workers.filter((w) => w.status === 'done').length,
    turns: out.turns,
    coordTokens,
  }
}

async function main(): Promise<void> {
  const nTasks = Number(process.env.TASKS ?? 4)
  const k = Number(process.env.K ?? 4)
  const opts: AgenticOptions = {
    routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
    routerKey: must('TANGLE_API_KEY'),
    model: process.env.WORKER_MODEL ?? 'gpt-4.1',
    temperature: Number(process.env.TEMPERATURE ?? 0.7),
    innerTurns: Number(process.env.INNER_TURNS ?? 4),
  }
  const cfg: RouterConfig = { routerBaseUrl: opts.routerBaseUrl, routerKey: opts.routerKey, model: opts.model }
  const surface = createEopsSurface(must('EOPS_GYM_DBS_DIR'))
  const tasks = await loadItsmTasks(nTasks)
  console.log(`=== OPERATOR vs BREADTH over EOPS · ${tasks.length} itsm tasks · K=${k} · ${opts.model} · innerTurns=${opts.innerTurns} ===\n`)

  const rows: Array<{ op: OperatorOutcome; breadth: number; bResolved: boolean }> = []
  for (const [i, task] of tasks.entries()) {
    let op: OperatorOutcome
    try {
      op = await runOperator(cfg, surface, task, opts, k)
    } catch (e) {
      console.log(`  task ${i} ${task.id.slice(0, 22)}: OPERATOR failed — ${e instanceof Error ? e.message.slice(0, 120) : e}`)
      continue
    }
    const breadth = await runBreadthPersonified(surface, task, opts, k)
    rows.push({ op, breadth: breadth.score, bResolved: breadth.resolved })
    console.log(
      `  task ${i} ${task.id.slice(0, 22)}: OPERATOR ${(op.score * 100).toFixed(0)}% (${op.resolved ? 'resolved' : 'unresolved'}, ${op.workersUsed}/${k} workers, ${op.turns} turns, ${op.coordTokens} coordTok)  vs  BREADTH@${k} ${(breadth.score * 100).toFixed(0)}% (${breadth.resolved ? 'resolved' : 'unresolved'})`,
    )
  }

  if (rows.length === 0) throw new Error('no scoreable tasks')
  const mean = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0) / rows.length
  const o = mean((r) => r.op.score)
  const b = mean((r) => r.breadth)
  const oRes = mean((r) => (r.op.resolved ? 1 : 0))
  const bRes = mean((r) => (r.bResolved ? 1 : 0))
  // Paired sign test over the score-discordant tasks (the only ones that carry signal).
  const eps = 1e-9
  let wins = 0
  let losses = 0
  for (const r of rows) {
    if (r.op.score > r.breadth + eps) wins += 1
    else if (r.breadth > r.op.score + eps) losses += 1
  }
  const disc = wins + losses
  const p = twoSidedSignP(wins, disc)
  const maxWorkers = Math.max(...rows.map((r) => r.op.workersUsed))
  console.log(`\n=== n=${rows.length} · K=${k} ===`)
  console.log(`OPERATOR (adaptive, analyst-steered): score ${(o * 100).toFixed(1)}%  resolve ${(oRes * 100).toFixed(1)}%  (mean ${mean((r) => r.op.workersUsed).toFixed(1)} workers/task, max ${maxWorkers}, ${Math.round(mean((r) => r.op.coordTokens))} coordTok/task)`)
  console.log(`BREADTH  (blind best-of-K):           score ${(b * 100).toFixed(1)}%  resolve ${(bRes * 100).toFixed(1)}%`)
  console.log(`PAIRED: ${wins} win / ${losses} loss / ${rows.length - disc} tie  ·  sign-test p=${p.toFixed(3)} (n_disc=${disc})`)
  console.log(`VERDICT: operator ${o >= b ? 'BEATS' : 'loses to'} breadth by ${((o - b) * 100).toFixed(1)}pp (score), ${((oRes - bRes) * 100).toFixed(1)}pp (resolve) — coordination tax ${Math.round(mean((r) => r.op.coordTokens))} tok/task is operator overhead (worker-K is equal)`)
}

/** Two-sided exact binomial sign-test p-value: P(|X - n/2| >= |wins - n/2|) under X~Bin(n, 0.5). */
function twoSidedSignP(wins: number, n: number): number {
  if (n === 0) return 1
  const choose = (a: number, b: number): number => {
    let r = 1
    for (let i = 0; i < b; i += 1) r = (r * (a - i)) / (i + 1)
    return r
  }
  const pmf = (kk: number) => choose(n, kk) * 0.5 ** n
  const obs = pmf(wins)
  let p = 0
  for (let kk = 0; kk <= n; kk += 1) if (pmf(kk) <= obs + 1e-12) p += pmf(kk)
  return Math.min(1, p)
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
