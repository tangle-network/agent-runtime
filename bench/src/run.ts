/**
 * Bench CLI. For now: prove the benchmark JUDGE works before wiring the agent.
 *
 *   tsx src/run.ts preflight              # harness + Docker reachable?
 *   tsx src/run.ts verify-judge [id]      # gold patch must RESOLVE; empty must FAIL
 */
import { createAppWorldAdapter } from './benchmarks/appworld'
import { createCadBenchAdapter } from './benchmarks/cadbench'
import { createCadDesignAdapter } from './benchmarks/cad-design'
import { createCadGenBenchAdapter } from './benchmarks/cadgenbench'
import { createFinsearchcompAdapter } from './benchmarks/finsearchcomp'
import { createFramesAdapter } from './benchmarks/frames'
import { createHotpotqaAdapter } from './benchmarks/hotpotqa'
import { createMind2WebAdapter } from './benchmarks/mind2web'
import { createSimpleQaAdapter } from './benchmarks/simpleqa'
import { createSweBenchAdapter } from './benchmarks/swe-bench'
import { createTerminalBenchAdapter } from './benchmarks/terminal-bench'
import type { BenchmarkAdapter, BenchTask } from './benchmarks/types'
import type { BrowserTask } from './browser/agent-adapter'
import { randomAtK, summarizeCompare } from './compare-decomp'
import { appendRunRecord } from './corpus'
import { runPool } from './run-pool'

const ADAPTERS: Record<string, () => BenchmarkAdapter> = {
  'swe-bench': createSweBenchAdapter,
  'terminal-bench': createTerminalBenchAdapter,
  // PLANNED (scaffolded): preflight is real; loadTasks/judge fail loud with the
  // exact wiring step until integrated. Kept on purpose — the benchmark roster is
  // the cross-benchmark-transfer asset; this is roadmap, not dead code.
  appworld: createAppWorldAdapter,
  'cad-design': createCadDesignAdapter,
  cadbench: createCadBenchAdapter,
  cadgenbench: createCadGenBenchAdapter,
  frames: createFramesAdapter,
  finsearchcomp: createFinsearchcompAdapter,
  simpleqa: createSimpleQaAdapter,
  hotpotqa: createHotpotqaAdapter,
  mind2web: createMind2WebAdapter,
}

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
  batch-oracle <N>       k shots/instance; CORPUS=path persists a selector-readable corpus
  batch-blind <N>        one shot/instance (pass@1)
  batch-compare <N>      blind / random@k / refine decomposition (RESEARCH=1 | SANDBOX=1 | default)
  solve-one <id>         one sandbox-backed solve (SANDBOX_KEY + ROUTER_KEY)
  solve-one-local <id>   one local-opencode solve
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

  if (cmd === 'solve-one-local') {
    const { solveShotLocal } = await import('./worker-local')
    const model = process.env.WORKER_MODEL ?? 'deepseek/deepseek-v4-pro'
    const livenessMs = process.env.OPENCODE_LIVENESS_MS ? Number(process.env.OPENCODE_LIVENESS_MS) : undefined
    const id = rest[0] ?? 'astropy__astropy-12907'
    await adapter.preflight()
    const [task] = await adapter.loadTasks({ ids: [id] })
    if (!task) throw new Error(`instance not found: ${id}`)
    console.log(`[local] solving ${task.id} with opencode model=${model}…`)
    const shot = await solveShotLocal(task, { model, livenessMs })
    console.log(`worker: ok=${shot.ok} patchBytes=${shot.patch.length}${shot.detail ? ` (${shot.detail})` : ''}`)
    if (!shot.ok) {
      console.log('❌ no patch produced — nothing to judge')
      process.exit(1)
    }
    console.log('→ judging the agent-produced patch (real SWE-bench harness)…')
    const score = await adapter.judge(task, shot.patch)
    console.log(`\n${score.resolved ? '✅ RESOLVED' : '⚠️  NOT resolved'} — ${task.id} (score=${score.score})`)
    return
  }

  if (cmd === 'batch-blind') {
    const { solveShotLocal } = await import('./worker-local')
    const fs = await import('node:fs/promises')
    const model = process.env.WORKER_MODEL ?? 'deepseek/deepseek-v4-pro'
    const livenessMs = process.env.OPENCODE_LIVENESS_MS ? Number(process.env.OPENCODE_LIVENESS_MS) : undefined
    const limit = Number(rest[0] ?? process.env.N ?? 10)
    const conc = Number(process.env.CONCURRENCY ?? 5)
    const out = process.env.SCORECARD ?? '/tmp/swebench-blind-scorecard.jsonl'
    await adapter.preflight()
    const _ids = process.env.IDS ? process.env.IDS.split(",") : undefined
    const tasks = await adapter.loadTasks(_ids ? { ids: _ids } : { limit })
    const livenessLabel = livenessMs === 0 ? 'disabled' : `${Math.round((livenessMs ?? 1_800_000) / 1000)}s`
    console.log(
      `[batch-blind] ${tasks.length} instances · model=${model} · concurrency=${conc} · liveness backstop=${livenessLabel}`,
    )
    let done = 0
    let resolved = 0
    const results: Array<{ id: string; resolved: boolean; patchBytes: number; error?: string }> = []
    await runPool(
      tasks,
      conc,
      async (task) => {
        const started = Date.now()
        let rec: { id: string; resolved: boolean; patchBytes: number; error?: string }
        try {
          const shot = await solveShotLocal(task, { model, livenessMs }) // liveness backstop reaps hangs only
          const score = shot.ok ? await adapter.judge(task, shot.patch) : { resolved: false, score: 0 }
          rec = { id: task.id, resolved: score.resolved, patchBytes: shot.patch.length }
        } catch (err) {
          rec = { id: task.id, resolved: false, patchBytes: 0, error: err instanceof Error ? err.message : String(err) }
        }
        results.push(rec)
        await fs.appendFile(out, `${JSON.stringify({ ...rec, secs: Math.round((Date.now() - started) / 1000) })}\n`)
        done += 1
        if (rec.resolved) resolved += 1
        console.log(`  [${done}/${tasks.length}] ${rec.id}: ${rec.resolved ? '✅ RESOLVED' : rec.error ? `ERR ${rec.error.slice(0, 60)}` : '⚠️  no'} (${resolved}/${done} so far)`)
      },
    )
    console.log(`\n=== BLIND resolve rate: ${resolved}/${tasks.length} = ${((resolved / tasks.length) * 100).toFixed(1)}% ===`)
    console.log(`scorecard: ${out}`)
    return
  }

  if (cmd === 'batch-oracle') {
    // Router-free headroom measurement: k blind shots per instance, judge ALL of
    // them, report pass@1 / pass@k-random / pass@k-oracle. No critic, no router —
    // so it can't be 403-killed. The oracle column is the gate: if oracle@k ≈
    // pass@1, multi-shot has no headroom and the driver direction is dead; if
    // oracle@k ≫ pass@1, a real selector is worth building.
    const fs = await import('node:fs/promises')
    // RESEARCH=1 swaps the code-patch worker for the research answer worker, so the
    // same headroom machinery measures answer-variance domains (where a driver might
    // find the headroom coding lacks). loadTasks carries the answer contract; the
    // adapter judges the captured answer.
    const research = process.env.RESEARCH === '1'
    const { solveShotLocal } = await import('./worker-local')
    const { solveResearchLocal } = await import('./worker-research')
    const runShot = async (task: BenchTask, m: string, l?: number): Promise<string> => {
      if (research) {
        const s = await solveResearchLocal(task, { model: m, livenessMs: l })
        return s.ok ? s.answer : ''
      }
      const s = await solveShotLocal(task, { model: m, livenessMs: l })
      return s.ok ? s.patch : ''
    }
    const model = process.env.WORKER_MODEL ?? 'deepseek/deepseek-v4-pro'
    // MODELS (comma list) = the diversity lever: shot i uses models[i % len]. With a
    // single near-deterministic model, oracle@k trivially equals pass@1 (the k shots
    // are identical), so the only real headroom is heterogeneous (cross-model) fanout.
    const models = process.env.MODELS ? process.env.MODELS.split(',').map((m) => m.trim()) : [model]
    const livenessMs = process.env.OPENCODE_LIVENESS_MS ? Number(process.env.OPENCODE_LIVENESS_MS) : undefined
    const k = Number(process.env.K ?? models.length)
    const conc = Number(process.env.CONCURRENCY ?? 2)
    const out = process.env.SCORECARD ?? '/tmp/swebench-oracle.jsonl'
    // CORPUS (opt-in): also persist a selector-readable RunRecord per instance, so
    // the deployable selector is scored OFFLINE via `corpus-replay --selector` — the
    // local, sandbox-free path to the selector@k vs random@k gate.
    const corpusPath = process.env.CORPUS
    const benchName = process.env.BENCH ?? 'swe-bench'
    // DIVERSE=1: each of the k shots gets a DIFFERENT strategy lens (composeStrategies)
    // prepended to the prompt → a diverse@k corpus to gate against the identical-directive
    // random@k control. corpus-replay --selector then compares selector@k on diverse vs random.
    // Pair with a SINGLE model (MODELS=one) to isolate strategy-diversity from model-diversity.
    const diverse = process.env.DIVERSE === '1'
    const { composeStrategies } = await import('./directives')
    // DIVERSE_BASE_FILE (a learned directive, e.g. gepa-refine's winner from #145) or
    // DIVERSE_BASE (inline) becomes the shared base the lenses layer on — this is where the
    // directive-optimization surface (#145) composes with the diversification surface:
    // GEPA-best-base × diverse-lenses × selection. Defaults to a neutral answer instruction.
    const diverseBase = process.env.DIVERSE_BASE_FILE
      ? (await import('node:fs')).readFileSync(process.env.DIVERSE_BASE_FILE, 'utf8').trim()
      : (process.env.DIVERSE_BASE ?? 'Give your single best, final answer to the question.')
    const diverseStrategies = diverse ? composeStrategies(diverseBase, k) : null
    await adapter.preflight()
    const _ids = process.env.IDS ? process.env.IDS.split(',') : undefined
    const tasks = await adapter.loadTasks(_ids ? { ids: _ids } : { limit: Number(rest[0] ?? process.env.N ?? 10) })
    console.log(`[batch-oracle] ${tasks.length} instances · k=${k} · models=[${models.join(', ')}] · conc=${conc} (router-free)`)
    const agg = { n: 0, pass1: 0, randomExp: 0, oracle: 0 }
    let done = 0
    await runPool(tasks, conc, async (task) => {
      const started = Date.now()
      try {
        const shots: Array<{ output: string; valid: boolean; score: number; prompt: string }> = []
        const origPrompt = String((task as { prompt?: unknown }).prompt ?? '')
        for (let i = 0; i < k; i += 1) {
          const shotModel = models[i % models.length] as string
          // The sent prompt IS the steer: a diverse shot carries its lens prefix, recorded
          // faithfully so the corpus captures what was actually steered (not the bare task).
          const sentPrompt = diverseStrategies ? `${diverseStrategies[i] ?? ''}\n\n${origPrompt}` : origPrompt
          const shotTask = diverseStrategies ? { ...task, prompt: sentPrompt } : task
          const artifact = await runShot(shotTask, shotModel, livenessMs)
          const score = artifact ? await adapter.judge(task, artifact) : { resolved: false, score: 0 }
          shots.push({ output: artifact, valid: score.resolved === true, score: score.score, prompt: sentPrompt })
        }
        const resolved = shots.map((s) => s.valid)
        const nResolved = resolved.filter(Boolean).length
        const pass1 = resolved[0] === true
        const oracle = nResolved > 0
        const randomExpected = k > 0 ? nResolved / k : 0
        if (corpusPath) {
          // local-research worker returns no token usage (it spawns opencode +
          // reads stdout), so cost/tokens are 0 here — the selector reads output +
          // valid only, which is what we capture faithfully.
          await appendRunRecord(corpusPath, {
            ts: new Date().toISOString(),
            benchmark: benchName,
            instanceId: task.id,
            condition: diverse ? `diverse@${k}` : `random@${k}`,
            model: models.join('+'),
            blindResolved: shots[0]?.valid === true,
            resolved: oracle,
            attempts: shots.map((s, i) => ({
              round: i,
              prompt: s.prompt,
              output: s.output,
              valid: s.valid,
              score: s.score,
              costUsd: 0,
              tokensIn: 0,
              tokensOut: 0,
              eventCount: 0,
              eventTypes: {},
            })),
            infraError: false,
          })
        }
        agg.n += 1
        if (pass1) agg.pass1 += 1
        if (oracle) agg.oracle += 1
        agg.randomExp += randomExpected
        done += 1
        console.log(
          `  [${done}/${tasks.length}] ${task.id}: ${nResolved}/${k} resolved · pass1=${pass1 ? '✓' : '·'} oracle=${oracle ? '✓' : '·'}`,
        )
        await fs.appendFile(
          out,
          `${JSON.stringify({ id: task.id, k, nResolved, pass1, oracle, randomExpected, secs: Math.round((Date.now() - started) / 1000) })}\n`,
        )
      } catch (err) {
        done += 1
        const msg = err instanceof Error ? err.message : String(err)
        console.log(`  [${done}/${tasks.length}] ${task.id}: ERR ${msg.slice(0, 70)}`)
        await fs.appendFile(
          out,
          `${JSON.stringify({ id: task.id, error: msg, secs: Math.round((Date.now() - started) / 1000) })}\n`,
        )
      }
    })
    const pct = (x: number) => (agg.n > 0 ? `${((x / agg.n) * 100).toFixed(1)}%` : 'n/a')
    console.log(`\n=== ORACLE HEADROOM (n=${agg.n}, k=${k}) ===`)
    console.log(`  pass@1 (blind):               ${pct(agg.pass1)}`)
    console.log(`  pass@${k} random-pick:           ${pct(agg.randomExp)}`)
    console.log(`  pass@${k} oracle (ceiling):      ${pct(agg.oracle)}`)
    console.log(
      `  ► headroom (oracle − pass@1):  ${(((agg.oracle - agg.pass1) / Math.max(agg.n, 1)) * 100).toFixed(1)} pp  ← is multi-shot worth pursuing?`,
    )
    console.log(`scorecard: ${out}`)
    return
  }

  if (cmd === 'batch-compare') {
    // THE driver-vs-blind experiment. Per instance, run the sequential-refine worker
    // (round 1 = blind; rounds 2..k refine in place) and judge BOTH the round-1 patch
    // (blind pass@1) and the final patch (refine). Reports blind% vs refine% + the
    // delta — does steering-by-refinement beat one shot on a representative set?
    // Router-free: local opencode worker + the deterministic SWE-bench judge.
    const fs = await import('node:fs/promises')
    const model = process.env.WORKER_MODEL ?? 'deepseek/deepseek-v4-pro'
    const livenessMs = process.env.OPENCODE_LIVENESS_MS ? Number(process.env.OPENCODE_LIVENESS_MS) : undefined
    const rounds = Number(process.env.ROUNDS ?? 3)
    // Worker selection:
    //   SANDBOX=1  → sandbox research worker (web-search capable agent; THE FinSearchComp path)
    //   RESEARCH=1 → local research-answer refine worker (no web; knowledge QA)
    //   default    → local code-patch refine worker
    const research = process.env.RESEARCH === '1'
    const useSandbox = process.env.SANDBOX === '1'
    const { solveRefineLocal } = await import('./worker-refine')
    const { solveRefineResearchLocal } = await import('./worker-research')
    const runRefine = async (
      task: BenchTask,
    ): Promise<{ first: string; final: string; detail?: string }> => {
      if (useSandbox) {
        const { solveSandboxResearch } = await import('./worker-sandbox-research')
        const s = await solveSandboxResearch(task, {
          sandboxBaseUrl: process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools',
          sandboxKey: must('TANGLE_API_KEY'),
          routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
          routerKey: must('TANGLE_API_KEY'),
          model,
          provider: process.env.WORKER_PROVIDER ?? 'openai',
          rounds,
          perRoundMs: livenessMs,
        })
        return { first: s.round1Answer, final: s.finalAnswer, detail: s.detail }
      }
      if (research) {
        const s = await solveRefineResearchLocal(task, { model, rounds, livenessMs })
        return { first: s.round1Answer, final: s.finalAnswer, detail: s.detail }
      }
      const s = await solveRefineLocal(task, { model, rounds, livenessMs })
      return { first: s.round1Patch, final: s.finalPatch, detail: s.detail }
    }
    // Equal-k compute control: `rounds` INDEPENDENT bare attempts (no steering),
    // same budget as the refine arm. Without it the headline "refine − blind"
    // confounds steering with extra compute; the confound-free steering effect is
    // refine@k − random@k. Always run (never flag-gated) — the same un-forgettable-
    // control discipline runSteeringExperiment enforces for the runLoop path, here
    // for the worker-fn path that harness doesn't fit. One bare shot per mode.
    const { solveShotLocal } = await import('./worker-local')
    const { solveResearchLocal } = await import('./worker-research')
    const runBareShot = async (task: BenchTask): Promise<string> => {
      if (useSandbox) {
        const { solveSandboxResearch } = await import('./worker-sandbox-research')
        const s = await solveSandboxResearch(task, {
          sandboxBaseUrl: process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools',
          sandboxKey: must('TANGLE_API_KEY'),
          routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
          routerKey: must('TANGLE_API_KEY'),
          model,
          provider: process.env.WORKER_PROVIDER ?? 'openai',
          rounds: 1,
          perRoundMs: livenessMs,
        })
        return s.finalAnswer
      }
      if (research) {
        const s = await solveResearchLocal(task, { model, livenessMs })
        return s.ok ? s.answer : ''
      }
      const s = await solveShotLocal(task, { model, livenessMs })
      return s.ok ? s.patch : ''
    }
    const conc = Number(process.env.CONCURRENCY ?? 3)
    const out = process.env.SCORECARD ?? '/tmp/swebench-compare.jsonl'
    await adapter.preflight()
    const _ids = process.env.IDS ? process.env.IDS.split(',') : undefined
    const tasks = await adapter.loadTasks(_ids ? { ids: _ids } : { limit: Number(rest[0] ?? process.env.N ?? 10) })
    console.log(
      `[batch-compare] ${tasks.length} instances · rounds=${rounds} (blind=r1 · random@${rounds} compute-control · refine=r${rounds}) · model=${model} · conc=${conc} · ~${2 * rounds} worker calls/instance`,
    )
    const agg = { n: 0, blind: 0, randomExp: 0, oracle: 0, refine: 0, gained: 0, lost: 0 }
    let done = 0
    await runPool(tasks, conc, async (task) => {
      const started = Date.now()
      try {
        const shot = await runRefine(task)
        const blind = shot.first.trim()
          ? (await adapter.judge(task, shot.first)).resolved === true
          : false
        const refine = shot.final.trim()
          ? (await adapter.judge(task, shot.final)).resolved === true
          : false
        // equal-k compute control: `rounds` independent bare attempts, no steering
        const bare: boolean[] = []
        for (let i = 0; i < rounds; i += 1) {
          const artifact = await runBareShot(task)
          bare.push(artifact.trim() ? (await adapter.judge(task, artifact)).resolved === true : false)
        }
        const nBare = bare.filter(Boolean).length
        const randomExpected = randomAtK(nBare, rounds) // expected pass of a random pick among k
        const oracleK = nBare > 0 // any-pass ceiling over the k bare shots
        agg.n += 1
        if (blind) agg.blind += 1
        agg.randomExp += randomExpected
        if (oracleK) agg.oracle += 1
        if (refine) agg.refine += 1
        if (refine && !blind) agg.gained += 1 // refinement RESCUED a blind failure
        if (blind && !refine) agg.lost += 1 // refinement BROKE a blind success
        done += 1
        const tag = refine && !blind ? '↑GAINED' : blind && !refine ? '↓LOST' : blind ? '=both✓' : '=both·'
        console.log(
          `  [${done}/${tasks.length}] ${task.id}: blind=${blind ? '✓' : '·'} rand@${rounds}=${nBare}/${rounds} refine=${refine ? '✓' : '·'} ${tag}`,
        )
        await fs.appendFile(
          out,
          `${JSON.stringify({ id: task.id, repo: String(task.metadata?.repo ?? ''), blind, refine, rounds, nBare, randomExpected, oracleK, detail: shot.detail, secs: Math.round((Date.now() - started) / 1000) })}\n`,
        )
      } catch (err) {
        done += 1
        const msg = err instanceof Error ? err.message : String(err)
        console.log(`  [${done}/${tasks.length}] ${task.id}: ERR ${msg.slice(0, 70)}`)
        await fs.appendFile(
          out,
          `${JSON.stringify({ id: task.id, error: msg, secs: Math.round((Date.now() - started) / 1000) })}\n`,
        )
      }
    })
    const rep = summarizeCompare(agg)
    const pct = (x: number) => `${(x * 100).toFixed(1)}%`
    const pp = (x: number) => `${(x * 100).toFixed(1)} pp`
    console.log(`\n=== BLIND vs RANDOM@${rounds} vs REFINE (n=${agg.n}, k=${rounds}) ===`)
    console.log(`  blind     (pass@1):           ${pct(rep.blindRate)}  (${agg.blind}/${agg.n})`)
    console.log(`  random@${rounds}  (compute control):  ${pct(rep.randomRate)}`)
    console.log(`  oracle@${rounds}  (ceiling):          ${pct(rep.oracleRate)}`)
    console.log(`  refine    (r${rounds} final):           ${pct(rep.refineRate)}  (${agg.refine}/${agg.n})`)
    console.log(`  ► Δ compute (random@${rounds} − blind):   ${pp(rep.dCompute)}   (more compute, no steering)`)
    console.log(
      `  ► Δ steer   (refine − random@${rounds}):  ${pp(rep.dSteer)}   ← steering effect, confound-free  [rescued ${agg.gained}, broke ${agg.lost} vs blind]`,
    )
    console.log(`scorecard: ${out}`)
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
