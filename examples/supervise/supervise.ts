/**
 * The one-call supervisor — `supervise(profile, task, opts)`.
 *
 * Author a supervisor PROFILE (its standing instructions + which harness drives its brain) and a
 * goal; `supervise` defaults the scaffolding (blobs / perWorker / journal / executors / maxDepth) and
 * runs it. The brain is resolved from `profile.harness`: `null` → the in-process router tool-loop;
 * `'opencode'`/`'claude-code'`/`'codex'` → a sandboxed harness driving the coordination verbs.
 *
 * Run:  TANGLE_API_KEY=<router key>  pnpm tsx examples/supervise/supervise.ts
 */
import { type ExecutorConfig, supervise } from '@tangle-network/agent-runtime/loops'

const routerBaseUrl = process.env.TANGLE_ROUTER_URL ?? 'https://router.tangle.tools'
const routerKey = process.env.TANGLE_API_KEY
if (!routerKey) throw new Error('set TANGLE_API_KEY (your Tangle router key)')
const model = process.env.MODEL ?? 'gemini-2.5-pro'

// WHERE the workers run. Swap this one value to change the worker backend — e.g.
// `{ backend: 'sandbox', harness: 'opencode', sandboxClient }` runs each worker as a real coding
// harness in a box. Here: off-box router tool-using agents, no custom tools for the demo.
const backend: ExecutorConfig = {
  backend: 'router-tools',
  routerBaseUrl,
  routerKey,
  model,
  tools: [],
  executeToolCall: (name) => Promise.resolve(`unknown tool ${name}`),
  maxTurns: 6,
}

const result = await supervise(
  {
    name: 'supervisor',
    harness: null, // router brain (the supervisor reasons spawn/await/stop over the router's tool-calling)
    systemPrompt:
      'You are a supervisor. Spawn a worker with spawn_agent to produce the required output, ' +
      'await it with await_event, and stop once a worker delivered. Do not answer the task yourself.',
  },
  'Produce the exact line: READY',
  {
    budget: { maxIterations: 50, maxTokens: 500_000, maxUsd: 0.5 },
    router: { routerBaseUrl, routerKey, model }, // the supervisor's own brain
    backend, // where the workers run
    // Strongly recommended in production: a completion oracle so "delivered" means a real check passed.
    //   deliverable: { check: async (out) => String(out).includes('READY'), describe: 'output is READY' },
  },
)

console.log(result.kind === 'winner' ? '[OK] delivered' : `[--] no winner (${result.kind})`)
