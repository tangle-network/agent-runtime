/**
 * The whole vision, end to end, runnable from a laptop: a thin local driver
 * fans out N workers to CLOUD sandboxes, observes each worker's trace, reports
 * what to fix, and writes durable learnings to a corpus the NEXT run reads back.
 *
 * Local process = the driver (orchestrate + observe). All agent work runs in the
 * cloud (Tangle sandbox SDK). Scale is the API key, not the laptop.
 *
 *   dotenvx run -f ~/company/devops/secrets/.env.keys -f ~/company/devops/secrets/agent-state.env -- \
 *     env BACKEND=opencode MODEL=gpt-4.1 N=2 CORPUS=/tmp/fleet-corpus.jsonl \
 *     pnpm exec tsx src/fleet.mts
 *
 * Run it twice: the second run injects the first run's learnings into the workers.
 */
import { createChatClient } from '@tangle-network/agent-eval'
import { FileCorpus, observe, openSandboxRun, renderReport } from '@tangle-network/agent-runtime/loops'
import { Sandbox } from '@tangle-network/sandbox'
import { answerOutput, sandboxAgentRun, type WorkerBackendType } from './sandbox-run'

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback
  if (v === undefined) throw new Error(`missing env ${name}`)
  return v
}

// The fleet's work: each worker gets one subtask. Swap for any real decomposition.
const subtasks = [
  'Write a Python function `is_prime(n)` and three asserts proving it. Run them and report PASS/FAIL.',
  'Write a Python function `fib(n)` (iterative) and three asserts proving it. Run them and report PASS/FAIL.',
  'Write a Python function `rev_words(s)` that reverses word order, with asserts. Run them and report PASS/FAIL.',
]

interface WorkerResult {
  id: string
  task: string
  output: string
  events: unknown[]
  wallMs: number
  error?: string
}

async function runWorker(
  client: Sandbox,
  cfg: { backendType: WorkerBackendType; model: string; routerBaseUrl: string },
  id: string,
  task: string,
  priorLearnings: string,
): Promise<WorkerResult> {
  const startedAt = Date.now()
  const prompt = priorLearnings ? `${priorLearnings}\n\n---\n\n${task}` : task
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number(process.env.TIMEOUT_MS ?? 240_000))
  try {
    const agentRun = sandboxAgentRun({ ...cfg, name: id })
    const run = await openSandboxRun<string>(
      client,
      { agentRun, signal: controller.signal },
      { kind: 'events', fromEvents: (events) => answerOutput.parse(events as never) },
    )
    try {
      const turn = await run.start(prompt)
      return { id, task, output: (turn.out ?? '').trim(), events: turn.events, wallMs: Date.now() - startedAt }
    } finally {
      await run.close().catch(() => {})
    }
  } catch (err) {
    return { id, task, output: '', events: [], wallMs: Date.now() - startedAt, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}

async function main(): Promise<void> {
  const routerKey = env('TANGLE_API_KEY')
  const cfg = {
    backendType: env('BACKEND', 'opencode') as WorkerBackendType,
    model: env('MODEL', 'gpt-4.1'),
    routerBaseUrl: env('ROUTER_BASE_URL', 'https://router.tangle.tools/v1'),
  }
  const n = Math.min(Number(env('N', '2')), subtasks.length)
  const corpus = new FileCorpus(env('CORPUS', '/tmp/fleet-corpus.jsonl'))
  const observerModel = env('OBSERVER_MODEL', 'gpt-4.1')
  const chat = createChatClient({ transport: 'router', apiKey: routerKey, baseUrl: cfg.routerBaseUrl, defaultModel: observerModel })
  const client = new Sandbox({ baseUrl: env('SANDBOX_BASE_URL', 'https://sandbox.tangle.tools'), apiKey: routerKey })

  // ── continuous: read what prior runs LEARNED, inject it into this run's workers
  const prior = await corpus.query({ tags: ['audience:agent'], limit: 8 })
  const priorLearnings = prior.length
    ? `PRIOR LEARNINGS (from earlier runs — apply them):\n${prior.map((r) => `- ${r.claim}`).join('\n')}`
    : ''
  console.error(`\n=== FLEET · ${n} workers · ${cfg.backendType}/${cfg.model} · cloud ===`)
  console.error(prior.length ? `carrying ${prior.length} prior learning(s) into the workers\n` : 'first run — no prior learnings yet\n')

  // ── fan out N workers to cloud sandboxes, in parallel
  const tasks = subtasks.slice(0, n)
  const workers = await Promise.all(
    tasks.map((task, i) => runWorker(client, cfg, `worker-${i + 1}`, task, priorLearnings)),
  )

  // ── observe each worker's trace → findings → operator report + durable learnings
  let totalLearned = 0
  for (const w of workers) {
    console.error(`\n── ${w.id} (${Math.round(w.wallMs / 1000)}s)${w.error ? ` — ERROR: ${w.error}` : ''}`)
    if (w.error) continue
    const ob = await observe(
      { task: w.task, output: w.output, trace: w.events, outcome: w.output ? 'passed' : 'unknown', runId: w.id },
      { chat, model: observerModel, corpus, tags: [cfg.backendType, 'fleet'] },
    )
    totalLearned += ob.learned.length
    console.error(`  answer: ${w.output.slice(0, 120).replace(/\n/g, ' ')}`)
    console.error(renderReport(ob.findings).split('\n').map((l) => `  ${l}`).join('\n'))
    console.error(`  → ${ob.learned.length} new learning(s) saved to the corpus`)
  }

  console.error(`\n=== fleet done: ${workers.filter((w) => !w.error).length}/${n} workers ok · ${totalLearned} learnings banked → run again to apply them ===`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
