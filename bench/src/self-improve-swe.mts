/**
 * PHASE-1 closed self-improve loop over the REAL SWE Docker judge:
 * generate → drive → grade → promote → compose, in ONE `runLifecycle` call.
 *
 * The one previously-missing piece is `sweEvalRunner` (the lifecycle's
 * `EvalRunner` for the SWE domain): it drives each pinned Verified instance
 * with the multi-turn atom (`runAgentic` + refine) under the profile's prompt,
 * captures the `git diff`, and grades it with the swebench Docker judge held
 * OUTSIDE the agent. This driver wires it to `runLifecycle` with the shipped
 * `promptGenerator` (one deterministic candidate instruction injected through
 * its `refine` seam) and `thresholdPromotionGate(0)`, then prints the baseline
 * composite, each candidate's measured delta, and the composed profile.
 *
 *   IN  (env):  HOLDOUT_IDS=<comma-separated Verified instance ids>,
 *               WORKER_MODEL, MAX_TOKENS, ROUTER_BASE, TANGLE_API_KEY,
 *               INNER_TURNS, BUDGET, RUN_TOOL
 *   OUT (fd1):  baseline composite, per-candidate scoreDelta/promoted, the
 *               composed profile's prompt surface
 *   diagnostics go to STDERR.
 *
 * SMOKE=1 → import/wiring check only: the module graph (this file +
 * swe-bench-env + lifecycle incl. sweEvalRunner) loaded; print READY on stderr
 * and exit 0 WITHOUT a clone / model call / dataset read.
 */
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  composeProfile,
  promptGenerator,
  runLifecycle,
  sweEvalRunner,
  thresholdPromotionGate,
} from '@tangle-network/agent-runtime/lifecycle'
import { createSweBenchEnvironment, SWE_SEED_PROMPT, SWE_SEED_PROMPT_WITH_RUN } from './swe-bench-env'

async function main(): Promise<void> {
  const smoke = ['1', 'true', 'yes'].includes((process.env.SMOKE ?? '').toLowerCase())
  if (smoke) {
    console.error('SMOKE ok: self-improve-swe + swe-bench-env + lifecycle (sweEvalRunner) import graph loaded')
    return
  }

  const routerKey = process.env.TANGLE_API_KEY
  if (!routerKey) throw new Error('TANGLE_API_KEY required (the worker calls the router)')
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const model = process.env.WORKER_MODEL ?? 'google/gemini-2.5-flash-lite'
  const ids = (process.env.HOLDOUT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (ids.length === 0) throw new Error('HOLDOUT_IDS required (comma-separated Verified instance ids)')
  const innerTurns = Number(process.env.INNER_TURNS ?? 12)
  const maxTokens = Number(process.env.MAX_TOKENS ?? 12000)
  const budget = Number(process.env.BUDGET ?? 1)
  const enableRun = ['1', 'true', 'yes'].includes((process.env.RUN_TOOL ?? '').toLowerCase())

  const { environment, adapter } = await createSweBenchEnvironment(ids.length, { ids, enableRun })
  const pool = await adapter.loadTasks({ ids, split: 'test' })
  const missing = ids.filter((id) => !pool.some((t) => t.id === id))
  if (missing.length) throw new Error(`self-improve-swe: not in Verified: ${missing.join(', ')}`)

  const seedPrompt = enableRun ? SWE_SEED_PROMPT_WITH_RUN : SWE_SEED_PROMPT
  const evalRunner = sweEvalRunner({
    environment,
    tasks: pool,
    judge: (task, patch) => adapter.judge(task, patch),
    seedPrompt,
    routerBaseUrl,
    routerKey,
    model,
    maxTokens,
    innerTurns,
    budget,
  })

  const baseline: AgentProfile = { name: 'swe-baseline', prompt: { systemPrompt: seedPrompt } }

  // ONE deterministic candidate through the shipped generator's injected-refine
  // seam — the smallest real population that exercises the whole loop.
  const generator = promptGenerator({
    refine: () => [
      {
        instruction:
          'Before your first edit, state a one-line root-cause hypothesis naming the exact file and ' +
          'function you believe is at fault; if a later read_file contradicts it, revise the hypothesis ' +
          'before editing further.',
        label: 'root-cause-hypothesis-first',
        rationale:
          'Weak workers patch the first plausible site they read; forcing a named hypothesis before the ' +
          'first edit targets the wrong-file/wrong-function failure mode.',
      },
    ],
  })

  const t0 = Date.now()
  const out = await runLifecycle({
    baseline,
    domain: 'swe',
    generators: [generator],
    evalRunner,
    gate: thresholdPromotionGate(0),
  })

  console.log(
    `baseline composite=${out.baselineResult.composite.toFixed(4)} ` +
      `costUsd=${out.baselineResult.costUsd.toFixed(4)} (n=${pool.length} instances)`,
  )
  for (const o of out.outcomes) {
    console.log(
      `candidate "${o.artifact.name}" [${o.artifact.id}] kind=${o.kind} ` +
        `scoreDelta=${o.scoreDelta.toFixed(4)} costDelta=${o.costDelta.toFixed(4)} ` +
        `promoted=${o.promoted} (${o.verdict.reason})`,
    )
  }
  console.log(`promoted=[${out.promoted.join(', ')}]`)

  const composed = composeProfile(out.registry, baseline, { kind: 'prompt' })
  console.log(
    `composed profile: systemPrompt=${(composed.prompt?.systemPrompt ?? '').length}b ` +
      `instructions=${JSON.stringify(composed.prompt?.instructions ?? [])}`,
  )
  console.error(`[self-improve-swe] done in ${Math.round((Date.now() - t0) / 1000)}s`)
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
