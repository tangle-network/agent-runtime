/**
 * Coding-harness × web-search-backend benchmark runner.
 *
 * For each (task × harness × arm) cell: spin up a live sandbox, run the coding
 * task once through the harness with that arm's AgentProfile (native search /
 * provider-MCP+native-disabled), score the answer with the task's deterministic
 * oracle, and record score + cost + tokens + latency + tool-call count +
 * citations. Cells are concurrency-bounded and fault-isolated; an infra-errored
 * cell is recorded as such and excluded from rates (never a silent zero).
 *
 * Run (opencode, you.com vs native, seed tasks):
 *   dotenvx run -f ~/company/devops/secrets/.env.keys -f ~/company/devops/secrets/agent-state.env -- \
 *     env HARNESSES=opencode ARMS=native,you MODEL=opencode/deepseek/deepseek-v4-flash \
 *     OUT=/tmp/search-bench.jsonl pnpm exec tsx src/search-bench/run.mts
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { extractLlmCallEvent, openSandboxRun } from '@tangle-network/agent-runtime/kernel'
import { Sandbox, type SandboxEvent } from '@tangle-network/sandbox'
import { answerOutput, sandboxAgentRun, type WorkerBackendType } from '../sandbox-run'
import { type BridgeCfg, runBridgeCell } from './bridge'
import { type SearchArm, armLabel, buildArmProfile } from './profiles'
import { freshTasks } from './tasks-fresh'
import { type SearchTask, scoreTask, seedTasks, taskToPrompt } from './tasks'

export interface SearchCellResult {
  taskId: string
  domain: string
  harness: string
  /** Search arm: 'native' | 'off' | provider id (e.g. 'you', 'exa'). */
  arm: string
  model: string
  /** Deterministic oracle outcome. null ⇒ infra error (excluded from rates). */
  score: 0 | 1 | null
  reasons: string[]
  costUsd?: number
  tokensIn?: number
  tokensOut?: number
  wallMs: number
  /** Distinct tool calls observed (evidence the agent actually searched). */
  toolCalls: number
  /** Tool names used — distinguishes native (`webfetch`) from the provider MCP. */
  toolNames: string[]
  /** Distinct http(s) URLs cited in the answer. */
  citations: string[]
  /** Final answer text (truncated in the export; full in the raw JSONL). */
  answer: string
  infraError?: string
  ts: string
}

const urlRe = /https?:\/\/[^\s)\]}"'<>]+/gi

function extractCitations(answer: string): string[] {
  const seen = new Set<string>()
  for (const m of answer.match(urlRe) ?? []) seen.add(m.replace(/[.,;]+$/, ''))
  return [...seen]
}

/** Sum token usage + cost across the run's llm_call events (the kernel's ledger). */
function tally(events: SandboxEvent[]): { costUsd?: number; tokensIn?: number; tokensOut?: number } {
  let costUsd = 0
  let tokensIn = 0
  let tokensOut = 0
  let any = false
  for (const ev of events) {
    const call = extractLlmCallEvent(ev as never, 'search-bench')
    if (!call) continue
    any = true
    costUsd += call.costUsd ?? 0
    tokensIn += call.tokensIn ?? 0
    tokensOut += call.tokensOut ?? 0
  }
  return any ? { costUsd, tokensIn, tokensOut } : {}
}

/**
 * Distinct tool calls + the tool names used. opencode emits a tool call as
 * repeated `message.part.updated` events sharing a `data.part.callID` with
 * `data.part.type==='tool'` and `data.part.tool` the name (e.g. `webfetch`,
 * or an MCP tool like `tangle_search_web_search`). We dedupe by callID so a
 * single call counts once, and surface the names so the export can show which
 * search backend the agent actually used (native vs the provider MCP).
 */
function extractTools(events: SandboxEvent[]): { count: number; names: string[] } {
  const calls = new Map<string, string>()
  for (const ev of events) {
    const part = (ev as { data?: { part?: Record<string, unknown> } }).data?.part
    if (!part || typeof part !== 'object' || part.type !== 'tool') continue
    const callId = typeof part.callID === 'string' ? part.callID : `${calls.size}`
    const name = typeof part.tool === 'string' ? part.tool : 'unknown'
    calls.set(callId, name)
  }
  return { count: calls.size, names: [...new Set(calls.values())] }
}

export interface RunCfg {
  tasks: SearchTask[]
  harnesses: WorkerBackendType[]
  arms: SearchArm[]
  model: string
  routerBaseUrl: string
  tangleApiKey: string
  sandboxBaseUrl: string
  sandboxKey: string
  outPath: string
  /** In-box model provider — `openai` (default) or `openai-compat` for cheap models. */
  provider?: string
  /** Execution surface: `sandbox` (live box) or `bridge` (local cli-bridge). */
  backend?: 'sandbox' | 'bridge'
  /** cli-bridge wiring, required when `backend === 'bridge'`. */
  bridge?: BridgeCfg
  concurrency?: number
  timeoutMs?: number
}

async function runCell(
  cfg: RunCfg,
  client: Sandbox,
  task: SearchTask,
  harness: WorkerBackendType,
  arm: SearchArm,
): Promise<SearchCellResult> {
  const startedAt = Date.now()
  const armId = armLabel(arm)
  const base = {
    taskId: task.id,
    domain: task.domain,
    harness,
    arm: armId,
    model: cfg.model,
    ts: new Date(startedAt).toISOString(),
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 300_000)
  try {
    const agentRun = sandboxAgentRun({
      model: cfg.model,
      routerBaseUrl: cfg.routerBaseUrl,
      backendType: harness,
      ...(cfg.provider ? { provider: cfg.provider } : {}),
      profile: buildArmProfile({
        arm,
        routerBaseUrl: cfg.routerBaseUrl,
        tangleApiKey: cfg.tangleApiKey,
        name: `search-bench-${harness}-${armId}`,
        metadata: { harness, arm: armId, taskId: task.id },
      }),
    })
    const run = await openSandboxRun<string>(
      client,
      { agentRun, signal: controller.signal },
      { kind: 'events', fromEvents: (events) => answerOutput.parse(events as never) },
    )
    let turn: Awaited<ReturnType<typeof run.start>>
    try {
      turn = await run.start(taskToPrompt(task))
    } finally {
      await run.close().catch(() => {})
    }
    if (process.env.DUMP_EVENTS) {
      writeFileSync(process.env.DUMP_EVENTS, JSON.stringify(turn.events, null, 2))
    }
    const answer = turn.out ?? ''
    const { score, reasons } = scoreTask(task, answer)
    const tools = extractTools(turn.events)
    return {
      ...base,
      score,
      reasons,
      ...tally(turn.events),
      wallMs: Date.now() - startedAt,
      toolCalls: tools.count,
      toolNames: tools.names,
      citations: extractCitations(answer),
      answer,
    }
  } catch (err) {
    return {
      ...base,
      score: null,
      reasons: [],
      wallMs: Date.now() - startedAt,
      toolCalls: 0,
      toolNames: [],
      citations: [],
      answer: '',
      infraError: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function runSearchBench(cfg: RunCfg): Promise<SearchCellResult[]> {
  const useBridge = cfg.backend === 'bridge'
  if (useBridge && !cfg.bridge) throw new Error('backend=bridge requires cfg.bridge')
  const client = useBridge ? null : new Sandbox({ baseUrl: cfg.sandboxBaseUrl, apiKey: cfg.sandboxKey })
  const runOne = (task: SearchTask, harness: WorkerBackendType, arm: SearchArm): Promise<SearchCellResult> =>
    useBridge ? runBridgeCell(cfg.bridge!, task, harness, arm) : runCell(cfg, client!, task, harness, arm)
  const cells: Array<{ task: SearchTask; harness: WorkerBackendType; arm: SearchArm }> = []
  for (const task of cfg.tasks)
    for (const harness of cfg.harnesses) for (const arm of cfg.arms) cells.push({ task, harness, arm })

  mkdirSync(dirname(cfg.outPath), { recursive: true })
  writeFileSync(cfg.outPath, '')
  const results: SearchCellResult[] = []
  const conc = cfg.concurrency ?? 3
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < cells.length) {
      const i = next++
      const { task, harness, arm } = cells[i]
      const r = await runOne(task, harness, arm)
      results.push(r)
      appendFileSync(cfg.outPath, `${JSON.stringify(r)}\n`)
      const mark = r.score === null ? 'ERR' : r.score === 1 ? 'PASS' : 'fail'
      console.error(
        `[${i + 1}/${cells.length}] ${harness}:${armLabel(arm)} ${task.id} → ${mark}` +
          (r.infraError ? ` (${r.infraError})` : ` tools=${r.toolCalls}[${r.toolNames.join(',')}] cites=${r.citations.length} ${Math.round(r.wallMs / 1000)}s`),
      )
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, cells.length) }, () => worker()))
  return results
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback
  if (v === undefined) throw new Error(`missing env ${name}`)
  return v
}

async function main(): Promise<void> {
  const harnesses = env('HARNESSES', 'opencode').split(',').map((s) => s.trim()) as WorkerBackendType[]
  const arms: SearchArm[] = env('ARMS', 'native,you')
    .split(',')
    .map((s) => s.trim())
    .map((s) => (s === 'native' || s === 'off' ? s : { provider: s }))
  const tangleApiKey = env('TANGLE_API_KEY')
  const backend = env('BACKEND', 'sandbox') as 'sandbox' | 'bridge'
  let bridge: BridgeCfg | undefined
  if (backend === 'bridge') {
    bridge = {
      bridgeUrl: env('BRIDGE_URL', 'http://127.0.0.1:3355'),
      bridgeBearer: env('BRIDGE_BEARER'),
      tangleApiKey,
      routerSearchMcp: env('ROUTER_SEARCH_MCP', 'https://router.tangle.tools/v1/search/mcp'),
      bridgeModels: JSON.parse(
        env('BRIDGE_MODELS', '{"claude-code":"claude-code/sonnet","opencode":"opencode/zai-coding-plan/glm-5.1"}'),
      ) as Record<string, string>,
      timeoutMs: Number(env('TIMEOUT_MS', '300000')),
    }
  }
  const taskSet = (process.env.TASK_SET ?? 'fresh') === 'seed' ? seedTasks : freshTasks
  const onlyIds = (process.env.TASK_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const tasks = onlyIds.length ? taskSet.filter((t) => onlyIds.includes(t.id)) : taskSet
  if (tasks.length === 0) throw new Error(`no tasks matched TASK_IDS=${process.env.TASK_IDS} in TASK_SET=${process.env.TASK_SET ?? 'fresh'}`)
  const results = await runSearchBench({
    tasks,
    harnesses,
    arms,
    backend,
    ...(bridge ? { bridge } : {}),
    model: env('MODEL', 'opencode/deepseek/deepseek-v4-flash'),
    routerBaseUrl: env('ROUTER_BASE_URL', 'https://router.tangle.tools/v1'),
    tangleApiKey,
    sandboxBaseUrl: env('SANDBOX_BASE_URL', 'https://sandbox.tangle.tools'),
    sandboxKey: env('SANDBOX_KEY', tangleApiKey),
    provider: env('PROVIDER', 'openai'),
    outPath: env('OUT', '/tmp/search-bench.jsonl'),
    concurrency: Number(env('CONCURRENCY', '3')),
    timeoutMs: Number(env('TIMEOUT_MS', '300000')),
  })
  const scored = results.filter((r) => r.score !== null)
  console.error(
    `\nDone: ${results.length} cells, ${scored.length} scored, ${results.length - scored.length} infra-errored → ${env('OUT', '/tmp/search-bench.jsonl')}`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
