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
import { judgeFactoryPatch } from './factory-judge-child.mts'
import { loadFactoryInstance, loadFactoryInstances, type LoadedFactoryInstance } from './fixtures'
import { materializeWorkspace } from './materialize'
import { run, runOk, shq } from './proc'
import type { SerializedJudge } from './serialized-judge'

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
  total: number
  /** goldResolved && !baseResolved — the pool admission bar. */
  admitted: boolean
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

/** Run both admission directions for one instance. Throws only on infra failure. */
export async function calibrateFactoryInstance(inst: LoadedFactoryInstance): Promise<FactoryCalibrationResult> {
  const gold = await judgeFactoryPatch(inst, await goldImplPatch(inst))
  const base = await judgeFactoryPatch(inst, '')
  return {
    iid: inst.id,
    goldResolved: gold.result.resolved,
    goldPassed: gold.result.passed,
    baseResolved: base.result.resolved,
    basePassed: base.result.passed,
    total: inst.judgeTestTotal,
    admitted: gold.result.resolved && !base.result.resolved,
  }
}

// ---------------------------------------------------------------------------
// CLI:  tsx src/swe-arena/calibrate.ts --factory <instancesDirOrInstanceDir> [id ...]
// Rejection is LOUD: any instance failing either direction exits nonzero.
// ---------------------------------------------------------------------------

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const [mode, root, ...ids] = process.argv.slice(2)
  if (mode !== '--factory' || !root) {
    console.error('usage: tsx src/swe-arena/calibrate.ts --factory <instancesDir|instanceDir> [id ...]')
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
  let rejected = 0
  for (const inst of instances) {
    const r = await calibrateFactoryInstance(inst)
    const verdict = r.admitted ? 'ADMITTED' : 'REJECTED'
    console.log(
      `CALIBRATE ${r.iid}: gold ${r.goldPassed}/${r.total} resolved=${r.goldResolved}; ` +
        `base ${r.basePassed}/${r.total} resolved=${r.baseResolved} → ${verdict}`,
    )
    if (!r.admitted) rejected += 1
  }
  if (rejected > 0) {
    console.error(`calibration gate: ${rejected} instance(s) REJECTED (gold must pass AND base must fail)`)
    process.exit(1)
  }
}
