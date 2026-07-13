/**
 * PHASE-1 closed self-improve loop over the REAL SWE Docker judge:
 * generate → drive → grade → promote → compose, in ONE `runLifecycle` call.
 *
 * The one previously-missing piece is `sweEvalRunner` (the lifecycle's
 * `EvalRunner` for the SWE domain): it drives each pinned Verified instance
 * with the multi-turn atom (`runAgentic` + refine) under the profile's prompt,
 * captures the `git diff`, and grades it with the swebench Docker judge held
 * OUTSIDE the agent. This driver wires it to `runLifecycle` with
 * `thresholdPromotionGate(0)`, then prints the baseline composite, each
 * candidate's measured delta, and the composed profile.
 *
 * SURFACE picks the candidate surface:
 *   - `prompt` (default): the shipped `promptGenerator` with one deterministic
 *     candidate instruction through its injected-refine seam.
 *   - `mcp` (Phase 3): `buildableGenerator` fans out `worktreeBuildCandidate`
 *     builds of a real MCP server (driver→worker atom via `routerBrain`), each
 *     verified by boot-and-probe (`mcpServeVerifier` inside the build), then
 *     ranked/gated by the SAME `sweEvalRunner` — whose `materializeMcp` path
 *     spawns the built server same-host so its tools are LIVE while scored.
 *
 *   IN  (env):  HOLDOUT_IDS=<comma-separated Verified instance ids>,
 *               WORKER_MODEL, MAX_TOKENS, ROUTER_BASE, TANGLE_API_KEY,
 *               INNER_TURNS, BUDGET, RUN_TOOL, SURFACE=prompt|mcp
 *               SURFACE=mcp also reads: BUILD_REPO_ROOT (required),
 *               MCP_SERVE_COMMAND (required), MCP_SERVE_ARGS, BUILD_BASE_REF,
 *               BUILD_HARNESS, BUILD_FANOUT, BUILD_MAX_SHOTS, DRIVER_MODEL
 *   OUT (fd1):  baseline composite, per-candidate scoreDelta/promoted, the
 *               composed profile's surface
 *   diagnostics go to STDERR.
 *
 * SMOKE=1 → import/wiring check only: the module graph (this file +
 * swe-bench-env + lifecycle incl. sweEvalRunner + the same-host MCP client)
 * loaded; print READY on stderr and exit 0 WITHOUT a clone / model call /
 * dataset read.
 *
 * RUN FROM bench/ (cwd=bench): this driver imports `sweEvalRunner`, which lives
 * in THIS worktree's `../src` and is reachable only through bench/tsconfig's
 * path aliases — tsx applies them when cwd is bench. `bench/node_modules` pins
 * the PUBLISHED agent-runtime (no `sweEvalRunner`), so running from the repo
 * root resolves the published dist and crashes on the missing export. Use the
 * package script `pnpm --filter ./bench self-improve` (or `cd bench && tsx
 * src/self-improve-swe.mts`), never `tsx bench/src/...` from the root.
 */
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  buildableGenerator,
  type CandidateGenerator,
  composeProfile,
  type EvalRunner,
  promptGenerator,
  runLifecycle,
  sweEvalRunner,
  thresholdPromotionGate,
  worktreeBuildCandidate,
  type WorktreeBuildOptions,
} from '@tangle-network/agent-runtime/lifecycle'
import { routerBrain } from '@tangle-network/agent-runtime/loops'
import { createSweBenchEnvironment, SWE_SEED_PROMPT, SWE_SEED_PROMPT_WITH_RUN } from './swe-bench-env'

async function main(): Promise<void> {
  const smoke = ['1', 'true', 'yes'].includes((process.env.SMOKE ?? '').toLowerCase())
  if (smoke) {
    console.error(
      'SMOKE ok: self-improve-swe + swe-bench-env + lifecycle (sweEvalRunner, buildableGenerator, same-host MCP) import graph loaded',
    )
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
  const surfaceRaw = (process.env.SURFACE ?? 'prompt').toLowerCase()
  if (surfaceRaw !== 'prompt' && surfaceRaw !== 'mcp') {
    throw new Error(`SURFACE must be 'prompt' or 'mcp' (got '${surfaceRaw}')`)
  }
  const surface = surfaceRaw as 'prompt' | 'mcp'

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
    // SURFACE=mcp: the candidate profile carries a worktree-built stdio server;
    // spawn it same-host so its tools are live while the profile is scored.
    materializeMcp: surface === 'mcp',
  })

  const baseline: AgentProfile = { name: 'swe-baseline', prompt: { systemPrompt: seedPrompt } }

  const generator: CandidateGenerator =
    surface === 'mcp'
      ? mcpBuildGenerator(evalRunner, { routerBaseUrl, routerKey, model })
      : // ONE deterministic candidate through the shipped generator's injected-refine
        // seam — the smallest real population that exercises the whole loop.
        promptGenerator({
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

  const composed = composeProfile(out.registry, baseline, { kind: surface })
  if (surface === 'mcp') {
    const servers = Object.entries(composed.mcp ?? {}).map(
      ([key, s]) => `${key} (${s.transport} ${s.command ?? s.url ?? '?'} cwd=${s.cwd ?? '-'})`,
    )
    console.log(`composed profile: mcp=[${servers.join('; ')}]`)
  } else {
    console.log(
      `composed profile: systemPrompt=${(composed.prompt?.systemPrompt ?? '').length}b ` +
        `instructions=${JSON.stringify(composed.prompt?.instructions ?? [])}`,
    )
  }
  console.error(`[self-improve-swe] done in ${Math.round((Date.now() - t0) / 1000)}s`)
}

/** The Phase-3 buildable surface: fan-out worktree builds of a real MCP server,
 *  driver→worker atom steering each build, boot-and-probe verification, then
 *  rank/gate on the injected SWE eval runner (materializeMcp path). */
function mcpBuildGenerator(
  evalRunner: EvalRunner,
  router: { routerBaseUrl: string; routerKey: string; model: string },
): CandidateGenerator {
  const repoRoot = process.env.BUILD_REPO_ROOT
  if (!repoRoot) {
    throw new Error('SURFACE=mcp requires BUILD_REPO_ROOT (the checkout candidate worktrees fork from)')
  }
  const command = process.env.MCP_SERVE_COMMAND
  if (!command) {
    throw new Error(
      'SURFACE=mcp requires MCP_SERVE_COMMAND (boots the built server in its worktree, stdio transport)',
    )
  }
  const args = (process.env.MCP_SERVE_ARGS ?? '').split(' ').filter(Boolean)
  return buildableGenerator({
    kind: 'mcp',
    fanout: Number(process.env.BUILD_FANOUT ?? 2),
    evalRunner,
    buildCandidate: worktreeBuildCandidate({
      kind: 'mcp',
      repoRoot,
      baseRef: process.env.BUILD_BASE_REF ?? 'main',
      harness: (process.env.BUILD_HARNESS ?? 'claude') as NonNullable<WorktreeBuildOptions['harness']>,
      maxShots: Number(process.env.BUILD_MAX_SHOTS ?? 3),
      mcp: { command, ...(args.length ? { args } : {}) },
      driver: {
        brain: routerBrain({
          routerBaseUrl: router.routerBaseUrl,
          routerKey: router.routerKey,
          model: process.env.DRIVER_MODEL ?? router.model,
        }),
      },
    }),
  })
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
