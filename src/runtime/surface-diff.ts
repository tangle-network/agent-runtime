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
import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'
import { readBoxPathWithRetry } from './box-read-retry'
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
 *  mounted compares against its mount; one that wasn't reports `created` if it now exists.
 *  `created` is an inference from the mount manifest, not a proof of authorship: a file the box
 *  IMAGE shipped at a never-mounted path also reports `created`. Watch paths known absent at run
 *  start (or enumerate the tree at start AND settle and watch the difference) to make the label
 *  mean what it says. */
export interface WatchedSurface {
  path: string
  /** Origin label carried onto the diff (default `'watched'`). */
  source?: string
}

/** Inputs to {@link harvestSurfaceDiffs}: the run's mount manifest, the read seam, and optional
 *  watch paths for surfaces the agent may have created. */
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

/** Contain a reader that violates its typed-outcome contract by THROWING: the module's law is that
 *  a failed read becomes an `unreadable` diff, so one bad path must not reject the whole harvest
 *  and silently drop every other diff. */
const readOutcome = async (read: SurfaceReader, path: string): Promise<SurfaceReadOutcome> => {
  try {
    return await read(path)
  } catch (err) {
    return {
      succeeded: false,
      missing: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** The collision/dedup key for a path: a leading `./` stripped, so `./AGENTS.md` (a mount
 *  recorder's form) and `AGENTS.md` (a file-tree enumeration's form) are one surface. Absolute vs
 *  relative cannot be reconciled here — keep those forms consistent between mounts and watches. */
const pathKey = (p: string): string => p.replace(/^\.\//, '')

/**
 * Re-read every mounted (and watched) surface and report the ones whose settled state differs from
 * the manifest — modified, removed, or created. Unchanged surfaces and still-absent watched paths
 * produce no entry; reads run concurrently; output preserves record order, mounts before
 * watch-only paths. Mounts and watches sharing a path key are each collapsed to the LAST entry,
 * and a watched path that was also mounted compares against its mount (never reports `created`).
 *
 * The harvest takes no `AbortSignal`: it is pure fan-out over the read seam and waits on nothing
 * itself, so every cancellable moment belongs to the reader. Pass a signal to the reader instead
 * ({@link BoxSurfaceReaderOptions.signal}, or close over one in a custom {@link SurfaceReader}) —
 * that cuts the backoff waits, and the harvest still returns the diffs it did establish rather
 * than discarding settle-time evidence on a late cancellation.
 */
export async function harvestSurfaceDiffs(
  options: HarvestSurfaceDiffsOptions,
): Promise<SurfaceDiff[]> {
  const byPath = new Map<string, MountManifestEntry>()
  for (const entry of options.mounts) byPath.set(pathKey(entry.path), entry)
  const watchByPath = new Map<string, WatchedSurface>()
  for (const watched of options.watch ?? []) {
    if (byPath.has(pathKey(watched.path))) continue
    watchByPath.set(pathKey(watched.path), watched)
  }
  const mountDiffs = await Promise.all(
    [...byPath.values()].map(async (entry): Promise<SurfaceDiff | undefined> => {
      const outcome = await readOutcome(options.read, entry.path)
      if (!outcome.succeeded) {
        return outcome.missing
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
            }
      }
      const settledSha256 = sha256Hex(outcome.value)
      if (settledSha256 === entry.sha256.toLowerCase()) return undefined
      return {
        path: entry.path,
        status: 'modified',
        mountedSha256: entry.sha256,
        source: entry.source,
        settledSha256,
        settledBytes: outcome.value.byteLength,
      }
    }),
  )
  const watchDiffs = await Promise.all(
    [...watchByPath.values()].map(async (watched): Promise<SurfaceDiff | undefined> => {
      const outcome = await readOutcome(options.read, watched.path)
      if (!outcome.succeeded) {
        // A still-absent watched path is the expected no-op; a failing read is not.
        if (outcome.missing) return undefined
        return {
          path: watched.path,
          status: 'unreadable',
          source: watched.source ?? 'watched',
          error: outcome.error,
        }
      }
      return {
        path: watched.path,
        status: 'created',
        source: watched.source ?? 'watched',
        settledSha256: sha256Hex(outcome.value),
        settledBytes: outcome.value.byteLength,
      }
    }),
  )
  return [...mountDiffs, ...watchDiffs].filter((d): d is SurfaceDiff => d !== undefined)
}

/** The minimal box surface the box-backed reader needs — structurally typed so the real
 *  `@tangle-network/sandbox` box and a test double both satisfy it, no SDK import. */
export interface SurfaceReadBox {
  fs: { read(path: string): Promise<string> }
}

/** Retry and cancellation controls for {@link boxSurfaceReader}. */
export interface BoxSurfaceReaderOptions {
  /** Read attempts per path before settling on a failed outcome. The data plane can transiently
   *  404 a just-written file (the same blip `openSandboxRun`'s deliverable read retries for), and a
   *  first-attempt 404 taken at face value turns a fresh self-edit into a false `removed`/dropped
   *  `created`. Default 3. */
  attempts?: number
  /** Linear backoff base between attempts (delay = base × attempt). Default 250. */
  retryDelayMs?: number
  /** Cuts the retry waits short when the run is abandoned. The reader still returns a typed
   *  outcome — the harvest reports what it managed to read rather than rejecting. */
  signal?: AbortSignal
}

/**
 * A {@link SurfaceReader} over a sandbox box's filesystem — the same `box.fs.read` seam
 * `openSandboxRun` reads deliverables through, with the same transient-404 posture (bounded
 * retry). The box wire returns UTF-8 TEXT (the SDK's binary path is `download()`), which profile
 * surfaces are; hashes are computed over the UTF-8 encoding, and content the wire had to
 * lossy-decode (a U+FFFD replacement character) is reported `unreadable` rather than hashed as
 * mojibake. The SDK's not-found error is detected structurally (`err.name === 'NotFoundError'`)
 * and maps to `missing: true` — unless its `resourceType` names something other than a file/path
 * (the BOX or session being gone), which is a transport failure, not an absent surface.
 */
export function boxSurfaceReader(
  box: SurfaceReadBox,
  options: BoxSurfaceReaderOptions = {},
): SurfaceReader {
  return async (path) => {
    const result = await readBoxPathWithRetry(box.fs.read.bind(box.fs), path, {
      attempts: options.attempts ?? 3,
      delayMs: options.retryDelayMs ?? 250,
      signal: options.signal,
    })
    if (result.succeeded) {
      // A lossy decode is deterministic — retrying cannot recover the bytes, so this is a final
      // outcome rather than another attempt.
      if (result.text.includes('�')) {
        return {
          succeeded: false,
          missing: false,
          error: `boxSurfaceReader: content at ${JSON.stringify(path)} is not valid UTF-8 text (the box text wire lossy-decoded it); binary surfaces need a byte-faithful reader`,
        }
      }
      return { succeeded: true, value: new TextEncoder().encode(result.text) }
    }
    const err = result.error
    const notFound = err instanceof Error && err.name === 'NotFoundError'
    const resourceType =
      err && typeof err === 'object' && 'resourceType' in err
        ? String((err as { resourceType: unknown }).resourceType)
        : undefined
    // A NotFoundError naming the BOX or the session means the TRANSPORT is gone — calling that
    // `missing` would read as "the agent deleted every surface". Anything else is the file: the
    // SDK's HTTP mapper defaults `resourceType` to `'Resource'` when the server does not name one,
    // so matching only file-ish names would classify an ordinary deletion as `unreadable` and the
    // harvest would never report `removed`.
    const transportGone = resourceType !== undefined && /sandbox|session/i.test(resourceType)
    return {
      succeeded: false,
      missing: notFound && !transportGone,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * A {@link SurfaceReader} over the local filesystem, for worktree/local workers. Every path —
 * relative or absolute — must resolve INSIDE `root`: a path that escapes it (`../`, an absolute
 * path elsewhere) fails as a contained non-missing outcome rather than reading outside the
 * worktree, so a persisted or mistyped manifest path cannot turn the harvest into an
 * existence/hash oracle over the host filesystem. Containment is checked twice — once on the
 * lexical path, then again on the symlink-resolved path, because `readFile` follows a link and a
 * link planted inside the root would otherwise read host bytes through a contained-looking name.
 * Absence maps to `missing: true`; every other failure carries the error message.
 */
export function fsSurfaceReader(root: string): SurfaceReader {
  const lexicalRoot = resolve(root)
  let resolvedRoot: string | undefined
  const escapes = (candidate: string, boundary: string): boolean =>
    candidate !== boundary && !candidate.startsWith(boundary + sep)
  const outside = (path: string, boundary: string): SurfaceReadOutcome => ({
    succeeded: false,
    missing: false,
    error: `fsSurfaceReader: path ${JSON.stringify(path)} resolves outside the reader root ${JSON.stringify(boundary)}`,
  })
  return async (path) => {
    const target = isAbsolute(path) ? resolve(path) : resolve(lexicalRoot, path)
    if (escapes(target, lexicalRoot)) return outside(path, lexicalRoot)
    try {
      // The root itself may be reached through a link (a worktree, a temp dir); compare
      // link-resolved against link-resolved so a legitimate mount is not read as an escape.
      resolvedRoot ??= await realpath(lexicalRoot)
    } catch (err) {
      // The WORKSPACE is gone, not the surface. Calling this `missing` would report every mount as
      // a deliberate agent deletion — the filesystem twin of a dead box answering for each path.
      return {
        succeeded: false,
        missing: false,
        error: `fsSurfaceReader: reader root ${JSON.stringify(lexicalRoot)} is unreadable (${err instanceof Error ? err.message : String(err)})`,
      }
    }
    try {
      const resolvedTarget = await realpath(target)
      if (escapes(resolvedTarget, resolvedRoot)) return outside(path, resolvedRoot)
      return { succeeded: true, value: new Uint8Array(await readFile(resolvedTarget)) }
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
