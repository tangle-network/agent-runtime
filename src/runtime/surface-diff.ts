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
 * One watched surface whose settled state differs from what was mounted (or from absence).
 *
 * - `modified` — the surface exists with different bytes (`settledSha256`/`settledBytes` present).
 * - `removed` — the surface no longer exists at its mounted path.
 * - `created` — a watched path that was never mounted now exists (`settledSha256`/`settledBytes`
 *   present, no `mountedSha256`) — the shape a harness's new memory/skill file takes.
 * - `unreadable` — the read seam failed for a reason other than absence; `error` carries the
 *   diagnostic. Reported rather than dropped so a permissions or transport failure cannot
 *   masquerade as "nothing changed".
 */
export interface SurfaceDiff {
  /** The mounted/watched path, exactly as recorded. */
  path: string
  status: 'modified' | 'removed' | 'created' | 'unreadable'
  /** Hex SHA-256 of the bytes that were mounted (from the manifest). Absent for `created`. */
  mountedSha256?: string
  /** Free-form origin: the manifest entry's `source`, or the watch entry's `source`. */
  source: string
  /** Hex SHA-256 of the settled bytes. Present for `modified` and `created`. */
  settledSha256?: string
  /** Size of the settled bytes. Present for `modified` and `created`. */
  settledBytes?: number
  /** The read seam's diagnostic. Present only for `unreadable`. */
  error?: string
}

/** A path to check at settle that was NOT necessarily mounted — where a harness is known to write
 *  self-authored surfaces (a memory dir's files, a refinement log). A watched path that was also
 *  mounted compares against its mount; one that wasn't reports `created` if it now exists. */
export interface WatchedSurface {
  path: string
  /** Origin label carried onto the diff (default `'watched'`). */
  source?: string
}

export interface HarvestSurfaceDiffsOptions {
  /** The run's mount manifest (`RunProvenance.mounts`). Entries sharing a path are collapsed to the
   *  LAST entry — the bytes the agent actually saw at start. */
  mounts: readonly MountManifestEntry[]
  /** How to read a mounted path's current bytes. */
  read: SurfaceReader
  /** Additional paths to check that may not have been mounted (see {@link WatchedSurface}). The
   *  caller enumerates them (it knows the harness's state layout — e.g. via the box's file tree);
   *  the harvest stays layout-agnostic. */
  watch?: readonly WatchedSurface[]
}

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/**
 * Re-read every mounted (and watched) surface and report the ones whose settled state differs from
 * the manifest — modified, removed, or created. Unchanged surfaces and still-absent watched paths
 * produce no entry; output preserves record order, mounts before watch-only paths.
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
  for (const watched of options.watch ?? []) {
    if (byPath.has(watched.path)) continue
    const outcome = await options.read(watched.path)
    if (!outcome.succeeded) {
      // A still-absent watched path is the expected no-op; a failing read is not.
      if (!outcome.missing)
        diffs.push({
          path: watched.path,
          status: 'unreadable',
          source: watched.source ?? 'watched',
          error: outcome.error,
        })
      continue
    }
    diffs.push({
      path: watched.path,
      status: 'created',
      source: watched.source ?? 'watched',
      settledSha256: sha256Hex(outcome.value),
      settledBytes: outcome.value.byteLength,
    })
  }
  return diffs
}

/** The minimal box surface the box-backed reader needs — structurally typed so the real
 *  `@tangle-network/sandbox` box and a test double both satisfy it, no SDK import. */
export interface SurfaceReadBox {
  fs: { read(path: string): Promise<string> }
}

/**
 * A {@link SurfaceReader} over a sandbox box's filesystem — the same `box.fs.read` seam
 * `openSandboxRun` reads deliverables through. The box wire returns UTF-8 text, so this reader
 * covers TEXT surfaces (which profile surfaces are); hashes are computed over the UTF-8 encoding.
 * The SDK's not-found error is detected structurally (`err.name === 'NotFoundError'`) and maps to
 * `missing: true`; every other failure carries its message.
 */
export function boxSurfaceReader(box: SurfaceReadBox): SurfaceReader {
  return async (path) => {
    try {
      return { succeeded: true, value: new TextEncoder().encode(await box.fs.read(path)) }
    } catch (err) {
      return {
        succeeded: false,
        missing: err instanceof Error && err.name === 'NotFoundError',
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
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
