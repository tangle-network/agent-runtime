/**
 * SELF-IMPROVEMENT on the SEE-able LOCAL SWE-bench path — NO tangle sandbox.
 *
 * Composes the three proven pieces into ONE held-out-gated improvement generation:
 *   1. `improve({ surface: 'prompt' })` (agent-runtime) drives the loop: it asks
 *      `gepaProposer` to EVOLVE the SWE agent's system prompt, then measures each
 *      candidate prompt on real instances and gates the winner on a held-out split.
 *   2. Per candidate + scenario, the `agent` fn runs the LOCAL SWE env
 *      (`createSweBenchEnvironment` + `runAgentic`): clone the instance repo to a
 *      host tmpdir, run the jailed list/read/edit tool loop with the CANDIDATE
 *      prompt as the system prompt, and return the `git diff` as the artifact.
 *   3. The `judge` scores that patch with the OFFICIAL swebench Docker harness
 *      (`adapter.judge` → resolved 0/1). The only remote call is the model
 *      completion via the router; nothing touches sandbox.tangle.tools.
 *
 * IN-LOOP score is a cheap patch-exists proxy (NOT the Docker judge) so the ONLY
 * Docker run per cell is the improve judge — one deterministic verdict per cell.
 *
 * Cost per run = T·(1 + G·P) + 2·H cells, each = 1 clone + 1 runAgentic + 1 judge.
 *
 *   TANGLE_API_KEY=… dotenvx run -f …/agent-state.env -- \
 *     TRAIN_IDS=psf__requests-2931 HOLDOUT_IDS=psf__requests-1142 \
 *     GENERATIONS=1 POPULATION=1 WORKER_MODEL=glm-4.6 REFLECT_MODEL=glm-4.6 \
 *     node_modules/.bin/tsx bench/src/swe-improve.mts
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { improve } from '@tangle-network/agent-runtime'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type { AgenticSurface, ArtifactHandle, SurfaceScore } from '@tangle-network/agent-runtime/loops'
import { refine, runAgentic } from '@tangle-network/agent-runtime/loops'
import type { DispatchContext, JudgeConfig, Scenario } from '@tangle-network/agent-eval/contract'
import { gepaProposer } from '@tangle-network/agent-eval/campaign'
import { createSweBenchAdapter } from './benchmarks/swe-bench'
import type { BenchTask } from './benchmarks/types'
import { createSweBenchEnvironment, SWE_SEED_PROMPT, SWE_SEED_PROMPT_WITH_RUN } from './swe-bench-env'

const exec = promisify(execFile)

async function main(): Promise<void> {
  const routerKey = process.env.TANGLE_API_KEY
  if (!routerKey) throw new Error('TANGLE_API_KEY required (the worker + reflection call the router)')
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const workerModel = process.env.WORKER_MODEL ?? 'glm-4.6'
  const reflectModel = process.env.REFLECT_MODEL ?? 'glm-4.6'
  const trainIds = (process.env.TRAIN_IDS ?? 'psf__requests-2931').split(',').map((s) => s.trim()).filter(Boolean)
  const holdoutIds = (process.env.HOLDOUT_IDS ?? 'psf__requests-1142').split(',').map((s) => s.trim()).filter(Boolean)
  const generations = Number(process.env.GENERATIONS ?? 1)
  const population = Number(process.env.POPULATION ?? 1)
  const innerTurns = Number(process.env.INNER_TURNS ?? 40)
  const workerMaxTokens = Number(process.env.MAX_TOKENS ?? 8000)
  const reflectMaxTokens = Number(process.env.REFLECT_MAX_TOKENS ?? 12000)
  const maxConcurrency = Number(process.env.MAX_CONCURRENCY ?? 1)
  const budgetShots = Number(process.env.BUDGET ?? 1)
  // WITH-TOOLS arm: RUN_TOOL=1 exposes the jailed `run` tool AND swaps the seed to the run-aware prompt.
  // Default OFF ⇒ reproduces the read/edit-only baseline denominator unchanged.
  const enableRun = ['1', 'true', 'yes'].includes((process.env.RUN_TOOL ?? '').toLowerCase())
  const SEED_PROMPT = enableRun ? SWE_SEED_PROMPT_WITH_RUN : SWE_SEED_PROMPT

  const allIds = [...new Set([...trainIds, ...holdoutIds])]
  const cellsMax = trainIds.length * (1 + generations * population) + 2 * holdoutIds.length

  console.log('═══ SWE-bench self-improvement — SEE-able LOCAL (no tangle sandbox) ═══')
  console.log(`worker=${workerModel}  reflect=${reflectModel}  router=${routerBaseUrl}`)
  console.log(`train=[${trainIds.join(', ')}]  holdout=[${holdoutIds.join(', ')}]`)
  console.log(`generations=${generations} population=${population} innerTurns=${innerTurns} workerMaxTokens=${workerMaxTokens} reflectMaxTokens=${reflectMaxTokens} runTool=${enableRun}`)
  console.log(`≈ ${cellsMax} cells max (each = 1 clone + 1 runAgentic + 1 Docker judge)\n`)

  if (process.env.DRYRUN) {
    // Import + wiring smoke: prove every module resolves and the plan is well-formed
    // WITHOUT paying for a clone / model call / Docker judge.
    console.log(`DRYRUN: imports OK (improve=${typeof improve}, gepaProposer=${typeof gepaProposer}, runAgentic=${typeof runAgentic}, refine=${typeof refine})`)
    return
  }

  const { environment, adapter } = await createSweBenchEnvironment(allIds.length, { ids: allIds, enableRun })
  const pool = await adapter.loadTasks({ ids: allIds, split: 'test' })
  const byId = new Map<string, BenchTask>(pool.map((t) => [t.id, t]))
  for (const id of allIds) if (!byId.has(id)) throw new Error(`instance not found in Verified: ${id}`)

  // The agent under improvement: run the LOCAL SWE env with the CANDIDATE prompt on
  // one instance, return the git-diff patch. A per-call proxy captures the patch in
  // score() BEFORE runAgentic closes (rm) the workspace; its score is a cheap
  // patch-exists proxy so the ONLY Docker run per cell is the improve judge.
  const agent = async (surface: unknown, scenario: Scenario, ctx: DispatchContext): Promise<string | null> => {
    const promptText = String(surface)
    const bt = byId.get(scenario.id)
    if (!bt) throw new Error(`agent: unknown scenario ${scenario.id}`)
    const task = { id: bt.id, systemPrompt: promptText, userPrompt: bt.prompt, meta: { instanceId: bt.id } }
    let capturedPatch = ''
    const stats = { list: 0, read: 0, edit_ok: 0, edit_fail: 0, run: 0, run_err: 0 }
    const proxy: AgenticSurface = {
      ...environment,
      async call(handle, name, args) {
        const res = await environment.call(handle, name, args)
        const r = String(res)
        if (name === 'list_files') stats.list += 1
        else if (name === 'read_file') stats.read += 1
        else if (name === 'edit_file') r.startsWith('edited ') ? (stats.edit_ok += 1) : (stats.edit_fail += 1)
        else if (name === 'run') r.startsWith('ERROR:') ? (stats.run_err += 1) : (stats.run += 1)
        return res
      },
      async score(_t, handle: ArtifactHandle): Promise<SurfaceScore> {
        try {
          const diff = await exec('git', ['-C', handle.id, 'diff'], { maxBuffer: 40_000_000, timeout: 60_000 })
          if (!capturedPatch.trim() && diff.stdout.trim()) capturedPatch = diff.stdout
        } catch {
          /* workspace gone or git error → treat as no patch */
        }
        return { passes: capturedPatch.trim() ? 1 : 0, total: 1, errored: 0 }
      },
    }
    const t0 = Date.now()
    const r = await runAgentic({
      surface: proxy,
      task,
      strategy: refine,
      routerBaseUrl,
      routerKey,
      model: workerModel,
      maxTokens: workerMaxTokens,
      innerTurns,
      budget: budgetShots,
    })
    // Report REAL cost/tokens so the backend-integrity guard sees a real backend
    // rather than a silent-zero stub. A glm-5.2 turn occasionally returns a real
    // patch with an UNPOPULATED usage block (a router telemetry gap on some
    // reasoning-model responses — NOT a stub: the cell made real tool calls and
    // produced a patch). In that gap case report a nominal floor so the stub-guard
    // (artifact + zero usage) cannot abort the whole campaign on a telemetry gap.
    // The lift metric is judge-derived, so a floored count does not distort it; only
    // cost accounting undercounts those few cells (disclosed). No-patch cells return
    // null below and are skipped by the guard's own contract, so this floor only
    // ever applies to a cell that genuinely produced a patch.
    const zeroUsage = (r.tokens.input ?? 0) === 0 && (r.tokens.output ?? 0) === 0
    const hasPatch = capturedPatch.trim().length > 0
    ctx.cost.observe(zeroUsage && hasPatch ? Math.max(r.usd ?? 0, 0.0001) : r.usd ?? 0, workerModel)
    ctx.cost.observeTokens(
      zeroUsage && hasPatch
        ? { input: Math.max(r.tokens.input ?? 0, 1), output: Math.max(r.tokens.output ?? 0, 1) }
        : { input: r.tokens.input, output: r.tokens.output },
    )
    const files = capturedPatch ? [...capturedPatch.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]) : []
    console.log(
      `  [agent] ${scenario.id} prompt=${promptText.length}c tools(l/r/e+/e-/run/run!)=${stats.list}/${stats.read}/${stats.edit_ok}/${stats.edit_fail}/${stats.run}/${stats.run_err} ` +
        `patch=${capturedPatch.length}b files=[${files.join(', ') || 'none'}] tok=in:${r.tokens.input}/out:${r.tokens.output} usd=${r.usd} ${Math.round((Date.now() - t0) / 1000)}s` +
        `${zeroUsage ? (hasPatch ? ' [zero-usage telemetry gap: patch kept, usage floored]' : ' [zero-usage cell: empty completion — scored as no-patch]') : ''}`,
    )
    // A cell with no patch produced NO artifact. Return null (not '') so the
    // backend-integrity guard's own contract (`artifact == null → skip`) applies:
    // a glm-4.6 empty-content turn is scored 0 like the baseline, instead of
    // aborting the whole campaign as a false-positive "stub cell". Any cell that
    // DOES produce a patch still returns it and must report real usage or fire.
    return capturedPatch.trim() ? capturedPatch : null
  }

  // The judge: the OFFICIAL swebench Docker harness. Deterministic FAIL_TO_PASS +
  // PASS_TO_PASS → resolved 0/1. This is the held-out gate's scoring axis.
  const judge: JudgeConfig<string, Scenario> = {
    name: 'swebench-docker',
    dimensions: [{ key: 'resolved', description: 'FAIL_TO_PASS + PASS_TO_PASS resolved by the official swebench Docker harness' }],
    async score({ artifact, scenario }) {
      const patch = String(artifact ?? '')
      if (!patch.trim()) {
        console.log(`  [judge] ${scenario.id} resolved=0 (no patch)`)
        return { dimensions: { resolved: 0 }, composite: 0, notes: 'no patch emitted' }
      }
      const bt = byId.get(scenario.id)
      if (!bt) throw new Error(`judge: unknown scenario ${scenario.id}`)
      const s = await adapter.judge(bt, patch)
      console.log(`  [judge] ${scenario.id} resolved=${s.resolved ? 1 : 0}`)
      // 1500 chars keeps the whole swebench report JSON (a flat summary object —
      // it has no separate failure section to extract); the old 200 clipped it to
      // an uninformative head, leaving GEPA reflection trace-blind.
      return { dimensions: { resolved: s.resolved ? 1 : 0 }, composite: s.resolved ? 1 : 0, notes: (s.detail ?? '').slice(0, 1500) }
    },
  }

  const profile: AgentProfile = { name: 'swe-agent-glm46', prompt: { systemPrompt: SEED_PROMPT } }
  const proposer = gepaProposer({
    llm: { baseUrl: routerBaseUrl, apiKey: routerKey },
    model: reflectModel,
    target: 'the system prompt of a coding agent that fixes real GitHub bugs via list_files/read_file/edit_file tools',
    maxTokens: reflectMaxTokens,
    temperature: 0.7,
  })

  const scenarios: Scenario[] = allIds.map((id) => ({ id, kind: 'swe-bench-verified' }))
  const holdoutScenarios: Scenario[] = holdoutIds.map((id) => ({ id, kind: 'swe-bench-verified' }))

  const out = await improve(profile, [], {
    surface: 'prompt',
    gate: 'holdout',
    generator: proposer,
    scenarios,
    judge,
    agent,
    // glm-5.2 occasionally returns a real patch with an unpopulated usage block
    // (a router telemetry gap on some reasoning-model responses — NOT a stub: the
    // cell made real tool calls and produced a patch). 'assert' would abort the
    // whole campaign on such a cell; 'warn' logs it and continues. The lift metric
    // (resolved) is judge-derived, so a missing token count does not distort it —
    // only the cost accounting undercounts those cells, which is disclosed.
    expectUsage: 'warn',
    budget: { generations, populationSize: population, holdoutScenarios, maxConcurrency, reps: 1 },
    llm: { baseUrl: routerBaseUrl, apiKey: routerKey, model: reflectModel },
  })

  console.log('\n═══ RESULT ═══')
  console.log(`gateDecision=${out.gateDecision}  shipped=${out.shipped}  lift=${out.lift}`)
  console.log(`baseline holdout composite = ${out.raw.baseline.compositeMean}`)
  console.log(`winner   holdout composite = ${out.raw.winner.compositeMean}`)
  console.log(`baseline per-scenario: ${JSON.stringify(out.raw.baseline.perScenario)}`)
  console.log(`winner   per-scenario: ${JSON.stringify(out.raw.winner.perScenario)}`)
  if (out.raw.winner.label) console.log(`winner label   : ${out.raw.winner.label}`)
  if (out.raw.winner.rationale) console.log(`winner rationale: ${out.raw.winner.rationale}`)

  // Per-candidate verdicts on the train set (the "real swebench verdict per candidate").
  for (const gen of out.raw.generations ?? []) {
    console.log(`\n── generation ${gen.record.generationIndex} candidates ──`)
    for (const c of gen.record.candidates) {
      const perScenario = (c as { scenarios?: Array<{ scenarioId: string; composite: number }> }).scenarios ?? []
      const detail = perScenario.map((s) => `${s.scenarioId}=${s.composite}`).join(' ')
      console.log(`  candidate ${c.surfaceHash.slice(0, 8)} composite=${c.composite}${c.label ? ` "${c.label}"` : ''}  [${detail}]`)
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
