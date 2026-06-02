/**
 * Bench CLI. For now: prove the benchmark JUDGE works before wiring the agent.
 *
 *   tsx src/run.ts preflight              # harness + Docker reachable?
 *   tsx src/run.ts verify-judge [id]      # gold patch must RESOLVE; empty must FAIL
 */
import { createAppWorldAdapter } from './benchmarks/appworld'
import { createFinsearchcompAdapter } from './benchmarks/finsearchcomp'
import { createFramesAdapter } from './benchmarks/frames'
import { createHotpotqaAdapter } from './benchmarks/hotpotqa'
import { createSimpleQaAdapter } from './benchmarks/simpleqa'
import { createSweBenchAdapter } from './benchmarks/swe-bench'
import { createTerminalBenchAdapter } from './benchmarks/terminal-bench'
import type { BenchmarkAdapter } from './benchmarks/types'

const ADAPTERS: Record<string, () => BenchmarkAdapter> = {
  'swe-bench': createSweBenchAdapter,
  'terminal-bench': createTerminalBenchAdapter,
  appworld: createAppWorldAdapter,
  frames: createFramesAdapter,
  finsearchcomp: createFinsearchcompAdapter,
  simpleqa: createSimpleQaAdapter,
  hotpotqa: createHotpotqaAdapter,
}

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
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
      sandboxKey: must('SANDBOX_KEY'),
      routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
      routerKey: must('ROUTER_KEY'),
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
    let next = 0
    let done = 0
    let resolved = 0
    const results: Array<{ id: string; resolved: boolean; patchBytes: number; error?: string }> = []
    const worker = async () => {
      while (next < tasks.length) {
        const task = tasks[next++] as (typeof tasks)[number]
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
      }
    }
    await Promise.all(Array.from({ length: Math.min(conc, tasks.length) }, worker))
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
    const { solveShotLocal } = await import('./worker-local')
    const fs = await import('node:fs/promises')
    const model = process.env.WORKER_MODEL ?? 'deepseek/deepseek-v4-pro'
    const livenessMs = process.env.OPENCODE_LIVENESS_MS ? Number(process.env.OPENCODE_LIVENESS_MS) : undefined
    const k = Number(process.env.K ?? 3)
    const conc = Number(process.env.CONCURRENCY ?? 2)
    const out = process.env.SCORECARD ?? '/tmp/swebench-oracle.jsonl'
    await adapter.preflight()
    const _ids = process.env.IDS ? process.env.IDS.split(',') : undefined
    const tasks = await adapter.loadTasks(_ids ? { ids: _ids } : { limit: Number(rest[0] ?? process.env.N ?? 10) })
    console.log(`[batch-oracle] ${tasks.length} instances · k=${k} · model=${model} · conc=${conc} (router-free)`)
    const agg = { n: 0, pass1: 0, randomExp: 0, oracle: 0 }
    let next = 0
    let done = 0
    const worker = async () => {
      while (next < tasks.length) {
        const task = tasks[next++] as (typeof tasks)[number]
        const started = Date.now()
        try {
          const resolved: boolean[] = []
          for (let i = 0; i < k; i += 1) {
            const shot = await solveShotLocal(task, { model, livenessMs })
            const score = shot.ok ? await adapter.judge(task, shot.patch) : { resolved: false, score: 0 }
            resolved.push(score.resolved === true)
          }
          const nResolved = resolved.filter(Boolean).length
          const pass1 = resolved[0] === true
          const oracle = nResolved > 0
          const randomExpected = k > 0 ? nResolved / k : 0
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
      }
    }
    await Promise.all(Array.from({ length: Math.min(conc, tasks.length) }, worker))
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

  throw new Error(
    `unknown command: ${cmd ?? '(none)'} — use preflight | verify-judge | solve-one | solve-one-local | batch-blind | batch-oracle`,
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
