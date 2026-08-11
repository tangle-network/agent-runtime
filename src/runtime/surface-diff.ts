/**
 *
 * Settle-time surface-diff harvest — the read-back dual of the mount manifest.
 *
 * `RunProvenance.mounts` records what the caller placed INTO a run's workspace before the agent saw
 * it (instructions, skills, memory files — the profile surfaces the substrate materialized). This
 * module answers the reverse question at settle: **which of those mounted surfaces did the agent
 * itself change while working?** Harnesses mutate their own profile-adjacent surfaces as a matter of
 * course — a memory file appended to, an instructions file edited, a skill rewritten — and that
 * self-mutation is improvement-relevant evidence: an OBSERVED, session-scoped edit that may later be
 * lifted into the measured proposal pipeline (`proposeAgentImprovement`), never auto-promoted.
 *
 * The harvest is harness-agnostic by construction: it compares content hashes against the mount
 * manifest, so it needs no harness event format, no refinement protocol, and no knowledge of WHY a
 * surface changed. A harness that additionally reports structured self-edit events can enrich this
 * signal; nothing requires it to.
 *
 * The kernel never reads workspace contents itself — the caller supplies the read seam (a box
 * `fs.read`, a worktree read, a test double), mirroring how `recordMount` keeps mount hashing with
 * the byte owner. Reads return typed outcomes; a failed read is reported as an `unreadable` diff
 * carrying the error, never silently dropped.
 *
 * @experimental
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import type { MountManifestEntry } from './types'

/** Outcome of reading one surface back at settle. `missing: true` means the path no longer exists
 *  (a deletion — a valid, reportable outcome); any other failure carries its diagnostic. */
export type SurfaceReadOutcome =
  | { succeeded: true; value: Uint8Array }
  | { succeeded: false; missing: boolean; error: string }

/** The read seam: fetch the current bytes at a mounted path. Implemented by a sandbox box's
 *  `fs.read`, a local worktree read ({@link fsSurfaceReader}), or a test double. */
export type SurfaceReader = (path: string) => Promise<SurfaceReadOutcome>

/**
 * One mounted surface whose settled state differs from what was mounted.
 *
 * - `modified` — the surface exists with different bytes (`settledSha256`/`settledBytes` present).
 * - `removed` — the surface no longer exists at its mounted path.
 * - `unreadable` — the read seam failed for a reason other than absence; `error` carries the
 *   diagnostic. Reported rather than dropped so a permissions or transport failure cannot
 *   masquerade as "nothing changed".
 */
export interface SurfaceDiff {
  /** The mounted path, exactly as recorded in the manifest entry. */
  path: string
  status: 'modified' | 'removed' | 'unreadable'
  /** Hex SHA-256 of the bytes that were mounted (from the manifest). */
  mountedSha256: string
  /** Free-form origin of the mounted resource, carried through from the manifest. */
  source: string
  /** Hex SHA-256 of the settled bytes. Present only for `modified`. */
  settledSha256?: string
  /** Size of the settled bytes. Present only for `modified`. */
  settledBytes?: number
  /** The read seam's diagnostic. Present only for `unreadable`. */
  error?: string
}

export interface HarvestSurfaceDiffsOptions {
  /** The run's mount manifest (`RunProvenance.mounts`). Entries sharing a path are collapsed to the
   *  LAST entry — the bytes the agent actually saw at start. */
  mounts: readonly MountManifestEntry[]
  /** How to read a mounted path's current bytes. */
  read: SurfaceReader
}

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/**
 * Re-read every mounted surface and report the ones whose settled state differs from the manifest.
 * Unchanged surfaces produce no entry; output preserves manifest record order. Surfaces the agent
 * CREATED (paths never mounted) are outside this contract — the manifest cannot see them; a
 * substrate that enumerates harness-state directories can feed those paths in as additional mounts.
 */
export async function harvestSurfaceDiffs(
  options: HarvestSurfaceDiffsOptions,
): Promise<SurfaceDiff[]> {
  const byPath = new Map<string, MountManifestEntry>()
  for (const entry of options.mounts) byPath.set(entry.path, entry)
  const diffs: SurfaceDiff[] = []
  for (const entry of byPath.values()) {
    const outcome = await options.read(entry.path)
    if (!outcome.succeeded) {
      diffs.push(
        outcome.missing
          ? {
              path: entry.path,
              status: 'removed',
              mountedSha256: entry.sha256,
              source: entry.source,
            }
          : {
              path: entry.path,
              status: 'unreadable',
              mountedSha256: entry.sha256,
              source: entry.source,
              error: outcome.error,
            },
      )
      continue
    }
    const settledSha256 = sha256Hex(outcome.value)
    if (settledSha256 === entry.sha256.toLowerCase()) continue
    diffs.push({
      path: entry.path,
      status: 'modified',
      mountedSha256: entry.sha256,
      source: entry.source,
      settledSha256,
      settledBytes: outcome.value.byteLength,
    })
  }
  return diffs
}

/**
 * A {@link SurfaceReader} over the local filesystem, for worktree/local workers. Relative mount
 * paths resolve against `root`. Absence maps to `missing: true`; every other failure carries the
 * error message.
 */
export function fsSurfaceReader(root: string): SurfaceReader {
  return async (path) => {
    const target = isAbsolute(path) ? path : resolve(root, path)
    try {
      return { succeeded: true, value: new Uint8Array(await readFile(target)) }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      return {
        succeeded: false,
        missing: code === 'ENOENT' || code === 'ENOTDIR',
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
}
