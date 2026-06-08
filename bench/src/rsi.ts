/**
 * The RSI driver experiment, instantiated. The whole thing in one file: pick a
 * benchmark adapter, pick the steer POLICIES (the arms), run them through the one
 * flow at equal compute, read the result. Everything else is the library
 * (src/experiment.ts). Adding a benchmark is one import; adding a policy is one
 * steer function.
 *
 *   BENCH=swe-bench N=20 ROUNDS=3 tsx src/rsi.ts
 *
 * Caveat: `blind`/`random` are independent fresh attempts (the compute control).
 * A `continue` / "build on your prior work" policy is only meaningful with
 * CONTINUED-SESSION execution (the kernel reusing one box across turns); the loop
 * is fresh-box-per-attempt today, so it would degrade to a re-attempt. The
 * prompt-steering policies below (critical-audit, aggressive-push) are live now.
 */
import { createExecutor, inlineSandboxClient, type SandboxClient } from '@tangle-network/agent-runtime/loops'
import { Sandbox } from '@tangle-network/sandbox'
import { ADAPTERS } from './adapters'
import { type Arm, analystArm, arm, llmAnalyst, randomArm, runExperiment, sandboxAgentRun } from './experiment'

const must = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`env ${k} is required`)
  return v
}

async function main() {
  const make = ADAPTERS[process.env.BENCH ?? 'swe-bench']
  if (!make) throw new Error(`unknown BENCH=${process.env.BENCH} (have: ${Object.keys(ADAPTERS).join(', ')})`)
  const adapter = make()
  const model = process.env.WORKER_MODEL ?? 'gpt-5'
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('TANGLE_API_KEY')
  const rounds = Number(process.env.ROUNDS ?? 3)
  const router = { routerBaseUrl, routerKey, model }
  // BACKEND=router runs the worker OFF-BOX (a router chat-completion as the leaf
  // executor, presented as a SandboxClient) — the real runLoop kernel + analyst
  // steering, no sandbox dependency. Use it for deployable-checker domains whose
  // worker is a completion (humaneval) or where box egress to the router is blocked.
  // Default `sandbox` is the in-box agent (coding/tool domains).
  const backend = process.env.BACKEND ?? 'sandbox'
  const client: SandboxClient =
    backend === 'router'
      ? inlineSandboxClient(createExecutor({ backend: 'router', routerBaseUrl, routerKey, model }))
      : new Sandbox({
          baseUrl: process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools',
          apiKey: routerKey,
          timeoutMs: 1_200_000,
        } as never)

  // The steer policies under test. Each is an arm = a steer f(rootPrompt, history).
  // Labels follow corpus-report's contract: the `random*` family is the compute
  // control; `refine*` families are the steering arms it pairs against it (so
  // `tsx src/corpus-report.mts <corpus>` emits the paired-bootstrap + BH verdict).
  const policies: [Arm, ...Arm[]] = [
    randomArm('random'), // compute control: independent retries, no steer
    analystArm('refineAudit', llmAnalyst(router)), // observe→steer: audit the prior attempt's trace, steer on the findings
    arm('refinePush', (root, _h, r) =>
      r === 0 ? root : `${root}\n\nShip the most complete working end-to-end result NOW. Prefer done over polish; finish it.`),
  ]

  const corpus = process.env.CORPUS ?? `${process.cwd()}/corpus/rsi-${adapter.name}.jsonl`
  // Optional in-box web-search provider pin (research benches): SEARCH=you|exa|… sets
  // TANGLE_SEARCH_DEFAULT_PROVIDER in the box; EXA_API_KEY (if set) keys opencode-native exa.
  const searchEnv: Record<string, string> = {}
  if (process.env.SEARCH && process.env.SEARCH !== 'default' && process.env.SEARCH !== 'off') searchEnv.TANGLE_SEARCH_DEFAULT_PROVIDER = process.env.SEARCH
  if (process.env.EXA_API_KEY) searchEnv.EXA_API_KEY = process.env.EXA_API_KEY
  const r = await runExperiment({
    adapter,
    sandboxClient: client,
    agentRun: sandboxAgentRun({ model, routerBaseUrl, routerKey, ...(Object.keys(searchEnv).length ? { env: searchEnv } : {}) }),
    arms: policies,
    model,
    rounds,
    n: Number(process.env.N ?? 10),
    ids: process.env.IDS ? process.env.IDS.split(',') : undefined,
    concurrency: Number(process.env.CONCURRENCY ?? 3),
    ...(adapter.output ? { output: adapter.output } : {}),
    corpusPath: corpus,
  })

  const pct = (x: number) => (r.n > 0 ? `${((x / r.n) * 100).toFixed(1)}%` : 'n/a')
  console.log(`\n=== ${adapter.name}: ${r.arms.length} policies x rounds=${rounds} (clean n=${r.n}, excluded ${r.errored}) ===`)
  console.log(`  blind (1 attempt): ${pct(r.blind)}`)
  for (const a of r.arms) {
    const tag = a.label === r.arms[0]?.label ? '  <- compute control' : `  delta vs control ${((a.deltaVsControl / Math.max(r.n, 1)) * 100).toFixed(1)}pp`
    console.log(`  ${a.label}@${rounds}: ${pct(a.resolved)}${tag}`)
  }
  console.log(`corpus: ${corpus}  ->  paired CI + BH via: tsx src/corpus-report.mts ${corpus}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
