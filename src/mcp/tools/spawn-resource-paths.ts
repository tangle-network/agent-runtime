import { createHash } from 'node:crypto'
import { type FileHandle, open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

/**
 * Inline resources a manager hands a child by PATH instead of by content.
 *
 * The canonical profile schema knows two resource kinds, `inline` (a content string) and `github`.
 * A manager that wants a child to receive a data file therefore had one way to do it: emit the
 * bytes inside its own `spawn` tool call. That is a transcription by a language model, and it does
 * not survive size. Measured 2026-09-12 (discovery-lab `mech-interp-foundations-glm2-b-20260912b`):
 * a 29,144-character base64 payload on the manager's disk reached three children as 15,928
 * characters with 11 substitutions, and a fourth child received the literal placeholder the
 * manager meant to replace. Seven blind-check attempts across two runs delivered no data.
 *
 * `{ kind: 'inline', name, path }` lets the coordination server be the transport: it reads the
 * file under the manager's workspace root, fills `content`, and the profile that reaches the
 * schema, the journal, and the provider is an ordinary inline resource. Nothing downstream
 * changes; the model's output stops carrying the bytes.
 *
 * Fail-closed rules, each with the reason a manager needs to fix its call:
 *  - no root configured → refused (a nested manager in a remote sandbox has no host directory
 *    the server may read for it)
 *  - absolute path, `..` escape, or a symlink that resolves outside the root → refused; the
 *    workspace root is the only directory a manager may hand out
 *  - not a regular file → refused
 *  - over {@link SPAWN_RESOURCE_PATH_MAX_BYTES} → refused naming the bound
 *  - bytes that are not valid UTF-8 → refused; `content` is a string, so binary data is encoded
 *    (base64) by the manager first, exactly as it would be for a content resource
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

export type ResolveSpawnResourcePathsResult =
  | {
      readonly ok: true
      readonly profile: unknown
      readonly resolved: readonly ResolvedSpawnResourcePath[]
    }
  | { readonly ok: false; readonly at: string; readonly reason: string }

interface PathInlineRef {
  readonly kind: 'inline'
  readonly name: string
  readonly path: string
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

/**
 * Replace every `{ kind: 'inline', name, path }` under `profile.resources` with the inline
 * resource its bytes make. Returns the profile unchanged (same reference) when nothing names a
 * path, so callers pay nothing on the common case.
 */
export async function resolveSpawnResourcePaths(
  profile: unknown,
  root: string | undefined,
): Promise<ResolveSpawnResourcePathsResult> {
  if (!isRecord(profile) || !isRecord(profile.resources)) return { ok: true, profile, resolved: [] }
  const resources = profile.resources
  const resolved: ResolvedSpawnResourcePath[] = []
  let touched = false
  const next: Record<string, unknown> = { ...resources }

  const substitute = async (
    at: string,
    ref: PathInlineRef,
  ): Promise<{ kind: 'inline'; name: string; content: string } | { error: string }> => {
    if (root === undefined) {
      return {
        error:
          'this manager has no workspace root the coordination server may read, so a resource by path cannot be resolved; pass content, or a github resource',
      }
    }
    const read = await readUnderRoot(root, ref.path)
    if (!read.ok) return { error: read.reason }
    resolved.push({ at, path: ref.path, byteLength: read.byteLength, sha256: read.sha256 })
    touched = true
    return { kind: 'inline', name: ref.name, content: read.content }
  }

  for (const list of ['tools', 'skills', 'agents'] as const) {
    const entries = resources[list]
    if (!Array.isArray(entries)) continue
    const out: unknown[] = []
    for (const [index, entry] of entries.entries()) {
      const ref = pathInlineRef(entry)
      if (ref === undefined) {
        out.push(entry)
        continue
      }
      const at = `${list}[${index}]`
      const replaced = await substitute(at, ref)
      if ('error' in replaced) return { ok: false, at, reason: replaced.error }
      out.push(replaced)
    }
    next[list] = out
  }
  if (Array.isArray(resources.files)) {
    const out: unknown[] = []
    for (const [index, mount] of resources.files.entries()) {
      const ref = isRecord(mount) ? pathInlineRef(mount.resource) : undefined
      if (ref === undefined || !isRecord(mount)) {
        out.push(mount)
        continue
      }
      const at = `files[${index}].resource`
      const replaced = await substitute(at, ref)
      if ('error' in replaced) return { ok: false, at, reason: replaced.error }
      out.push({ ...mount, resource: replaced })
    }
    next.files = out
  }
  const instructions = pathInlineRef(resources.instructions)
  if (instructions !== undefined) {
    const replaced = await substitute('instructions', instructions)
    if ('error' in replaced) return { ok: false, at: 'instructions', reason: replaced.error }
    next.instructions = replaced
  }
  if (!touched) return { ok: true, profile, resolved: [] }
  return { ok: true, profile: { ...profile, resources: next }, resolved }
}
