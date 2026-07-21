/**
 * live-improve-campaign — the FIRST LIVE self-improvement campaign on the merged
 * machinery: `improve()` (surface 'rollout-policy') tunes the structuralRollout dials
 * { k, repairRounds, testgen } against REAL HumanEval with a REAL worker model, and the
 * library's own held-out gate (defaultProductionGate: paired bootstrap over held-out
 * scenarios, ship iff CI.low > deltaThreshold 0.05) makes the ship/hold call. No human
 * picks winners; this script only wires the real evaluator into the loop and reports.
 *
 * Wiring template: rollout-policy.test.ts's end-to-end improve() run, with the fake
 * judge gradient replaced by the real evaluator (the smoke's harness):
 *   agent(surface, scenario) = runAgentic(structuralRollout(parsed policy)) over an
 *   INERT verifier surface (no hidden signal reaches selection/repair), visible checks
 *   via the shipped sandboxCheckRunner over a docker --network=none exec channel, then
 *   SCRIPT-SIDE hidden grading of the locked winner candidate by the nonce-sentinel
 *   judge (hev-structural's runHiddenJudge pattern: pass requires exit 0 AND the
 *   per-call nonce in stdout — a candidate printing a forged verdict cannot pass).
 *
 * Honesty split:
 *   - DEV = HumanEval index [0, DEV_N) and HELD-OUT = [DEV_N, DEV_N+HOLD_N) — fixed,
 *     disjoint slices, passed as explicit `budget.holdoutScenarios` so the library's
 *     own train/holdout split machinery enforces disjointness (it throws on overlap).
 *   - The proposer is deterministic enumeration; `analyzeGeneration: null` keeps the
 *     findings channel empty, so the improver's context is ONLY the DEV composites the
 *     loop itself accumulates. Held-out cells run after all generations, gate-side only.
 *   - The gate decision is `result.gateDecision` from the library — never recomputed here.
 *
 * Run (key via dotenvx; never in the shell history):
 *   cd ~/company/devops/secrets && dotenvx run -f agent-state.env -- bash -c ' \
 *     cd /home/drew/code/agent-runtime-swe && \
 *     HUMANEVAL_GZ=/abs/HumanEval.jsonl.gz npx tsx bench/src/live-improve-campaign.mts'
 * Smoke first (cost gate): SMOKE=1 shrinks to 6 dev + 6 held-out tasks, 1 generation,
 * population 2 — proves the full path completes before the real burn.
 */

import { execFile, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  DispatchContext,
  JudgeConfig,
  MutableSurface,
  Scenario,
} from '@tangle-network/agent-eval/contract'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { improve } from '../../src/improvement/improve'
import {
  parseRolloutPolicy,
  ROLLOUT_POLICY_EXTENSION,
  serializeRolloutPolicy,
  structuralRolloutPolicyFromProfile,
} from '../../src/improvement/rollout-policy'
import {
  type AgenticRunResult,
  type CheckExecChannel,
  type CheckOutcome,
  type CheckRunner,
  createVerifierEnvironment,
  runAgentic,
  sandboxCheckRunner,
  structuralRollout,
  type StructuralRolloutResult,
} from '../../src/runtime/index'
import { basePrompt, type HumanEvalTask, loadHumanEval } from './benchmarks/humaneval'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

const SMOKE = process.env.SMOKE === '1'
const DEV_N = Number(process.env.DEV_N ?? (SMOKE ? 6 : 60))
const HOLD_N = Number(process.env.HOLD_N ?? (SMOKE ? 6 : 60))
const GENERATIONS = Number(process.env.GENERATIONS ?? (SMOKE ? 1 : 2))
const POPULATION = Number(process.env.POPULATION ?? (SMOKE ? 2 : 4))
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 8)
const DOCKER_CONCURRENCY = Number(process.env.DOCKER_CONCURRENCY ?? 6)
// Default worker: Qwen2.5-7B — the second model of the strategy's measured basis
// (Llama-3-8B/Qwen2.5-7B). The original smoke worker (Meta-Llama-3-8B-Instruct-Lite)
// and every other 8B Llama variant were retired from Together serverless
// (`model_not_available`, verified 2026-07); this is the closest live weak worker.
const MODEL = process.env.MODEL ?? 'Qwen/Qwen2.5-7B-Instruct-Turbo'
const BASE = process.env.ROUTER_BASE ?? 'https://api.together.xyz/v1'
const TEMP = Number(process.env.TEMPERATURE ?? 0.8)
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 2500)
const DOLLARS = Number(process.env.DOLLARS ?? 15)
const RUN_DIR = process.env.RUN_DIR ?? join(tmpdir(), `live-improve-campaign-${Date.now()}`)

const systemPrompt = 'You are an expert Python programmer.'
const dockerImage = 'python:3.12-slim'
const dockerTimeoutMs = Number(process.env.DOCKER_TIMEOUT_MS ?? 20000)

// ── Docker: ONE semaphored --network=none exec channel for BOTH judges ───────────────
// Visible checks (sandboxCheckRunner) and the hidden nonce judge each pipe a python
// program as `printf '%s' '<b64>' | base64 -d | python3 -`; every container passes
// through one global semaphore so task-level concurrency cannot stampede the daemon.

let dockerInFlight = 0
const dockerWaiters: Array<() => void> = []
async function withDockerSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (dockerInFlight >= DOCKER_CONCURRENCY) await new Promise<void>((r) => dockerWaiters.push(r))
  dockerInFlight += 1
  try {
    return await fn()
  } finally {
    dockerInFlight -= 1
    dockerWaiters.shift()?.()
  }
}

const containerPrefix = `lic-${process.pid}`
let containerSeq = 0

function reapContainers(): void {
  try {
    const ids = execFileSync('docker', ['ps', '-aq', '--filter', `name=${containerPrefix}`], {
      timeout: 10000,
    })
      .toString()
      .trim()
    if (ids) execFileSync('docker', ['rm', '-f', ...ids.split('\n')], { timeout: 15000 })
  } catch {
    /* reaper is best-effort by design */
  }
}
process.on('SIGINT', () => {
  reapContainers()
  process.exit(130)
})
process.on('SIGTERM', () => {
  reapContainers()
  process.exit(143)
})

const dockerBox: CheckExecChannel = {
  exec(command, options) {
    const timeoutMs = options?.timeoutMs ?? dockerTimeoutMs
    return withDockerSlot(
      () =>
        new Promise((resolve, reject) => {
          const name = `${containerPrefix}-${containerSeq++}`
          let settled = false
          const reap = () => execFile('docker', ['rm', '-f', name], () => {})
          const finish = (r: { exitCode: number; stdout: string; stderr: string }) => {
            if (settled) return
            settled = true
            clearTimeout(backstop)
            reap()
            resolve(r)
          }
          const fail = (e: Error) => {
            if (settled) return
            settled = true
            clearTimeout(backstop)
            reap()
            reject(e)
          }
          // execFile's timeout kills the docker CLIENT; a hung container could leave
          // the callback unfired. The backstop guarantees resolution and the named
          // reap kills the stray container.
          const backstop = setTimeout(
            () => finish({ exitCode: 124, stdout: '', stderr: 'timed out (backstop)' }),
            timeoutMs + 3000,
          )
          execFile(
            'docker',
            ['run', '--rm', '--name', name, '--network=none', '--cpus=1', '--memory=512m', dockerImage, 'sh', '-c', command],
            { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 },
            (err, stdout, stderr) => {
              if (err) {
                const e = err as NodeJS.ErrnoException & { code?: number | string }
                if (e.code === 'ENOENT') {
                  fail(new Error('docker binary not found on PATH'))
                  return
                }
                if (/cannot connect to the docker daemon|is the docker daemon running|permission denied while trying to connect/i.test(stderr ?? '')) {
                  fail(new Error(`docker daemon unreachable: ${(stderr ?? '').slice(0, 200)}`))
                  return
                }
                finish({ exitCode: typeof e.code === 'number' ? e.code : 1, stdout: stdout ?? '', stderr: stderr ?? '' })
                return
              }
              finish({ exitCode: 0, stdout: stdout ?? '', stderr: stderr ?? '' })
            },
          )
        }),
    )
  },
}

// ── The hidden nonce judge (script-side, AFTER the strategy locks its artifact) ──────
// Pass requires the per-call nonce sentinel that check() prints AFTER succeeding —
// exit-0-before-check (a candidate calling sys.exit(0)) is a fail here, where trusting
// the exit code alone would score it a pass. Nothing from this run reaches the strategy.

function buildHiddenProgram(task: HumanEvalTask, candidate: string, nonce: string): string {
  return `${task.prompt}\n${candidate}\n\n${task.test}\n\ncheck(${task.entryPoint})\nprint("HIDDEN-${nonce} PASS")\n`
}

async function runHiddenJudge(
  task: HumanEvalTask,
  candidate: string,
): Promise<{ pass: number; detail?: string }> {
  const nonce = randomBytes(8).toString('hex')
  const b64 = Buffer.from(buildHiddenProgram(task, candidate, nonce), 'utf8').toString('base64')
  const r = await dockerBox.exec(`printf '%s' '${b64}' | base64 -d | python3 -`, {
    timeoutMs: dockerTimeoutMs,
  })
  if (r.exitCode === 0 && r.stdout.includes(`HIDDEN-${nonce} PASS`)) return { pass: 1 }
  return { pass: 0, detail: (r.stderr || r.stdout).slice(-300) || 'timed out (no output)' }
}

// ── Scenarios: fixed disjoint slices of HumanEval ─────────────────────────────────────

interface HevScenario extends Scenario {
  kind: 'humaneval'
}

const taskById = new Map<string, HumanEvalTask>()

// ── The real evaluator: one cell = one structuralRollout run + hidden grade ──────────

interface CellArtifact {
  taskId: string
  policy: string
  /** Hidden nonce-judge grade of the FINAL selected candidate: {0,1}. */
  pass: number
  detail?: string
  repairStop: string
  shots: number
  completions: number
  authoredChecks: number
  tokens: { input: number; output: number }
  usd: number
  ms: number
}

interface ScoredCandidate {
  candidate: string
  outcome: CheckOutcome
}
function recordingRunner(inner: CheckRunner, log: ScoredCandidate[]): CheckRunner {
  return {
    async run(candidate, checks, ctx) {
      const outcome = await inner.run(candidate, checks, ctx)
      log.push({ candidate, outcome })
      return outcome
    },
  }
}

// Global spend meter (every cell of every phase — baseline, generations, holdout).
const spend = { cells: 0, llmCalls: 0, tokensIn: 0, tokensOut: 0, usd: 0, hiddenPass: 0 }

async function evaluateCell(
  surface: MutableSurface,
  scenario: HevScenario,
  ctx: DispatchContext,
): Promise<CellArtifact> {
  const policy = parseRolloutPolicy(surface)
  if (!policy) {
    throw new Error(`agent: surface carries no valid rollout policy: ${String(surface).slice(0, 120)}`)
  }
  const task = taskById.get(scenario.id)
  if (!task) throw new Error(`agent: unknown scenario id ${scenario.id}`)

  const scored: ScoredCandidate[] = []
  const strategy = structuralRollout({
    policy: { ...policy, temperature: TEMP },
    checkRunner: recordingRunner(sandboxCheckRunner({ box: dockerBox }), scored),
  })
  // INERT check: the strategy's harness-verified score channel carries no hidden
  // signal — hidden grading happens below, after the rollout locks its artifact.
  const inertSurface = createVerifierEnvironment({
    name: 'humaneval-inert',
    check: () => ({ passes: 0, total: 1, errored: 0 }),
  })
  const result = (await runAgentic({
    surface: inertSurface,
    task: {
      id: task.taskId,
      systemPrompt,
      userPrompt: basePrompt(task),
      meta: { entryPoint: task.entryPoint },
    },
    routerBaseUrl: BASE,
    routerKey: must('TOGETHER_API_KEY'),
    model: MODEL,
    temperature: TEMP,
    maxTokens: MAX_TOKENS,
    innerTurns: 2,
    strategy,
    // The strategy's documented sizing: k samples + repair rounds + the check-author consult.
    budget: policy.k + policy.repairRounds + 1,
  })) as AgenticRunResult & StructuralRolloutResult

  // Backend integrity: report REAL usage on every cell (expectUsage 'assert' upstream).
  ctx.cost.observe(result.usd, 'together')
  ctx.cost.observeTokens(result.tokens)

  const winner = result.selection.find((r) => r.selected)
  if (!winner) {
    throw new Error(`${task.taskId}: no receipt marked selected (repairStop=${result.repairStop})`)
  }
  const rec = scored[winner.candidateIndex]
  if (!rec) {
    throw new Error(
      `${task.taskId}: selected receipt #${winner.candidateIndex} has no recorded candidate (${scored.length} scored)`,
    )
  }

  const hidden = await runHiddenJudge(task, rec.candidate)

  spend.cells += 1
  spend.llmCalls += result.completions
  spend.tokensIn += result.tokens.input
  spend.tokensOut += result.tokens.output
  spend.usd += result.usd
  spend.hiddenPass += hidden.pass

  const artifact: CellArtifact = {
    taskId: task.taskId,
    policy: serializeRolloutPolicy(policy),
    pass: hidden.pass,
    ...(hidden.detail ? { detail: hidden.detail } : {}),
    repairStop: result.repairStop,
    shots: result.shots,
    completions: result.completions,
    authoredChecks: result.authoredChecks,
    tokens: result.tokens,
    usd: result.usd,
    ms: result.ms,
  }
  appendFileSync(
    join(RUN_DIR, 'cells.jsonl'),
    `${JSON.stringify({ cellId: ctx.cellId, generation: ctx.generation ?? null, ...artifact, detail: undefined })}\n`,
  )
  console.log(
    `  [cell ${String(spend.cells).padStart(3)}] ${task.taskId.padEnd(14)} ${artifact.policy.padEnd(38)} hidden=${hidden.pass ? 'PASS' : 'fail'} ${result.repairStop} calls=${result.completions}`,
  )
  return artifact
}

// The in-loop judge is a deterministic transcriber of the script-side hidden grade —
// the grading itself never runs inside the strategy or the proposer's view.
const hiddenJudge: JudgeConfig<CellArtifact, HevScenario> = {
  name: 'hidden-nonce-judge',
  dimensions: [
    { key: 'hidden', description: 'HumanEval hidden check() suite (docker --network=none, nonce sentinel)' },
  ],
  score: ({ artifact }) => ({
    dimensions: { hidden: artifact.pass },
    composite: artifact.pass,
    notes: artifact.pass ? 'hidden PASS' : `hidden fail: ${(artifact.detail ?? '').slice(0, 160)}`,
  }),
}

// ── Reporting helpers (read the library's own result objects; never re-decide) ───────

interface CampaignLike {
  cells: Array<{ error?: string | null; judgeScores: Record<string, { composite: number }> }>
}
function passStats(campaign: CampaignLike): { passed: number; scored: number; errored: number; rate: number } {
  let passed = 0
  let scored = 0
  let errored = 0
  for (const cell of campaign.cells) {
    if (cell.error) {
      errored += 1
      continue
    }
    scored += 1
    const scores = Object.values(cell.judgeScores)
    const composite = scores.length === 0 ? 0 : scores.reduce((s, j) => s + j.composite, 0) / scores.length
    if (composite >= 0.999) passed += 1
  }
  return { passed, scored, errored, rate: scored > 0 ? passed / scored : 0 }
}
const pct = (x: number) => `${(100 * x).toFixed(1)}%`

async function main(): Promise<void> {
  must('TOGETHER_API_KEY')
  mkdirSync(RUN_DIR, { recursive: true })
  const started = Date.now()

  const all = await loadHumanEval(DEV_N + HOLD_N, 0)
  if (all.length !== DEV_N + HOLD_N) {
    throw new Error(`expected ${DEV_N + HOLD_N} tasks, loaded ${all.length}`)
  }
  const devTasks = all.slice(0, DEV_N)
  const holdTasks = all.slice(DEV_N)
  for (const t of all) taskById.set(t.taskId, t)

  const toScenario = (t: HumanEvalTask): HevScenario => ({ id: t.taskId, kind: 'humaneval' })
  const scenarios = all.map(toScenario)
  const holdoutScenarios = holdTasks.map(toScenario)

  const baselinePolicy = { k: 5, repairRounds: 2, testgen: 6 }
  const profile: AgentProfile = {
    name: 'humaneval-structural-worker',
    extensions: { [ROLLOUT_POLICY_EXTENSION]: baselinePolicy },
  }

  console.log('=== LIVE self-improvement campaign · improve() surface rollout-policy ===')
  console.log(`  worker: ${MODEL} @ ${BASE} (temp=${TEMP}, maxTokens=${MAX_TOKENS}, innerTurns=2)`)
  console.log(
    `  DEV slice      : HumanEval index [0, ${DEV_N}) — ${devTasks[0]?.taskId} .. ${devTasks[devTasks.length - 1]?.taskId} (n=${devTasks.length})`,
  )
  console.log(
    `  HELD-OUT slice : HumanEval index [${DEV_N}, ${DEV_N + HOLD_N}) — ${holdTasks[0]?.taskId} .. ${holdTasks[holdTasks.length - 1]?.taskId} (n=${holdTasks.length})`,
  )
  console.log(`  baseline policy: ${JSON.stringify(baselinePolicy)}`)
  console.log(
    `  budget: generations=${GENERATIONS} population<=${POPULATION} reps=1 concurrency=${CONCURRENCY} docker<=${DOCKER_CONCURRENCY} ceiling=$${DOLLARS}`,
  )
  console.log(`  gate: library defaultProductionGate (paired bootstrap on held-out, ship iff CI.low > 0.05)`)
  console.log(`  runDir: ${RUN_DIR}`)
  console.log(`\n  profile BEFORE: ${JSON.stringify(profile)}\n`)

  const result = await improve<HevScenario, CellArtifact>(profile, [], {
    surface: 'rollout-policy',
    scenarios,
    judge: hiddenJudge,
    agent: evaluateCell,
    budget: {
      generations: GENERATIONS,
      populationSize: POPULATION,
      maxConcurrency: CONCURRENCY,
      holdoutScenarios,
      reps: 1,
      dollars: DOLLARS,
    },
    runDir: RUN_DIR,
    // Deterministic proposer, empty findings channel: the improver's context is ONLY
    // the DEV composites the loop accumulates — no distilled failure text, no trace
    // paths, and (by the loop's own structure) never a held-out cell.
    analyzeGeneration: null,
  })

  const loop = result.raw.raw
  const wallMin = (Date.now() - started) / 60000

  console.log('\n── DEV (train) results — what the improver saw ──')
  const baseDev = passStats(loop.baselineCampaign)
  console.log(
    `  gen -1 baseline  ${serializeRolloutPolicy(structuralRolloutPolicyFromProfile(profile)!).padEnd(38)} DEV ${baseDev.passed}/${baseDev.scored} = ${pct(baseDev.rate)}  (errored ${baseDev.errored})`,
  )
  for (const gen of loop.generations) {
    const surfaceByHash = new Map(gen.surfaces.map((s) => [s.surfaceHash, s]))
    const promotedHashes = new Set(gen.record.promoted)
    for (const cand of gen.record.candidates) {
      const s = surfaceByHash.get(cand.surfaceHash)
      const stats = s ? passStats(s.campaign) : undefined
      console.log(
        `  gen ${String(gen.record.generationIndex).padStart(2)} ${String(cand.label ?? '').padEnd(16)} ${String(s?.surface ?? '?').padEnd(38)} DEV ${stats ? `${stats.passed}/${stats.scored} = ${pct(stats.rate)} (errored ${stats.errored})` : '?'}${promotedHashes.has(cand.surfaceHash) ? '  [promoted]' : ''}`,
      )
    }
  }
  console.log(`  training winner: ${String(loop.winnerSurface)}${loop.winnerLabel ? ` (${loop.winnerLabel})` : ''}`)

  console.log('\n── HELD-OUT gate — the library decides ──')
  const baseHold = passStats(loop.baselineOnHoldout)
  const winHold = passStats(loop.winnerOnHoldout)
  console.log(
    `  baseline on held-out : ${baseHold.passed}/${baseHold.scored} = ${pct(baseHold.rate)}  (errored ${baseHold.errored})`,
  )
  console.log(
    `  winner   on held-out : ${winHold.passed}/${winHold.scored} = ${pct(winHold.rate)}  (errored ${winHold.errored})`,
  )
  console.log(`  gate decision: ${result.gateDecision.toUpperCase()}  (lift ${result.lift >= 0 ? '+' : ''}${result.lift.toFixed(3)})`)
  for (const reason of loop.gateResult.reasons) console.log(`    reason: ${reason}`)
  for (const g of loop.gateResult.contributingGates) {
    console.log(`    gate[${g.name}] passed=${g.passed} detail=${JSON.stringify(g.detail).slice(0, 300)}`)
  }

  console.log('\n── ship/hold outcome ──')
  console.log(`  shipped: ${result.shipped}`)
  console.log(`  profile AFTER : ${JSON.stringify(result.profile)}`)
  if (result.shipped) {
    console.log(`  policy change : ${serializeRolloutPolicy(structuralRolloutPolicyFromProfile(profile)!)} → ${serializeRolloutPolicy(structuralRolloutPolicyFromProfile(result.profile)!)}`)
  } else {
    console.log('  policy change : none (gate held — baseline policy stays)')
  }

  console.log('\n── spend / provenance ──')
  console.log(
    `  cells ${spend.cells} · llm calls ${spend.llmCalls} · tokens ${spend.tokensIn} in / ${spend.tokensOut} out · router-priced $${spend.usd.toFixed(4)} · loop-reported $${result.raw.totalCostUsd.toFixed(4)}`,
  )
  console.log(`  wall ${wallMin.toFixed(1)} min · runDir ${RUN_DIR} (cells.jsonl + campaign cells + loop provenance)`)
  reapContainers()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  reapContainers()
  process.exit(1)
})
