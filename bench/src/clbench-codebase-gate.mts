/**
 * CL-Bench (Continual) Codebase Adaptation — verifier-grounded selector gate.
 *
 * Of CL-Bench's six domains, codebase_adaptation is the ONLY deployable checker:
 * its scorer applies the instance's provided `test_patch` and runs pytest in the
 * instance's Docker image, keying off the exit code (the rest grade against realized
 * outcomes the agent never has = oracles). That makes it the clean analogue of the
 * HumanEval gate — an INDEPENDENT deployable check (tests ≠ the answer), unlike the
 * CL-bench Context gate where the rubric judge IS the metric.
 *
 * Each instance is SWE-bench format (repo @ base_commit + a GitHub issue). The worker
 * is a real sandbox rollout (opencode clones the repo, fixes the source, writes a diff
 * to a file we read back — a large diff truncates in the chat stream). We score each
 * candidate patch with CL-Bench's OWN scorer via `clbench_codebase_judge.py` (run in
 * CL-Bench's venv) — verified to self-check (gold patch passes, empty fails). Two
 * paired arms over the same instances:
 *   random@K  — K identical-issue rollouts (the compute control)
 *   diverse@K — K rollouts, the i-th with a strategy lens prepended (composeStrategies)
 * verifierGroundedSelect picks by pytest-pass; we report blind / random@k / diverse@k /
 * oracle@k with paired-bootstrap CIs, and write a corpus RunRecord/task the existing
 * `corpus-replay --selector=verifier` + `corpus-report` consume unchanged. Fail loud:
 * an infra-errored rollout is excluded (infraError), never scored 0.
 *
 *   dotenvx run -f … -- env N=4 K=3 WORKER_MODEL=deepseek-chat CONCURRENCY=2 \
 *     CLBENCH_DIR=/tmp/clbench-continual CORPUS=/tmp/clbench-codebase.jsonl \
 *     tsx src/clbench-codebase-gate.mts
 */

import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { acquireSandbox } from '@tangle-network/agent-runtime/loops'
import { Sandbox } from '@tangle-network/sandbox'
import { composeStrategies } from './directives'
import { type AttemptRecord, appendRunRecord, type RunRecord } from './corpus'
import { verifierGroundedSelect } from './selector'

const execFileAsync = promisify(execFile)
const PATCH_PATH = '/tmp/solution.patch'
const randomSuffix = () => Math.random().toString(36).slice(2, 10)

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

interface Instance {
  instanceId: string
  repo: string
  baseCommit: string
  problemStatement: string
}

/** Load CL-Bench codebase_adaptation instances (SWE-bench format) from the cloned
 *  repo's final-dataset.jsonl. Fail loud on a malformed/short record. */
function loadInstances(clbenchDir: string, limit: number, offset: number): Instance[] {
  const path = join(clbenchDir, 'data/codebase_adaptation/final-dataset.jsonl')
  const text = readFileSync(path, 'utf8')
  const out: Instance[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    const d = JSON.parse(line) as { instance_id?: string; repo?: string; base_commit?: string; problem_statement?: string }
    if (!d.instance_id || !d.repo || !d.base_commit || !d.problem_statement) {
      throw new Error(`malformed codebase_adaptation record: ${line.slice(0, 120)}`)
    }
    out.push({ instanceId: d.instance_id, repo: d.repo, baseCommit: d.base_commit, problemStatement: d.problem_statement })
  }
  if (out.length === 0) throw new Error('codebase_adaptation parsed to 0 instances')
  if (offset >= out.length) throw new Error(`OFFSET ${offset} >= dataset size ${out.length}`)
  return out.slice(offset, offset + limit)
}

function rolloutPrompt(inst: Instance, lens: string | undefined): string {
  return [
    lens ? `${lens}\n` : '',
    `Clone https://github.com/${inst.repo} into /work, then \`cd /work && git checkout ${inst.baseCommit}\`.`,
    '',
    'Resolve this GitHub issue by editing the SOURCE only (never the tests — the evaluation re-runs its own hidden tests on a fresh clone):',
    '',
    inst.problemStatement,
    '',
    'Work iteratively: install the package editable (`pip install -e .`), reproduce the issue, implement the fix, and re-run the existing tests until they pass.',
    `When done, from /work run EXACTLY:`,
    `  git add -A && git diff --cached -- . ':(exclude)*/test*' > ${PATCH_PATH}`,
    `Then stop. The patch file is the only deliverable — do NOT paste the diff in your reply.`,
  ].filter((s) => s !== '').join('\n')
}

interface ShotCfg {
  sandboxBaseUrl: string
  routerBaseUrl: string
  routerKey: string
  model: string
  timeoutMs: number
}

interface Shot {
  patch: string
  /** rollout completed and produced a (possibly empty) patch; false ⇒ infra error (excluded). */
  ran: boolean
  detail?: string
}

/** One fault-isolated sandbox rollout → a patch (read from the box FS). ANY rollout
 *  error becomes a recorded infra failure (ran=false), never a throw that kills the pool. */
async function runRollout(inst: Instance, lens: string | undefined, cfg: ShotCfg): Promise<Shot> {
  const client = new Sandbox({ baseUrl: cfg.sandboxBaseUrl, apiKey: cfg.routerKey })
  let box: Awaited<ReturnType<typeof acquireSandbox>> | undefined
  try {
    box = await acquireSandbox(client, {
      name: `clbench-cb-${inst.instanceId}-${randomSuffix()}`.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 60),
      environment: 'universal',
      env: { OPENAI_API_KEY: cfg.routerKey, OPENAI_BASE_URL: cfg.routerBaseUrl },
      backend: { type: 'opencode', model: { provider: 'openai', model: cfg.model, baseUrl: cfg.routerBaseUrl, apiKey: cfg.routerKey } },
    })
    const signal = cfg.timeoutMs > 0 ? AbortSignal.timeout(cfg.timeoutMs) : undefined
    for await (const _ev of box.streamPrompt(rolloutPrompt(inst, lens), signal ? { signal } : {})) {
      // drain; the deliverable is the patch FILE, not the stream
    }
    let patch = ''
    try {
      patch = await box.fs.read(PATCH_PATH)
    } catch {
      patch = '' // missing patch file ⇒ the agent produced nothing (a real empty, ran=true)
    }
    return { patch, ran: true }
  } catch (err) {
    return { patch: '', ran: false, detail: `rollout error: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}` }
  } finally {
    try {
      if (box) await box.delete()
    } catch {
      // staging reaps on expiry
    }
  }
}

/** Score one candidate patch with CL-Bench's deployable pytest checker via the bridge
 *  (run in CL-Bench's venv, cwd = its repo root so `src.tasks...` resolves). Returns
 *  pass (0/1) or null on an infra/judge failure (excluded, never scored 0). */
async function judgePatch(inst: Instance, patch: string, clbenchDir: string): Promise<number | null> {
  if (patch.trim() === '') return 0 // empty patch is a legitimate fail, not an infra error
  const dir = mkdtempSync(join(tmpdir(), 'clbench-cb-'))
  const patchFile = join(dir, 'candidate.patch')
  writeFileSync(patchFile, patch)
  try {
    const { stdout } = await execFileAsync(
      join(clbenchDir, '.venv/bin/python'),
      [
        join(process.cwd(), 'scripts/clbench_codebase_judge.py'),
        '--dataset',
        join(clbenchDir, 'data/codebase_adaptation/final-dataset.jsonl'),
        '--instance-id',
        inst.instanceId,
        '--patch-file',
        patchFile,
      ],
      { cwd: clbenchDir, maxBuffer: 8 * 1024 * 1024, timeout: 600_000 },
    )
    const last = stdout.trim().split('\n').at(-1) ?? '{}'
    const verdict = JSON.parse(last) as { success?: boolean }
    return verdict.success ? 1 : 0
  } catch (err) {
    console.error(`  judge infra error ${inst.instanceId}: ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`)
    return null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
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

function makeRng(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface PairedLift {
  point: number
  low: number
  high: number
  pairs: number
  discordant: number
}

function pairedLift(baseline: number[], treatment: number[], bootstrapN = 10000): PairedLift {
  if (baseline.length !== treatment.length) throw new Error('pairedLift: misaligned arms')
  const n = baseline.length
  if (n === 0) throw new Error('pairedLift: no pairs')
  const deltas = baseline.map((b, i) => (treatment[i] as number) - b)
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length
  const point = mean(deltas)
  const discordant = deltas.filter((d) => Math.abs(d) > 1e-9).length
  const rng = makeRng(0x9e3779b9)
  const rint = (m: number) => Math.floor(rng() * m)
  const boots: number[] = []
  for (let b = 0; b < bootstrapN; b += 1) {
    let acc = 0
    for (let j = 0; j < n; j += 1) acc += deltas[rint(n)] as number
    boots.push(acc / n)
  }
  boots.sort((x, y) => x - y)
  return { point, low: boots[Math.floor(0.025 * bootstrapN)] ?? Number.NaN, high: boots[Math.floor(0.975 * bootstrapN)] ?? Number.NaN, pairs: n, discordant }
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const pp = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`

async function main(): Promise<void> {
  const n = Number(process.env.N ?? 4)
  const k = Number(process.env.K ?? 3)
  const offset = Number(process.env.OFFSET ?? 0)
  const model = process.env.WORKER_MODEL ?? 'deepseek-chat'
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('TANGLE_API_KEY')
  const sandboxBaseUrl = process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools'
  const clbenchDir = process.env.CLBENCH_DIR ?? '/tmp/clbench-continual'
  const rolloutConc = Number(process.env.CONCURRENCY ?? 3)
  const judgeConc = Number(process.env.JUDGE_CONCURRENCY ?? 2)
  const timeoutMs = process.env.SHOT_TIMEOUT_MS ? Number(process.env.SHOT_TIMEOUT_MS) : 900_000
  const corpusPath = process.env.CORPUS ?? '/tmp/clbench-codebase.jsonl'
  if (!Number.isInteger(n) || n < 1) throw new Error(`N must be a positive integer, got ${process.env.N}`)
  if (!Number.isInteger(k) || k < 1) throw new Error(`K must be a positive integer, got ${process.env.K}`)

  const cfg: ShotCfg = { sandboxBaseUrl, routerBaseUrl, routerKey, model, timeoutMs }
  console.log(`=== CL-Bench Codebase Adaptation selector gate · N=${n} K=${k} offset=${offset} model=${model} ===`)
  console.log(`  sandbox=${sandboxBaseUrl}  judge=CL-Bench pytest-in-Docker (deployable)  clbench=${clbenchDir}`)

  const instances = loadInstances(clbenchDir, n, offset)
  console.log(`loaded ${instances.length} instance(s): ${instances.map((i) => i.instanceId).join(', ')}`)

  type Unit = { instIdx: number; arm: 'random' | 'diverse'; shot: number; lens: string | undefined }
  const units: Unit[] = []
  for (let ii = 0; ii < instances.length; ii += 1) {
    const lenses = composeStrategies('', k) // lens prefixes only ('' base ⇒ "<lens>\n\n")
    for (let s = 0; s < k; s += 1) {
      units.push({ instIdx: ii, arm: 'random', shot: s, lens: undefined })
      units.push({ instIdx: ii, arm: 'diverse', shot: s, lens: (lenses[s] as string).trim() })
    }
  }
  console.log(`\n▶ phase 1: ${units.length} rollouts (${instances.length}×${k}×2 arms) via sandbox, conc=${rolloutConc}`)
  const shots = await pool(units, rolloutConc, async (u) => {
    const inst = instances[u.instIdx] as Instance
    const s = await runRollout(inst, u.lens, cfg)
    console.log(`  rollout ${inst.instanceId} ${u.arm}#${u.shot}: ${s.ran ? `patch ${s.patch.length}B` : `INFRA (${s.detail})`}`)
    return s
  })

  console.log(`\n▶ phase 2: judging ${shots.length} patches with the deployable checker, conc=${judgeConc}`)
  const passes = await pool(units, judgeConc, async (u, i) => {
    const shot = shots[i] as Shot
    if (!shot.ran) return null // infra error ⇒ excluded
    const inst = instances[u.instIdx] as Instance
    const p = await judgePatch(inst, shot.patch, clbenchDir)
    console.log(`  judge ${inst.instanceId} ${u.arm}#${u.shot}: ${p === null ? 'INFRA' : p ? 'PASS' : 'fail'}`)
    return p
  })

  // Regroup; an attempt with a null pass (infra) is dropped from its arm.
  const byInst = instances.map(() => ({ random: [] as (number | null)[], diverse: [] as (number | null)[], rPatch: [] as string[], dPatch: [] as string[] }))
  units.forEach((u, i) => {
    const grp = byInst[u.instIdx] as { random: (number | null)[]; diverse: (number | null)[]; rPatch: string[]; dPatch: string[] }
    const pass = passes[i] as number | null
    const patch = (shots[i] as Shot).patch
    if (u.arm === 'random') { grp.random[u.shot] = pass; grp.rPatch[u.shot] = patch } else { grp.diverse[u.shot] = pass; grp.dPatch[u.shot] = patch }
  })

  // Per-instance {0,1} outcomes; instances with no valid attempt in BOTH arms are excluded.
  const blind: number[] = []
  const randomAtK: number[] = []
  const diverseAtK: number[] = []
  const oracleAtK: number[] = []
  let excluded = 0
  for (const grp of byInst) {
    const rValid = grp.random.filter((p): p is number => p !== null && p !== undefined)
    const dValid = grp.diverse.filter((p): p is number => p !== null && p !== undefined)
    if (rValid.length === 0 || dValid.length === 0) { excluded += 1; continue }
    blind.push(rValid[0] as number)
    randomAtK.push(rValid[verifierGroundedSelect(rValid)] as number)
    diverseAtK.push(dValid[verifierGroundedSelect(dValid)] as number)
    oracleAtK.push(dValid.some((p) => p > 0) ? 1 : 0)
  }
  const rate = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length)

  console.log(`\n${'='.repeat(78)}`)
  console.log(`RESULTS · CL-Bench Codebase Adaptation · n=${blind.length} scored (${excluded} excluded) · k=${k} · model=${model}`)
  console.log('='.repeat(78))
  console.log(`  blind pass@1               ${pct(rate(blind))}`)
  console.log(`  random@k (verifier-pick)   ${pct(rate(randomAtK))}`)
  console.log(`  diverse@k (verifier-pick)  ${pct(rate(diverseAtK))}`)
  console.log(`  oracle@k (diverse, any)    ${pct(rate(oracleAtK))}`)
  if (blind.length >= 2) {
    const row = (label: string, l: PairedLift) =>
      console.log(`  ${label.padEnd(34)} ${pp(l.point).padStart(7)}   CI [${pp(l.low)}, ${pp(l.high)}]   (paired ${l.pairs}, discordant ${l.discordant})`)
    console.log(`\n  PAIRED LIFTS (95% bootstrap CI):`)
    row('random@k − blind (compute)', pairedLift(blind, randomAtK))
    row('diverse@k − random@k (verifier)', pairedLift(randomAtK, diverseAtK))
    row('diverse@k − blind (total)', pairedLift(blind, diverseAtK))
  } else {
    console.log('\n  (n<2 scored — paired CIs need ≥2; this is a plumbing smoke, not a signal)')
  }

  // Corpus: random@k arm, ranked by the deployable pytest verifier.
  for (let ii = 0; ii < instances.length; ii += 1) {
    const inst = instances[ii] as Instance
    const grp = byInst[ii] as { random: (number | null)[]; rPatch: string[] }
    const attempts: AttemptRecord[] = grp.random.map((p, round) => ({
      round,
      prompt: 'clbench-codebase-rollout',
      output: (grp.rPatch[round] ?? '').slice(0, 4000),
      ...(p === null ? { error: 'infra' } : { valid: p > 0, score: p }),
      eventCount: 1,
      eventTypes: { 'sandbox.stream': 1 },
      traceTail: (grp.rPatch[round] ?? '').slice(-600),
    }))
    const validPasses = grp.random.filter((p): p is number => p !== null && p !== undefined)
    const record: RunRecord = {
      ts: new Date().toISOString(),
      benchmark: 'clbench-codebase',
      instanceId: inst.instanceId,
      condition: `random@${k}`,
      model,
      blindResolved: validPasses[0] === 1,
      resolved: validPasses.some((p) => p > 0),
      attempts,
      infraError: validPasses.length === 0,
    }
    await appendRunRecord(corpusPath, record)
  }
  console.log(`\n=== wrote ${instances.length} task(s) → ${corpusPath} · gate: tsx src/corpus-replay.mts ${corpusPath} --selector=verifier ===`)
}

main().catch((err) => {
  console.error(`clbench-codebase-gate: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
