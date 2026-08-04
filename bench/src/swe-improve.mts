/**
 * Official GEPA prompt optimization on the local SWE-bench path.
 *
 * Composes three pieces:
 *   1. `improve({ method: officialGepa(...) })` runs GEPA's upstream
 *      Optimize Anything engine on explicit train and selection partitions.
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
 *   TANGLE_API_KEY=... dotenvx run -f .../agent-state.env -- \
 *     TRAIN_IDS=psf__requests-2931 SELECTION_IDS=pallets__flask-5014 \
 *     TEST_IDS=psf__requests-1142,psf__requests-1921 \
 *     MAX_EVALUATIONS=4 MAX_PROPOSER_COST_USD=2 \
 *     node_modules/.bin/tsx bench/src/swe-improve.mts
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  improve,
  officialGepa,
  type ReadonlyAgentProfile,
} from '@tangle-network/agent-runtime'
import {
  canonicalCandidateDigest,
  agentProfileSchema,
  type AgentProfile,
} from '@tangle-network/agent-interface'
import type { AgenticSurface, ArtifactHandle, SurfaceScore } from '@tangle-network/agent-runtime/kernel'
import { defaultAnalystInstruction, refine, runAgentic } from '@tangle-network/agent-runtime/kernel'
import type { DispatchContext, JudgeConfig, Scenario } from '@tangle-network/agent-eval/contract'
import { createSweBenchAdapter } from './benchmarks/swe-bench'
import type { BenchTask } from './benchmarks/types'
import {
  assertCompleteCost,
  officialOptimizerModel,
  requiredTokenPricing,
} from './official-optimizer-config.mjs'
import { createSweBenchEnvironment, SWE_SEED_PROMPT, SWE_SEED_PROMPT_WITH_RUN } from './swe-bench-env'
import { benchRouterProfile, withBenchProfile } from './router-turn'

const exec = promisify(execFile)

async function main(): Promise<void> {
  const routerKey = process.env.TANGLE_API_KEY
  if (!routerKey) throw new Error('TANGLE_API_KEY required (the worker + reflection call the router)')
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const workerModel = process.env.WORKER_MODEL ?? 'glm-4.6'
  const reflectBase = process.env.REFLECT_BASE ?? routerBaseUrl
  const reflectKey = process.env.REFLECT_KEY ?? routerKey
  const reflectModel = process.env.REFLECT_MODEL ?? 'glm-4.6'
  const trainIds = (process.env.TRAIN_IDS ?? 'psf__requests-2931').split(',').map((s) => s.trim()).filter(Boolean)
  const selectionIds = (process.env.SELECTION_IDS ?? 'pallets__flask-5014').split(',').map((s) => s.trim()).filter(Boolean)
  const testIds = (process.env.TEST_IDS ?? 'psf__requests-1142,psf__requests-1921').split(',').map((s) => s.trim()).filter(Boolean)
  const maxEvaluations = Number(process.env.MAX_EVALUATIONS ?? 4)
  const maxProposerCostUsd = Number(process.env.MAX_PROPOSER_COST_USD ?? 2)
  const innerTurns = Number(process.env.INNER_TURNS ?? 40)
  const workerMaxTokens = Number(process.env.MAX_TOKENS ?? 8000)
  const reflectMaxTokens = Number(process.env.REFLECT_MAX_TOKENS ?? 12000)
  const maxConcurrency = Number(process.env.MAX_CONCURRENCY ?? 1)
  const budgetShots = Number(process.env.BUDGET ?? 1)
  const runDir = process.env.RUN_DIR ?? '.runs/swe-official-gepa'
  // WITH-TOOLS arm: RUN_TOOL=1 exposes the jailed `run` tool AND swaps the seed to the run-aware prompt.
  // Default OFF ⇒ reproduces the read/edit-only baseline denominator unchanged.
  const enableRun = ['1', 'true', 'yes'].includes((process.env.RUN_TOOL ?? '').toLowerCase())
  const SEED_PROMPT = enableRun ? SWE_SEED_PROMPT_WITH_RUN : SWE_SEED_PROMPT
  const allIds = [...new Set([...trainIds, ...selectionIds, ...testIds])]
  const workerProfile = withBenchProfile(
    {
      name: 'swe-agent-worker',
      harness: 'cli-base',
      model: { provider: 'tangle-router', default: workerModel },
      tools: {
        list_files: true,
        read_file: true,
        edit_file: true,
        ...(enableRun ? { run: true } : {}),
      },
    },
    { systemPrompt: SEED_PROMPT, maxTokens: workerMaxTokens, maxTurns: innerTurns },
  )
  const analystProfile = benchRouterProfile('swe-agent-analyst', workerModel, {
    systemPrompt: defaultAnalystInstruction,
    maxTokens: workerMaxTokens,
  })

  console.log('=== SWE-bench prompt optimization with official GEPA ===')
  console.log(`worker=${workerModel} reflect=${reflectModel} router=${routerBaseUrl}`)
  console.log(`train=[${trainIds.join(', ')}] selection=[${selectionIds.join(', ')}] test=[${testIds.join(', ')}]`)
  console.log(`maxEvaluations=${maxEvaluations} maxProposerCostUsd=${maxProposerCostUsd} innerTurns=${innerTurns} workerMaxTokens=${workerMaxTokens} runTool=${enableRun}`)
  console.log(`runDir=${runDir}\n`)

  if (process.env.DRYRUN) {
    // Import + wiring smoke: prove every module resolves and the plan is well-formed
    // WITHOUT paying for a clone / model call / Docker judge.
    console.log(`DRYRUN: imports OK (improve=${typeof improve}, officialGepa=${typeof officialGepa}, runAgentic=${typeof runAgentic}, refine=${typeof refine})`)
    return
  }
  const workerPricing = requiredTokenPricing(process.env, 'WORKER')
  const optimizer = officialOptimizerModel({
    env: process.env,
    model: reflectModel,
    baseUrl: reflectBase,
    apiKey: reflectKey,
    maxCostUsd: maxProposerCostUsd,
    maxOutputTokensPerRequest: reflectMaxTokens,
  })

  const { environment, adapter } = await createSweBenchEnvironment(allIds.length, { ids: allIds, enableRun })
  const pool = await adapter.loadTasks({ ids: allIds, split: 'test' })
  const byId = new Map<string, BenchTask>(pool.map((t) => [t.id, t]))
  for (const id of allIds) if (!byId.has(id)) throw new Error(`instance not found in Verified: ${id}`)

  // The agent under improvement: run the LOCAL SWE env with the CANDIDATE prompt on
  // one instance, return the git-diff patch. A per-call proxy captures the patch in
  // score() BEFORE runAgentic closes (rm) the workspace; its score is a cheap
  // patch-exists proxy so the ONLY Docker run per cell is the improve judge.
  const agent = async (candidate: ReadonlyAgentProfile, scenario: Scenario, ctx: DispatchContext): Promise<string | null> => {
    const exactCandidate = agentProfileSchema.parse(candidate)
    const promptText = exactCandidate.prompt?.systemPrompt
    if (promptText === undefined) throw new Error('agent: candidate profile has no system prompt')
    const bt = byId.get(scenario.id)
    if (!bt) throw new Error(`agent: unknown scenario ${scenario.id}`)
    const task = { id: bt.id, userPrompt: bt.prompt, meta: { instanceId: bt.id } }
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
    const paid = await ctx.cost.runPaidCall({
      channel: 'agent',
      actor: 'swe-worker',
      model: workerModel,
      execute: () =>
        runAgentic({
          surface: proxy,
          task,
          strategy: refine,
          routerBaseUrl,
          routerKey,
          workerProfile: exactCandidate,
          analystProfile,
          budget: budgetShots,
        }),
      receipt: (result) => {
        const inputTokens = result.tokens.input ?? 0
        const outputTokens = result.tokens.output ?? 0
        const usageUnknown = inputTokens === 0 && outputTokens === 0
        return {
          model: workerModel,
          inputTokens,
          outputTokens,
          customTokenPricing: workerPricing,
          ...(usageUnknown ? { usageUnknown: true } : {}),
        }
      },
    })
    if (!paid.succeeded) throw paid.error
    const r = paid.value
    const zeroUsage = (r.tokens.input ?? 0) === 0 && (r.tokens.output ?? 0) === 0
    const hasPatch = capturedPatch.trim().length > 0
    const files = capturedPatch ? [...capturedPatch.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]) : []
    console.log(
      `  [agent] ${scenario.id} prompt=${promptText.length}c tools(l/r/e+/e-/run/run!)=${stats.list}/${stats.read}/${stats.edit_ok}/${stats.edit_fail}/${stats.run}/${stats.run_err} ` +
        `patch=${capturedPatch.length}b files=[${files.join(', ') || 'none'}] tok=in:${r.tokens.input}/out:${r.tokens.output} ${Math.round((Date.now() - t0) / 1000)}s` +
        `${zeroUsage ? ' [provider usage unavailable]' : ''}`,
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
  const judge: JudgeConfig<string | null, Scenario> = {
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

  const scenario = (id: string): Scenario => ({ id, kind: 'swe-bench-verified' })

  const out = await improve(workerProfile, {
    surface: 'prompt',
    executionRef: canonicalCandidateDigest({
      callback: 'bench/swe-improve',
      model: workerModel,
      endpoint: new URL(routerBaseUrl).origin,
      innerTurns,
      maxTokens: workerMaxTokens,
      budgetShots,
      enableRun,
    }),
    method: officialGepa<Scenario, string | null>({
      objective:
        'Improve the system prompt of a coding agent that fixes real GitHub bugs with list_files, read_file, edit_file, and optional run tools.',
      background:
        'Return the complete system prompt. Preserve tool names and require evidence from repository files and tests.',
      recipe: {
        kind: 'engine',
        run: {
          engine: 'gepa',
          maxEvaluations,
          maxProposerCostUsd,
        },
      },
      optimizer,
      resume: 'if-compatible',
      trustResumeState: true,
      describeScenario: (item) => ({ prompt: byId.get(item.id)?.prompt ?? item.id }),
    }),
    trainScenarios: trainIds.map(scenario),
    selectionScenarios: selectionIds.map(scenario),
    testScenarios: testIds.map(scenario),
    judges: [judge],
    agent,
    expectUsage: 'warn',
    maxConcurrency,
    reps: 1,
    runDir,
    optimizationRunOptions: {
      expectUsage: 'warn',
      maxConcurrency,
      reps: 1,
    },
  })

  assertCompleteCost('SWE-bench official GEPA run', out.cost)
  console.log('\n=== RESULT ===')
  console.log(`decision=${out.decision} lift=${out.lift} interval=[${out.liftInterval.low}, ${out.liftInterval.high}]`)
  console.log(`baseline test composite=${out.raw.best.baselineComposite}`)
  console.log(`winner test composite=${out.raw.best.winnerComposite}`)
  console.log(`test scenarios=${JSON.stringify(out.raw.best.scenarioScores)}`)
  console.log(`cost=${JSON.stringify(out.cost)}`)
  console.log(`candidate prompt:\n${String(out.candidate.value).slice(0, 2000)}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
