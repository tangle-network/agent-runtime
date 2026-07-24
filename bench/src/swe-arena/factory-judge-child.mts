/**
 * Factory judge child — the factory-bench equivalent of `judge-child.mts`.
 * One candidate patch, one hidden-test verdict, printed as a single
 * `JUDGE_RESULT {...}` line so serialized-judge.ts (queue, retry, SIGKILL
 * ceiling) carries over unchanged. No docker, no Python venv: the judge
 * workspace is a `git archive` export of the instance's base commit from the
 * local mirror, with the PR's own added test files overlaid from the merge
 * commit — the tests the builder never saw.
 *
 * Steps: export base tree → apply candidate patch → overlay judge tests from
 * `judge_ref` → run `setup_cmds` (shared pnpm store) → run `judge_cmds` →
 * parse vitest's pass/fail counts → JUDGE_RESULT with partial credit.
 *
 * Verdict semantics:
 *  - `resolved` = every calibrated judge test passes (passed === total, 0 failed).
 *  - `score` = passed / judgeTestTotal, where the denominator is the CALIBRATED
 *    total from the manifest's resolved_criterion — never vitest's reported
 *    total, which shrinks when a judge file fails to collect.
 *  - An unappliable patch is the candidate's failure → resolved:false, score 0.
 *  - A setup/parse failure is an INFRA failure → exit 1 with no JUDGE_RESULT
 *    line, so serialized-judge retries and then records `resolved: null`
 *    (inconclusive), never a fabricated verdict.
 *
 * usage: node --import tsx src/swe-arena/factory-judge-child.mts <instanceDir> <patchPath>
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { applyPatchWithFallback } from './calibrate.ts'
import { loadFactoryInstance, type LoadedFactoryInstance } from './fixtures.ts'
import { run, runOk, shq } from './proc.ts'
import { applyTestExclusions, type JudgeTestSource, specReferencedPaths } from './spec-reachability.ts'

/** Warm installs across judge/calibration runs (design: `--config.store-dir`). */
export const SHARED_PNPM_STORE = join(tmpdir(), 'factory-bench-pnpm-store')

export interface VitestSummary {
  passed: number
  failed: number
  /** vitest's own reported total (collected tests only — informational). */
  reportedTotal: number
}

const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '')

/**
 * Parse the `Tests  …` summary line of a vitest run (v3 and v4 formats):
 *   "      Tests  30 passed (30)"
 *   "      Tests  17 failed | 13 passed (30)"
 *   "      Tests  no tests"        (collection failure — 0 passed is a verdict)
 * Returns undefined when no summary line exists (infra failure, not a verdict).
 */
export function parseVitestSummary(output: string): VitestSummary | undefined {
  for (const rawLine of stripAnsi(output).split('\n')) {
    const m = /^\s*Tests\s{2,}(.+)$/.exec(rawLine)
    if (!m) continue
    const body = m[1].trim()
    if (body.startsWith('no tests')) return { passed: 0, failed: 0, reportedTotal: 0 }
    const passed = /(\d+) passed/.exec(body)
    const failed = /(\d+) failed/.exec(body)
    const total = /\((\d+)\)/.exec(body)
    if (!passed && !failed) continue
    return {
      passed: passed ? Number(passed[1]) : 0,
      failed: failed ? Number(failed[1]) : 0,
      reportedTotal: total ? Number(total[1]) : 0,
    }
  }
  return undefined
}

/** The JUDGE_RESULT row this child prints (superset of the SWE child's fields). */
export interface FactoryJudgeResult {
  iid: string
  resolved: boolean
  /** passed / judgeTestTotal — partial credit for the staircase. */
  score: number
  passed: number
  total: number
  secs: number
  patch_bytes: number
  error?: string
}

/** Parse one JUDGE_RESULT line back out of child stdout (calibrate + tests). */
export function parseFactoryJudgeResult(stdout: string): FactoryJudgeResult | undefined {
  const line = stdout.split('\n').find((l) => l.includes('JUDGE_RESULT'))
  if (!line) return undefined
  try {
    const parsed = JSON.parse(line.slice(line.indexOf('JUDGE_RESULT') + 'JUDGE_RESULT'.length).trim())
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.resolved !== 'boolean') return undefined
    return parsed as FactoryJudgeResult
  } catch {
    return undefined
  }
}

/** `git archive <ref> | tar -x` — a bare tree, no .git, no refs, no future history. */
export async function exportBaseTree(mirror: string, ref: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true })
  await runOk('bash', ['-c', `git -C ${shq(mirror)} archive ${shq(ref)} | tar -x -C ${shq(dest)}`])
}

/** Overlay each judge test from the merge commit (`git show <judge_ref>:<path>`). */
/** The hidden judge test files as authored at `judge_ref`. */
export async function judgeTestSources(inst: LoadedFactoryInstance): Promise<JudgeTestSource[]> {
  const out: JudgeTestSource[] = []
  for (const path of inst.judge_tests) {
    const show = await runOk('git', ['-C', inst.repo_local_mirror, 'show', `${inst.judge_ref}:${path}`])
    out.push({ path, source: show.stdout })
  }
  return out
}

/**
 * Base-tree contents of the source files the spec explicitly names. These are
 * part of what a builder can derive the contract from, so the reachability
 * gate reads them alongside the spec text.
 */
export async function specReferencedSources(inst: LoadedFactoryInstance): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const path of specReferencedPaths(inst.spec)) {
    const res = await run('git', ['-C', inst.repo_local_mirror, 'show', `${inst.base_commit}:${path}`])
    if (res.code === 0) out[path] = res.stdout
  }
  return out
}

/**
 * Write the hidden tests into the workspace, marking every `excluded_tests`
 * entry `it.skip` so it lands in vitest's skipped bucket instead of counting
 * as a failure nobody could have avoided. Fail-loud when an exclusion matches
 * no test — a stale name would silently shrink the denominator.
 */
export async function overlayJudgeTests(inst: LoadedFactoryInstance, ws: string): Promise<void> {
  const excludedNames = inst.excluded_tests.map((e) => e.name)
  const skipped = new Set<string>()
  for (const { path, source } of await judgeTestSources(inst)) {
    const applied = applyTestExclusions(source, path, excludedNames)
    for (const name of applied.skipped) skipped.add(name)
    await mkdir(dirname(join(ws, path)), { recursive: true })
    await writeFile(join(ws, path), applied.source)
  }
  const unmatched = excludedNames.filter((n) => !skipped.has(n))
  if (unmatched.length > 0) {
    throw new Error(
      `${inst.id}: excluded_tests names no test in ${inst.judge_tests.join(', ')} — ${unmatched.join(' | ')}`,
    )
  }
}

/** Env for setup/judge commands: shared pnpm store, CI heuristics disabled. */
export function judgeCmdEnv(): NodeJS.ProcessEnv {
  // CI='false' keeps pnpm out of frozen-lockfile mode: a candidate patch may
  // legitimately edit package.json, and the judge must install it, not refuse.
  return { ...process.env, CI: 'false', npm_config_store_dir: SHARED_PNPM_STORE }
}

export interface FactoryJudgeOutcome {
  result: FactoryJudgeResult
  /** Raw judge_cmds output, for post-mortem. */
  output: string
}

/**
 * Build the judge workspace and run the judge over one patch. Throws on infra
 * failure (export/overlay/setup/parse); returns a verdict otherwise.
 */
export async function judgeFactoryPatch(
  inst: LoadedFactoryInstance,
  patch: string,
  opts: { workDir?: string; keepWorkspace?: boolean } = {},
): Promise<FactoryJudgeOutcome> {
  const t0 = Date.now()
  const ws = opts.workDir ?? (await mkdtemp(join(tmpdir(), `factory-judge-${inst.id.replace(/[^a-zA-Z0-9.-]/g, '-')}-`)))
  const cmdTimeoutMs = inst.timeout_s * 1000
  try {
    await exportBaseTree(inst.repo_local_mirror, inst.base_commit, ws)
    // A git repo (fresh, historyless) so `git apply` and repo tooling behave;
    // judge-side only, so its refs are irrelevant to leak prevention.
    await runOk('git', ['-C', ws, 'init', '-q'])

    if (patch.trim().length > 0) {
      const patchFile = join(ws, '.factory-candidate.patch')
      await writeFile(patchFile, patch)
      const applyRc = await applyPatchWithFallback(ws, patchFile)
      await rm(patchFile, { force: true })
      if (applyRc !== 0) {
        return {
          result: {
            iid: inst.id,
            resolved: false,
            score: 0,
            passed: 0,
            total: inst.judgeTestTotal,
            secs: Math.round((Date.now() - t0) / 1000),
            patch_bytes: patch.length,
            error: `apply-failed rc=${applyRc}`,
          },
          output: '',
        }
      }
    }

    await overlayJudgeTests(inst, ws)

    const env = judgeCmdEnv()
    for (const cmd of inst.setup_cmds) {
      const res = await run('bash', ['-c', cmd], { cwd: ws, timeoutMs: cmdTimeoutMs, env })
      if (res.code !== 0) {
        throw new Error(
          `setup_cmd failed (rc=${res.code}${res.timedOut ? ', timeout' : ''}): ${cmd}\n${(res.stderr || res.stdout).slice(-2000)}`,
        )
      }
    }

    let passed = 0
    let failed = 0
    let output = ''
    for (const cmd of inst.judge_cmds) {
      const res = await run('bash', ['-c', cmd], { cwd: ws, timeoutMs: cmdTimeoutMs, env })
      const combined = res.stdout + res.stderr
      output += combined
      if (res.timedOut) throw new Error(`judge_cmd timed out after ${cmdTimeoutMs}ms: ${cmd}`)
      const summary = parseVitestSummary(combined)
      if (!summary) {
        throw new Error(`judge_cmd produced no parseable test summary (rc=${res.code}): ${cmd}\n${combined.slice(-2000)}`)
      }
      passed += summary.passed
      failed += summary.failed
    }

    const total = inst.judgeTestTotal
    return {
      result: {
        iid: inst.id,
        resolved: failed === 0 && passed === total,
        score: total > 0 ? Number((passed / total).toFixed(4)) : 0,
        passed,
        total,
        secs: Math.round((Date.now() - t0) / 1000),
        patch_bytes: patch.length,
      },
      output,
    }
  } finally {
    if (!opts.keepWorkspace) await rm(ws, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// CLI (guarded so calibrate/tests can import the helpers above).
// ---------------------------------------------------------------------------

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const [, , instanceDir, patchPath] = process.argv
  if (!instanceDir || !patchPath) {
    console.error('usage: node --import tsx factory-judge-child.mts <instanceDir> <patchPath>')
    process.exit(2)
  }
  const inst = loadFactoryInstance(instanceDir)
  const patch = await readFile(patchPath, 'utf8')
  const { result } = await judgeFactoryPatch(inst, patch)
  console.log('JUDGE_RESULT ' + JSON.stringify(result))
}
