/**
 * Terminal-Bench blind-vs-refine runner.
 *
 * Reuses Terminal-Bench's OPEN-SOURCE infrastructure end to end: tb's native
 * opencode agent runs IN the task's Docker container and the task's OWN verifier
 * scores it (results.json). There is NO hand-rolled agent and NO hand-rolled
 * judge here.
 *
 * Per task:
 *   ROUND 1 (blind) — Terminal-Bench runs one exact AgentProfile → parse results.json →
 *                     resolved_1. This IS blind pass@1.
 *   ROUND r (refine, only if blind failed AND rounds>1) — extract a compact
 *                     summary of round 1's commands + terminal state + the
 *                     failing tests from tb's own run dir, then
 *                     `tb run --agent-import-path
 *                     tb_agents.opencode_refine_agent:OpenCodeRefineAgent
 *                     --agent-kwarg prior_attempt=<summary>`. The refine agent
 *                     prepends an evidence-gated refine directive; with no
 *                     prior_attempt it is byte-for-byte the plain opencode agent,
 *                     so round 1 == blind by construction.
 *   Stop early once resolved.
 *
 * Reports blind (resolved_1) vs refine (resolved_final) + rescued/broke counts,
 * matching src/run.ts `batch-compare`. tb is shelled through bench/.venv exactly
 * as src/benchmarks/swe-bench.ts shells its venv.
 */

import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { homedir } from 'node:os'
import { agentProfileSchema } from '@tangle-network/agent-interface'

import { appendRunRecord, type AttemptRecord, type RunRecord } from './corpus'
import { runPool } from './run-pool'

const BENCH_ROOT = fileURLToPath(new URL('..', import.meta.url))
const TB = join(BENCH_ROOT, '.venv', 'bin', 'tb')
const RUNS_DIR = join(BENCH_ROOT, 'runs')
const PROFILE_AGENT_IMPORT = 'tb_agents.opencode_router_agent:OpenCodeRouterAgent'
// The durable learning-flywheel corpus (docs/learning-flywheel.md). terminal-bench
// is bench-orchestrated (tb owns the containers) so it cannot use buildRunRecord,
// which consumes runAgentRounds Iterations; instead each task's per-round tb artifacts are
// folded into one RunRecord here so the corpus is genuinely cross-benchmark
// (finsearch-loop.ts writes the same store from the runAgentRounds path).
const CORPUS = process.env.CORPUS ?? join(BENCH_ROOT, 'corpus', 'terminal.jsonl')

const DATASET = process.env.TB_DATASET ?? 'terminal-bench-core==0.1.1'
const MODEL = process.env.TB_MODEL ?? 'deepseek-v4-flash'
const PROVIDER = process.env.TB_PROVIDER ?? 'tangle-router'
const PROFILE = agentProfileSchema.parse({
  name: 'terminal-compare-worker',
  harness: 'opencode',
  model: { provider: PROVIDER, default: MODEL },
  prompt: {
    systemPrompt:
      'Solve the Terminal-Bench task completely in the provided container and verify the result before finishing.',
  },
  permission: {
    edit: 'allow',
    bash: 'allow',
    webfetch: 'allow',
    read: 'allow',
    write: 'allow',
    external_directory: 'allow',
  },
})
const PROFILE_MODEL = MODEL.includes('/') ? MODEL : `${PROVIDER}/${MODEL}`
const PROFILE_PATH = join(RUNS_DIR, 'terminal-compare.profile.json')
const ROUNDS = Math.max(1, Number(process.env.ROUNDS ?? 2))
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY ?? 2))
// Per-round wall-clock cap (ms). tb itself enforces task timeouts; this is the
// outer kill-switch so a wedged container can't burn the budget.
const ROUND_CAP_MS = Math.max(60_000, Number(process.env.ROUND_CAP_MS ?? 1_200_000))
// tb's own agent-step timeout. Bounds each round's in-container agent work so a
// slow model can't blow the per-round budget; tb scores the container as-is when
// it fires (failure_mode=agent_timeout). Unset → tb's task default.
const TB_AGENT_TIMEOUT_SEC = process.env.TB_AGENT_TIMEOUT_SEC
  ? Number(process.env.TB_AGENT_TIMEOUT_SEC)
  : undefined
const DEFAULT_IDS = ['hello-world', 'fix-permissions']
const IDS = (process.env.IDS ? process.env.IDS.split(',') : DEFAULT_IDS)
  .map((s) => s.trim())
  .filter(Boolean)

interface BenchmarkResults {
  resolved_ids?: string[]
  unresolved_ids?: string[]
  results?: Array<{
    task_id?: string
    is_resolved?: boolean
    parser_results?: Record<string, string>
    instruction?: string
    failure_mode?: string
    total_input_tokens?: number
    total_output_tokens?: number
  }>
}

interface RoundOutcome {
  round: number
  resolved: boolean
  runId: string
  outputDir: string
  trialDir: string | null
}

/** Resolve the router key the in-container opencode agent uses (sk-tan… via the Tangle router). */
function must(name: string): string {
  const v = process.env[name]
  if (!v || !v.trim()) throw new Error(`missing required env ${name}`)
  return v
}

function envForTb(): NodeJS.ProcessEnv {
  // tb's opencode agent (provider=openai) forwards OPENAI_API_KEY / OPENAI_BASE_URL
  // into the container. Point them at the Tangle router.
  return {
    ...process.env,
    OPENAI_API_KEY: must('OPENAI_API_KEY'),
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ?? 'https://router.tangle.tools/v1',
  }
}

/** Shell tb through the bench venv with a hard wall-clock cap; fail loud on nonzero. */
function runTb(args: string[], runId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      TB,
      args,
      { cwd: BENCH_ROOT, env: envForTb(), maxBuffer: 1024 * 1024 * 256, timeout: ROUND_CAP_MS },
      (err) => {
        if (err) {
          const killed = (err as { killed?: boolean }).killed
          reject(
            new Error(
              `tb run failed (runId=${runId}${killed ? ', killed by ROUND_CAP_MS' : ''}): ${err.message}`,
            ),
          )
          return
        }
        resolve()
      },
    )
    child.stdout?.on('data', (d) => process.stdout.write(String(d)))
    child.stderr?.on('data', (d) => process.stderr.write(String(d)))
  })
}

/** Read tb's top-level results.json for a run and return whether taskId resolved. */
async function readResolved(outputDir: string, taskId: string): Promise<boolean> {
  const raw = await readFile(join(outputDir, 'results.json'), 'utf8')
  const parsed = JSON.parse(raw) as BenchmarkResults
  if (Array.isArray(parsed.resolved_ids)) return parsed.resolved_ids.includes(taskId)
  // Fall back to the per-trial flag — never silently report a zero.
  const trial = parsed.results?.find((r) => r.task_id === taskId)
  if (!trial || typeof trial.is_resolved !== 'boolean') {
    throw new Error(`results.json for ${taskId} has neither resolved_ids nor a per-trial is_resolved`)
  }
  return trial.is_resolved
}

/** Locate the single trial dir tb wrote under <outputDir>/<taskId>/<trial>/. */
async function findTrialDir(outputDir: string, taskId: string): Promise<string | null> {
  const taskDir = join(outputDir, taskId)
  let entries: string[]
  try {
    entries = await readdir(taskDir)
  } catch {
    return null
  }
  const trials: Array<{ dir: string; mtime: number }> = []
  for (const e of entries) {
    const p = join(taskDir, e)
    const s = await stat(p)
    if (s.isDirectory()) trials.push({ dir: p, mtime: s.mtimeMs })
  }
  trials.sort((a, b) => b.mtime - a.mtime)
  return trials[0]?.dir ?? null
}

async function readFileSafe(path: string, tailBytes = 0): Promise<string> {
  try {
    const txt = await readFile(path, 'utf8')
    return tailBytes > 0 && txt.length > tailBytes ? txt.slice(-tailBytes) : txt
  } catch {
    return ''
  }
}

/**
 * Build the evidence-gated prior-attempt summary from tb's OWN round-1 artifacts:
 * the opencode invocation, the failing tests (parser_results), and the tail of the
 * post-agent terminal pane. Compact + bounded so it fits an --agent-kwarg.
 */
async function buildPriorSummary(outcome: RoundOutcome, taskId: string): Promise<string> {
  const parts: string[] = []

  if (outcome.trialDir) {
    const trialResultsRaw = await readFileSafe(join(outcome.trialDir, 'results.json'))
    if (trialResultsRaw) {
      try {
        const tr = JSON.parse(trialResultsRaw) as { parser_results?: Record<string, string> }
        const parser = tr.parser_results
        if (parser) {
          const failed = Object.entries(parser)
            .filter(([, v]) => v !== 'passed')
            .map(([k, v]) => `${k}: ${v}`)
          if (failed.length) parts.push(`FAILING TESTS:\n${failed.join('\n')}`)
        }
      } catch {
        // non-fatal: fall through to other evidence
      }
    }

    const commands = await readFileSafe(join(outcome.trialDir, 'commands.txt'))
    if (commands) {
      // The opencode invocation line carries the instruction the agent actually ran.
      const opencodeLine = commands
        .split('\n')
        .find((l) => l.includes('opencode --model'))
      if (opencodeLine) parts.push(`AGENT INVOCATION:\n${opencodeLine.slice(0, 600)}`)
    }

    const postAgent = await readFileSafe(join(outcome.trialDir, 'panes', 'post-agent.txt'), 1500)
    if (postAgent.trim()) parts.push(`TERMINAL STATE AFTER ATTEMPT (tail):\n${postAgent.trim()}`)

    const postTest = await readFileSafe(join(outcome.trialDir, 'panes', 'post-test.txt'), 1200)
    if (postTest.trim()) parts.push(`TEST OUTPUT (tail):\n${postTest.trim()}`)
  }

  if (parts.length === 0) {
    parts.push(
      `The previous attempt ran tb's opencode agent on "${taskId}" and the task's tests did not pass. No transcript artifacts were captured.`,
    )
  }
  return parts.join('\n\n')
}

const TRACE_TAIL_MAX = 600
const OUTPUT_TAIL_MAX = 2000

/** The fields the corpus reads from tb's top-level results.json per round. */
interface TbRoundFacts {
  instruction: string
  failureMode?: string
  /** tb's own token counts. Absent (not 0) when tb didn't record them — a
   *  missing/unparseable results.json or a non-numeric field is "unmeasured",
   *  never a fabricated 0 (which would read as a free round downstream). */
  tokensIn?: number
  tokensOut?: number
}

/** Pull the bare task instruction, failure mode, and token counts tb recorded for
 *  this round. The instruction tb records is always the unmodified task statement —
 *  the refine directive is injected inside the agent, after tb captures it — so the
 *  refine steer is taken from `priorSteer`, not from here. */
async function readRoundFacts(outcome: RoundOutcome, taskId: string): Promise<TbRoundFacts> {
  const raw = await readFileSafe(join(outcome.outputDir, 'results.json'))
  if (!raw) return { instruction: '' }
  let parsed: BenchmarkResults
  try {
    parsed = JSON.parse(raw) as BenchmarkResults
  } catch {
    return { instruction: '' }
  }
  const trial = parsed.results?.find((r) => r.task_id === taskId)
  return {
    instruction: typeof trial?.instruction === 'string' ? trial.instruction : '',
    failureMode: typeof trial?.failure_mode === 'string' ? trial.failure_mode : undefined,
    // Only set when tb actually surfaced a number — absence stays absent.
    ...(typeof trial?.total_input_tokens === 'number' ? { tokensIn: trial.total_input_tokens } : {}),
    ...(typeof trial?.total_output_tokens === 'number' ? { tokensOut: trial.total_output_tokens } : {}),
  }
}

/**
 * Fold one tb round into a corpus AttemptRecord. `priorSteer` is the evidence-gated
 * refine payload the runner injected for this round (empty for round 1, which is the
 * bare blind attempt). tb does not expose a structured event stream, so eventCount /
 * eventTypes are 0/{}; costUsd is OMITTED (tb reports no cost — we never fabricate
 * a 0). traceTail = the failing-test + terminal-state evidence summary (the same
 * one fed forward as the next steer).
 */
async function roundToAttempt(
  outcome: RoundOutcome,
  taskId: string,
  priorSteer: string,
): Promise<AttemptRecord> {
  const facts = await readRoundFacts(outcome, taskId)
  // Round 1 = the bare task instruction (blind). Refine rounds = the steer actually
  // injected: the evidence-gated prior summary carrying the round's failure info.
  const prompt =
    outcome.round === 1 || !priorSteer
      ? facts.instruction
      : `REFINE STEER (prepended to the task instruction):\n${priorSteer}\n\n--- ORIGINAL TASK ---\n${facts.instruction}`
  const transcript = outcome.trialDir
    ? await readFileSafe(join(outcome.trialDir, 'panes', 'post-agent.txt'), OUTPUT_TAIL_MAX)
    : ''
  const traceSummary = await buildPriorSummary(outcome, taskId)
  return {
    round: outcome.round,
    prompt,
    output: transcript.trim(),
    valid: outcome.resolved,
    score: outcome.resolved ? 1 : 0,
    tokensIn: facts.tokensIn,
    tokensOut: facts.tokensOut,
    eventCount: 0,
    eventTypes: {},
    traceTail: traceSummary.slice(-TRACE_TAIL_MAX),
    // A failed round is a wrong answer, not an attempt error; surface only a concrete
    // tb-reported failure mode (e.g. agent_timeout). tb writes 'unset'/'none' when it
    // has no specific mode — that carries no signal, so it is not an error.
    error: informativeFailureMode(facts.failureMode),
  }
}

/** tb's failure_mode, normalized: undefined for its no-signal sentinels. */
function informativeFailureMode(mode: string | undefined): string | undefined {
  if (!mode) return undefined
  const m = mode.trim().toLowerCase()
  if (m === '' || m === 'unset' || m === 'none') return undefined
  return `failure_mode=${mode}`
}

/**
 * Build and persist one flywheel RunRecord per task from terminal-compare's own
 * round data — no buildRunRecord (that consumes runAgentRounds Iterations; tb is not
 * runAgentRounds-shaped). condition = 'refine@k' when a refine budget was available,
 * 'blind' when only the single blind round can run (ROUNDS===1). Appended once
 * per task; never throws into the run (corpus capture must not fail the bench).
 */
async function captureRunRecord(
  taskId: string,
  rounds: RoundOutcome[],
  priorSteers: string[],
): Promise<void> {
  const attempts: AttemptRecord[] = []
  for (const outcome of rounds) {
    // priorSteers[i] is the steer injected for rounds[i] ('' for round 1).
    const steer = priorSteers[outcome.round - 1] ?? ''
    attempts.push(await roundToAttempt(outcome, taskId, steer))
  }
  const blindResolved = rounds[0]?.resolved === true
  const last = rounds[rounds.length - 1]
  const record: RunRecord = {
    ts: new Date().toISOString(),
    benchmark: 'terminal-bench',
    instanceId: taskId,
    condition: ROUNDS > 1 ? `refine@${ROUNDS}` : 'blind',
    model: PROFILE.model?.default ?? MODEL,
    blindResolved,
    resolved: last ? last.resolved : blindResolved,
    attempts,
    infraError: false,
  }
  await appendRunRecord(CORPUS, record)
}

/**
 * Serially `docker compose build` each task image before the concurrent fan-out.
 * tb builds per-task images on first use; building two cold images concurrently
 * contends on the shared docker build backend and can return nonzero. Warming the
 * cache serially makes the parallel rounds hit a warm cache and never race.
 * Dataset-agnostic: derives the compose path from the tb cache layout
 * (<cache>/<name>/<version>/<task>/docker-compose.yaml).
 */
async function prebuildImages(taskIds: string[]): Promise<void> {
  const [name, version] = DATASET.split('==')
  if (!name || !version) {
    console.log(`  prebuild: skipped (dataset ${DATASET} is not name==version; relying on tb's lazy build)`)
    return
  }
  const cacheRoot = join(homedir(), '.cache', 'terminal-bench', name, version)
  for (const taskId of taskIds) {
    const composePath = join(cacheRoot, taskId, 'docker-compose.yaml')
    try {
      await stat(composePath)
    } catch {
      console.log(`  prebuild: no compose at ${composePath}; tb will materialize ${taskId} on first run`)
      continue
    }
    process.stdout.write(`  prebuild: ${taskId} … `)
    await new Promise<void>((resolve, reject) => {
      execFile(
        'docker',
        ['compose', '-p', `tbprebuild-${taskId}`, '-f', composePath, 'build'],
        { maxBuffer: 1024 * 1024 * 256, timeout: ROUND_CAP_MS },
        (err) => (err ? reject(new Error(`prebuild ${taskId} failed: ${err.message}`)) : resolve()),
      )
    })
    console.log('built')
  }
}

function slugRunId(taskId: string, round: number): string {
  // tb derives a docker compose project name from the run-id, which must match
  // [a-z0-9][a-z0-9_-]* — lowercase, no '.', no ISO 'T'/'Z' separators, no ':'.
  const ts = new Date().toISOString().replace(/[^0-9]/g, '')
  return `cmp-${taskId}-r${round}-${ts}`.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
}

/** One tb round. round 1 = plain opencode (blind); round>1 = refine agent + prior_attempt. */
async function runRound(taskId: string, round: number, prior: string): Promise<RoundOutcome> {
  const runId = slugRunId(taskId, round)
  // tb writes results to <output-path>/<run-id>/, so point output-path at RUNS_DIR
  // and the run materializes at RUNS_DIR/<runId>/.
  const outputDir = join(RUNS_DIR, runId)
  const baseArgs = [
    'run',
    '-d', DATASET,
    '--task-id', taskId,
    '-m', PROFILE_MODEL,
    '--output-path', RUNS_DIR,
    '--run-id', runId,
    '--n-concurrent', '1',
    '--no-livestream',
    ...(TB_AGENT_TIMEOUT_SEC ? ['--global-agent-timeout-sec', String(TB_AGENT_TIMEOUT_SEC)] : []),
  ]
  // tb injects model_name from -m into the agent kwargs, and its kwarg parser
  // (`key, value = kwarg.split('=')` + ast.literal_eval) rejects '=' and Python
  // literals in values. Hex-encode the prior with an 'h' sentinel so it survives
  // the split and is kept as a string; the refine agent decodes it.
  const priorHex = `h${Buffer.from(prior, 'utf8').toString('hex')}`
  const args = [
    ...baseArgs,
    '--agent-import-path', PROFILE_AGENT_IMPORT,
    '--agent-kwarg', `profile_path=${PROFILE_PATH}`,
    ...(round > 1 ? ['--agent-kwarg', `prior_attempt_hex=${priorHex}`] : []),
  ]
  await runTb(args, runId)
  const resolved = await readResolved(outputDir, taskId)
  const trialDir = await findTrialDir(outputDir, taskId)
  return { round, resolved, runId, outputDir, trialDir }
}

async function solveTask(taskId: string): Promise<{
  taskId: string
  blind: boolean
  refine: boolean
  rounds: RoundOutcome[]
}> {
  const history: RoundOutcome[] = []
  // The evidence-gated steer injected per round, indexed by round number (round 1 has
  // none). Captured here so the corpus records the exact steer each refine round saw.
  const priorSteers: string[] = ['']
  const r1 = await runRound(taskId, 1, '')
  history.push(r1)
  const blind = r1.resolved
  let prev = r1

  for (let round = 2; round <= ROUNDS && !prev.resolved; round++) {
    const prior = await buildPriorSummary(prev, taskId)
    priorSteers[round - 1] = prior
    const r = await runRound(taskId, round, prior)
    history.push(r)
    prev = r
  }
  // refine = the final round's outcome (blind itself when no refine round fired).
  const last = history[history.length - 1]
  const refine = last ? last.resolved : blind
  // Persist the full per-attempt tuple to the durable cross-benchmark flywheel corpus.
  // Capture is observability over the primary bench result: a write failure is logged
  // loudly (never silently swallowed) but does not abort an expensive container run.
  try {
    await captureRunRecord(taskId, history, priorSteers)
  } catch (err) {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err)
    console.error(`  [corpus] WARN: failed to persist RunRecord for ${taskId}: ${msg}`)
  }
  return { taskId, blind, refine, rounds: history }
}

async function main(): Promise<void> {
  await mkdir(RUNS_DIR, { recursive: true })
  await writeFile(PROFILE_PATH, JSON.stringify(PROFILE, null, 2) + '\n')
  // Validate auth up front — fail loud before spending a single container.
  must('OPENAI_API_KEY')

  console.log('=== TERMINAL-BENCH BLIND vs REFINE — run plan ===')
  console.log(`  dataset:        ${DATASET}`)
  console.log(`  model:          ${MODEL}`)
  console.log(`  tasks (${IDS.length}):      ${IDS.join(', ')}`)
  console.log(`  rounds/task:    1 (blind) … up to ${ROUNDS} (refine on blind failure)`)
  console.log(`  concurrency:    ${CONCURRENCY}`)
  console.log(`  per-round cap:  ${Math.round(ROUND_CAP_MS / 1000)}s`)
  console.log(
    `  worst-case tb container runs: ${IDS.length * ROUNDS} (best case ${IDS.length} if all blind-pass)`,
  )
  console.log('')

  await prebuildImages(IDS)
  console.log('')

  const results: Array<Awaited<ReturnType<typeof solveTask>>> = []
  let done = 0
  await runPool(IDS, CONCURRENCY, async (taskId) => {
    const started = Date.now()
    const r = await solveTask(taskId)
    results.push(r)
    done += 1
    const secs = Math.round((Date.now() - started) / 1000)
    const perRound = r.rounds.map((x) => `r${x.round}=${x.resolved ? '✓' : '·'}`).join(' ')
    const tag =
      r.refine && !r.blind ? '↑RESCUED' : r.blind && !r.refine ? '↓BROKE' : r.blind ? '=both✓' : '=both·'
    console.log(
      `  [${done}/${IDS.length}] ${taskId}: blind=${r.blind ? '✓' : '·'} refine=${r.refine ? '✓' : '·'} ${tag}  (${perRound}, ${secs}s)`,
    )
    for (const rd of r.rounds) console.log(`        round ${rd.round} run dir: ${rd.outputDir}`)
  })

  const n = results.length
  const nBlind = results.filter((r) => r.blind).length
  const nRefine = results.filter((r) => r.refine).length
  const rescued = results.filter((r) => r.refine && !r.blind).length
  const broke = results.filter((r) => r.blind && !r.refine).length
  const pct = (x: number) => (n > 0 ? `${((x / n) * 100).toFixed(1)}%` : 'n/a')

  console.log(`\n=== BLIND vs REFINE (n=${n}, rounds=${ROUNDS}) ===`)
  console.log(`  blind  (pass@1):     ${pct(nBlind)}  (${nBlind}/${n})`)
  console.log(`  refine (final):      ${pct(nRefine)}  (${nRefine}/${n})`)
  console.log(
    `  ► delta (refine − blind): ${(((nRefine - nBlind) / Math.max(n, 1)) * 100).toFixed(1)} pp   [rescued ${rescued}, broke ${broke}]`,
  )
  console.log('\n  per-task:')
  for (const r of results) {
    console.log(
      `    ${r.taskId}: blind=${r.blind ? '✓' : '·'} refine=${r.refine ? '✓' : '·'}  rounds=[${r.rounds.map((x) => `r${x.round}:${x.resolved ? 'pass' : 'fail'}`).join(', ')}]`,
    )
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err))
  process.exit(1)
})
