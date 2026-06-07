/**
 * commit0 Layer-1 gate runner — the verifier-grounded selector on REAL stateful
 * coding rollouts. Each shot is a fresh sandbox where an opencode agent clones the
 * stubbed repo at base_commit, implements the source, and WRITES its diff to a file
 * we read back over the sandbox FS — NOT pasted in the final message (a large diff
 * truncates there → `git apply` "corrupt patch", the failure that made the generic
 * stream-parse path unusable). The official commit0 pytest harness then grades each
 * diff to a continuous (passed+xfail)/total reward — the within-task variance the
 * verifier-grounded selector needs (unlike aec's per-task-deterministic scores).
 *
 * Two phases, deliberately split:
 *   1. ROLLOUTS run concurrently (sandbox-bound; CONCURRENCY shots in flight).
 *   2. JUDGES run SEQUENTIALLY (Docker-bound). commit0 keys its report dir on
 *      hash(test_ids), shared across a repo's attempts, so concurrent judging of the
 *      same repo races/overwrites report.json — the `None`-score bug. One unique
 *      repo image is built once (rebuild_image), the rest reuse it.
 *
 * Writes a corpus RunRecord/task (condition random@K) the existing
 * `corpus-replay --selector=verifier` + `corpus-report` consume unchanged. Fail loud.
 *
 *   dotenvx run -f … -- env BENCH-less; N=8 K=4 WORKER_MODEL=gpt-4.1 CONCURRENCY=3 \
 *     CORPUS=/tmp/commit0.jsonl tsx src/commit0-gate.mts
 *   tsx src/corpus-replay.mts /tmp/commit0.jsonl --selector=verifier
 */

import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type AgentRunSpec,
  type Deliverable,
  openSandboxRun,
  type SandboxRun,
} from '@tangle-network/agent-runtime/loops'
import { Sandbox } from '@tangle-network/sandbox'
import { createCommit0Adapter } from './benchmarks/commit0'
import type { BenchTask } from './benchmarks/types'
import { type AttemptRecord, appendRunRecord, buildRunRecordFromAttempts } from './corpus'
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
  runtimeEvents?: BenchRuntimeHookEvent[]
  runtimeDecisionPoints?: BenchRuntimeDecisionPoint[]
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
  routerKey: string
  model: string
  /** in-box opencode provider. `openai-compat` (default) is the generic passthrough,
   *  so router-served cheap models resolve in-box; `openai` only accepts its
   *  registered model names (e.g. gpt-4.1). Override via WORKER_PROVIDER. */
  provider: string
  timeoutMs: number
  /** local-backend: the opencode CLI binary (cli-bridge fallback when the sandbox is down). */
  opencodeBin: string
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

async function runShot(task: BenchTask, attempt: number, cfg: ShotCfg): Promise<Shot> {
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
  // opencode reads OPENAI_* from the box env (backend.model.apiKey alone is not enough
  // — without these the in-box agent throws ProviderAuthError); the inline profile +
  // backend override is the same generic AgentRunSpec the runLoop kernel boots.
  const agentRun: AgentRunSpec<string> = {
    profile: { name: 'commit0-worker', metadata: { backendType: 'opencode' } },
    name: 'commit0-worker',
    taskToPrompt: () => '', // unused — the prompt is streamed directly by openSandboxRun
    sandboxOverrides: {
      name: `commit0-${task.id}-${attempt}-${randomSuffix()}`.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 60),
      environment: 'universal',
      env: { OPENAI_API_KEY: cfg.routerKey, OPENAI_BASE_URL: cfg.routerBaseUrl },
      backend: {
        type: 'opencode',
        model: { provider: cfg.provider, model: cfg.model, baseUrl: cfg.routerBaseUrl, apiKey: cfg.routerKey },
      },
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
    const turn = await run.start(rolloutPrompt(meta))
    const ok = turn.out.diff.trim().length > 0
    return {
      task,
      attempt,
      diff: turn.out.diff,
      ok,
      events: turn.events.length,
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
async function runShotLocal(task: BenchTask, attempt: number, cfg: ShotCfg): Promise<Shot> {
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
    // openai/* → route through the router (OPENAI_* env); anything else → opencode's
    // OWN configured auth (kimi-for-coding / zai coding-plan subscriptions).
    const env = cfg.model.startsWith('openai/')
      ? { ...process.env, OPENAI_API_KEY: cfg.routerKey, OPENAI_BASE_URL: cfg.routerBaseUrl }
      : process.env
    const oc = await sh(cfg.opencodeBin, ['run', localRolloutPrompt(meta), '-m', cfg.model, '--dir', dir], { timeoutMs: cfg.timeoutMs, env })
    const events = oc.out.split('\n').length
    // Read the diff straight from git, scoped to src_dir (excludes the .venv the agent made).
    const diffRes = await sh('bash', ['-c', `cd ${JSON.stringify(dir)} && git add -- ${JSON.stringify(meta.srcDir)} && git diff --cached -- ${JSON.stringify(meta.srcDir)}`], { timeoutMs: 60_000 })
    const diff = diffRes.out
    const ok = diff.trim().length > 0
    return { task, attempt, diff, ok, events, wallMs: Date.now() - startedAt, ...(ok ? {} : { detail: `no diff (opencode rc=${oc.code}): ${oc.out.trim().slice(-160)}` }) }
  } catch (err) {
    return { task, attempt, diff: '', ok: false, events: 0, wallMs: Date.now() - startedAt, detail: `local rollout error: ${(err instanceof Error ? err.message : String(err)).slice(0, 180)}` }
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
  const model = process.env.WORKER_MODEL ?? (backend === 'local' ? 'kimi-for-coding/kimi-k2-thinking' : 'gpt-4.1')
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const needsRouterKey = backend === 'sandbox' || model.startsWith('openai/')
  const routerKey = needsRouterKey ? must('TANGLE_API_KEY') : (process.env.TANGLE_API_KEY ?? '')
  const sandboxBaseUrl = process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools'
  const opencodeBin = process.env.OPENCODE_BIN ?? join(process.env.HOME ?? '', '.local/bin/opencode')
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
  console.log(`=== commit0 Layer-1 gate · backend=${backend} · N=${n} K=${k} model=${model} rolloutConc=${concurrency} ===`)
  await adapter.preflight()
  const tasks = await adapter.loadTasks({ limit: n })
  console.log(`loaded ${tasks.length} task(s): ${tasks.map((t) => t.id).join(', ')}`)

  // Phase 1 — rollouts, concurrent. sandbox = remote box; local = cli-bridge (opencode
  // in a tmpdir, diff read from git). Both fault-isolated → a failure is a NO-DIFF, never a throw.
  const units = tasks.flatMap((task) => Array.from({ length: k }, (_, attempt) => ({ task, attempt })))
  const where = backend === 'local' ? 'local opencode (cli-bridge)' : `in-box (${PATCH_PATH})`
  console.log(`\n▶ phase 1: ${units.length} rollouts (conc=${concurrency}) via ${where}`)
  const cfg: ShotCfg = { sandboxBaseUrl, sandboxKey: routerKey, routerBaseUrl, routerKey, model, provider, timeoutMs, opencodeBin }
  const runRollout = backend === 'local' ? runShotLocal : runShot
  const shots = await pool(units, concurrency, async (u) => {
    const s = await runRollout(u.task, u.attempt, cfg)
    console.log(`  rollout ${u.task.id}#${u.attempt}: ${s.ok ? `diff ${s.diff.length}B` : `NO DIFF (${s.detail})`} (${(s.wallMs / 1000) | 0}s)`)
    return s
  })

  // Phase 2 — judging, SEQUENTIAL (Docker-bound; commit0 keys its report dir on
  // hash(test_ids), shared across a repo's attempts → concurrent judging of one repo
  // races/overwrites report.json). Judged PER TASK, writing each RunRecord immediately
  // so a mid-run crash keeps completed tasks. First ok-diff attempt of a repo rebuilds
  // its image; the rest reuse it.
  console.log(`\n▶ phase 2: judging sequentially per task (official commit0 pytest harness) → ${corpusPath}`)
  let scoredTasks = 0
  for (const task of tasks) {
    let built = false
    const attempts: AttemptRecord[] = []
    const runtimeEvents = shots
      .filter((x) => x.task.id === task.id)
      .flatMap((x) => x.runtimeEvents ?? [])
    const runtimeDecisionPoints = shots
      .filter((x) => x.task.id === task.id)
      .flatMap((x) => x.runtimeDecisionPoints ?? [])
    for (let i = 0; i < k; i += 1) {
      const s = shots.find((x) => x.task.id === task.id && x.attempt === i)
      let sc: { score: number; resolved: boolean } | undefined
      if (s?.ok) {
        process.env.COMMIT0_REBUILD_IMAGE = built ? '0' : '1' // build this repo's image once
        built = true
        try {
          const v = await adapter.judge(s.task, s.diff)
          sc = { score: v.score, resolved: v.resolved }
          console.log(`  judge ${task.id}#${i}: score=${(v.score * 100).toFixed(1)}% resolved=${v.resolved}`)
        } catch (err) {
          console.log(`  judge ${task.id}#${i}: ERROR ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`)
        }
      } else {
        console.log(`  judge ${task.id}#${i}: skipped (no diff)`)
      }
      attempts.push({
        round: i,
        prompt: 'commit0-rollout',
        output: s?.diff ?? '',
        ...(sc ? { valid: sc.resolved, score: sc.score } : {}),
        wallMs: s?.wallMs ?? 0,
        eventCount: s?.events ?? 0,
        eventTypes: { 'sandbox.stream': s?.events ?? 0 },
        traceTail: (s?.diff ?? '').slice(-600),
      })
    }
    if (attempts.some((a) => a.score !== undefined)) scoredTasks += 1
    const record = buildRunRecordFromAttempts(attempts, {
      benchmark: adapter.name,
      instanceId: task.id,
      condition: `random@${k}`,
      model,
      infraError: false,
      runtimeEvents,
      runtimeDecisionPoints,
    })
    await appendRunRecord(corpusPath, record) // incremental: partial progress survives a crash
  }

  console.log(
    `\n=== wrote ${tasks.length} task(s) (${scoredTasks} with ≥1 scored attempt) → ${corpusPath} ===\n` +
      `  THE GATE: tsx src/corpus-replay.mts ${corpusPath} --selector=verifier`,
  )
}

main().catch((err) => {
  console.error(`commit0-gate: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
