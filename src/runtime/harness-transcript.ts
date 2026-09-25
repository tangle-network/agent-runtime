/**
 * Read a sandbox child's own harness transcript out of its environment before the
 * environment is destroyed, and persist it beside the tool-span `trace` receipt.
 *
 * Why this exists: Runtime destroys a child's environment at teardown and nothing read
 * those files first, so a child's Claude Code / Codex / OpenCode session never reached a
 * run record. The settled `trace` receipt covers the supervisor's own tool spans only —
 * `toolName`, `args`, `status`, `callId`, with `startedAt === endedAt` — so it carries no
 * assistant text, no reasoning, and no tool results, and `status: 'available'` never meant
 * the transcript survived. See tangle-network/agent-runtime#1214.
 *
 * The port already has what this needs: `AgentEnvironment.read?(path, { signal })`
 * returns a file's content as a string. Two constraints shape the design:
 *
 *   - `read` is OPTIONAL and, on the Tangle provider, gated behind
 *     `capabilities.workspace.read && box.read`. An environment without it is reported as
 *     `unsupported` rather than silently producing an empty artifact — the whole point of
 *     #1214 is that a receipt must not claim coverage it does not have.
 *   - `read` takes one path and gives no directory listing, so enumeration goes through
 *     `exec`. An environment with `read` but no `exec` cannot be enumerated and is also
 *     reported, not guessed at.
 *
 * Storage is NOT the executor's business. The executor holds the in-memory capture and hands it
 * to the scope through `Executor.harnessTranscript()`; the scope persists it under its own
 * content ref with `persistHarnessTranscript` and settles the receipt. No provider or destroy
 * site learns about storage, the result blob never carries the files, and replay rehydrates a
 * pointer — the bytes are read only by `harnessTranscriptArtifact`, when someone opens them.
 *
 * Credentials are excluded by construction: enumeration lists only the transcript globs
 * for the harness, and any path matching DENY is dropped even if a producer moved a
 * credential file inside a session directory. The helper never reads `auth.json`,
 * `.credentials.json`, `credentials`, or a dotenv file.
 */
import { contentAddress } from '../durable/content-address'
import { ValidationError } from '../errors'
import type { ResultBlobStore } from './supervise/types'

/** Where each harness keeps the session files that hold the conversation. */
const HARNESS_ROOTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'claude-code': Object.freeze(['.claude/projects', '.claude/history.jsonl', '.claude/todos']),
  codex: Object.freeze(['.codex/sessions', '.codex/history.jsonl']),
  // Current opencode keeps sessions in SQLite, which a text capture cannot carry. A shared-box
  // worker exports each session as JSON under `export`; a dedicated Tangle box's sidecar keeps
  // its own per-session record under `.opencode/sessions` and `.opencode/messages`.
  opencode: Object.freeze([
    '.local/share/opencode/storage',
    '.local/share/opencode/export',
    '.local/share/opencode/log',
    '.opencode/sessions',
    '.opencode/messages',
  ]),
  // Pi keeps a session tree per cwd; it had no entry, so a pi child captured nothing.
  pi: Object.freeze(['.pi/agent/sessions']),
})

/**
 * Never read, whatever a producer put inside a session tree.
 *
 * Case-insensitive and broader than the obvious names: `.netrc`, `*.key`, `*.p12`/`*.pfx`
 * and an uppercase `ID_RSA` all slipped an earlier lowercase-only pattern.
 */
const DENY =
  /(^|\/)(auth\.json|\.credentials\.json|credentials|\.netrc|\.env(\..*)?|secrets?(\.|$)|.*\.(pem|key|p12|pfx)|id_[a-z0-9_]+)$/iu

/**
 * Bounds per file and in total, PER CHILD. They multiply by fleet width, and the next person
 * sizing a fleet must find that here: a 132-child pursuit (mech-interp-foundations-astra-20260911f,
 * the widest retained on one operator host) at the ceiling is 132 x 16 MiB = 2.1 GiB of transcript
 * for one run (#1248).
 *
 * That figure is a DISK number, not a replay number. The artifact is persisted under its own
 * content ref in the `ResultBlobStore` and the settlement carries only the receipt, so replay and
 * resume rehydrate a ref, never the files; nothing pays for a transcript until someone opens it.
 * The bound is enforced exactly, after each read, so a child settles at or under MAX_TOTAL_BYTES.
 */
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_BYTES = 16 * 1024 * 1024
const MAX_FILES = 1_000

export const HARNESS_TRANSCRIPT_SCHEMA_VERSION = 1 as const

export interface HarnessTranscriptFile {
  readonly path: string
  readonly bytes: number
  readonly content: string
}

export interface HarnessTranscriptArtifact {
  readonly schemaVersion: typeof HARNESS_TRANSCRIPT_SCHEMA_VERSION
  readonly harness: string
  readonly files: readonly HarnessTranscriptFile[]
  /** Paths found but not read, with why — a gap named is a gap an operator can act on. */
  readonly skipped: readonly { readonly path: string; readonly reason: string }[]
}

/** Why no transcript reached a record, from either the capture or the settle path. */
export type HarnessTranscriptUnavailableReason =
  | 'unsupported-environment'
  | 'unknown-harness'
  | 'no-transcript'
  | 'enumeration-failed'
  /** No environment was ever created for this child, so there is no transcript and never
   *  was one. The admission refusal of #1240 is the measured case: a budget pool that
   *  refuses an unknown dollar cost kills the child before it runs. Distinct from
   *  `unsupported-environment`, which means a box existed and could not be read. */
  | 'execution-never-started'
  /** An environment WAS created and the child ran, but the capture never executed — the
   *  deadline/abort path closes the stream with `iterator.return()`, which runs the
   *  generator's `finally` and skips its `catch`. Says only what is known: this child had a
   *  transcript and nobody read it. Never collapse it into `execution-never-started`; that
   *  would report a child that reasoned for twenty seconds as one that never ran. */
  | 'capture-did-not-run'
  /** This executor implements no transcript port at all: a CLI, in-process, bridge, or
   *  sandbox-session executor that has no capture yet. An absence by construction, never a
   *  failure — and never a claim that the harness wrote nothing. */
  | 'executor-exposes-no-transcript'
  /** Session files were found and none was carried: every path was refused, over budget,
   *  unreadable, or skipped by an abort. The `skipped` list beside this reason names each one,
   *  so "there was a transcript and it was not kept" never reads as "no transcript". */
  | 'nothing-carried'
  /** The capture succeeded and the blob write did not. The transcript existed in memory and
   *  never reached disk; mirrors `trace-persistence-failed` on the tool-span receipt. */
  | 'transcript-persistence-failed'

export interface HarnessTranscriptUnavailable {
  readonly status: 'unavailable'
  readonly reason: HarnessTranscriptUnavailableReason
  /** Present with `nothing-carried`: the paths that existed and why each was not read. */
  readonly skipped?: readonly { readonly path: string; readonly reason: string }[]
}

/**
 * What the executor holds in memory between the read and the settle: the files, inline.
 *
 * Never journaled and never inside a result blob. The scope persists it under its own content
 * ref and records the {@link HarnessTranscriptEvidence} receipt instead, so the settlement stays
 * small and a replay pays nothing for a transcript nobody opens.
 */
export type HarnessTranscriptCapture =
  | {
      readonly status: 'captured'
      readonly artifact: HarnessTranscriptArtifact
      readonly fileCount: number
      readonly totalBytes: number
      /** Non-zero when some transcript was found but deliberately not carried. */
      readonly skippedCount: number
    }
  | HarnessTranscriptUnavailable

/**
 * The durable receipt on a settlement: a content-addressed pointer to a persisted
 * {@link HarnessTranscriptArtifact}, or the exact reason there is none. A SIBLING of the tool-span
 * `trace` receipt, never nested inside it — a dropped child has zero tool spans and an
 * unavailable trace, and it is precisely the child whose transcript this exists to keep.
 */
export type HarnessTranscriptEvidence =
  | {
      readonly status: 'available'
      /** Content-addressed pointer to a persisted `HarnessTranscriptArtifact` in the run's blobs. */
      readonly transcriptRef: string
      readonly harness: string
      readonly fileCount: number
      readonly totalBytes: number
      /** Non-zero when some transcript was found but deliberately not carried. */
      readonly skippedCount: number
    }
  | HarnessTranscriptUnavailable

/** The two optional environment reads the capture needs. Public because `captureHarnessTranscript`
 *  is, so a BYO executor can satisfy it with any box that offers a bounded `read` and an `exec`. */
export interface ReadableEnvironment {
  readonly read?: (path: string, options?: { readonly signal?: AbortSignal }) => Promise<string>
  readonly exec?: (
    command: string,
    options?: Record<string, unknown>,
  ) => Promise<{ readonly stdout?: string; readonly exitCode?: number }>
}

function unavailable(reason: HarnessTranscriptUnavailableReason): HarnessTranscriptUnavailable {
  return Object.freeze({ status: 'unavailable', reason })
}

/** The one place an absent transcript is spelled, so every settlement reads the same — the
 *  settle path needs it for the reasons only IT can know (an executor that offers no transcript,
 *  a child that never started), which the capture itself never sees. */
export function harnessTranscriptUnavailable(
  reason: HarnessTranscriptUnavailableReason,
): HarnessTranscriptUnavailable {
  return unavailable(reason)
}

/**
 * Read one executor's harness-transcript receipt without letting a broken port escape.
 *
 * The three answers this has to keep apart, because #1214 and #1244 are both about an artifact
 * that reads as coverage without being coverage:
 *   - `available`                              the transcript survived;
 *   - a reason the CAPTURE produced            a box existed and could not be read;
 *   - `executor-exposes-no-transcript`     this runtime has no transcript to offer at all;
 *   - `execution-never-started`                no environment was ever created (the executor's
 *                                              own seed, set before `create`);
 *   - `capture-did-not-run`                    the port answered nothing, so the capture was
 *                                              skipped rather than attempted and failed.
 *
 * Mirrors the supervise scope's `readInteractiveSession`: an absence is always a named reason,
 * never `undefined`. The scope reads each child with it, and `supervise` reads the root with it.
 */
export function readHarnessTranscript(executor: {
  harnessTranscript?: () => unknown
}): HarnessTranscriptCapture {
  if (!executor.harnessTranscript) {
    return harnessTranscriptUnavailable('executor-exposes-no-transcript')
  }
  let reported: unknown
  try {
    reported = executor.harnessTranscript()
  } catch {
    return harnessTranscriptUnavailable('executor-exposes-no-transcript')
  }
  if (reported === undefined) return harnessTranscriptUnavailable('capture-did-not-run')
  const capture = reported as HarnessTranscriptCapture
  if (capture.status === 'captured' && capture.artifact) return capture
  if (capture.status === 'unavailable' && capture.reason) return capture
  return harnessTranscriptUnavailable('executor-exposes-no-transcript')
}

interface Enumeration {
  /** Paths to read, at most MAX_FILES of them. */
  readonly paths: readonly string[]
  /** What the enumeration itself left out, named — never folded silently into "no transcript". */
  readonly omitted: readonly { readonly path: string; readonly reason: string }[]
}

/**
 * Enumerate candidate transcript paths inside the environment.
 *
 * `find -printf` is given the roots and prints one `size<TAB>path` line per file. A missing root
 * is not an error: a child that never used a harness has no directory for it. GNU find is the
 * target (the Tangle Linux box); BSD and BusyBox `find` have no `-printf`, their error is
 * discarded by `2>/dev/null`, and the empty listing then reads as `no-transcript` — that is a
 * known limit, not a fallback. A path-only line (no size) is still accepted and bounded after
 * the read, which is what a stub or a wrapped `find` produces, not what BSD does.
 *
 * Two omissions used to be silent, so `skippedCount` could read 0 on an incomplete capture: a
 * `-size` filter dropped oversized files before they were ever listed, and `head` cut the listing
 * at MAX_FILES with nothing saying so. Both are reported now: an oversized file is skipped by its
 * listed size WITHOUT being read, and a listing that overflows carries one
 * `enumeration-truncated` entry naming the bound.
 */
async function enumerate(
  environment: ReadableEnvironment,
  roots: readonly string[],
  signal?: AbortSignal,
): Promise<Enumeration | undefined> {
  if (!environment.exec) return undefined
  const quoted = roots.map((r) => `"$HOME/${r}"`).join(' ')
  // One past the bound, so an exact overflow is observable rather than indistinguishable from
  // a listing that happened to be full.
  const command = `find ${quoted} -type f -printf '%s\\t%p\\n' 2>/dev/null | head -${MAX_FILES + 1}`
  try {
    const result = await environment.exec(command, signal ? { signal } : undefined)
    const lines = (result.stdout ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    const omitted: { path: string; reason: string }[] = []
    const paths: string[] = []
    for (const line of lines.slice(0, MAX_FILES)) {
      const tab = line.indexOf('\t')
      const path = tab === -1 ? line : line.slice(tab + 1)
      const size = tab === -1 ? undefined : Number(line.slice(0, tab))
      if (size !== undefined && Number.isFinite(size) && size > MAX_FILE_BYTES) {
        omitted.push({ path, reason: 'file-exceeds-byte-bound' })
        continue
      }
      paths.push(path)
    }
    if (lines.length > MAX_FILES) {
      omitted.push({ path: roots.join(' '), reason: `enumeration-truncated-at-${MAX_FILES}` })
    }
    return { paths, omitted }
  } catch {
    return undefined
  }
}

/**
 * Read the harness transcript out of one LIVE environment.
 *
 * Call this before the environment is destroyed — on the settled path that means before the
 * result is built, since the `finally` that destroys runs after. It never throws: a teardown
 * must not fail because evidence could not be collected, and every failure mode is a named
 * `reason` the settled receipt carries instead of an empty artifact that reads as coverage.
 */
export async function captureHarnessTranscript(
  environment: ReadableEnvironment | undefined,
  harness: string | undefined,
  signal?: AbortSignal,
): Promise<HarnessTranscriptCapture> {
  if (!environment?.read) return unavailable('unsupported-environment')
  // Narrow `harness` before use: the roots lookup alone does not, and an artifact must
  // name the harness it came from.
  if (harness === undefined) return unavailable('unknown-harness')
  const roots = HARNESS_ROOTS[harness]
  if (!roots) return unavailable('unknown-harness')

  const enumerated = await enumerate(environment, roots, signal)
  if (enumerated === undefined) return unavailable('enumeration-failed')
  const { paths } = enumerated
  if (paths.length === 0 && enumerated.omitted.length === 0) return unavailable('no-transcript')

  const files: HarnessTranscriptFile[] = []
  // Seeded with what the enumeration itself left out, so an incomplete listing is never a
  // receipt with skippedCount 0.
  const skipped: { path: string; reason: string }[] = [...enumerated.omitted]
  let total = 0
  for (const path of paths) {
    // Stop on abort rather than attempting every remaining read and failing each: a
    // cancelled run should leave the dying environment alone, not make MAX_FILES doomed
    // calls into it. The remainder is still named in `skipped`.
    if (signal?.aborted) {
      skipped.push({ path, reason: 'aborted' })
      continue
    }
    if (DENY.test(path)) {
      skipped.push({ path, reason: 'denied-credential-shaped-path' })
      continue
    }
    if (total >= MAX_TOTAL_BYTES) {
      skipped.push({ path, reason: 'total-byte-budget-exhausted' })
      continue
    }
    try {
      const content = await environment.read(path, signal ? { signal } : undefined)
      const bytes = Buffer.byteLength(content, 'utf8')
      if (bytes > MAX_FILE_BYTES) {
        skipped.push({ path, reason: 'file-exceeds-byte-bound' })
        continue
      }
      // Checked AFTER the read so the ceiling is exact. A pre-read check let one child land at
      // MAX_TOTAL_BYTES plus one more file, about 18 MB against a stated 16 (#1248).
      if (total + bytes > MAX_TOTAL_BYTES) {
        skipped.push({ path, reason: 'total-byte-budget-exhausted' })
        continue
      }
      files.push(Object.freeze({ path, bytes, content }))
      total += bytes
    } catch {
      skipped.push({ path, reason: 'read-failed' })
    }
  }
  // Nothing read is two different facts: no session files at all (reported above), or files that
  // every rule declined — including an abort that skipped them all. The second must name them.
  if (files.length === 0) {
    return Object.freeze({
      status: 'unavailable',
      reason: 'nothing-carried',
      skipped: Object.freeze(skipped),
    })
  }

  const artifact: HarnessTranscriptArtifact = Object.freeze({
    schemaVersion: HARNESS_TRANSCRIPT_SCHEMA_VERSION,
    harness,
    files: Object.freeze(files),
    skipped: Object.freeze(skipped),
  })
  return Object.freeze({
    status: 'captured',
    artifact,
    fileCount: files.length,
    totalBytes: total,
    skippedCount: skipped.length,
  })
}

/**
 * Persist a capture under its own content ref and return the receipt a settlement carries.
 *
 * The scope calls this, not the executor: storage stays out of every provider and destroy site,
 * exactly as the tool-span trace is persisted by `captureWorkerTraceEvidence` and not by the
 * source that collected it. A capture that is already unavailable passes through untouched.
 */
export async function persistHarnessTranscript(
  capture: HarnessTranscriptCapture,
  blobs: Pick<ResultBlobStore, 'put'>,
): Promise<HarnessTranscriptEvidence> {
  if (capture.status !== 'captured') return capture
  const transcriptRef = contentAddress(capture.artifact)
  try {
    await blobs.put(transcriptRef, capture.artifact)
  } catch {
    return unavailable('transcript-persistence-failed')
  }
  return Object.freeze({
    status: 'available',
    transcriptRef,
    harness: capture.artifact.harness,
    fileCount: capture.fileCount,
    totalBytes: capture.totalBytes,
    skippedCount: capture.skippedCount,
  })
}

/**
 * Rehydrate the exact persisted transcript a receipt points at, or `undefined` when the receipt
 * says there is none. Throws only when the receipt claims a blob the store does not hold — that
 * is corruption, not absence, and must not read as "no transcript".
 */
export async function harnessTranscriptArtifact(
  evidence: HarnessTranscriptEvidence,
  blobs: Pick<ResultBlobStore, 'get'>,
): Promise<HarnessTranscriptArtifact | undefined> {
  if (evidence.status !== 'available') return undefined
  const raw = await blobs.get(evidence.transcriptRef)
  if (!isHarnessTranscriptArtifact(raw)) {
    throw new ValidationError(
      `harnessTranscriptArtifact: blob store has no transcript artifact for '${evidence.transcriptRef}'`,
    )
  }
  return raw
}

/** Every entry, not just the arrays: a blob with `files: [null]` is corruption, not a transcript. */
function isHarnessTranscriptArtifact(value: unknown): value is HarnessTranscriptArtifact {
  if (value === null || typeof value !== 'object') return false
  const artifact = value as Partial<HarnessTranscriptArtifact>
  return (
    artifact.schemaVersion === HARNESS_TRANSCRIPT_SCHEMA_VERSION &&
    typeof artifact.harness === 'string' &&
    Array.isArray(artifact.files) &&
    artifact.files.every(
      (file) =>
        file !== null &&
        typeof file === 'object' &&
        typeof file.path === 'string' &&
        typeof file.content === 'string' &&
        Number.isSafeInteger(file.bytes) &&
        file.bytes >= 0,
    ) &&
    Array.isArray(artifact.skipped) &&
    artifact.skipped.every(
      (entry) =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof entry.path === 'string' &&
        typeof entry.reason === 'string',
    )
  )
}
