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
import { type ExecutorConfig, supervise } from '@tangle-network/agent-runtime/kernel'

async function main(): Promise<void> {
  const routerBaseUrl = process.env.TANGLE_ROUTER_URL ?? 'https://router.tangle.tools/v1'
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
    tools: [],
    executeToolCall: (name) => Promise.resolve(`unknown tool ${name}`),
  }

  const result = await supervise(
    {
      name: 'supervisor',
      harness: 'cli-base', // in-process router brain (the supervisor calls spawn/await/stop)
      model: { provider: 'tangle-router', default: model },
      tools: {
        agent_runtime_coordination_spawn_worker: true,
        agent_runtime_coordination_await_event: true,
        agent_runtime_coordination_stop: true,
      },
      prompt: {
        systemPrompt:
          'You are a supervisor. Produce the deliverable by delegating:\n' +
          '1. Call spawn_worker with a worker profile and the task.\n' +
          `   The worker profile must use harness="cli-base", model.provider="tangle-router", ` +
          `model.default=${JSON.stringify(model)}, and model.metadata.maxTurns=6.\n` +
          '2. Then call await_event and WAIT for that worker to settle — never call stop while a ' +
          'worker is still running, or its result is lost.\n' +
          '3. Once a worker has delivered, call stop.\n' +
          "Do not answer the task yourself — only a spawned worker's output counts as delivered.",
      },
    },
    'Produce the exact line: READY',
    {
      budget: { maxIterations: 50, maxTokens: 500_000, maxUsd: 0.5 },
      router: { routerBaseUrl, routerKey }, // the supervisor's own transport
      backend, // where the workers run
      // The completion oracle: "delivered" means a real check passed against the worker's OUTPUT,
      // not the supervisor's say-so. A `router-tools` worker settles `{ content: string }`, so read
      // the field — `String(out)` would stringify the wrapper to `[object Object]` and never match.
      deliverable: {
        check: (out) => String((out as { content?: unknown })?.content ?? out).includes('READY'),
        describe: 'output is READY',
      },
    },
  )

  // Report the real outcome: the delivered output on a win, or the typed reason + spend on a
  // no-winner, so a failure explains itself instead of printing a bare "no winner".
  if (result.kind === 'winner') {
    console.log(`[OK] delivered: ${JSON.stringify(result.out)}`)
  } else {
    const { tokens } = result.spentTotal
    console.log(
      `[--] no winner (${result.reason}) — ${result.downCount} child(ren) down, ` +
        `spent ${tokens.input + tokens.output} tokens / $${result.spentTotal.usd.toFixed(4)}`,
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
