import { realpathSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { Fingerprints } from './swe-structural-provenance'

export const PAIRED_FINGERPRINT_KEYS = [
  'source',
  'commonConfig',
  'repro',
  'prompt',
  'tools',
  'task',
] as const satisfies ReadonlyArray<keyof Fingerprints>

export function assertCompleteTaskSet(
  rowIds: Iterable<string>,
  taskIds: readonly string[],
  context: string,
): void {
  const rows = new Set(rowIds)
  if (rows.size !== taskIds.length || taskIds.some((id) => !rows.has(id))) {
    throw new Error(`${context}: incomplete Phase A (${rows.size}/${taskIds.length} required rows)`)
  }
}

export function assertPairedFingerprints(
  left: Fingerprints,
  right: Fingerprints,
  context: string,
): void {
  for (const key of PAIRED_FINGERPRINT_KEYS) {
    if (left[key] !== right[key]) throw new Error(`${context}: paired ${key} fingerprints do not match`)
  }
}

export function assertPairedExecutionFingerprint(left: string, right: string, context: string): void {
  if (!left || left !== right) throw new Error(`${context}: paired execution fingerprints do not match`)
}

interface ArtifactPathIdentity {
  canonicalPath: string
  device: number | null
  inode: number | null
}

function artifactPathIdentity(path: string): ArtifactPathIdentity {
  const absolute = resolve(path)
  try {
    const canonicalPath = realpathSync(absolute)
    const stat = statSync(canonicalPath)
    return { canonicalPath, device: stat.dev, inode: stat.ino }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw error
    const canonicalParent = realpathSync(dirname(absolute))
    return { canonicalPath: join(canonicalParent, basename(absolute)), device: null, inode: null }
  }
}

/** Reject relative/absolute, symlink, and hardlink aliases before any judge output is opened. */
export function assertDistinctArtifactPaths(paths: Record<string, string>): void {
  const entries = Object.entries(paths).map(([name, path]) => ({ name, ...artifactPathIdentity(path) }))
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const left = entries[leftIndex]!
      const right = entries[rightIndex]!
      const sameCanonicalPath = left.canonicalPath === right.canonicalPath
      const sameExistingFile =
        left.device !== null &&
        right.device !== null &&
        left.device === right.device &&
        left.inode === right.inode
      if (sameCanonicalPath || sameExistingFile) {
        throw new Error(`${left.name} and ${right.name} alias the same artifact file`)
      }
    }
  }
}

export interface CompletedJudgeScore {
  hiddenResolved: boolean
  judgeDetail: string | null
  judgeSkipped: 'empty-patch' | null
}

/** A scorer error rejects the promise, so callers cannot serialize an incomplete judge row. */
export async function completeJudgeScore(
  finalDiff: string,
  judge: () => Promise<{ resolved?: boolean; detail?: unknown }>,
): Promise<CompletedJudgeScore> {
  if (!finalDiff.trim()) {
    return { hiddenResolved: false, judgeDetail: null, judgeSkipped: 'empty-patch' }
  }
  const score = await judge()
  return {
    hiddenResolved: score.resolved ?? false,
    judgeDetail: String(score.detail ?? '').slice(0, 1_000),
    judgeSkipped: null,
  }
}

export function assertJudgeCompletionMatchesInput(
  row: CompletedJudgeScore,
  finalDiff: string,
  context: string,
): void {
  if (!finalDiff.trim()) {
    if (row.hiddenResolved !== false || row.judgeSkipped !== 'empty-patch') {
      throw new Error(`${context}: empty patch has an invalid completed-judge receipt`)
    }
    return
  }
  if (row.judgeSkipped !== null) {
    throw new Error(`${context}: non-empty patch cannot skip official scoring`)
  }
}

export interface JudgeResumeFingerprintReceipt {
  pairFingerprint: string
  phaseFileFingerprint: string
  inputFingerprint: string
  executionFingerprint: string
  finalDiffHash: string
}

export function assertJudgeResumeFingerprints(
  actual: JudgeResumeFingerprintReceipt,
  expected: JudgeResumeFingerprintReceipt,
  context: string,
): void {
  for (const key of Object.keys(expected) as Array<keyof JudgeResumeFingerprintReceipt>) {
    if (actual[key] !== expected[key]) throw new Error(`${context}: judge resume ${key} mismatch`)
  }
}
