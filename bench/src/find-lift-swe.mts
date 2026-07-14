/**
 * `find-lift-swe` — the MULTI-ROUND research loop over the REAL SWE Docker judge:
 * run → autopsy → evolve → pursue → compose → REPEAT.
 *
 * Where `self-improve-swe.mts` runs ONE generation with a single hardcoded
 * candidate (which scores Δ=0 because a generic instruction targets no real
 * failure), this driver closes the intelligence loop each round:
 *
 *   (a) RUN     — score the CURRENT profile on the held-out set via
 *                 `sweEvalRunner` → composite + per-instance rows.
 *   (b) AUTOPSY — `autopsySweFailures(rows)` reads the FAILING rows, asks a router
 *                 analyst which mechanism each lost to (empty-patch /
 *                 wrong-file-or-function / …) and returns ranked findings,
 *                 dominant mode first (firewall: `derived_from_judge:false`).
 *   (c) EVOLVE + PURSUE — `runLifecycle` measures a population authored FROM those
 *                 findings: `reflectiveSweRefine` sharpens the incumbent toward the
 *                 dominant mode, `authorDiverseSweSeeds` spreads across framings to
 *                 escape a basin. Each candidate's marginal lift is the with/without
 *                 ablation on the same held-out exam, graded by the judge held
 *                 OUTSIDE the agent; `thresholdPromotionGate(0)` promotes any
 *                 positive-lift candidate.
 *   (d) COMPOSE — fold this round's promoted winners onto the current profile with
 *                 `composeProfile` → the profile the NEXT round starts from, so the
 *                 instruction stack accretes only measured wins.
 *
 * The baseline is scored ONCE per round: step (a) scores it to read the failures
 * the autopsy steers from, then that same eval is passed to `runLifecycle` as its
 * `baselineResult` (the shared "without" arm of the with/without ablation), so the
 * identical profile is never re-scored — a full arm of compute saved every round.
 *
 * CONVERGENCE: stop early once a round promotes nothing AND the ranked findings are
 * byte-identical to the prior round's (the loop has nothing new to learn or try);
 * otherwise run `ROUNDS`.
 *
 *   IN  (env):  HOLDOUT_IDS=<comma-separated Verified instance ids> (required),
 *               WORKER_MODEL, REFLECT_MODEL (default = WORKER_MODEL), ROUNDS (3),
 *               POP (3), EVAL_CONCURRENCY (4), BUDGET, INNER_TURNS, MAX_TOKENS,
 *               RUN_TOOL, RUN_DIR (per-round JSON output dir),
 *               ROUTER_BASE, TANGLE_API_KEY
 *   OUT (fd1):  a per-round line + a final trajectory table; per-round JSON under
 *               RUN_DIR/round-<n>.json. Diagnostics → STDERR.
 *
 * SMOKE=1 → import/wiring check only: load the module graph (this file +
 * swe-bench-env + lifecycle incl. sweEvalRunner + the reflective autopsy/proposer),
 * print READY on stderr, exit 0 WITHOUT a clone / model call / dataset read.
 *
 * RUN FROM bench/ (cwd=bench): imports resolve `sweEvalRunner`,
 * `autopsySweFailures`, `reflectiveSweRefine`, `authorDiverseSweSeeds` from THIS
 * worktree's `../src` through bench/tsconfig's path aliases (tsx applies them when
 * cwd is bench). `bench/node_modules` pins the PUBLISHED agent-runtime, which lacks
 * these exports; running from the repo root resolves the published dist and crashes.
 * Use `pnpm --filter ./bench find-lift` (or `cd bench && tsx src/find-lift-swe.mts`).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  authorDiverseSweSeeds,
  autopsySweFailures,
  composeProfile,
  promptGenerator,
  reflectiveSweRefine,
  runLifecycle,
  sweEvalRunner,
  type SweEvalTaskResult,
  thresholdPromotionGate,
} from '@tangle-network/agent-runtime/lifecycle'
import { createSweBenchEnvironment, SWE_SEED_PROMPT, SWE_SEED_PROMPT_WITH_RUN } from './swe-bench-env'

/** The `EvalResult.details` shape `sweEvalRunner` emits (typed `unknown` on the
 *  seam); we read the driven system prompt + the per-instance audit rows. */
interface SweEvalDetails {
  systemPrompt: string
  rows: SweEvalTaskResult[]
}

/** One row of the final trajectory table. */
interface TrajectoryRow {
  round: number
  composite: number
  /** Best PROMOTED marginal lift this round (the realized improvement); 0 when
   *  nothing promoted. */
  lift: number
  promoted: number
  instructions: number
}

async function main(): Promise<void> {
  const smoke = ['1', 'true', 'yes'].includes((process.env.SMOKE ?? '').toLowerCase())
  if (smoke) {
    console.error(
      'SMOKE ok: find-lift-swe + swe-bench-env + lifecycle (sweEvalRunner, autopsySweFailures, reflectiveSweRefine, authorDiverseSweSeeds) import graph loaded — READY',
    )
    return
  }

  const routerKey = process.env.TANGLE_API_KEY
  if (!routerKey) throw new Error('TANGLE_API_KEY required (the worker + analyst call the router)')
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const model = process.env.WORKER_MODEL ?? 'google/gemini-2.5-flash-lite'
  const reflectModel = process.env.REFLECT_MODEL ?? model
  // Train/holdout split — the leak fix. The autopsy reads (and the search
  // optimizes on) the TRAIN failures ONLY; the composed profile is certified on a
  // FROZEN holdout the autopsy never sees, so the reported lift is a genuine
  // generalization number, not in-sample fitting. Both sets required, disjoint.
  const parseIds = (s: string | undefined) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  const trainIds = parseIds(process.env.TRAIN_IDS)
  const holdoutIds = parseIds(process.env.HOLDOUT_IDS)
  if (trainIds.length === 0) throw new Error('TRAIN_IDS required (comma-separated Verified ids the autopsy learns from)')
  if (holdoutIds.length === 0) throw new Error('HOLDOUT_IDS required (comma-separated Verified ids, DISJOINT from TRAIN, for frozen certification)')
  const overlap = trainIds.filter((id) => holdoutIds.includes(id))
  if (overlap.length) throw new Error(`TRAIN_IDS and HOLDOUT_IDS must be DISJOINT — overlap: ${overlap.join(', ')}`)
  const ids = [...trainIds, ...holdoutIds]
  const rounds = Math.max(1, Number(process.env.ROUNDS ?? 3))
  const pop = Math.max(1, Number(process.env.POP ?? 3))
  const concurrency = Math.max(1, Number(process.env.EVAL_CONCURRENCY ?? 4))
  const innerTurns = Number(process.env.INNER_TURNS ?? 12)
  const maxTokens = Number(process.env.MAX_TOKENS ?? 12000)
  const budget = Number(process.env.BUDGET ?? 1)
  const enableRun = ['1', 'true', 'yes'].includes((process.env.RUN_TOOL ?? '').toLowerCase())
  const runDir =
    process.env.RUN_DIR ??
    join(process.cwd(), 'find-lift-runs', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(runDir, { recursive: true })

  const { environment, adapter } = await createSweBenchEnvironment(ids.length, { ids, enableRun })
  const pool = await adapter.loadTasks({ ids, split: 'test' })
  const missing = ids.filter((id) => !pool.some((t) => t.id === id))
  if (missing.length) throw new Error(`find-lift-swe: not in Verified: ${missing.join(', ')}`)
  const trainPool = pool.filter((t) => trainIds.includes(t.id))
  const holdoutPool = pool.filter((t) => holdoutIds.includes(t.id))

  const seedPrompt = enableRun ? SWE_SEED_PROMPT_WITH_RUN : SWE_SEED_PROMPT
  const runnerCfg = {
    environment,
    judge: (task: (typeof pool)[number], patch: string) => adapter.judge(task, patch),
    seedPrompt,
    routerBaseUrl,
    routerKey,
    model,
    maxTokens,
    innerTurns,
    budget,
    concurrency,
  }
  // TRAIN scorer — the search runs here (baseline autopsy + candidate ablation).
  const trainEval = sweEvalRunner({ ...runnerCfg, tasks: trainPool })
  // HOLDOUT scorer — the FROZEN exam. Only ever scores the composed profile +
  // the original baseline; the autopsy never reads these rows, so the lift is real.
  const holdoutEval = sweEvalRunner({ ...runnerCfg, tasks: holdoutPool })

  let currentProfile: AgentProfile = { name: 'swe-find-lift', prompt: { systemPrompt: seedPrompt } }
  const trajectory: TrajectoryRow[] = []
  let prevFindingSignature: string | undefined
  const t0 = Date.now()

  // Frozen-holdout baseline — scored ONCE on the bare profile. Every round's real
  // lift is (composed profile on holdout) − (this), on tasks the autopsy never saw.
  const holdoutBaseline = await holdoutEval(currentProfile)
  {
    const r = (holdoutBaseline.details as Partial<SweEvalDetails> | undefined)?.rows ?? []
    const dead = r.filter((x) => x.tokens.input === 0 && x.tokens.output === 0).length
    if (r.length >= 4 && dead / r.length > 0.5) {
      throw new Error(`dead-worker guard (holdout baseline): ${dead}/${r.length} rollouts 0-token — worker '${model}' down; re-run when recovered`)
    }
  }
  console.error(`[find-lift-swe] frozen holdout baseline = ${(holdoutBaseline.composite * 100).toFixed(1)}% on ${holdoutPool.length} disjoint tasks`)

  for (let round = 1; round <= rounds; round++) {
    // (a) RUN — score the current profile on TRAIN; keep the rows for the autopsy.
    const baselineResult = await trainEval(currentProfile)
    const details = (baselineResult.details ?? {}) as Partial<SweEvalDetails>
    const rows = details.rows ?? []
    const composite = baselineResult.composite

    // FAIL-LOUD DEAD-WORKER GUARD: a real baseline SPENDS tokens even at 0% resolved;
    // a router blip returns 0 completions → 0 tokens, which would silently score every
    // task 0 and produce a FAKE baseline the whole round (autopsy + paid candidate arms)
    // is then measured against. If most rows show zero tokens, the worker is down — abort
    // before spending, rather than bank a fake null. (Router weather is intermittent; a
    // clean retry when the provider recovers is correct, a corrupted scored round is not.)
    const deadRows = rows.filter((r) => r.tokens.input === 0 && r.tokens.output === 0).length
    if (rows.length >= 4 && deadRows / rows.length > 0.5) {
      throw new Error(
        `dead-worker guard: ${deadRows}/${rows.length} baseline rollouts returned 0 tokens ` +
          `(worker '${model}' is erroring — likely a transient router 5xx). Refusing to score a ` +
          `fake-null round. Re-run when the provider recovers.`,
      )
    }

    // (b) AUTOPSY — classify the failing rows into ranked mechanism findings.
    const findings = await autopsySweFailures(rows, {
      baseUrl: routerBaseUrl,
      key: routerKey,
      reflectModel,
      systemPrompt: details.systemPrompt,
    })
    const findingSignature = findings.map((f) => f.claim).join('|')

    // (c) EVOLVE + PURSUE — measure a finding-authored population on the judge.
    // Reuse step (a)'s baseline eval as the shared "without" arm — the profile is
    // identical, so re-scoring it here would burn a full arm of compute for nothing.
    const out = await runLifecycle({
      baseline: currentProfile,
      baselineResult,
      domain: 'swe',
      findings,
      generators: [
        promptGenerator({
          refine: reflectiveSweRefine({
            baseUrl: routerBaseUrl,
            key: routerKey,
            reflectModel,
            populationSize: pop,
          }),
          authorDiverseSeeds: authorDiverseSweSeeds({
            baseUrl: routerBaseUrl,
            key: routerKey,
            reflectModel,
          }),
          diverseSeedCount: pop,
        }),
      ],
      evalRunner: trainEval,
      gate: thresholdPromotionGate(0),
      generation: round - 1,
    })

    // (d) COMPOSE — fold this round's promoted winners onto the current profile.
    const prevInstructionCount = currentProfile.prompt?.instructions?.length ?? 0
    currentProfile = composeProfile(out.registry, currentProfile, { kind: 'prompt' })
    const composedInstructions = currentProfile.prompt?.instructions ?? []

    // (e) CERTIFY on the FROZEN holdout — the real generalization number. But ONLY
    // re-score when the profile actually CHANGED. If nothing promoted this round,
    // the composed profile is byte-identical to what produced `holdoutBaseline`, so
    // a fresh scoring would report pure worker run-to-run VARIANCE as "lift" — a
    // false positive. When unchanged, the lift is 0 by construction; carry the
    // baseline forward and skip the wasted, misleading re-score.
    const profileChanged = composedInstructions.length !== prevInstructionCount
    const holdoutComposed = profileChanged ? await holdoutEval(currentProfile) : holdoutBaseline
    const holdoutLift = holdoutComposed.composite - holdoutBaseline.composite

    const bestOutcome = out.outcomes.reduce<(typeof out.outcomes)[number] | undefined>(
      (best, o) => (best === undefined || o.scoreDelta > best.scoreDelta ? o : best),
      undefined,
    )
    const bestPromotedLift = out.outcomes
      .filter((o) => o.promoted)
      .reduce((mx, o) => Math.max(mx, o.scoreDelta), 0)

    // (f) PERSIST — the round's decision trail, judge-grounded.
    const roundReport = {
      round,
      worker: model,
      analyst: reflectModel,
      trainIds,
      holdoutIds,
      trainComposite: composite,
      holdoutBaselineComposite: holdoutBaseline.composite,
      holdoutComposedComposite: holdoutComposed.composite,
      holdoutLift,
      baselineCostUsd: baselineResult.costUsd,
      findings: findings.map((f) => ({
        area: f.area,
        severity: f.severity,
        claim: f.claim,
        action: f.recommended_action,
        count: f.evidence_refs.length,
      })),
      candidates: out.outcomes.map((o) => ({
        name: o.artifact.name,
        id: o.artifact.id,
        kind: o.kind,
        scoreDelta: o.scoreDelta,
        costDelta: o.costDelta,
        promoted: o.promoted,
        reason: o.verdict.reason,
        rationale: o.artifact.metadata?.rationale,
        instruction: (o.artifact.payload as { instruction?: string }).instruction,
      })),
      promoted: out.promoted,
      composedInstructions,
    }
    writeFileSync(join(runDir, `round-${round}.json`), `${JSON.stringify(roundReport, null, 2)}\n`)

    const hbSign = holdoutLift >= 0 ? '+' : ''
    const holdoutTag = profileChanged
      ? `HOLDOUT ${(holdoutBaseline.composite * 100).toFixed(1)}%→${(holdoutComposed.composite * 100).toFixed(1)}% = ${hbSign}${(holdoutLift * 100).toFixed(1)}pp (real, frozen)`
      : `HOLDOUT lift = 0pp (nothing promoted — profile unchanged; not a measurement)`
    console.log(
      `round ${round}: train=${(composite * 100).toFixed(1)}% search-best=${(bestPromotedLift * 100).toFixed(1)}pp ` +
        `(${out.promoted.length} promoted) -> ${holdoutTag} [instructions=${composedInstructions.length}]`,
    )

    trajectory.push({
      round,
      composite,
      lift: holdoutLift,
      promoted: out.promoted.length,
      instructions: composedInstructions.length,
    })

    // CONVERGENCE — nothing promoted AND the same findings as last round ⇒ the
    // loop has no new mechanism to attack and no candidate beat the incumbent.
    if (out.promoted.length === 0 && findingSignature === prevFindingSignature) {
      console.error(`[find-lift-swe] converged at round ${round} (no promotion, findings unchanged)`)
      break
    }
    prevFindingSignature = findingSignature
  }

  printTrajectory(trajectory)
  console.error(
    `[find-lift-swe] done in ${Math.round((Date.now() - t0) / 1000)}s — per-round JSON in ${runDir}`,
  )
}

/** The final research trajectory: round → composite → realized lift → promoted. */
function printTrajectory(rows: readonly TrajectoryRow[]): void {
  console.log('')
  console.log('trajectory (lift = REAL frozen-holdout lift vs bare baseline):')
  console.log('  round  train%   holdoutLift(pp)  promoted  instructions')
  for (const r of rows) {
    console.log(
      `  ${String(r.round).padStart(5)}  ${(r.composite * 100).toFixed(1).padStart(8)}%  ` +
        `${(r.lift * 100 >= 0 ? '+' : '') + (r.lift * 100).toFixed(1)}`.padStart(8) +
        `  ${String(r.promoted).padStart(8)}  ${String(r.instructions).padStart(12)}`,
    )
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
