/**
 * Bench CLI. For now: prove the benchmark JUDGE works before wiring the agent.
 *
 *   tsx src/run.ts preflight              # harness + Docker reachable?
 *   tsx src/run.ts verify-judge [id]      # gold patch must RESOLVE; empty must FAIL
 */
import { createCadDesignAdapter } from './benchmarks/cad-design'
import { createMind2WebAdapter } from './benchmarks/mind2web'
import type { BenchmarkAdapter, BenchTask } from './benchmarks/types'
import type { BrowserTask } from './browser/agent-adapter'
import { Sandbox } from '@tangle-network/sandbox'
import { ADAPTERS } from './adapters'
import { DEFAULT_SANDBOX_REFINE_DIRECTIVE, GEPA_LEARNED_DIRECTIVE, composeStrategies } from './directives'
import {
  analystArm,
  type Arm,
  diverseArm,
  llmAnalyst,
  loopAnalyst,
  randomArm,
  refineArm,
  runExperiment,
  sandboxAgentRun,
  type WorkerBackendType,
} from './experiment'
import { runPool } from './run-pool'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

/** Escape a string for literal inclusion in a RegExp source. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Turn a run's trace into a shareable video + temp link by invoking the
 * @tangle-network/run-capsule CLI, returning the litterbox URL it prints. This
 * is the "a video falls out of every run" seam: a benchmark run writes its
 * trace, and the link drops out e2e. Prefers a local build (RUN_CAPSULE_CLI or
 * ~/code/run-capsule/dist/cli.js) and falls back to the published package.
 * Fail-soft: a missing/broken video tool never fails the eval — returns null.
 */
async function renderCapsuleVideo(tracePath: string, title: string): Promise<string | null> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const { existsSync } = await import('node:fs')
  const execFileAsync = promisify(execFile)
  const local = process.env.RUN_CAPSULE_CLI ?? `${process.env.HOME}/code/run-capsule/dist/cli.js`
  const useLocal = existsSync(local)
  const bin = useLocal ? 'node' : 'npx'
  const head = useLocal ? [local] : ['-y', '@tangle-network/run-capsule']
  const { tmpdir } = await import('node:os')
  const outDir = process.env.VIDEO_OUT ?? `${tmpdir()}/cad-video`
  const args = [...head, '--trace', tracePath, '--kinds', 'composed', '--narrate', '--music', '--title', title, '--out', outDir]
  try {
    const { stdout } = await execFileAsync(bin, args, { timeout: 360_000, maxBuffer: 1 << 26, env: process.env })
    return /https?:\/\/\S+\.mp4/.exec(stdout)?.[0] ?? null
  } catch (err) {
    console.warn(`[video] run-capsule failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`)
    return null
  }
}

// The command map, printed by `help` — the source of truth HARNESS.md + CLAUDE.md cite.
// Keep in sync with the dispatch below and the standalone .mts/.ts tools (the gate lives
// in those, not here). Drift here is the re-discovery tax; fix this string when you add a command.
const HELP = `bench harness — commands (full map + data flow: bench/HARNESS.md)

run.ts  (BENCH=<adapter> selects the benchmark; default swe-bench):
  help                   this map
  preflight              is the harness/worker/judge reachable for BENCH?
  verify-judge [id]      judge sanity: gold artifact RESOLVES, empty FAILS
  batch-oracle <N>       k shots/instance through the one flow; CORPUS=path persists the corpus; DIVERSE=1 = diverse@k
  batch-blind <N>        one shot/instance (pass@1)
  batch-compare <N>      random@k vs refine (hand + GEPA directives): the steering experiment.
                         ANALYST=llm|loop adds a targeted-steer arm (LLM(trace) | a whole sub-loop).
                         BACKEND=opencode|hermes|claude-code|... is the cost dial. All are runExperiment presets.
  solve-one <id>         one sandbox-backed solve (SANDBOX_KEY + ROUTER_KEY)
  solve-cad <id>         CAD authoring + render (LOCAL=1 | default sandbox)
  solve-browser [id]     Mind2Web one-step element selection (ROUTER_KEY)
  solve-web-live <goal> <url>   live browser agent → attested verdict → run-capsule film (ROUTER_KEY)
  ui-review <url>        design-audit reviewer over a live URL (ROUTER_KEY)

standalone tools (NOT dispatched here — run directly):
  tsx src/corpus-replay.mts <corpus.jsonl> --selector   selector@k vs random@k vs oracle@k, OFFLINE (zero creds)
  tsx src/corpus-report.mts <corpus.jsonl...>           paired-bootstrap CI + Benjamini-Hochberg
  tsx src/gepa-refine.ts                                 GEPA-optimize a directive vs a held-out gate (ROUTER_KEY)
  tsx src/finsearch-loop.ts                              real runLoop closed loop on FinSearchComp (SANDBOX_KEY + ROUTER_KEY)
  tsx src/terminal-compare.ts                            Terminal-Bench compare

data flow: rollout -> adapter.judge -> CORPUS RunRecord -> corpus-replay --selector -> corpus-report CI -> gate verdict
THE GATE, runnable today with zero creds:  tsx src/corpus-replay.mts corpus/finsearch.jsonl --selector`

/**
 * Run an experiment through the ONE flow (`runExperiment`): N instances × arms,
 * each driven through the real kernel, judged by the adapter, written to the
 * corpus. The old batch-* subcommands are thin presets of this — the four knobs
 * (task=adapter · backend.type · arms · judge) are parameters, not commands.
 * Deep stats (oracle/headroom, paired CI) come from the standalone
 * corpus-report.mts over the written corpus — not reimplemented per subcommand.
 */
async function runExperimentPreset(
  adapter: BenchmarkAdapter,
  rest: string[],
  opts: { arms: [Arm, ...Arm[]]; rounds: number; corpus?: string },
): Promise<void> {
  const model = process.env.WORKER_MODEL ?? 'gpt-5'
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('TANGLE_API_KEY')
  const sandboxBaseUrl = process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools'
  const backendType = (process.env.BACKEND as WorkerBackendType | undefined) ?? 'opencode'
  const client = new Sandbox({ baseUrl: sandboxBaseUrl, apiKey: routerKey, timeoutMs: 1_200_000 } as never)
  const agentRun = sandboxAgentRun({ model, routerBaseUrl, routerKey, backendType })
  // ANALYST=llm|loop appends a targeted-steer arm (the LLM(trace) / agentic rung): llm =
  // one model call over the trace, loop = a whole sub-loop investigates. The honest
  // experiment vs the fixed-directive refine arm — refine@k vs analyst@k vs random@k.
  const arms = process.env.ANALYST
    ? ([
        ...opts.arms,
        analystArm(
          `analyst-${process.env.ANALYST}`,
          process.env.ANALYST === 'loop'
            ? loopAnalyst({ sandboxClient: client, agentRun, rounds: 1 })
            : llmAnalyst({ routerBaseUrl, routerKey, model }),
        ),
      ] as [Arm, ...Arm[]])
    : opts.arms
  const r = await runExperiment({
    adapter,
    sandboxClient: client,
    agentRun,
    arms,
    model,
    rounds: opts.rounds,
    n: Number(rest[0] ?? process.env.N ?? 10),
    ids: process.env.IDS ? process.env.IDS.split(',') : undefined,
    concurrency: Number(process.env.CONCURRENCY ?? 3),
    ...(adapter.output ? { output: adapter.output } : {}),
    ...(opts.corpus ? { corpusPath: opts.corpus } : {}),
  })
  const pct = (x: number) => (r.n > 0 ? `${((x / r.n) * 100).toFixed(1)}%` : 'n/a')
  const dlt = (x: number) => `${((x / Math.max(r.n, 1)) * 100).toFixed(1)} pp`
  console.log(`\n=== ${adapter.name} — ${r.arms.length}-arm (clean n=${r.n}, excluded ${r.errored}, rounds=${opts.rounds}) ===`)
  console.log(`  blind (1 attempt):  ${pct(r.blind)}  (${r.blind}/${r.n})`)
  for (const a of r.arms) {
    const tag = a.label === r.arms[0]?.label ? '  ← compute control' : ` · Δ vs control ${dlt(a.deltaVsControl)}`
    console.log(`  ${a.label}@${opts.rounds}:  ${pct(a.resolved)}  (${a.resolved}/${r.n})${tag}`)
  }
  if (opts.corpus) console.log(`corpus: ${opts.corpus} · analysis: tsx src/corpus-report.mts ${opts.corpus}`)
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP)
    return
  }
  const adapter = ADAPTERS[process.env.BENCH ?? 'swe-bench']?.()
  if (!adapter) throw new Error(`unknown BENCH=${process.env.BENCH}`)

  if (cmd === 'preflight') {
    await adapter.preflight()
    console.log(`✅ ${adapter.name}: harness + judge reachable`)
    return
  }

  if (cmd === 'verify-judge') {
    await adapter.preflight()
    const ids = rest[0] ? [rest[0]] : undefined
    const tasks = await adapter.loadTasks(ids ? { ids } : { limit: 1 })
    const task = tasks[0]
    if (!task) throw new Error('no task loaded')
    console.log(`task: ${task.id}`)

    const gold = await adapter.goldArtifact(task)
    if (!gold) throw new Error('no gold artifact for task')
    console.log('→ judging GOLD patch (must resolve)…')
    const goldScore = await adapter.judge(task, gold)
    console.log(`   gold: resolved=${goldScore.resolved} score=${goldScore.score}`)

    console.log('→ judging EMPTY patch (must fail)…')
    const emptyScore = await adapter.judge(task, '')
    console.log(`   empty: resolved=${emptyScore.resolved} score=${emptyScore.score}`)

    const ok = goldScore.resolved === true && emptyScore.resolved === false
    console.log(
      ok
        ? `\n✅ JUDGE VERIFIED: gold resolves, empty fails — the deterministic judge is wired correctly.`
        : `\n❌ JUDGE BROKEN: expected gold=resolved, empty=failed; got gold=${goldScore.resolved}, empty=${emptyScore.resolved}`,
    )
    process.exit(ok ? 0 : 1)
  }

  if (cmd === 'solve-one') {
    const { solveShot } = await import('./worker')
    const cfg = {
      sandboxBaseUrl: process.env.SANDBOX_BASE_URL ?? 'https://staging-sandbox.tangle.tools',
      sandboxKey: must('TANGLE_API_KEY'),
      routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
      routerKey: must('TANGLE_API_KEY'),
      model: process.env.WORKER_MODEL ?? 'gpt-5',
      provider: process.env.WORKER_PROVIDER ?? 'openai',
      // No timeout by default — the agent runs until it's done. Only honored if
      // SHOT_TIMEOUT_MS is explicitly set.
      timeoutMs: process.env.SHOT_TIMEOUT_MS ? Number(process.env.SHOT_TIMEOUT_MS) : undefined,
    }
    const id = rest[0] ?? 'astropy__astropy-12907'
    await adapter.preflight()
    const [task] = await adapter.loadTasks({ ids: [id] })
    if (!task) throw new Error(`instance not found: ${id}`)
    console.log(`solving ${task.id} with ${cfg.model} on ${cfg.sandboxBaseUrl}…`)
    const shot = await solveShot(task, cfg)
    console.log(`worker: ok=${shot.ok} patchBytes=${shot.patch.length}${shot.detail ? ` (${shot.detail})` : ''}`)
    if (!shot.ok) {
      console.log('❌ worker produced no patch — nothing to judge')
      process.exit(1)
    }
    console.log('→ judging the agent-produced patch…')
    const score = await adapter.judge(task, shot.patch)
    console.log(`\n${score.resolved ? '✅ RESOLVED' : '⚠️  NOT resolved'} — ${task.id} (real SWE-bench judge, score=${score.score})`)
    return
  }

  if (cmd === 'batch-blind') {
    // pass@1: one shot per instance through the one flow (the control arm, rounds=1).
    await runExperimentPreset(adapter, rest, { arms: [randomArm('blind')], rounds: 1 })
    return
  }

  if (cmd === 'batch-oracle') {
    // k shots/instance through the one flow; CORPUS=path persists the canonical,
    // selector-readable corpus. DIVERSE=1 gives each shot a distinct strategy lens
    // (the diverse@k arm); else identical retries (random@k). The oracle/headroom +
    // selector@k stats come from `corpus-report.mts`/`corpus-replay.mts` over that
    // corpus — measured once, in one place, not reimplemented here.
    const k = Number(process.env.K ?? 4)
    // DIVERSE_BASE_FILE (a learned directive, e.g. gepa-refine's winner) or DIVERSE_BASE
    // (inline) is the shared base the lenses layer on: GEPA-best-base x diverse-lenses x
    // selection. This is where directive optimization composes with diversification.
    const diverseBase = process.env.DIVERSE_BASE_FILE
      ? (await import('node:fs')).readFileSync(process.env.DIVERSE_BASE_FILE, 'utf8').trim()
      : (process.env.DIVERSE_BASE ?? 'Give your single best, final answer.')
    const arms: [Arm, ...Arm[]] =
      process.env.DIVERSE === '1'
        ? [diverseArm('diverse', composeStrategies(diverseBase, k))]
        : [randomArm('random')]
    await runExperimentPreset(adapter, rest, { arms, rounds: k, corpus: process.env.CORPUS })
    return
  }

  if (cmd === 'batch-compare') {
    // The steering experiment through the one flow: random@k (compute control) vs
    // refine@k with a hand directive vs refine@k with the GEPA-learned directive.
    // The compute-matched control is enforced by runExperiment/runSteeringExperiment;
    // refine − random at equal k is the confound-free steering effect. Paired CI +
    // BH come from corpus-report.mts over the corpus.
    const rounds = Number(process.env.ROUNDS ?? 3)
    await runExperimentPreset(adapter, rest, {
      arms: [
        randomArm('random'),
        refineArm('refineHand', DEFAULT_SANDBOX_REFINE_DIRECTIVE),
        refineArm('refineGepa', GEPA_LEARNED_DIRECTIVE),
      ],
      rounds,
      corpus: process.env.CORPUS,
    })
    return
  }

  if (cmd === 'solve-cad') {
    // Full rounded CAD run: agent authors OpenSCAD in a real 'universal' sandbox,
    // the box's own openscad gates + renders it, we judge the artifact and write
    // the screenshot-rich trace for run-capsule to turn into a video.
    const fs = await import('node:fs/promises')
    const { solveCadShot, solveCadRefine, solveCadRefineLocal } = await import('./worker-cad')
    // solve-cad is CAD-specific — don't depend on the BENCH-selected adapter.
    const adapter = createCadDesignAdapter()
    // LOCAL=1 → author via router + gate/render with the LOCAL openscad kernel
    // (staging-independent). Default → orchestrated refine in a BARE sandbox;
    // IN_SANDBOX_AGENT=1 → opencode-agent-in-box. Only the sandbox paths need a
    // TANGLE_API_KEY, so don't demand it in local mode.
    const local = process.env.LOCAL === '1'
    const inBoxAgent = process.env.IN_SANDBOX_AGENT === '1'
    // Run a specific authoring directive (e.g. one a GEPA run learned): inline
    // via CAD_DIRECTIVE or from a file via CAD_DIRECTIVE_FILE. Local path only.
    const directive = process.env.CAD_DIRECTIVE_FILE
      ? await fs.readFile(process.env.CAD_DIRECTIVE_FILE, 'utf8')
      : process.env.CAD_DIRECTIVE
    const cfg = {
      sandboxBaseUrl: process.env.SANDBOX_BASE_URL ?? 'https://staging-sandbox.tangle.tools',
      sandboxKey: local ? (process.env.TANGLE_API_KEY ?? '') : must('TANGLE_API_KEY'),
      routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
      routerKey: must('TANGLE_API_KEY'),
      model: process.env.WORKER_MODEL ?? 'claude-sonnet-4-6',
      provider: process.env.WORKER_PROVIDER ?? 'openai',
      timeoutMs: process.env.SHOT_TIMEOUT_MS ? Number(process.env.SHOT_TIMEOUT_MS) : undefined,
      rounds: process.env.ROUNDS ? Number(process.env.ROUNDS) : undefined,
      directive,
    }
    const id = rest[0] ?? 'two-story-house'
    await adapter.preflight()
    const [task] = await adapter.loadTasks({ ids: [id] })
    if (!task) throw new Error(`task not found: ${id}`)
    const mode = local ? 'local-refine' : inBoxAgent ? 'opencode-in-box' : 'orchestrated-refine'
    console.log(`[solve-cad] ${task.id} with ${cfg.model} (${mode}${local ? '' : ` · ${cfg.sandboxBaseUrl}`})…`)
    const shot = local
      ? await solveCadRefineLocal(task, cfg)
      : inBoxAgent
        ? await solveCadShot(task, cfg)
        : await solveCadRefine(task, cfg)
    console.log(`worker: ok=${shot.ok} scadBytes=${shot.artifact.length}${shot.detail ? ` (${shot.detail})` : ''}`)
    const tracePath = process.env.TRACE_OUT ?? `/tmp/cad-trace-${task.id}.json`
    await fs.writeFile(tracePath, JSON.stringify(shot.trace, null, 2))
    console.log(`trace (${shot.trace.length} spans) → ${tracePath}`)
    if (shot.artifact.trim()) {
      const score = await adapter.judge(task, shot.artifact)
      console.log(`\n${score.resolved ? '✅ RESOLVED' : `⚠️  score=${score.score}`} — ${task.id} (real openscad geometry judge)`) // eslint-disable-line
      console.log(`detail: ${score.detail}`)
    }
    // A video falls out of the run, e2e: render the trace into a film and drop a
    // shareable litterbox link. Opt out with VIDEO=0; narration uses TANGLE_API_KEY.
    if (process.env.VIDEO !== '0' && shot.trace.length > 1) {
      console.log(`\n[video] rendering run-capsule film…`)
      const link = await renderCapsuleVideo(tracePath, `Agent designs a ${task.id.replace(/-/g, ' ')}`)
      console.log(link ? `🎬 video → ${link}` : `🎬 video step finished (no link captured — see run-capsule output)`) // eslint-disable-line
    }
    return
  }

  if (cmd === 'solve-browser') {
    // One Mind2Web step: the agent picks the next element + action under the
    // (optionally learned) directive; the deterministic judge scores element +
    // operation; the screenshot-rich trace becomes a run-capsule film — the real
    // page the agent acted on. Router-only (no sandbox) — still the one TANGLE_API_KEY.
    const fs = await import('node:fs/promises')
    const { solveBrowserLocal } = await import('./worker-browser')
    const m2w = createMind2WebAdapter()
    const directive = process.env.M2W_DIRECTIVE_FILE
      ? await fs.readFile(process.env.M2W_DIRECTIVE_FILE, 'utf8')
      : process.env.M2W_DIRECTIVE
    const cfg = {
      routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
      routerKey: must('TANGLE_API_KEY'),
      model: process.env.WORKER_MODEL ?? 'claude-sonnet-4-6',
      directive,
    }
    await m2w.preflight()
    const [task] = rest[0] ? await m2w.loadTasks({ ids: [rest[0]] }) : await m2w.loadTasks({ limit: 1 })
    if (!task) throw new Error('no mind2web task loaded')
    console.log(`[solve-browser] ${task.id} with ${cfg.model}…`)
    const shot = await solveBrowserLocal(task, cfg)
    console.log(`worker: ok=${shot.ok} (${shot.detail})`)
    const tracePath = process.env.TRACE_OUT ?? `/tmp/m2w-trace-${task.id}.json`
    await fs.writeFile(tracePath, JSON.stringify(shot.trace, null, 2))
    console.log(`trace (${shot.trace.length} spans) → ${tracePath}`)
    const score = await m2w.judge(task, shot.artifact)
    console.log(`\n${score.resolved ? '✅ RESOLVED' : `⚠️  score=${score.score}`} — ${task.id} (deterministic mind2web step judge)`) // eslint-disable-line
    console.log(`detail: ${score.detail}`)
    if (process.env.VIDEO !== '0' && shot.trace.length > 1) {
      console.log(`\n[video] rendering run-capsule film…`)
      const link = await renderCapsuleVideo(tracePath, `Agent navigates ${String(task.metadata?.website ?? 'the web')}`)
      console.log(link ? `🎬 video → ${link}` : `🎬 video step finished (no link captured — see run-capsule output)`) // eslint-disable-line
    }
    return
  }

  if (cmd === 'ui-review') {
    // Run a PANEL of UI reviewers over a live URL and print the deduped union of
    // their subjective findings PLUS the attestable deterministic-floor verdict
    // (axe a11y + WCAG contrast — re-derived by judgeUiFloor, never a reviewer's
    // self-reported healthScore). Driver-agnostic: add more UiReviewerAdapters to
    // the panel. Router-backed `bad design-audit` reviewer, so TANGLE_API_KEY needed.
    const url = rest[0] ?? process.env.UI_REVIEW_URL
    if (!url) throw new Error('ui-review needs a URL: `tsx src/run.ts ui-review https://example.com`')
    const { runUiReviewerPanel } = await import('./browser/ui-reviewer')
    const { badDesignAuditReviewer } = await import('./browser/adapters/bad-design-audit')
    const reviewers = [
      badDesignAuditReviewer({
        baseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
        apiKey: must('TANGLE_API_KEY'),
        model: process.env.WORKER_MODEL ?? 'claude-sonnet-4-6',
        profile: process.env.UI_REVIEW_PROFILE,
        pages: process.env.UI_REVIEW_PAGES ? Number(process.env.UI_REVIEW_PAGES) : undefined,
      }),
    ]
    console.log(`[ui-review] panel of ${reviewers.length} over ${url}…`)
    const panel = await runUiReviewerPanel({ url }, reviewers)
    for (const [id, runs] of Object.entries(panel.perReviewer)) {
      console.log(`  reviewer ${id}: ${runs.length} run(s), ${runs.reduce((n, r) => n + r.findings.length, 0)} finding(s)`)
    }
    const top = [...panel.findings].sort((a, b) => b.flaggedBy.length - a.flaggedBy.length).slice(0, 10)
    console.log(`\nfindings (deduped union, ${panel.findings.length} total — top ${top.length}):`)
    for (const f of top) {
      console.log(`  [${f.severity}] ${f.lens} @ ${f.route}: ${f.title}${f.flaggedBy.length > 1 ? ` (×${f.flaggedBy.length} reviewers)` : ''}`)
    }
    const v = panel.verdict
    console.log(`\n${v.resolved ? '✅ FLOOR OK' : '⛔ FLOOR BLOCKING'} — score=${v.score} (attestable deterministic floor, NOT a self-reported score)`) // eslint-disable-line
    console.log(`detail: ${v.detail}`)
    return
  }

  if (cmd === 'solve-web-live') {
    // A LIVE interactive browser agent navigates a real site (the `bad` CLI drives
    // a real headless Chromium), the DETERMINISTIC judge attests the outcome from
    // the run's final observable state (NOT the agent's self-report), and the
    // multi-step navigation — each turn's real screenshot — becomes a run-capsule
    // film. This is the live-agent path; distinct from solve-browser's single-step
    // action-prediction over a pre-captured dataset frame. Router-only.
    const fs = await import('node:fs/promises')
    const { badBrowserAdapter } = await import('./browser/adapters/bad')
    const { judgeBrowserRun } = await import('./browser/agent-adapter')
    const { browserRunToSpans } = await import('./browser/run-to-spans')
    const goal = rest[0] ?? process.env.WEB_GOAL
    const startUrl = rest[1] ?? process.env.WEB_URL
    if (!goal || !startUrl) {
      throw new Error('solve-web-live needs a goal + url: `tsx src/run.ts solve-web-live "<goal>" <startUrl>` (or WEB_GOAL/WEB_URL)')
    }
    // SuccessSpec is REQUIRED + non-empty — the judge throws on an empty spec
    // rather than silent-attest. Default: the agent must leave the start origin
    // (a generic "it navigated" floor); override with WEB_SUCCESS (JSON SuccessSpec[]).
    const success = process.env.WEB_SUCCESS
      ? (JSON.parse(process.env.WEB_SUCCESS) as BrowserTask['success'])
      : [{ type: 'url-matches' as const, value: '^(?!' + escapeRegExp(startUrl) + '$).+' }]
    const task: BrowserTask = {
      id: process.env.WEB_TASK_ID ?? 'web-live',
      goal,
      startUrl,
      maxSteps: process.env.WEB_MAX_STEPS ? Number(process.env.WEB_MAX_STEPS) : 12,
      success,
    }
    const adapter = badBrowserAdapter({
      baseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
      apiKey: must('ROUTER_KEY'),
      model: process.env.WORKER_MODEL ?? 'gpt-4o',
      captureScreenshots: true,
    })
    console.log(`[solve-web-live] ${task.id}: "${goal}" @ ${startUrl} with ${process.env.WORKER_MODEL ?? 'gpt-4o'}…`)
    const run = await adapter.run(task)
    console.log(`steps=${run.steps.length} finalUrl=${run.finalUrl} cost=$${(run.costUsd ?? 0).toFixed(3)} selfReported=${run.selfReportedSuccess}`)
    const verdict = judgeBrowserRun(task, run)
    console.log(`\n${verdict.resolved ? '✅ RESOLVED' : `⚠️  score=${verdict.score}`} — ${task.id} (attestable deterministic judge, NOT the agent's self-report)`) // eslint-disable-line
    console.log(`detail: ${verdict.detail}`)
    const spans = await browserRunToSpans(run, { startTs: Date.now() })
    const tracePath = process.env.TRACE_OUT ?? `/tmp/web-live-trace-${task.id}.json`
    await fs.writeFile(tracePath, JSON.stringify(spans, null, 2))
    const framed = spans.filter((s) => (s.attributes as { screenshot?: string } | undefined)?.screenshot).length
    console.log(`trace (${spans.length} spans, ${framed} framed) → ${tracePath}`)
    if (process.env.VIDEO !== '0' && spans.length > 1) {
      console.log(`\n[video] rendering run-capsule film…`)
      const link = await renderCapsuleVideo(tracePath, `Agent navigates ${new URL(startUrl).hostname}`)
      console.log(link ? `🎬 video → ${link}` : `🎬 video step finished (no link captured — see run-capsule output)`) // eslint-disable-line
    }
    return
  }

  throw new Error(`unknown command: ${cmd} — run \`tsx src/run.ts help\` for the command map`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
