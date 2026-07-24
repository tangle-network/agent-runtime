/**
 * Gen-5 public/private score split (SOTA adoption #1, AIDE2-style).
 *
 * Per generation the improvement instances are DETERMINISTICALLY split
 * (seeded by runId) into a PUBLIC set — whose scores/evidence proposers and
 * the pre-filter may see — and a PRIVATE set that is scored identically but
 * NEVER surfaced to proposers. Winner selection stays on the COMBINED
 * public+private score (the lib judge already averages every scenario), so
 * the split changes only what feedback the search sees, exactly the
 * anti-overfitting mechanism: a candidate that games the visible instances
 * still has to survive the instances it never saw named.
 *
 * SMALL-N CAVEAT: with only 6 improvement instances the split is 4 public /
 * 2 private. Two private instances give a coarse overfit signal (0, 1/2 or
 * 2/2) and a single flake flips it — treat the private sub-score as a
 * direction check, not a certification; the pre-registered 6-instance holdout
 * remains the only promotion evidence.
 *
 * RESUME STABILITY: runId embeds a launch timestamp, so a resumed run gets a
 * fresh runId. The split is therefore PERSISTED to <outDir>/score-split.json
 * on first computation and reloaded verbatim afterwards — a resume can never
 * rotate previously-private instances into view.
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const SCORE_SPLIT_SCHEMA = 'swe-arena.score-split.v1'
export const SCORE_SPLIT_FILENAME = 'score-split.json'

export interface ScoreSplitConfig {
  /** Number of PUBLIC instances (the rest are private). Must satisfy
   *  0 < publicCount < instances.length. */
  publicCount: number
}

export interface ScoreSplit {
  schema: typeof SCORE_SPLIT_SCHEMA
  /** The runId that seeded the split (provenance; a resumed run keeps it). */
  seededBy: string
  publicInstances: string[]
  privateInstances: string[]
}

/** Deterministic split: instances are ranked by sha256(runId + ':' + iid) and
 *  the first `publicCount` become public. Pure — same (runId, instances,
 *  publicCount) always yields the same split; instance-list ORDER does not
 *  matter (ranking is content-derived). */
export function splitInstances(runId: string, instances: readonly string[], publicCount: number): ScoreSplit {
  if (!Number.isInteger(publicCount) || publicCount <= 0 || publicCount >= instances.length) {
    throw new Error(
      `score-split: publicCount must be an integer in (0, ${instances.length}), got ${JSON.stringify(publicCount)}`,
    )
  }
  if (new Set(instances).size !== instances.length) {
    throw new Error('score-split: duplicate instance ids')
  }
  const ranked = [...instances]
    .map((iid) => ({ iid, rank: createHash('sha256').update(`${runId}:${iid}`).digest('hex') }))
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
  const pub = ranked.slice(0, publicCount).map((r) => r.iid)
  const priv = ranked.slice(publicCount).map((r) => r.iid)
  return {
    schema: SCORE_SPLIT_SCHEMA,
    seededBy: runId,
    publicInstances: [...pub].sort(),
    privateInstances: [...priv].sort(),
  }
}

/** Load the persisted split for this outDir, or compute + persist it. The
 *  persisted file always wins (resume stability); it is validated against the
 *  current instance set so a config edit mid-outDir fails loud. */
export async function loadOrCreateScoreSplit(args: {
  outDir: string
  runId: string
  instances: readonly string[]
  publicCount: number
}): Promise<ScoreSplit> {
  const path = join(args.outDir, SCORE_SPLIT_FILENAME)
  if (existsSync(path)) {
    const split = JSON.parse(await readFile(path, 'utf8')) as ScoreSplit
    if (split.schema !== SCORE_SPLIT_SCHEMA) {
      throw new Error(`score-split: ${path} has unknown schema ${JSON.stringify(split.schema)}`)
    }
    const persisted = [...split.publicInstances, ...split.privateInstances].sort()
    const expected = [...args.instances].sort()
    if (JSON.stringify(persisted) !== JSON.stringify(expected)) {
      throw new Error(
        `score-split: persisted split at ${path} covers [${persisted.join(', ')}] but the config ` +
          `names [${expected.join(', ')}] — refusing to silently re-split; move the outDir or fix the config`,
      )
    }
    if (split.publicInstances.length !== args.publicCount) {
      throw new Error(
        `score-split: persisted split has ${split.publicInstances.length} public instances, config wants ` +
          `${args.publicCount} — refusing to silently re-split`,
      )
    }
    return split
  }
  const split = splitInstances(args.runId, args.instances, args.publicCount)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(split, null, 2))
  return split
}

/** True when `text` mentions any private instance id — the NEVER-SURFACED
 *  invariant's checkable form. Used by tests and by the evidence-index writer
 *  as a final guard on proposer-visible text. */
export function leaksPrivateInstance(text: string, split: Pick<ScoreSplit, 'privateInstances'>): string[] {
  return split.privateInstances.filter((iid) => text.includes(iid))
}

/** Filter per-instance evidence records to the PUBLIC set. Identity function
 *  when no split is configured (split === null). */
export function publicOnly<T>(
  records: readonly T[],
  iidOf: (record: T) => string,
  split: Pick<ScoreSplit, 'privateInstances'> | null,
): T[] {
  if (split === null) return [...records]
  const priv = new Set(split.privateInstances)
  return records.filter((r) => !priv.has(iidOf(r)))
}

/** Public/private sub-scores for one candidate, from per-instance AND-verdicts
 *  (fail-closed: an instance with no conclusive full-reps verdict counts 0). */
export function subScores(
  verdicts: Record<string, boolean>,
  split: Pick<ScoreSplit, 'publicInstances' | 'privateInstances'>,
): { publicResolvedCount: number; privateResolvedCount: number } {
  const count = (iids: readonly string[]): number => iids.filter((iid) => verdicts[iid] === true).length
  return {
    publicResolvedCount: count(split.publicInstances),
    privateResolvedCount: count(split.privateInstances),
  }
}
