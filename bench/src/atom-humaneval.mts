/**
 * The "useful or BS" verdict: agents-driving-agents on a REAL deployable-checked domain.
 *
 * A `coordinationDriverAgent` with a REAL router-LLM brain drives, per HumanEval task: it spawns
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
  type CoordinationDriverOptions,
  coordinationDriverAgent,
  createExecutorRegistry,
  createSupervisor,
  type DriverChat,
  type DriverMessage,
  type Executor,
  type ExecutorResult,
  gateOnDeliverable,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  type RouterConfig,
  routerChatWithTools,
  routerChatWithUsage,
} from '../../src/runtime/index'
import { basePrompt, extractCode, type HumanEvalTask, loadHumanEval, runChecker } from './benchmarks/humaneval'

function must(k: string): string {
  const v = process.env[k]
  if (!v) throw new Error(`missing required env ${k}`)
  return v
}

const N = Number(process.env.N ?? 5)
const K = Number(process.env.K ?? 3)
const OFFSET = Number(process.env.OFFSET ?? 0)
const WORKER_TEMP = Number(process.env.WORKER_TEMP ?? 0.7)

const cfg: RouterConfig = {
  routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
  routerKey: must('TANGLE_API_KEY'),
  model: process.env.WORKER_MODEL ?? 'deepseek-v4-flash',
}
const driverCfg: RouterConfig = { ...cfg, model: process.env.DRIVER_MODEL ?? cfg.model }

// ── The real driver-LLM brain: routerChatWithTools adapted to the DriverChat seam ────────────
function routerDriverChat(c: RouterConfig): DriverChat {
  return {
    next: async ({ system, messages, tools }) => {
      const oa: Array<Record<string, unknown>> = [
        { role: 'system', content: system },
        ...messages.map(toOpenAI),
      ]
      const oaTools = tools.map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }))
      const r = await routerChatWithTools(c, oa, oaTools, { temperature: 0.4, toolChoice: 'auto' })
      return {
        ...(r.content ? { content: r.content } : {}),
        toolCalls: r.toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: safeParse(tc.arguments),
        })),
      }
    },
  }
}

function toOpenAI(m: DriverMessage): Record<string, unknown> {
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return {
      role: 'assistant',
      content: m.content ?? '',
      tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id ?? tc.name,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    }
  }
  if (m.role === 'tool') {
    return { role: 'tool', tool_call_id: m.toolCallId ?? m.name ?? 'call', content: m.content }
  }
  return { role: m.role, content: m.content }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return {}
  }
}

// ── A gated router worker: one router call → candidate code, settled valid ⟺ the tests pass ──
function humanEvalWorker(task: HumanEvalTask, label: string): Agent<unknown, unknown> {
  let artifact: ExecutorResult<unknown> | undefined
  const inner: Executor<unknown> = {
    runtime: 'router',
    async execute(_t, signal) {
      const res = await routerChatWithUsage(cfg, [{ role: 'user', content: basePrompt(task) }], {
        temperature: WORKER_TEMP,
        ...(signal ? { signal } : {}),
      })
      const code = extractCode(res.content)
      artifact = {
        outRef: contentAddress(code),
        out: code,
        spent: { iterations: 1, tokens: res.usage ?? { input: 0, output: 0 }, usd: res.costUsd ?? 0, ms: 0 },
      }
      return artifact
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: () => {
      if (!artifact) throw new Error('resultArtifact read before execute')
      return artifact
    },
  }
  const gated = gateOnDeliverable(inner, {
    check: async (out) => (await runChecker(task, String(out))).pass === 1,
    describe: `${task.taskId}: the provided test suite passes`,
  })
  const spec: AgentSpec = { profile: { name: label } as AgentProfile, harness: null, executor: gated }
  return { name: label, act: async () => '', executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

const driverSystem = `You are an orchestrator driving worker agents to solve a Python coding task. You do NOT write code yourself. Each worker independently attempts the task and is graded by a deterministic, hidden test suite. Tools: spawn_worker (dispatch one attempt; the "profile" argument may be {} and "task" a short note), await_next (collect the next settled worker — its result tells you valid:true if its tests PASSED, valid:false if they failed), and stopping (reply with NO tool call) once a worker has DELIVERED. Spawn one worker, await it; if it delivered, stop; if not, spawn another, up to ${K} workers total. You cannot declare success yourself — only a delivered (valid:true) worker counts.`

interface TaskOutcome {
  taskId: string
  driverDelivered: boolean
  blindDelivered: boolean
  driverSpawns: number
  driverWorkerTokens: number
}

// ── Driver arm: the orchestrated atom ────────────────────────────────────────────────────────
async function driveTask(task: HumanEvalTask): Promise<{ delivered: boolean; spawns: number; tokens: number }> {
  const blobs = new InMemoryResultBlobStore()
  const journal = new InMemorySpawnJournal()
  let spawns = 0
  const makeWorker = (): Agent<unknown, unknown> => {
    const w = humanEvalWorker(task, `w-${spawns}`)
    spawns += 1
    return w
  }
  const opts: CoordinationDriverOptions = {
    name: `drv-${task.taskId}`,
    chat: routerDriverChat(driverCfg),
    blobs,
    makeWorkerAgent: makeWorker,
    perWorker: { maxIterations: 2, maxTokens: 4000 },
    systemPrompt: driverSystem,
    maxTurns: K + 4,
  }
  const root = coordinationDriverAgent(opts)
  const result = await createSupervisor<unknown, unknown>().run(root, basePrompt(task), {
    budget: { maxIterations: 100, maxTokens: 400_000 },
    runId: `he-${task.taskId.replace('/', '-')}`,
    journal,
    blobs,
    executors: createExecutorRegistry(),
    maxDepth: 4,
    now: () => Date.now(),
  })
  const tree = await journal.loadTree(`he-${task.taskId.replace('/', '-')}`)
  const tokens = (tree ?? [])
    .filter((e): e is Extract<(typeof tree)[number], { kind: 'settled' }> => e.kind === 'settled')
    .reduce((s, e) => s + e.spent.tokens.input + e.spent.tokens.output, 0)
  return { delivered: result.kind === 'winner', spawns, tokens }
}

// ── Blind arm: K independent workers, best-of-K by the checker (no orchestration) ─────────────
async function blindTask(task: HumanEvalTask): Promise<boolean> {
  for (let i = 0; i < K; i += 1) {
    const res = await routerChatWithUsage(cfg, [{ role: 'user', content: basePrompt(task) }], {
      temperature: WORKER_TEMP,
    })
    if ((await runChecker(task, extractCode(res.content))).pass === 1) return true
  }
  return false
}

async function main(): Promise<void> {
  console.log(`atom-humaneval: N=${N} K=${K} offset=${OFFSET} worker=${cfg.model} driver=${driverCfg.model}`)
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
