/**
 * commit0 Layer-1 gate runner — the verifier-grounded selector AND the
 * observe→steer efficacy experiment on REAL stateful coding rollouts. Each shot is
 * a fresh sandbox where an opencode agent clones the stubbed repo at base_commit,
 * implements the source, and WRITES its diff to a file we read back over the
 * sandbox FS — NOT pasted in the final message (a large diff truncates there →
 * `git apply` "corrupt patch", the failure that made the generic stream-parse path
 * unusable). The official commit0 pytest harness then grades each diff to a
 * continuous (passed+xfail)/total reward — the within-task variance the
 * verifier-grounded selector needs (unlike aec's per-task-deterministic scores).
 *
 * ARMS (comma-separated, default `random`):
 *   - random      — K independent blind shots (the equal-compute control).
 *   - refineAudit — shot 0 blind, then for each later shot a TRACE-ONLY analyst
 *     (ANALYST_MODEL, default deepseek-v4-pro, off-box via the router) reads the
 *     prior shot's diff + stream-trace tail and its findings are appended to a
 *     FRESH sandbox's prompt. The analyst never sees a judge score — judging is
 *     phase 2, after every rollout, so selector≠judge holds by construction.
 *   Both arms run K shots per task: equal compute is the non-negotiable invariant
 *   (the analyst call is the steering overhead, one cheap router completion).
 *
 * Two phases, deliberately split:
 *   1. ROLLOUTS run concurrently (sandbox-bound; CONCURRENCY units in flight; a
 *      steered arm's shots chain sequentially inside one unit).
 *   2. JUDGES run SEQUENTIALLY (Docker-bound). commit0 keys its report dir on
 *      hash(test_ids), shared across a repo's attempts, so concurrent judging of the
 *      same repo races/overwrites report.json — the `None`-score bug.
 *
 * Judge prerequisite: the per-repo Docker image MUST exist before judging — the
 * local Docker backend ignores `rebuild_image` (only the Modal context honors it),
 * so run `./src/commit0-prereqs.sh <repo…>` (pulls wentingzhao/<repo>:v0, else
 * builds via commit0.harness.build) for every repo in the task list first.
 *
 * Fail loud: an attempt whose rollout errored, whose diff never materialized, or
 * whose judge harness failed is recorded as an INFRA attempt (error on the
 * AttemptRecord, no score) and its record is marked infraError — counted +
 * reported, excluded by corpus-report, never a silent 0.
 *
 * Writes one corpus RunRecord per (task, arm) (conditions `random@K`,
 * `refineAudit@K`) the existing `corpus-replay --selector=verifier` +
 * `corpus-report` consume unchanged.
 *
 *   ./src/commit0-prereqs.sh wcwidth tinydb …   # once per repo set
 *   dotenvx run -f … -- env N=8 K=2 ARMS=random,refineAudit \
 *     WORKER_MODEL=deepseek-v4-pro CONCURRENCY=3 CORPUS=/tmp/commit0.jsonl \
 *     tsx src/commit0-gate.mts
 *   tsx src/corpus-report.mts /tmp/commit0.jsonl          # paired steering verdict
 *   tsx src/corpus-replay.mts /tmp/commit0.jsonl --selector=verifier
 */

import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectAgentTurn,
  createExecutor,
  type AgentRunSpec,
  type Deliverable,
  openSandboxRun,
  type SandboxRun,
  streamAgentTurn,
} from '@tangle-network/agent-runtime/kernel'
import { Sandbox } from '@tangle-network/sandbox'
import { createCommit0Adapter } from './benchmarks/commit0'
import type { BenchTask } from './benchmarks/types'
import { type AttemptRecord, appendRunRecord, buildRunRecordFromAttempts } from './corpus'
import { type AnalystFn, llmAnalyst } from './sandbox-run'
import {
  type BenchRuntimeDecisionPoint,
  type BenchRuntimeHookEvent,
  createRuntimeHookRecorder,
} from './runtime-hook-recorder'
import { pool } from './stats.mts'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

const PATCH_PATH = '/tmp/solution.patch'
const randomSuffix = () => Math.random().toString(36).slice(2, 10)

interface Commit0Meta {
  repo: string
  baseCommit: string
  srcDir: string
  testDir: string
  specification: string
}

interface Shot {
  task: BenchTask
  attempt: number
  diff: string
  ok: boolean
  detail?: string
  wallMs: number
  /** measured count of stream events from the rollout (0 if it errored before streaming) */
  events: number
  /** bounded tail of the raw stream events — the trace the analyst reads (trace-only). */
  traceEvents?: unknown[]
  /** the analyst findings appended to this shot's prompt (steered arm, round ≥ 1). */
  steer?: string
  runtimeEvents?: BenchRuntimeHookEvent[]
  runtimeDecisionPoints?: BenchRuntimeDecisionPoint[]
}

/** Last events of a rollout stream, kept for the trace-only analyst. */
const TRACE_EVENTS_TAIL = 12
/** Diff prefix shown to the analyst (it names files + hunks; the full diff can be 100KB+). */
const ANALYST_DIFF_MAX = 6_000
/** Findings ceiling appended to a steered prompt (the analyst is told 1-3 sentences). */
const STEER_MAX = 1_500

/** Append the analyst's findings to the base rollout prompt (fresh box — the
 *  agent has no memory of the prior attempt, so the framing names it). */
function steeredPrompt(base: string, steer: string): string {
  return `${base}\n\n--- Analysis of a previous attempt at this task ---\n${steer}\n\nApply this correction while you implement.`
}

/** Build the rollout prompt: clone the stub, implement the source, write the diff to
 *  a FILE (the robust deliverable). Mirrors solveShot's file-read contract. */
function rolloutPrompt(meta: Commit0Meta): string {
  return [
    `Clone https://github.com/${meta.repo} into /work, then \`cd /work && git checkout ${meta.baseCommit}\`.`,
    `The public functions/classes under \`${meta.srcDir}\` are stubbed (empty \`pass\`/\`...\` bodies). Your job is to`,
    `implement COMPLETE, CORRECT bodies under \`${meta.srcDir}\` so the existing test suite under \`${meta.testDir}\` passes.`,
    '',
    'Work iteratively — do NOT stop at a first draft:',
    `1. Read the spec (${meta.specification}) and the tests under \`${meta.testDir}\` to learn the exact required behavior.`,
    `2. Install the package editable so imports resolve: \`pip install -e .\` (use the repo's setup if it differs).`,
    `3. Implement ALL stubbed bodies under \`${meta.srcDir}\` — every function/class, not just the easy ones.`,
    `4. RUN the suite: \`python -m pytest ${meta.testDir} -q\`. Read failures and FIX them. Repeat until as many tests`,
    `   pass as you can get — keep iterating; a partial implementation that fails most tests is not done.`,
    '5. Do NOT edit the tests — the evaluation re-runs them on a fresh clone.',
    '',
    `When the suite is green (or you have maximized passing tests), from /work run EXACTLY:`,
    `  git add -A && git diff --cached -- ${meta.srcDir} > ${PATCH_PATH}`,
    `Then stop. The patch file is the only deliverable — do NOT paste the diff in your reply.`,
  ].join('\n')
}

interface ShotCfg {
  sandboxBaseUrl: string
  sandboxKey: string
  routerBaseUrl: string
  /** Host-side opencode (`COMMIT0_BACKEND=local`) only — routes `openai/*` models
   *  through the router from THIS machine. The sandbox path never sends it into
   *  the box: in-box model auth is the box-provisioned `OPENCODE_MODEL_API_KEY`. */
  routerKey: string
  model: string
  /** in-box opencode provider. `openai-compat` (default) is the generic passthrough,
   *  so router-served cheap models resolve in-box; `openai` only accepts its
   *  registered model names (e.g. gpt-4.1). Override via WORKER_PROVIDER. */
  provider: string
  timeoutMs: number
  /** Local Runtime bridge transport. The profile, not this transport, selects the harness/model. */
  bridgeUrl?: string
  bridgeBearer?: string
}

function workerProfile(cfg: ShotCfg, name: string) {
  return {
    name,
    harness: 'opencode' as const,
    model: { provider: cfg.provider, default: cfg.model },
  }
}

/** The diff the in-box agent produces, read back off the box FS (+ any stream error). */
interface RolloutDeliverable {
  diff: string
  lastErr?: string
}

/** Reads the patch FILE the agent wrote (the robust deliverable — a large diff
 *  truncates in the chat stream → `git apply` "corrupt patch"), folding any in-box
 *  error event into `lastErr` so a failed rollout still surfaces on an empty patch. */
const commit0Deliverable: Deliverable<RolloutDeliverable> = {
  kind: 'artifact',
  path: PATCH_PATH,
  fromArtifact: (raw, events) => {
    let lastErr: string | undefined
    for (const ev of events) {
      if ((ev as { type?: string }).type === 'error') lastErr = JSON.stringify((ev as { data?: unknown }).data).slice(0, 300)
    }
    return { diff: raw, ...(lastErr ? { lastErr } : {}) }
  },
}

async function runShot(task: BenchTask, attempt: number, cfg: ShotCfg, steer?: string): Promise<Shot> {
  const meta = task.metadata as unknown as Commit0Meta
  const startedAt = Date.now()
  const client = new Sandbox({ baseUrl: cfg.sandboxBaseUrl, apiKey: cfg.sandboxKey })
  // A stream/transport ceiling for the flaky sandbox path (0 ⇒ untimed); the run
  // tears its own box down in `close()`. The whole rollout is fault-isolated: ANY
  // error (502 / stream drop / provision fail / abort) becomes a recorded NO-DIFF
  // attempt — it MUST NOT throw, or one flaky box aborts the pool and loses every
  // other rollout (the powered-run crash).
  const controller = new AbortController()
  const timer = cfg.timeoutMs > 0 ? setTimeout(() => controller.abort(), cfg.timeoutMs) : undefined
  // The exact profile owns harness/provider/model. Sandbox overrides contain only box
  // infrastructure; Runtime derives the backend from the profile and refuses conflicts.
  const agentRun: AgentRunSpec<string> = {
    profile: workerProfile(cfg, 'commit0-worker'),
    name: 'commit0-worker',
    taskToPrompt: () => '', // unused — the prompt is streamed directly by openSandboxRun
    sandboxOverrides: {
      name: `commit0-${task.id}-${attempt}-${randomSuffix()}`.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 60),
      environment: 'universal',
    },
  }
  let run: SandboxRun<RolloutDeliverable> | undefined
  const runtime = createRuntimeHookRecorder()
  try {
    run = await openSandboxRun(
      client,
      {
        agentRun,
        signal: controller.signal,
        hooks: runtime.hooks,
        runId: `commit0:${task.id}:${attempt}`,
        scenarioId: task.id,
      },
      commit0Deliverable,
    )
    const prompt = steer ? steeredPrompt(rolloutPrompt(meta), steer) : rolloutPrompt(meta)
    const turn = await run.start(prompt)
    const ok = turn.out.diff.trim().length > 0
    return {
      task,
      attempt,
      diff: turn.out.diff,
      ok,
      events: turn.events.length,
      traceEvents: turn.events.slice(-TRACE_EVENTS_TAIL),
      ...(steer ? { steer } : {}),
      runtimeEvents: runtime.events,
      runtimeDecisionPoints: runtime.decisionPoints,
      wallMs: Date.now() - startedAt,
      ...(ok ? {} : { detail: `empty patch${turn.readError ? ` (read failed: ${turn.readError.slice(0, 120)})` : ''}${turn.out.lastErr ? `; lastError=${turn.out.lastErr}` : ''}` }),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      task,
      attempt,
      diff: '',
      ok: false,
      events: 0,
      ...(steer ? { steer } : {}),
      runtimeEvents: runtime.events,
      runtimeDecisionPoints: runtime.decisionPoints,
      wallMs: Date.now() - startedAt,
      detail: `rollout error: ${msg.slice(0, 200)}`,
    }
  } finally {
    if (timer) clearTimeout(timer)
    if (run) await run.close()
  }
}

/** Run a subprocess, capturing combined stdout+stderr; never throws (returns rc). */
function sh(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      env: opts.env ?? process.env,
      ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
    })
    let out = ''
    child.stdout?.on('data', (c: Buffer) => { out += c.toString() })
    child.stderr?.on('data', (c: Buffer) => { out += c.toString() })
    child.on('error', (e) => resolve({ code: -1, out: `${out}\n${e}` }))
    child.on('close', (code) => resolve({ code: code ?? -1, out }))
  })
}

/** Local-rollout prompt: the repo is ALREADY cloned + checked out into the cwd, so
 *  (unlike the sandbox prompt) the agent implements + test-iterates in place; the diff
 *  is read from git afterward (no chat-message truncation). */
function localRolloutPrompt(meta: Commit0Meta): string {
  return [
    `The current directory is the stubbed Python library \`${meta.repo}\`, checked out at its base commit.`,
    `The public functions/classes under \`${meta.srcDir}\` are stubbed (empty \`pass\`/\`...\`). Implement COMPLETE, CORRECT bodies so the tests under \`${meta.testDir}\` pass.`,
    'Work iteratively, do NOT stop at a first draft:',
    `1. Read the spec (${meta.specification}) and the tests under \`${meta.testDir}\`.`,
    '2. Set up an ISOLATED venv so imports + pytest resolve: `python3 -m venv .venv && .venv/bin/pip install -e .` (use the repo setup if it differs).',
    `3. Implement ALL stubbed bodies under \`${meta.srcDir}\`.`,
    `4. Run \`.venv/bin/python -m pytest ${meta.testDir} -q\`, read failures, FIX them, and repeat until as many tests pass as you can.`,
    '5. Do NOT edit the test files.',
    'When done, just stop — do NOT print the diff; it is collected from git.',
  ].join('\n')
}

/**
 * LOCAL rollout backend (cli-bridge fallback for when the sandbox gateway is down):
 * clone + checkout the stub into a tmpdir, run local opencode (its own kimi/zai
 * coding-plan auth, or the router when model is `openai/*`) to implement + test-iterate
 * in place, then read the diff straight from git (complete — no message truncation).
 * Fault-isolated like runShot: any failure → a recorded NO-DIFF attempt, never a throw.
 */
async function runShotLocal(task: BenchTask, attempt: number, cfg: ShotCfg, steer?: string): Promise<Shot> {
  const meta = task.metadata as unknown as Commit0Meta
  const startedAt = Date.now()
  let dir: string | undefined
  try {
    dir = await mkdtemp(join(tmpdir(), 'commit0-local-'))
    const clone = await sh('git', ['clone', '--quiet', `https://github.com/${meta.repo}`, dir], { timeoutMs: 180_000 })
    if (clone.code !== 0) {
      return { task, attempt, diff: '', ok: false, events: 0, wallMs: Date.now() - startedAt, detail: `git clone failed: ${clone.out.trim().slice(-180)}` }
    }
    const co = await sh('git', ['-C', dir, 'checkout', '--quiet', meta.baseCommit], { timeoutMs: 60_000 })
    if (co.code !== 0) {
      return { task, attempt, diff: '', ok: false, events: 0, wallMs: Date.now() - startedAt, detail: `git checkout ${meta.baseCommit} failed: ${co.out.trim().slice(-180)}` }
    }
    const prompt = steer ? steeredPrompt(localRolloutPrompt(meta), steer) : localRolloutPrompt(meta)
    if (!cfg.bridgeUrl || !cfg.bridgeBearer) {
      throw new Error('local rollout requires CLI_BRIDGE_URL/BRIDGE_URL and CLI_BRIDGE_BEARER/BRIDGE_BEARER')
    }
    const factory = createExecutor({
      backend: 'bridge',
      bridgeUrl: cfg.bridgeUrl,
      bridgeBearer: cfg.bridgeBearer,
      cwd: dir,
      ...(cfg.timeoutMs > 0 ? { timeoutMs: cfg.timeoutMs } : {}),
    })
    const turn = await collectAgentTurn(
      streamAgentTurn(
        { kind: 'executor', factory, profile: workerProfile(cfg, `commit0-local-${attempt}`) },
        { prompt },
        cfg.timeoutMs > 0 ? { timeoutMs: cfg.timeoutMs } : {},
      ),
    )
    if (turn.status !== 'completed') {
      throw new Error(turn.error?.message ?? `Runtime bridge ended with ${turn.status}`)
    }
    const traceEvents = turn.events.map((event) => JSON.stringify(event))
    const events = turn.events.length
    // Read the diff straight from git, scoped to src_dir (excludes the .venv the agent made).
    const diffRes = await sh('bash', ['-c', `cd ${JSON.stringify(dir)} && git add -- ${JSON.stringify(meta.srcDir)} && git diff --cached -- ${JSON.stringify(meta.srcDir)}`], { timeoutMs: 60_000 })
    const diff = diffRes.out
    const ok = diff.trim().length > 0
    return {
      task,
      attempt,
      diff,
      ok,
      events,
      traceEvents: traceEvents.slice(-TRACE_EVENTS_TAIL),
      ...(steer ? { steer } : {}),
      wallMs: Date.now() - startedAt,
      ...(ok ? {} : { detail: `no diff (Runtime bridge completed): ${turn.finalText.trim().slice(-160)}` }),
    }
  } catch (err) {
    return { task, attempt, diff: '', ok: false, events: 0, ...(steer ? { steer } : {}), wallMs: Date.now() - startedAt, detail: `local rollout error: ${(err instanceof Error ? err.message : String(err)).slice(0, 180)}` }
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

async function main(): Promise<void> {
  // BACKEND=local → cli-bridge fallback (local opencode, no remote sandbox); needs a
  // sandbox-down workaround. Default 'sandbox' (the remote gateway). Local uses opencode's
  // OWN auth (kimi-for-coding / zai coding-plan), so TANGLE_API_KEY is only required for
  // the sandbox backend or an `openai/*` local model (router).
  const backend = process.env.COMMIT0_BACKEND === 'local' ? 'local' : 'sandbox'
  const n = Number(process.env.N ?? 8)
  const k = Number(process.env.K ?? 4)
  const model = process.env.WORKER_MODEL ?? (backend === 'local' ? 'kimi-for-coding/kimi-k2-thinking' : 'deepseek-v4-flash')
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  // The arms under test. `random` = K independent blind shots (the equal-compute
  // control); `refineAudit` = blind shot 0, then trace-only-analyst-steered shots.
  const armNames = (process.env.ARMS ?? 'random').split(',').map((s) => s.trim()).filter(Boolean)
  for (const a of armNames) {
    if (a !== 'random' && a !== 'refineAudit') throw new Error(`unknown arm ${a} (have: random, refineAudit)`)
  }
  // The analyst is an OFF-BOX router call (host-side), so it needs the router key
  // even when the worker runs on its own auth.
  const analystModel = process.env.ANALYST_MODEL ?? 'deepseek-v4-pro'
  const needsRouterKey = backend === 'sandbox' || model.startsWith('openai/') || armNames.includes('refineAudit')
  const routerKey = needsRouterKey ? must('TANGLE_API_KEY') : (process.env.TANGLE_API_KEY ?? '')
  const sandboxBaseUrl = process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools'
  // openai-compat = generic passthrough so cheap router models resolve in-box;
  // `openai` rejects non-registered model names. Override via WORKER_PROVIDER.
  const provider = process.env.WORKER_PROVIDER ?? 'openai-compat'
  const concurrency = Number(process.env.CONCURRENCY ?? 3)
  // No tight cap on the agentic rollout — it runs until the agent finishes (the clone→
  // implement→pytest-iterate loop genuinely takes a while). 0 = untimed. Only set
  // SHOT_TIMEOUT_MS to impose a deliberate ceiling. Sandbox keeps a stream cap (flaky transport).
  const timeoutMs = process.env.SHOT_TIMEOUT_MS ? Number(process.env.SHOT_TIMEOUT_MS) : backend === 'local' ? 0 : 900_000
  const corpusPath = process.env.CORPUS ?? '/tmp/commit0.jsonl'
  if (!Number.isInteger(n) || n < 1) throw new Error(`N must be a positive integer, got ${process.env.N}`)
  if (!Number.isInteger(k) || k < 1) throw new Error(`K must be a positive integer, got ${process.env.K}`)

  const adapter = createCommit0Adapter()
  console.log(`=== commit0 Layer-1 gate · backend=${backend} · N=${n} K=${k} arms=${armNames.join(',')} model=${model} analyst=${analystModel} rolloutConc=${concurrency} ===`)
  await adapter.preflight()
  const tasks = await adapter.loadTasks({ limit: n })
  console.log(`loaded ${tasks.length} task(s): ${tasks.map((t) => t.id).join(', ')}`)

  // Phase 1 — rollouts, concurrent. sandbox = remote box; local = cli-bridge (opencode
  // in a tmpdir, diff read from git). Both fault-isolated → a failure is a NO-DIFF, never a throw.
  const cfg: ShotCfg = {
    sandboxBaseUrl,
    sandboxKey: routerKey,
    routerBaseUrl,
    routerKey,
    model,
    provider,
    timeoutMs,
    bridgeUrl: process.env.CLI_BRIDGE_URL ?? process.env.BRIDGE_URL,
    bridgeBearer: process.env.CLI_BRIDGE_BEARER ?? process.env.BRIDGE_BEARER,
  }
  const runRollout = backend === 'local' ? runShotLocal : runShot
  const analyze: AnalystFn = llmAnalyst({ routerBaseUrl, routerKey, model: analystModel })
  const logShot = (armName: string, s: Shot) =>
    console.log(`  rollout ${s.task.id}[${armName}]#${s.attempt}: ${s.ok ? `diff ${s.diff.length}B` : `NO DIFF (${s.detail})`}${s.steer ? ' [steered]' : ''} (${(s.wallMs / 1000) | 0}s)`)

  interface TaggedShot {
    arm: string
    shot: Shot
  }
  // A unit is the pool's schedulable atom: one blind shot for the control arm
  // (max packing), the WHOLE blind→analyst→steered chain for the steered arm
  // (shot i+1 depends on shot i's trace). Units never throw — every failure is a
  // recorded NO-DIFF/INFRA shot, so one flaky box cannot abort the pool.
  const units: Array<() => Promise<TaggedShot[]>> = []
  for (const task of tasks) {
    for (const armName of armNames) {
      if (armName === 'random') {
        for (let attempt = 0; attempt < k; attempt += 1) {
          units.push(async () => {
            const s = await runRollout(task, attempt, cfg)
            logShot(armName, s)
            return [{ arm: armName, shot: s }]
          })
        }
        continue
      }
      units.push(async () => {
        const out: TaggedShot[] = []
        let prev: Shot | undefined
        for (let attempt = 0; attempt < k; attempt += 1) {
          let steer: string | undefined
          if (prev) {
            // Trace-only: the analyst sees the prior shot's diff + stream tail,
            // never a judge score (judging is phase 2 — selector≠judge by
            // construction). "no change needed" is the policy's informed no-op.
            try {
              const events = prev.traceEvents?.length ? prev.traceEvents : prev.detail ? [prev.detail] : []
              const feedback = (await analyze([{ output: prev.diff.slice(0, ANALYST_DIFF_MAX), events }])).trim()
              if (feedback && !/^no change needed/i.test(feedback)) steer = feedback.slice(0, STEER_MAX)
            } catch (err) {
              // A steered arm whose analyst died is no longer a steered arm —
              // record the attempt as INFRA rather than degrading to blind.
              const msg = (err instanceof Error ? err.message : String(err)).slice(0, 200)
              const s: Shot = { task, attempt, diff: '', ok: false, events: 0, wallMs: 0, detail: `analyst error: ${msg}` }
              logShot(armName, s)
              out.push({ arm: armName, shot: s })
              break
            }
          }
          const s = await runRollout(task, attempt, cfg, steer)
          logShot(armName, s)
          out.push({ arm: armName, shot: s })
          prev = s
        }
        return out
      })
    }
  }
  const where = backend === 'local' ? 'local opencode (cli-bridge)' : `in-box (${PATCH_PATH})`
  console.log(`\n▶ phase 1: ${tasks.length * armNames.length * k} rollouts in ${units.length} units (conc=${concurrency}) via ${where}`)
  const tagged = (await pool(units, concurrency, (u) => u())).flat()

  // Phase 2 — judging, SEQUENTIAL (Docker-bound; commit0 keys its report dir on
  // hash(test_ids), shared across a repo's attempts → concurrent judging of one repo
  // races/overwrites report.json). Judged PER (TASK, ARM), writing each RunRecord
  // immediately so a mid-run crash keeps completed records. Fail loud: an attempt
  // with no diff or a failed judge becomes an INFRA attempt (error recorded, no
  // score) and the whole record is infra-excluded — never a silent 0.
  console.log(`\n▶ phase 2: judging sequentially per task (official commit0 pytest harness) → ${corpusPath}`)
  let scoredRecords = 0
  let infraRecords = 0
  let infraAttempts = 0
  for (const task of tasks) {
    let imageTouched = false
    for (const armName of armNames) {
      const armShots = tagged.filter((t) => t.arm === armName && t.shot.task.id === task.id).map((t) => t.shot)
      const attempts: AttemptRecord[] = []
      let recordInfra = false
      for (let i = 0; i < k; i += 1) {
        const s = armShots.find((x) => x.attempt === i)
        let sc: { score: number; resolved: boolean } | undefined
        let attemptError: string | undefined
        if (s?.ok) {
          // Local Docker backend: images must pre-exist (src/commit0-prereqs.sh);
          // rebuild_image is honored by the Modal backend only, where the first
          // judged attempt of a repo force-builds and the rest reuse.
          process.env.COMMIT0_REBUILD_IMAGE = imageTouched ? '0' : '1'
          imageTouched = true
          try {
            const v = await adapter.judge(s.task, s.diff)
            sc = { score: v.score, resolved: v.resolved }
            console.log(`  judge ${task.id}[${armName}]#${i}: score=${(v.score * 100).toFixed(1)}% resolved=${v.resolved}`)
          } catch (err) {
            attemptError = `judge harness failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`
            console.log(`  judge ${task.id}[${armName}]#${i}: INFRA ${attemptError.slice(0, 200)}`)
          }
        } else {
          attemptError = s ? `no diff: ${s.detail ?? 'unknown'}` : 'missing shot'
          console.log(`  judge ${task.id}[${armName}]#${i}: INFRA (${attemptError.slice(0, 160)})`)
        }
        if (attemptError) {
          recordInfra = true
          infraAttempts += 1
        }
        attempts.push({
          round: i,
          prompt: s?.steer ? `commit0-rollout + steer:\n${s.steer}` : 'commit0-rollout',
          output: s?.diff ?? '',
          ...(sc ? { valid: sc.resolved, score: sc.score } : {}),
          ...(attemptError ? { error: attemptError } : {}),
          wallMs: s?.wallMs ?? 0,
          eventCount: s?.events ?? 0,
          eventTypes: { 'sandbox.stream': s?.events ?? 0 },
          traceTail: (s?.diff ?? '').slice(-600),
        })
      }
      if (recordInfra) infraRecords += 1
      else if (attempts.some((a) => a.score !== undefined)) scoredRecords += 1
      const record = buildRunRecordFromAttempts(attempts, {
        benchmark: adapter.name,
        instanceId: task.id,
        condition: `${armName}@${k}`,
        model,
        infraError: recordInfra,
        runtimeEvents: armShots.flatMap((x) => x.runtimeEvents ?? []),
        runtimeDecisionPoints: armShots.flatMap((x) => x.runtimeDecisionPoints ?? []),
      })
      await appendRunRecord(corpusPath, record) // incremental: partial progress survives a crash
    }
  }

  console.log(
    `\n=== wrote ${tasks.length * armNames.length} record(s) (${scoredRecords} fully scored, ${infraRecords} infra-excluded; ${infraAttempts} infra attempts) → ${corpusPath} ===\n` +
      `  STEERING VERDICT: tsx src/corpus-report.mts ${corpusPath}\n` +
      `  SELECTOR GATE:    tsx src/corpus-replay.mts ${corpusPath} --selector=verifier`,
  )
}

main().catch((err) => {
  console.error(`commit0-gate: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
