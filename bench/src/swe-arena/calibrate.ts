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
import { materializeWorkspace } from './materialize'
import { run, shq } from './proc'
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
