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

import { acquireSandbox } from '@tangle-network/agent-runtime/loops'
import { Sandbox } from '@tangle-network/sandbox'
import { createCommit0Adapter } from './benchmarks/commit0'
import type { BenchTask } from './benchmarks/types'
import { type AttemptRecord, appendRunRecord, type RunRecord } from './corpus'

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

async function runShot(
  task: BenchTask,
  attempt: number,
  cfg: { sandboxBaseUrl: string; sandboxKey: string; routerBaseUrl: string; routerKey: string; model: string; timeoutMs: number },
): Promise<Shot> {
  const meta = task.metadata as unknown as Commit0Meta
  const startedAt = Date.now()
  const client = new Sandbox({ baseUrl: cfg.sandboxBaseUrl, apiKey: cfg.sandboxKey })
  // Fault-isolated: ANY rollout error (sandbox 502 / stream drop / provision fail /
  // timeout) becomes a recorded NO-DIFF attempt — it MUST NOT throw, or one flaky box
  // aborts the whole pool and loses every other rollout (the powered-run crash).
  let box: Awaited<ReturnType<typeof acquireSandbox>> | undefined
  try {
    box = await acquireSandbox(client, {
      name: `commit0-${task.id}-${attempt}-${randomSuffix()}`.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 60),
      environment: 'universal',
      // opencode reads OPENAI_* from the box env (the backend.model.apiKey alone is not
      // enough — without these the in-box agent throws ProviderAuthError). Mirrors the
      // generic sandboxAgentRun wiring that the smoke rollout proved works.
      env: { OPENAI_API_KEY: cfg.routerKey, OPENAI_BASE_URL: cfg.routerBaseUrl },
      backend: {
        type: 'opencode',
        model: { provider: 'openai', model: cfg.model, baseUrl: cfg.routerBaseUrl, apiKey: cfg.routerKey },
      },
    })
    const signal = AbortSignal.timeout(cfg.timeoutMs)
    let lastErr: string | undefined
    for await (const ev of box.streamPrompt(rolloutPrompt(meta), { signal })) {
      if ((ev as { type?: string })?.type === 'error') lastErr = JSON.stringify((ev as { data?: unknown }).data).slice(0, 300)
    }
    let diff = ''
    let readErr: string | undefined
    try {
      diff = await box.fs.read(PATCH_PATH)
    } catch (err) {
      readErr = err instanceof Error ? err.message : String(err)
    }
    const ok = diff.trim().length > 0
    return {
      task,
      attempt,
      diff,
      ok,
      wallMs: Date.now() - startedAt,
      ...(ok ? {} : { detail: `empty patch${readErr ? ` (read failed: ${readErr.slice(0, 120)})` : ''}${lastErr ? `; lastError=${lastErr}` : ''}` }),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { task, attempt, diff: '', ok: false, wallMs: Date.now() - startedAt, detail: `rollout error: ${msg.slice(0, 200)}` }
  } finally {
    try {
      if (box) await box.delete()
    } catch {
      // staging reaps on expiry; ignore
    }
  }
}

/** Bounded-concurrency pool. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    for (;;) {
      const idx = next
      next += 1
      if (idx >= items.length) return
      results[idx] = await fn(items[idx] as T, idx)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()))
  return results
}

async function main(): Promise<void> {
  const n = Number(process.env.N ?? 8)
  const k = Number(process.env.K ?? 4)
  const model = process.env.WORKER_MODEL ?? 'gpt-4.1'
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('TANGLE_API_KEY')
  const sandboxBaseUrl = process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools'
  const concurrency = Number(process.env.CONCURRENCY ?? 3)
  const timeoutMs = Number(process.env.SHOT_TIMEOUT_MS ?? 900_000)
  const corpusPath = process.env.CORPUS ?? '/tmp/commit0.jsonl'
  if (!Number.isInteger(n) || n < 1) throw new Error(`N must be a positive integer, got ${process.env.N}`)
  if (!Number.isInteger(k) || k < 1) throw new Error(`K must be a positive integer, got ${process.env.K}`)

  const adapter = createCommit0Adapter()
  console.log(`=== commit0 Layer-1 gate · N=${n} K=${k} model=${model} rolloutConc=${concurrency} ===`)
  await adapter.preflight()
  const tasks = await adapter.loadTasks({ limit: n })
  console.log(`loaded ${tasks.length} task(s): ${tasks.map((t) => t.id).join(', ')}`)

  // Phase 1 — rollouts, concurrent (sandbox-bound).
  const units = tasks.flatMap((task) => Array.from({ length: k }, (_, attempt) => ({ task, attempt })))
  console.log(`\n▶ phase 1: ${units.length} rollouts (conc=${concurrency}) → writing diffs to ${PATCH_PATH} in-box`)
  const cfg = { sandboxBaseUrl, sandboxKey: routerKey, routerBaseUrl, routerKey, model, timeoutMs }
  const shots = await pool(units, concurrency, async (u) => {
    const s = await runShot(u.task, u.attempt, cfg)
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
        eventCount: 1,
        eventTypes: { 'sandbox.rollout': 1 },
        traceTail: (s?.diff ?? '').slice(-600),
      })
    }
    if (attempts.some((a) => a.score !== undefined)) scoredTasks += 1
    const record: RunRecord = {
      ts: new Date().toISOString(),
      benchmark: adapter.name,
      instanceId: task.id,
      condition: `random@${k}`,
      model,
      blindResolved: attempts[0]?.valid === true,
      resolved: attempts.some((a) => a.valid === true),
      attempts,
      infraError: false,
    }
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
