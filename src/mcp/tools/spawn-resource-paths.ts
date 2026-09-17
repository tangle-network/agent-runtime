import { createHash } from 'node:crypto'
import { type FileHandle, open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { parseSpawnBlobRef, type SpawnBlobStore, spawnBlobRef } from './spawn-blob-store'

/**
 * Inline resources a manager hands a child by PATH or by staged BLOB instead of by content.
 *
 * The canonical profile schema knows two resource kinds, `inline` (a content string) and `github`.
 * A manager that wants a child to receive a data file therefore had one way to do it: emit the
 * bytes inside its own `spawn` tool call. That is a transcription by a language model, and it does
 * not survive size. Measured 2026-09-12 (discovery-lab `mech-interp-foundations-glm2-b-20260912b`):
 * a 29,144-character base64 payload on the manager's disk reached three children as 15,928
 * characters with 11 substitutions, and a fourth child received the literal placeholder the
 * manager meant to replace. Seven blind-check attempts across two runs delivered no data.
 *
 * Measured again 2026-09-17, on a Discovery director inside a Tangle sandbox (opencode harness,
 * glm-5.3), across four runs and roughly fifteen lost children: a brief pinned SEVEN files and the
 * spawn carried TWO, and of six mounted files the one whose docstring held a column-aligned table
 * arrived two bytes short — 6,983 bytes authored, 6,981 delivered. Splitting that file into parts
 * drifted both parts. Code indentation never drifted; aligned prose did. Children caught it at
 * their own sha256 gate and stopped, which is correct and still wasted the child.
 *
 * Two transports answer it, and the substituted profile is an ordinary inline resource either way,
 * so nothing downstream changes and the model's output stops carrying the bytes:
 *
 *  - `{ kind: 'inline', name, path }` — the coordination server READS the file under the manager's
 *    workspace root. Available only to a manager whose workspace this process can read.
 *  - `{ kind: 'inline', name, blob: 'sha256:<hex>' }` — the manager PUSHED the bytes to the
 *    coordination server itself (`put_blob`, driven from its shell). This is the one that works
 *    from a sandbox, where the server can read no directory of the manager's at all. See
 *    `spawn-blob-store.ts`.
 *
 * Fail-closed rules, each with the reason a manager needs to fix its call:
 *  - a ref naming BOTH path and blob → refused; one transport per reference
 *  - path: no root configured → refused (a nested manager in a remote sandbox has no host
 *    directory the server may read for it; it should stage a blob instead)
 *  - path: absolute, `..` escape, or a symlink that resolves outside the root → refused; the
 *    workspace root is the only directory a manager may hand out
 *  - path: not a regular file → refused
 *  - path: over {@link SPAWN_RESOURCE_PATH_MAX_BYTES} → refused naming the bound
 *  - blob: not the canonical `sha256:<64 lowercase hex>` spelling → refused
 *  - blob: no store wired, or a digest this manager does not hold → refused, naming which
 *  - blob: bytes that do not hash to the key they were held under → refused (a second, independent
 *    verification after the one at staging time)
 *  - either: over the caller's `maxContentBytes` → refused naming the bound and the upstream issue
 *  - either: bytes that are not valid UTF-8 → refused; `content` is a string, so binary data is
 *    encoded (base64) by the manager first, exactly as it would be for a content resource
 */
export const SPAWN_RESOURCE_PATH_MAX_BYTES = 4 * 1024 * 1024

export interface ResolvedSpawnResourcePath {
  /** The `resources` location, e.g. `files[0].resource` or `skills[2]`. */
  readonly at: string
  /** The path as the manager wrote it. */
  readonly path: string
  readonly byteLength: number
  readonly sha256: string
}

/** One receipt per staged blob a spawn mounted: the manager diffs this against its own staging
 *  list, so a reference it forgot to write is visible in the spawn's own result. */
export interface ResolvedSpawnResourceBlob {
  /** The `resources` location, e.g. `files[0].resource`. */
  readonly at: string
  /** The `sha256:<hex>` reference as the manager wrote it. */
  readonly blob: string
  readonly name: string
  readonly byteLength: number
  readonly sha256: string
}

/** Where the resolver may take bytes from, and the ceiling the caller's provider imposes on one
 *  profile string. Both arms are optional: a manager with neither can still spawn, and a reference
 *  naming a transport this manager was not given is refused with the reason. */
export interface SpawnResourceSource {
  /** Directory the server may read a `path` resource under. */
  readonly root?: string
  /** Blobs this manager staged with `put_blob`. */
  readonly blobs?: SpawnBlobStore
  /**
   * Refuse a resolved resource larger than this. Runtime cannot know a provider's payload limits,
   * so the default is no bound. `agent-provider-tangle` refuses any single create string over
   * 16,384 characters — tangle-network/agent-sdk#340.
   */
  readonly maxContentBytes?: number
}

export type ResolveSpawnResourcesResult =
  | {
      readonly ok: true
      readonly profile: unknown
      readonly resolved: readonly ResolvedSpawnResourcePath[]
      readonly resolvedBlobs: readonly ResolvedSpawnResourceBlob[]
    }
  | { readonly ok: false; readonly at: string; readonly reason: string }

interface PathInlineRef {
  readonly kind: 'inline'
  readonly name: string
  readonly path: string
}

interface BlobInlineRef {
  readonly kind: 'inline'
  readonly name: string
  readonly blob: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** An inline ref that names a path and carries no content. Anything else is left untouched so the
 *  canonical schema keeps its verdict on it. */
function pathInlineRef(value: unknown): PathInlineRef | undefined {
  if (!isRecord(value)) return undefined
  if (value.kind !== 'inline' || value.content !== undefined) return undefined
  if (typeof value.path !== 'string' || typeof value.name !== 'string') return undefined
  return { kind: 'inline', name: value.name, path: value.path }
}

/** An inline ref that names a staged blob and carries no content. */
function blobInlineRef(value: unknown): BlobInlineRef | undefined {
  if (!isRecord(value)) return undefined
  if (value.kind !== 'inline' || value.content !== undefined) return undefined
  if (typeof value.blob !== 'string' || typeof value.name !== 'string') return undefined
  return { kind: 'inline', name: value.name, blob: value.blob }
}

/** A ref naming both transports. Checked before either arm: `pathInlineRef` ignores extra keys, so
 *  without this the path arm would silently win and the manager's staged bytes would be ignored.
 *  A ref that also carries `content` is left alone — the canonical schema refuses it as an
 *  unrecognized key, which is the accurate verdict on a resource that named three transports. */
function namesBothTransports(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.kind === 'inline' &&
    value.content === undefined &&
    typeof value.path === 'string' &&
    typeof value.blob === 'string'
  )
}

async function readUnderRoot(
  root: string,
  requested: string,
): Promise<
  { ok: true; content: string; byteLength: number; sha256: string } | { ok: false; reason: string }
> {
  if (requested.length === 0) return { ok: false, reason: 'path is empty' }
  if (isAbsolute(requested)) {
    return {
      ok: false,
      reason: `path must be relative to the workspace root, not absolute (${requested})`,
    }
  }
  const rootReal = await realpath(root).catch(() => undefined)
  if (rootReal === undefined) return { ok: false, reason: `workspace root ${root} does not exist` }
  const candidate = resolve(rootReal, requested)
  if (!inside(rootReal, candidate)) {
    return { ok: false, reason: `path ${requested} leaves the workspace root` }
  }
  // Open first, then judge the OPENED file. A containment check on a path alone can be raced: the
  // manager's workspace is live (a background process of its own can rename a directory and put a
  // symlink in its place between the check and the read), so the descriptor's identity is what the
  // verdict is about. The in-root real path must name the same inode the descriptor holds, and the
  // bytes are read from the descriptor, never from the path.
  let handle: FileHandle
  try {
    handle = await open(candidate, 'r')
  } catch (error) {
    return { ok: false, reason: `path ${requested}: ${describe(error)}` }
  }
  try {
    const info = await handle.stat()
    if (!info.isFile()) return { ok: false, reason: `path ${requested} is not a regular file` }
    const real = await realpath(candidate).catch(() => undefined)
    if (real === undefined || !inside(rootReal, real)) {
      return { ok: false, reason: `path ${requested} resolves outside the workspace root` }
    }
    const named = await stat(real).catch(() => undefined)
    if (named === undefined || named.dev !== info.dev || named.ino !== info.ino) {
      return {
        ok: false,
        reason: `path ${requested} changed while it was being read; retry the spawn`,
      }
    }
    if (info.size > SPAWN_RESOURCE_PATH_MAX_BYTES) {
      return {
        ok: false,
        reason: `path ${requested} is ${info.size} bytes; an inline resource is at most ${SPAWN_RESOURCE_PATH_MAX_BYTES} bytes`,
      }
    }
    const bytes = await handle.readFile()
    if (bytes.length > SPAWN_RESOURCE_PATH_MAX_BYTES) {
      return {
        ok: false,
        reason: `path ${requested} is ${bytes.length} bytes; an inline resource is at most ${SPAWN_RESOURCE_PATH_MAX_BYTES} bytes`,
      }
    }
    const content = bytes.toString('utf8')
    if (!Buffer.from(content, 'utf8').equals(bytes)) {
      return {
        ok: false,
        reason: `path ${requested} is not valid UTF-8; encode binary data (base64) before handing it to a child`,
      }
    }
    return {
      ok: true,
      content,
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
  } catch (error) {
    return { ok: false, reason: `path ${requested}: ${describe(error)}` }
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/** `target` is `rootReal` itself or strictly below it; both must already be absolute. */
function inside(rootReal: string, target: string): boolean {
  const rel = relative(rootReal, target)
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)
}

function describe(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'ENOENT') return 'does not exist under the workspace root'
  if (code === 'EACCES' || code === 'EPERM') return 'is not readable by the runtime process'
  if (code === 'EISDIR') return 'is not a regular file'
  return error instanceof Error ? error.message : String(error)
}

/** The provider ceiling, applied to whichever transport produced the bytes. The upstream issue is
 *  named because the fix is not in this repository, and the instruction is what a manager can act
 *  on in the same turn. */
function overContentBound(subject: string, byteLength: number, maxContentBytes: number): string {
  return (
    `${subject} is ${byteLength} bytes; this run's provider refuses any single profile string ` +
    `over ${maxContentBytes} bytes (tangle-network/agent-sdk#340). Split the file, stage each ` +
    'part, and have the child concatenate them.'
  )
}

/**
 * Replace every `{ kind: 'inline', name, path }` and `{ kind: 'inline', name, blob }` under
 * `profile.resources` with the inline resource its bytes make. Returns the profile unchanged (same
 * reference) when nothing names either transport, so callers pay nothing on the common case.
 */
export async function resolveSpawnResources(
  profile: unknown,
  source: SpawnResourceSource,
): Promise<ResolveSpawnResourcesResult> {
  if (!isRecord(profile) || !isRecord(profile.resources)) {
    return { ok: true, profile, resolved: [], resolvedBlobs: [] }
  }
  const resources = profile.resources
  const resolved: ResolvedSpawnResourcePath[] = []
  const resolvedBlobs: ResolvedSpawnResourceBlob[] = []
  let touched = false
  const next: Record<string, unknown> = { ...resources }

  const fromPath = async (
    at: string,
    ref: PathInlineRef,
  ): Promise<{ kind: 'inline'; name: string; content: string } | { error: string }> => {
    if (source.root === undefined) {
      return {
        error:
          'this manager has no workspace root the coordination server may read, so a resource by ' +
          'path cannot be resolved; stage the file from bash with put_blob and reference it as ' +
          '{ kind: "inline", name, blob: "sha256:<hex>" }, or pass content, or a github resource',
      }
    }
    const read = await readUnderRoot(source.root, ref.path)
    if (!read.ok) return { error: read.reason }
    if (source.maxContentBytes !== undefined && read.byteLength > source.maxContentBytes) {
      return {
        error: overContentBound(`path ${ref.path}`, read.byteLength, source.maxContentBytes),
      }
    }
    resolved.push({ at, path: ref.path, byteLength: read.byteLength, sha256: read.sha256 })
    touched = true
    return { kind: 'inline', name: ref.name, content: read.content }
  }

  const fromBlob = (
    at: string,
    ref: BlobInlineRef,
  ): { kind: 'inline'; name: string; content: string } | { error: string } => {
    const digest = parseSpawnBlobRef(ref.blob)
    if (digest === undefined) {
      return { error: 'blob must be "sha256:" followed by 64 lowercase hex characters' }
    }
    if (source.blobs === undefined) {
      return {
        error: `blob ${digest} cannot be resolved: this manager's coordination server holds no blob store`,
      }
    }
    const bytes = source.blobs.get(digest)
    if (bytes === undefined) {
      return {
        error:
          `blob ${digest} is not held by this manager; stage it from bash with put_blob first ` +
          '(a coordinator restart empties the store, so re-stage after a resume)',
      }
    }
    // Second, independent verification. The first ran at staging time against the bytes on the
    // wire; this one proves the bytes handed back are still the bytes that address names, so a
    // store defect cannot deliver one file under another file's digest.
    const actual = spawnBlobRef(bytes)
    if (actual !== digest) {
      return {
        error: `blob ${digest} holds bytes that hash to ${actual}; the reference is refused`,
      }
    }
    if (source.maxContentBytes !== undefined && bytes.length > source.maxContentBytes) {
      return { error: overContentBound(`blob ${digest}`, bytes.length, source.maxContentBytes) }
    }
    const content = bytes.toString('utf8')
    // Staging already refused non-UTF-8 bytes; a store that returned some anyway would silently
    // deliver replacement characters, so the round trip is asserted here too.
    if (!Buffer.from(content, 'utf8').equals(bytes)) {
      return {
        error: `blob ${digest} is not valid UTF-8; encode binary data (base64) before handing it to a child`,
      }
    }
    resolvedBlobs.push({
      at,
      blob: digest,
      name: ref.name,
      byteLength: bytes.length,
      sha256: digest.slice('sha256:'.length),
    })
    touched = true
    return { kind: 'inline', name: ref.name, content }
  }

  /** `undefined` = not a managed reference; the canonical schema keeps its verdict on it. */
  const substitute = async (
    at: string,
    value: unknown,
  ): Promise<{ kind: 'inline'; name: string; content: string } | { error: string } | undefined> => {
    if (namesBothTransports(value)) {
      return { error: 'an inline resource names both path and blob; choose one transport' }
    }
    const blob = blobInlineRef(value)
    if (blob !== undefined) return fromBlob(at, blob)
    const path = pathInlineRef(value)
    if (path !== undefined) return await fromPath(at, path)
    return undefined
  }

  // Every list `agentProfileResourcesSchema` declares. `commands` was missing here while the
  // schema already carried it, so a command resource by path reached the schema unresolved and
  // failed as an unrecognized key.
  for (const list of ['tools', 'skills', 'agents', 'commands'] as const) {
    const entries = resources[list]
    if (!Array.isArray(entries)) continue
    const out: unknown[] = []
    for (const [index, entry] of entries.entries()) {
      const at = `${list}[${index}]`
      const replaced = await substitute(at, entry)
      if (replaced === undefined) {
        out.push(entry)
        continue
      }
      if ('error' in replaced) return { ok: false, at, reason: replaced.error }
      out.push(replaced)
    }
    next[list] = out
  }
  if (Array.isArray(resources.files)) {
    const out: unknown[] = []
    for (const [index, mount] of resources.files.entries()) {
      if (!isRecord(mount)) {
        out.push(mount)
        continue
      }
      const at = `files[${index}].resource`
      const replaced = await substitute(at, mount.resource)
      if (replaced === undefined) {
        out.push(mount)
        continue
      }
      if ('error' in replaced) return { ok: false, at, reason: replaced.error }
      out.push({ ...mount, resource: replaced })
    }
    next.files = out
  }
  const instructions = await substitute('instructions', resources.instructions)
  if (instructions !== undefined) {
    if ('error' in instructions)
      return { ok: false, at: 'instructions', reason: instructions.error }
    next.instructions = instructions
  }
  if (!touched) return { ok: true, profile, resolved: [], resolvedBlobs: [] }
  return { ok: true, profile: { ...profile, resources: next }, resolved, resolvedBlobs }
}
