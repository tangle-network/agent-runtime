/**
 * The "useful or BS" verdict: agents-driving-agents on a REAL deployable-checked domain.
 *
 * A `driverAgent` with a REAL router-LLM brain drives, per HumanEval task: it spawns
 * worker agents (each a router LLM that writes the function), every worker GATED by the
 * deterministic local Docker checker (the deliverable — a worker settles `valid` ⟺ its tests
 * pass), and the completion-oracle keeps-best a DELIVERED worker. The supervisor returns a winner
 * ONLY when a worker actually passed the tests (no self-declared done). We measure the driver's
 * delivered rate against a BLIND best-of-K baseline (K independent workers, no orchestration) at
 * the same K — the honest "does the recursion+oracle beat blind compute, or is it BS" question.
 *
 * Run (creds via dotenvx; Docker daemon must be up):
 *   DOTENV_PRIVATE_KEY_FILE=~/company/devops/secrets/.env.keys \
 *   dotenvx run -f ~/company/devops/secrets/agent-state.env -- \
 *   N=5 K=3 WORKER_MODEL=deepseek-v4-flash DRIVER_MODEL=deepseek-v4-flash \
 *   npx tsx bench/src/atom-humaneval.mts
 */

import {
  type Agent,
  type AgentProfile,
  type AgentSpec,
  contentAddress,
  createExecutor,
  createExecutorRegistry,
  createSupervisor,
  gateOnDeliverable,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  mapExecutorResult,
  supervisorAgent,
} from '../../src/runtime/index'
import { basePrompt, extractCode, type HumanEvalTask, loadHumanEval, runChecker } from './benchmarks/humaneval'
import {
  benchProfileModel,
  benchRouterProfile,
  type BenchRouterTarget,
  runBenchRouterTurn,
  withBenchProfile,
} from './router-turn'

function must(k: string): string {
  const v = process.env[k]
  if (!v) throw new Error(`missing required env ${k}`)
  return v
}

const N = Number(process.env.N ?? 5)
const K = Number(process.env.K ?? 3)
const OFFSET = Number(process.env.OFFSET ?? 0)
const WORKER_TEMP = Number(process.env.WORKER_TEMP ?? 0.7)

const cfg: BenchRouterTarget = {
  routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
  routerKey: must('TANGLE_API_KEY'),
  profile: benchRouterProfile(
    'humaneval-worker',
    process.env.WORKER_MODEL ?? 'deepseek-v4-flash',
    { temperature: WORKER_TEMP },
  ),
}
const driverCfg: BenchRouterTarget = {
  ...cfg,
  profile: benchRouterProfile(
    'humaneval-driver',
    process.env.DRIVER_MODEL ?? benchProfileModel(cfg.profile),
    { maxTurns: K + 4 },
  ),
}

// ── A gated router worker: one router call → candidate code, settled valid ⟺ the tests pass ──
function humanEvalWorker(task: HumanEvalTask, label: string): Agent<unknown, unknown> {
  const profile: AgentProfile = withBenchProfile(cfg.profile, {
    name: label,
    systemPrompt: basePrompt(task),
  })
  const routerFactory = createExecutor({
    backend: 'router',
    routerBaseUrl: cfg.routerBaseUrl,
    routerKey: cfg.routerKey,
  })
  const executorFactory = (spec: AgentSpec, ctx: Parameters<typeof routerFactory>[1]) => {
    const inner = routerFactory(spec, ctx)
    const mapped = mapExecutorResult(inner, (result) => {
      const raw = result.out as { content?: unknown }
      const code = extractCode(typeof raw?.content === 'string' ? raw.content : '')
      return { outRef: contentAddress(code), out: code }
    })
    return gateOnDeliverable(mapped, {
      check: async (out) => (await runChecker(task, String(out))).pass === 1,
      describe: `${task.taskId}: the provided test suite passes`,
    })
  }
  const spec: AgentSpec = { profile, harness: null, executorFactory }
  return { name: label, act: async () => '', executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

const driverSystem = `You are an orchestrator driving worker agents to solve a Python coding task. You do NOT write code yourself. Each worker independently attempts the task and is graded by a deterministic, hidden test suite. Tools: spawn_worker (dispatch one attempt; the "profile" argument may be {} and "task" a short note), await_event (collect the next settled worker — its result tells you valid:true if its tests PASSED, valid:false if they failed), and stopping (reply with NO tool call) once a worker has DELIVERED. Spawn one worker, await it; if it delivered, stop; if not, spawn another, up to ${K} workers total. You cannot declare success yourself — only a delivered (valid:true) worker counts.`

interface TaskOutcome {
  taskId: string
  driverDelivered: boolean
  blindDelivered: boolean
  driverSpawns: number
  driverWorkerTokens: number
}

// ── Driver arm: the orchestrated atom ────────────────────────────────────────────────────────
async function driveTask(
  task: HumanEvalTask,
): Promise<{ delivered: boolean; spawns: number; tokens: number }> {
  const blobs = new InMemoryResultBlobStore()
  const journal = new InMemorySpawnJournal()
  let spawns = 0
  const makeWorker = (): Agent<unknown, unknown> => {
    const w = humanEvalWorker(task, `w-${spawns}`)
    spawns += 1
    return w
  }
  const root = supervisorAgent(
    withBenchProfile(driverCfg.profile, {
      name: `drv-${task.taskId}`,
      systemPrompt: driverSystem,
    }),
    {
      router: {
        routerBaseUrl: driverCfg.routerBaseUrl,
        routerKey: driverCfg.routerKey,
      },
      blobs,
      makeWorkerAgent: makeWorker,
      perWorker: { maxIterations: 2, maxTokens: 4000 },
    },
  )
  const runId = `he-${task.taskId.replace('/', '-')}`
  const result = await createSupervisor<unknown, unknown>().run(root, basePrompt(task), {
    budget: { maxIterations: 100, maxTokens: 400_000 },
    runId,
    journal,
    blobs,
    executors: createExecutorRegistry(),
    maxDepth: 4,
    now: () => Date.now(),
  })
  const tree = await journal.loadTree(runId)
  const tokens = (tree ?? [])
    .filter((e): e is Extract<NonNullable<typeof tree>[number], { kind: 'settled' }> => e.kind === 'settled')
    .reduce((s, e) => s + e.spent.tokens.input + e.spent.tokens.output, 0)
  return { delivered: result.kind === 'winner', spawns, tokens }
}

// ── Blind arm: K independent workers, best-of-K by the checker (no orchestration) ─────────────
async function blindTask(task: HumanEvalTask): Promise<boolean> {
  for (let i = 0; i < K; i += 1) {
    // A transient router error is a FAILED attempt, not a crash — the driver arm already types
    // an executor throw into a `down` settlement, so the blind arm must match (fair comparison).
    let content = ''
    try {
      const res = await runBenchRouterTurn(
        {
          routerBaseUrl: cfg.routerBaseUrl,
          routerKey: cfg.routerKey,
          profile: withBenchProfile(cfg.profile, {
            name: 'humaneval-blind-atom-worker',
          }),
        },
        basePrompt(task),
      )
      content = res.finalText
    } catch {
      continue
    }
    if ((await runChecker(task, extractCode(content))).pass === 1) return true
  }
  return false
}

async function main(): Promise<void> {
  console.log(
    `atom-humaneval: N=${N} K=${K} offset=${OFFSET} worker=${benchProfileModel(cfg.profile)} driver=${benchProfileModel(driverCfg.profile)}`,
  )
  const tasks = await loadHumanEval(N, OFFSET)
  const outcomes: TaskOutcome[] = []
  for (const task of tasks) {
    const drv = await driveTask(task)
    const blind = await blindTask(task)
    outcomes.push({
      taskId: task.taskId,
      driverDelivered: drv.delivered,
      blindDelivered: blind,
      driverSpawns: drv.spawns,
      driverWorkerTokens: drv.tokens,
    })
    console.log(
      `  ${task.taskId.padEnd(14)} driver=${drv.delivered ? 'PASS' : 'fail'} (spawns=${drv.spawns}, tok=${drv.tokens})  blind@${K}=${blind ? 'PASS' : 'fail'}`,
    )
  }
  const driverPass = outcomes.filter((o) => o.driverDelivered).length
  const blindPass = outcomes.filter((o) => o.blindDelivered).length
  const avgSpawns = outcomes.reduce((s, o) => s + o.driverSpawns, 0) / Math.max(1, outcomes.length)
  console.log('\n── verdict ──')
  console.log(`driver-orchestrated delivered: ${driverPass}/${outcomes.length}  (avg spawns ${avgSpawns.toFixed(1)} of ${K} allowed)`)
  console.log(`blind best-of-${K} delivered:    ${blindPass}/${outcomes.length}`)
  console.log(
    driverPass > blindPass
      ? `→ orchestration BEAT blind by +${driverPass - blindPass} tasks`
      : driverPass === blindPass
        ? `→ orchestration TIED blind (the atom delivers, but adds no lift here at this N)`
        : `→ orchestration LOST to blind by ${blindPass - driverPass} tasks`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
