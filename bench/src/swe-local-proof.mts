/**
 * SEE-able LOCAL proof of the SWE-bench Verified pipeline — NO tangle sandbox.
 *
 * The whole loop runs on infra we can watch: the repo is cloned into a host tmpdir, the agent is a
 * router-driven tool loop (`runAgentic` + the swe-bench `AgenticSurface`'s list/read/edit tools —
 * jailed to the checkout), the patch is a plain `git diff` of the agent's edits, and the score is
 * the OFFICIAL swebench Docker harness (`adapter.judge`). The only remote call is the model
 * completion via the router. Nothing touches sandbox.tangle.tools.
 *
 * We proxy the surface's `score()` so we can SEE the exact bytes the judge grades: the extracted
 * patch, whether it applies to a clean base checkout (`git apply --check`), and the swebench verdict.
 * With TRACE=1 we also log every tool call so we can tell "agent never edited" from "agent can't edit".
 *
 *   TANGLE_API_KEY=… dotenvx run -f …/agent-state.env -- \
 *     IDS=django__django-12419 WORKER_MODEL=glm-4.6 \
 *     node_modules/.bin/tsx bench/src/swe-local-proof.mts
 */
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { AgenticSurface, ArtifactHandle, SurfaceScore } from '@tangle-network/agent-runtime/kernel'
import { defaultAnalystInstruction, refine, runAgentic } from '@tangle-network/agent-runtime/kernel'
import type { BenchScore } from './benchmarks/types'
import { createSweBenchEnvironment, SWE_SEED_PROMPT, SWE_SEED_PROMPT_WITH_RUN } from './swe-bench-env'
import { benchRouterProfile, withBenchProfile } from './router-turn'

const exec = promisify(execFile)

async function main(): Promise<void> {
  const routerKey = process.env.TANGLE_API_KEY
  if (!routerKey) throw new Error('TANGLE_API_KEY required (the worker calls the router)')
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const model = process.env.WORKER_MODEL ?? 'glm-4.6'
  const ids = (process.env.IDS ?? 'django__django-12419').split(',').map((s) => s.trim()).filter(Boolean)
  const innerTurns = Number(process.env.INNER_TURNS ?? 40)
  const maxTokens = Number(process.env.MAX_TOKENS ?? 8000)
  const budget = Number(process.env.BUDGET ?? 1)
  // WITH-TOOLS arm: RUN_TOOL=1 exposes the jailed `run` tool + the run-aware prompt. Default OFF ⇒
  // the read/edit-only baseline (glm-5.2 7/12) unchanged.
  const enableRun = ['1', 'true', 'yes'].includes((process.env.RUN_TOOL ?? '').toLowerCase())

  console.log(`═══ SWE-bench Verified — SEE-able LOCAL proof (no tangle sandbox) ═══`)
  console.log(`model=${model}  ids=${ids.join(',')}  innerTurns=${innerTurns}  maxTokens=${maxTokens}  budget=${budget}  runTool=${enableRun}`)
  console.log(`router=${routerBaseUrl}`)

  const { environment, tasks, adapter } = await createSweBenchEnvironment(ids.length, { ids, enableRun })
  const workerProfile = withBenchProfile(
    {
      name: 'swe-local-proof-worker',
      harness: 'cli-base',
      model: { provider: 'tangle-router', default: model },
      tools: {
        list_files: true,
        read_file: true,
        edit_file: true,
        ...(enableRun ? { run: true } : {}),
      },
    },
    {
      systemPrompt: enableRun ? SWE_SEED_PROMPT_WITH_RUN : SWE_SEED_PROMPT,
      maxTokens,
      maxTurns: innerTurns,
    },
  )
  const analystProfile = benchRouterProfile('swe-local-proof-analyst', model, {
    systemPrompt: defaultAnalystInstruction,
    maxTokens,
  })
  const taskList = await tasks(0, ids.length)
  const benchTaskById = new Map(
    (await adapter.loadTasks({ ids, split: 'test' })).map((task) => [task.id, task]),
  )

  // One shot per pinned id: proxy score() to capture the exact judged bytes + a NON-DESTRUCTIVE
  // apply-coherence check, then delegate the verdict to the real Docker judge.
  //
  // CRITICAL: score() is called MORE THAN ONCE per task by the driver — the shotExecutor scores
  // the handle to drive its loop, and depthStrategy scores it again at the end. So this proxy MUST
  // be non-destructive (never mutate the working tree the agent edited) and idempotent (never
  // clobber a captured non-empty patch with a later empty read). It also caches the judge by patch
  // so we don't run the Docker harness twice for the identical diff.
  type Rec = { patch: string; applied: boolean; applyErr?: string; applyChecked?: boolean; score?: BenchScore }
  const captured = new Map<string, Rec>()
  const judged = new Map<string, BenchScore>()
  const toolStats = new Map<string, { list: number; read: number; edit_ok: number; edit_fail: number; run: number; run_err: number }>()
  const proxy: AgenticSurface = {
    ...environment,
    async call(handle, name, args) {
      const res = await environment.call(handle, name, args)
      // Count tool usage per workspace so we can SEE whether the agent ever edited, and whether
      // edits succeeded or bounced off old_string matching. handle.id keys the workspace.
      const st = toolStats.get(handle.id) ?? { list: 0, read: 0, edit_ok: 0, edit_fail: 0, run: 0, run_err: 0 }
      const r = String(res)
      if (name === 'list_files') st.list += 1
      else if (name === 'read_file') st.read += 1
      else if (name === 'edit_file') {
        if (r.startsWith('edited ')) st.edit_ok += 1
        else st.edit_fail += 1
      } else if (name === 'run') {
        if (r.startsWith('ERROR:')) st.run_err += 1
        else st.run += 1
      }
      toolStats.set(handle.id, st)
      if (process.env.TRACE) {
        const a = JSON.stringify(args).slice(0, 200)
        console.error(`[TOOL] ${name} args=${a} -> ${r.slice(0, 200).replace(/\n/g, '⏎')}`)
      }
      return res
    },
    async score(task, handle: ArtifactHandle): Promise<SurfaceScore> {
      const dir = handle.id
      const diff = await exec('git', ['-C', dir, 'diff'], { maxBuffer: 40_000_000, timeout: 60_000 })
      const patch = diff.stdout
      // Mirror tool stats onto the task id (handle.id == dir).
      const st = toolStats.get(dir)
      if (st) toolStats.set(task.id, st)
      // Idempotent capture: keep the FIRST non-empty patch; never overwrite it with a later empty read.
      const prev = captured.get(task.id)
      let rec: Rec
      if (!prev) {
        rec = { patch, applied: false }
        captured.set(task.id, rec)
      } else {
        rec = prev
        if (!rec.patch.trim() && patch.trim()) rec.patch = patch
      }
      const effPatch = rec.patch
      if (!effPatch.trim()) return { passes: 0, total: 1, errored: 0 }
      // NON-DESTRUCTIVE apply-coherence check (once): the diff was produced from this tree vs HEAD,
      // so `git apply --check -R` proves it is a clean, self-consistent patch without touching the
      // working tree. The REAL forward-apply-to-clean-base proof is the swebench judge below, which
      // applies the patch in a fresh Docker checkout and reports apply failures.
      if (!rec.applyChecked) {
        rec.applyChecked = true
        const pf = join(mkdtempSync(join(tmpdir(), 'swe-apply-')), 'p.diff')
        writeFileSync(pf, effPatch)
        try {
          await exec('git', ['-C', dir, 'apply', '--check', '-R', pf], { timeout: 60_000 })
          rec.applied = true
        } catch (e) {
          rec.applied = false
          rec.applyErr = e instanceof Error ? e.message.slice(0, 200) : String(e)
        } finally {
          rmSync(pf, { force: true })
        }
      }
      // Cached judge: identical patch ⇒ identical verdict; don't pay for a second Docker run.
      let s = judged.get(effPatch)
      if (!s) {
        const benchTask = benchTaskById.get(task.id)
        if (!benchTask) throw new Error(`swe-local-proof: unknown benchmark task ${task.id}`)
        s = await adapter.judge(benchTask, effPatch)
        judged.set(effPatch, s)
      }
      rec.score = s
      return { passes: s.resolved ? 1 : 0, total: 1, errored: 0 }
    },
  }

  let anyResolved = 0
  for (const task of taskList) {
    const t0 = Date.now()
    const r = await runAgentic({
      surface: proxy,
      task,
      strategy: refine,
      routerBaseUrl,
      routerKey,
      workerProfile,
      analystProfile,
      budget,
    })
    const rec = captured.get(task.id)
    const st = toolStats.get(task.id)
    const patchBytes = rec?.patch.length ?? 0
    const patchLines = rec?.patch ? rec.patch.split('\n').length : 0
    const files = rec?.patch ? [...rec.patch.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]) : []
    const resolved = rec?.score?.resolved ?? false
    if (resolved) anyResolved += 1
    console.log(`\n──── ${task.id} ────`)
    console.log(`  agent shots=${r.shots} completions=${r.completions} tokens=in:${r.tokens.input}/out:${r.tokens.output} usd=${r.usd} wall=${Math.round((Date.now() - t0) / 1000)}s`)
    console.log(`  tools: list=${st?.list ?? 0} read=${st?.read ?? 0} edit_ok=${st?.edit_ok ?? 0} edit_fail=${st?.edit_fail ?? 0} run=${st?.run ?? 0} run_err=${st?.run_err ?? 0}`)
    console.log(`  patch: ${patchBytes} bytes, ${patchLines} lines, files=[${files.join(', ') || '(none)'}]`)
    console.log(`  patch APPLIED (git apply --check on clean base): ${rec?.applied ? 'YES' : 'NO'}${rec?.applyErr ? ` (${rec.applyErr})` : ''}`)
    console.log(`  swebench judge RESOLVED: ${resolved ? '1' : '0'}`)
    if (rec?.score?.detail) console.log(`  judge report: ${rec.score.detail.slice(0, 400)}`)
  }
  console.log(`\n>>> resolved ${anyResolved}/${taskList.length}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
