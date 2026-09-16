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
 * Storage is NOT this module's business. The executor returns the artifact inside the result
 * it already settles with, and supervise puts that under the child's `outRef` in its own
 * `ResultBlobStore`. No destroy site learns about storage, and replay rehydrates it for free.
 *
 * Credentials are excluded by construction: enumeration lists only the transcript globs
 * for the harness, and any path matching DENY is dropped even if a producer moved a
 * credential file inside a session directory. The helper never reads `auth.json`,
 * `.credentials.json`, `credentials`, or a dotenv file.
 */
/** Where each harness keeps the session files that hold the conversation. */
const HARNESS_ROOTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'claude-code': Object.freeze(['.claude/projects', '.claude/history.jsonl', '.claude/todos']),
  codex: Object.freeze(['.codex/sessions', '.codex/history.jsonl']),
  opencode: Object.freeze(['.local/share/opencode/storage', '.local/share/opencode/log']),
})

/** Never read, whatever a producer put inside a session tree. */
const DENY =
  /(^|\/)(auth\.json|\.credentials\.json|credentials|\.env(\..*)?|secrets?(\.|$)|.*\.pem|id_[a-z]+)$/u

/**
 * Bounds per file and in total. These are deliberately modest: the artifact rides inside the
 * settled result that supervise blobs under one `outRef`, so an unbounded transcript would
 * bloat every replay of that child, not just the capture.
 */
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_BYTES = 16 * 1024 * 1024
const MAX_FILES = 1_000

export const NATIVE_SESSION_SCHEMA_VERSION = 1 as const

export interface NativeSessionFile {
  readonly path: string
  readonly bytes: number
  readonly content: string
}

export interface NativeSessionArtifact {
  readonly schemaVersion: typeof NATIVE_SESSION_SCHEMA_VERSION
  readonly harness: string
  readonly files: readonly NativeSessionFile[]
  /** Paths found but not read, with why — a gap named is a gap an operator can act on. */
  readonly skipped: readonly { readonly path: string; readonly reason: string }[]
}

export type NativeSessionEvidence =
  | {
      readonly status: 'available'
      readonly artifact: NativeSessionArtifact
      readonly fileCount: number
      readonly totalBytes: number
      /** Non-zero when some transcript was found but deliberately not carried. */
      readonly skippedCount: number
    }
  | {
      readonly status: 'unavailable'
      readonly reason:
        | 'unsupported-environment'
        | 'unknown-harness'
        | 'no-transcript'
        | 'enumeration-failed'
    }

interface ReadableEnvironment {
  readonly read?: (path: string, options?: { readonly signal?: AbortSignal }) => Promise<string>
  readonly exec?: (
    command: string,
    options?: Record<string, unknown>,
  ) => Promise<{ readonly stdout?: string; readonly exitCode?: number }>
}

type NativeSessionUnavailableReason = Extract<
  NativeSessionEvidence,
  { status: 'unavailable' }
>['reason']

function unavailable(reason: NativeSessionUnavailableReason): NativeSessionEvidence {
  return Object.freeze({ status: 'unavailable', reason })
}

/**
 * Enumerate candidate transcript paths inside the environment.
 *
 * `find` is given the roots and prints one path per line. A missing root is not an error:
 * a child that never used a harness has no directory for it.
 */
async function enumerate(
  environment: ReadableEnvironment,
  roots: readonly string[],
  signal?: AbortSignal,
): Promise<readonly string[] | undefined> {
  if (!environment.exec) return undefined
  const quoted = roots.map((r) => `"$HOME/${r}"`).join(' ')
  const command = `find ${quoted} -type f -size -${Math.floor(MAX_FILE_BYTES / 1024)}k 2>/dev/null | head -${MAX_FILES}`
  try {
    const result = await environment.exec(command, signal ? { signal } : undefined)
    return (result.stdout ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
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
export async function captureNativeSessionEvidence(
  environment: ReadableEnvironment | undefined,
  harness: string | undefined,
  signal?: AbortSignal,
): Promise<NativeSessionEvidence> {
  if (!environment?.read) return unavailable('unsupported-environment')
  // Narrow `harness` before use: the roots lookup alone does not, and an artifact must
  // name the harness it came from.
  if (harness === undefined) return unavailable('unknown-harness')
  const roots = HARNESS_ROOTS[harness]
  if (!roots) return unavailable('unknown-harness')

  const paths = await enumerate(environment, roots, signal)
  if (paths === undefined) return unavailable('enumeration-failed')
  if (paths.length === 0) return unavailable('no-transcript')

  const files: NativeSessionFile[] = []
  const skipped: { path: string; reason: string }[] = []
  let total = 0
  for (const path of paths) {
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
      files.push(Object.freeze({ path, bytes, content }))
      total += bytes
    } catch {
      skipped.push({ path, reason: 'read-failed' })
    }
  }
  if (files.length === 0) return unavailable('no-transcript')

  const artifact: NativeSessionArtifact = Object.freeze({
    schemaVersion: NATIVE_SESSION_SCHEMA_VERSION,
    harness,
    files: Object.freeze(files),
    skipped: Object.freeze(skipped),
  })
  return Object.freeze({
    status: 'available',
    artifact,
    fileCount: files.length,
    totalBytes: total,
    skippedCount: skipped.length,
  })
}
