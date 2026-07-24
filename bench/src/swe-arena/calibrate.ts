/**
 * Dual calibration — an instance may enter an experiment only if BOTH gates
 * hold, mirroring the experiment's `calibrate.sh` (repro gate) plus the
 * gold-family judge rows M1 reconciles on (official-judge gate):
 *
 *  1. REPRO GATE (`verifyCalibrated`): on a pristine image-materialized
 *     workspace the self-repro verify command must FAIL at base_commit and
 *     PASS once the official gold patch is applied (git apply, then
 *     `patch --fuzz=3` fallback — several Verified gold patches only apply
 *     fuzzily to their own base). A verify that can't see the gold fix can't
 *     grade an arm's fix.
 *
 *  2. OFFICIAL-JUDGE GOLD GATE (`goldOfficialResolved`): the official swebench
 *     judge (via serialized-judge → adapter.judge) must resolve the gold patch
 *     itself. psf__requests-2931/-2317 proved a judge can be blind on an
 *     instance whose verify calibrates fine — those became the excluded
 *     "gold-ungradeable" rows in the M1 denominator.
 */

import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { judgeFactoryPatch, judgeTestSources, specReferencedSources } from './factory-judge-child.mts'
import { loadFactoryInstance, loadFactoryInstances, type LoadedFactoryInstance } from './fixtures'
import { materializeWorkspace } from './materialize'
import { run, runOk, shq } from './proc'
import type { SerializedJudge } from './serialized-judge'
import { checkSpecReachability } from './spec-reachability'

export interface CalibrateOptions {
  instanceId: string
  image: string
  baseCommit: string
  /** The official gold patch text (task-meta `patch`). */
  goldPatch: string
  /**
   * Self-repro verify command, run via `bash -c` with cwd = the workspace
   * (calibrate.sh ran `bash verify/<iid>.sh` from inside the tree).
   */
  verifyCmd: string
  /** Scratch root; two throwaway workspaces are created and removed under it. */
  workDir: string
  /** Judge for the official gold gate. */
  judge: SerializedJudge
  /** Ceiling for one verify run (repro scripts self-limit at 180s; this is a backstop). */
  verifyTimeoutMs?: number
  /** Keep the calibration workspaces for post-mortem. Default: removed. */
  keepWorkspaces?: boolean
}

export interface CalibrationResult {
  iid: string
  /** rc of verify on pristine base (must be nonzero). */
  baseRc: number
  /** rc of applying the gold patch (0 via git apply or the fuzz fallback). */
  goldApplyRc: number
  /** rc of verify with gold applied (must be zero). */
  goldRc: number
  /** base FAILS and gold PASSES. */
  verifyCalibrated: boolean
  /** Official judge resolves the gold patch. */
  goldOfficialResolved: boolean
  /** verifyCalibrated && goldOfficialResolved — the experiment admission bar. */
  experimentValid: boolean
}

async function runVerify(verifyCmd: string, ws: string, timeoutMs: number): Promise<number> {
  const res = await run('bash', ['-c', verifyCmd], { cwd: ws, timeoutMs })
  return res.code
}

/**
 * Apply a patch file with calibrate.sh's exact fallback chain:
 * `git apply --whitespace=nowarn`, then `patch -p1 --fuzz=3` on failure.
 * Returns the rc of the LAST attempt (0 = applied).
 */
export async function applyPatchWithFallback(ws: string, patchFile: string): Promise<number> {
  const gitApply = await run('git', ['apply', '--whitespace=nowarn', patchFile], { cwd: ws })
  if (gitApply.code === 0) return 0
  const fuzz = await run('bash', ['-c', `patch -p1 --fuzz=3 < ${shq(patchFile)}`], { cwd: ws })
  return fuzz.code
}

export async function calibrateInstance(opts: CalibrateOptions): Promise<CalibrationResult> {
  const { instanceId, image, baseCommit, verifyCmd, judge } = opts
  const verifyTimeoutMs = opts.verifyTimeoutMs ?? 600_000
  const baseWs = join(opts.workDir, `cal-base-${instanceId}`)
  const goldWs = join(opts.workDir, `cal-gold-${instanceId}`)
  const goldPatchFile = join(opts.workDir, `${instanceId}.gold.patch`)

  try {
    await materializeWorkspace({ instanceId, image, baseCommit, dest: baseWs })
    const baseRc = await runVerify(verifyCmd, baseWs, verifyTimeoutMs)

    await materializeWorkspace({ instanceId, image, baseCommit, dest: goldWs })
    await writeFile(goldPatchFile, opts.goldPatch)
    const goldApplyRc = await applyPatchWithFallback(goldWs, goldPatchFile)
    const goldRc = await runVerify(verifyCmd, goldWs, verifyTimeoutMs)

    const verifyCalibrated = baseRc !== 0 && goldRc === 0

    const goldVerdict = await judge.judge(instanceId, goldPatchFile, 'gold')
    const goldOfficialResolved = goldVerdict.resolved === true

    return {
      iid: instanceId,
      baseRc,
      goldApplyRc,
      goldRc,
      verifyCalibrated,
      goldOfficialResolved,
      experimentValid: verifyCalibrated && goldOfficialResolved,
    }
  } finally {
    if (!opts.keepWorkspaces) {
      await rm(baseWs, { recursive: true, force: true })
      await rm(goldWs, { recursive: true, force: true })
    }
  }
}

// ---------------------------------------------------------------------------
// Factory-bench admission gate — the same "calibrate through the OFFICIAL
// judge" lesson, generalized: gold (the real PR's impl-only diff) must judge
// resolved, and the bare base (empty patch) must judge unresolved. Both runs
// go through the SAME judge code the arena uses (judgeFactoryPatch — the
// factory-judge-child body), deliberately bypassing serialized-judge's
// empty-patch short-circuit so the base direction really executes the judge
// tests on the bare tree instead of trivially returning false.
// ---------------------------------------------------------------------------

export interface FactoryCalibrationResult {
  iid: string
  /** Gold = impl-only PR diff. Must be resolved with full score. */
  goldResolved: boolean
  goldPassed: number
  /** Base = empty patch. Must be unresolved. */
  baseResolved: boolean
  basePassed: number
  /** The JUDGED denominator (authored minus excluded). */
  total: number
  /** Every test the hidden judge files author. */
  authoredTotal: number
  reachability: FactoryReachabilityResult
  /** All three gates hold — the pool admission bar. */
  admitted: boolean
}

/** The spec-reachability gate's verdict for one instance. */
export interface FactoryReachabilityResult {
  authored: number
  reachable: number
  unreachable: number
  /** Base-tree files the spec names, whose contents joined the vocabulary. */
  referencedFiles: string[]
  /** Unreachable tests, with the tokens the spec never provides. */
  unreachableTests: { file: string; name: string; missing: string[] }[]
  /** Unreachable but NOT declared in `excluded_tests` — blocks admission. */
  undeclared: { file: string; name: string; missing: string[] }[]
  /** Declared `spec-unreachable` but now reachable — a denominator shrunk for nothing. */
  staleExclusions: string[]
  /** No undeclared unreachable tests and no stale exclusions. */
  passed: boolean
}

/**
 * Third admission gate: is every hidden test REACHABLE from what the builder
 * can see (the spec text, plus the base-tree files the spec names)?
 *
 * Gold-passes/base-fails only prove the tests grade the feature. `.309` passed
 * both and still failed the same 17 of 30 tests in all seven measured runs
 * because those tests assert on identifiers (`keepThreshold`, `saturated`,
 * `minTasksWithGap`) the spec rewrite dropped. An unreachable test is not a
 * difficulty signal, it is dead weight in the denominator that compresses
 * every arm into the same band.
 *
 * The instance is PRESERVED rather than rejected: unreachable tests must be
 * declared in `excluded_tests`, which takes them out of the judged denominator
 * (`30 → 19`) and skips them at overlay time, with the missing tokens recorded
 * in the manifest so the exclusion is auditable.
 */
export async function checkFactoryReachability(inst: LoadedFactoryInstance): Promise<FactoryReachabilityResult> {
  const files = await judgeTestSources(inst)
  const referenced = await specReferencedSources(inst)
  const report = checkSpecReachability(inst.spec, files, referenced)

  const declared = new Map(inst.excluded_tests.map((e) => [e.name, e]))
  const unreachableTests = report.tests
    .filter((t) => !t.reachable)
    .map((t) => ({ file: t.file, name: t.name, missing: t.missing.map((m) => `${m.token}(${m.kind})`) }))
  const undeclared = unreachableTests.filter((t) => !declared.has(t.name))
  const unreachableNames = new Set(report.unreachableNames)
  const staleExclusions = inst.excluded_tests
    .filter((e) => e.reason === 'spec-unreachable' && !unreachableNames.has(e.name))
    .map((e) => e.name)

  return {
    authored: report.tests.length,
    reachable: report.reachable,
    unreachable: report.unreachable,
    referencedFiles: Object.keys(referenced),
    unreachableTests,
    undeclared,
    staleExclusions,
    passed: undeclared.length === 0 && staleExclusions.length === 0,
  }
}

/**
 * The real PR's impl-only patch: full first-parent diff base→judge_ref minus
 * the judge test files (they are the hidden judge, not the deliverable).
 */
export async function goldImplPatch(inst: LoadedFactoryInstance): Promise<string> {
  const res = await runOk('git', [
    '-C', inst.repo_local_mirror,
    'diff', inst.base_commit, inst.judge_ref,
    '--', '.',
    ...inst.judge_tests.map((t) => `:(exclude)${t}`),
  ])
  if (res.stdout.trim().length === 0) {
    throw new Error(`calibrate ${inst.id}: impl-only gold diff is empty — judge_tests exclude everything?`)
  }
  return res.stdout
}

/** Run all three admission directions for one instance. Throws only on infra failure. */
export async function calibrateFactoryInstance(inst: LoadedFactoryInstance): Promise<FactoryCalibrationResult> {
  const reachability = await checkFactoryReachability(inst)
  const gold = await judgeFactoryPatch(inst, await goldImplPatch(inst))
  const base = await judgeFactoryPatch(inst, '')
  return {
    iid: inst.id,
    goldResolved: gold.result.resolved,
    goldPassed: gold.result.passed,
    baseResolved: base.result.resolved,
    basePassed: base.result.passed,
    total: inst.judgeTestTotal,
    authoredTotal: inst.judgeTestTotalAuthored,
    reachability,
    admitted: gold.result.resolved && !base.result.resolved && reachability.passed,
  }
}

// ---------------------------------------------------------------------------
// CLI:  tsx src/swe-arena/calibrate.ts --factory <instancesDirOrInstanceDir> [id ...]
// Rejection is LOUD: any instance failing either direction exits nonzero.
// ---------------------------------------------------------------------------

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const [mode, root, ...ids] = process.argv.slice(2)
  if ((mode !== '--factory' && mode !== '--factory-reachability') || !root) {
    console.error(
      'usage: tsx src/swe-arena/calibrate.ts --factory|--factory-reachability <instancesDir|instanceDir> [id ...]',
    )
    process.exit(2)
  }
  let instances: LoadedFactoryInstance[]
  try {
    instances = loadFactoryInstances(root)
  } catch {
    instances = [loadFactoryInstance(root)]
  }
  if (ids.length > 0) {
    const byId = new Map(instances.map((i) => [i.id, i]))
    instances = ids.map((id) => {
      const inst = byId.get(id)
      if (!inst) throw new Error(`unknown instance id ${id} (have: ${[...byId.keys()].join(', ')})`)
      return inst
    })
  }
  const printReachability = (iid: string, judged: number, authored: number, r: FactoryReachabilityResult): void => {
    console.log(
      `REACHABILITY ${iid}: ${r.reachable}/${r.authored} reachable, ${r.unreachable} unreachable; ` +
        `judged denominator ${judged} of ${authored} authored` +
        (r.referencedFiles.length > 0 ? ` (spec-named base files read: ${r.referencedFiles.join(', ')})` : ''),
    )
    for (const t of r.unreachableTests) {
      const tag = r.undeclared.some((u) => u.name === t.name) ? 'UNDECLARED' : 'excluded'
      console.log(`  [${tag}] ${t.file} :: ${t.name}\n      missing: ${t.missing.join(', ')}`)
    }
    for (const name of r.staleExclusions) console.log(`  [STALE EXCLUSION — now reachable] ${name}`)
  }

  let rejected = 0
  for (const inst of instances) {
    if (mode === '--factory-reachability') {
      const r = await checkFactoryReachability(inst)
      printReachability(inst.id, inst.judgeTestTotal, inst.judgeTestTotalAuthored, r)
      if (!r.passed) rejected += 1
      continue
    }
    const r = await calibrateFactoryInstance(inst)
    const verdict = r.admitted ? 'ADMITTED' : 'REJECTED'
    printReachability(r.iid, r.total, r.authoredTotal, r.reachability)
    console.log(
      `CALIBRATE ${r.iid}: gold ${r.goldPassed}/${r.total} resolved=${r.goldResolved}; ` +
        `base ${r.basePassed}/${r.total} resolved=${r.baseResolved}; ` +
        `reachability ${r.reachability.passed ? 'ok' : 'FAILED'} → ${verdict}`,
    )
    if (!r.admitted) rejected += 1
  }
  if (rejected > 0) {
    console.error(
      `calibration gate: ${rejected} instance(s) REJECTED ` +
        `(gold must pass, base must fail, and every spec-unreachable test must be declared in excluded_tests)`,
    )
    process.exit(1)
  }
}
