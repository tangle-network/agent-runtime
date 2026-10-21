/**
 * The workspace store port: path documents with compare-and-set revisions and
 * erasure tombstones. One store per tenant holds memory and files for every
 * executor; adapters own persistence, this module owns the contract.
 *
 * No `node:` imports: this module runs unchanged in Workers.
 */

/** What an entry holds; memory kinds are written through `memory.remember`, files through `files.write`. */
export type WorkspaceEntryKind = 'fact' | 'preference' | 'instruction' | 'file'

/** `member` entries live under `/memories/members/<memberId>/`; everything else is `workspace`. */
export type WorkspaceEntryScope = 'workspace' | 'member'

/** Large content kept outside the index, e.g. an R2 object. The adapter owns `key`. */
export interface WorkspaceBytesRef {
  readonly key: string
  readonly size: number
  readonly contentType?: string
  readonly sha256?: string
}

/** One live document. Exactly one of `content` and `bytes` is present. */
export interface WorkspaceEntry {
  readonly workspaceId: string
  /** Stable for the life of the path; kept across updates. */
  readonly id: string
  readonly path: string
  readonly kind: WorkspaceEntryKind
  readonly scope: WorkspaceEntryScope
  readonly content?: string
  readonly bytes?: WorkspaceBytesRef
  /** Monotonic per path, including across delete and re-create. */
  readonly revision: number
  readonly createdBy: string
  readonly createdAt: string
  readonly updatedBy: string
  readonly updatedAt: string
}

/** Erasure record: the content and bytes are gone; only this audit row remains. */
export interface WorkspaceTombstone {
  readonly workspaceId: string
  readonly id: string
  readonly path: string
  /** The revision the delete produced (last live revision + 1). */
  readonly revision: number
  readonly deletedBy: string
  readonly deletedAt: string
}

export interface WorkspacePutInput {
  readonly workspaceId: string
  readonly path: string
  readonly kind: WorkspaceEntryKind
  /** Revision the caller read, or `null` when the path must not hold a live entry. */
  readonly ifRevision: number | null
  readonly actor: string
  readonly content?: string
  readonly bytes?: WorkspaceBytesRef
  /** Id for a new entry; ignored on update. Defaults to a random UUID. */
  readonly id?: string
  /**
   * The caller's key for this write, for at-least-once callers such as a queue
   * consumer or a sidecar capture hook. While the path's live entry is the one
   * this operation wrote, with the same kind and content, repeating the call
   * returns that entry instead of a conflict. Honoured only by a store that sets
   * {@link WorkspaceStore.idempotentOperations}; others ignore it.
   */
  readonly operationId?: string
}

export interface WorkspaceDeleteInput {
  readonly workspaceId: string
  readonly path: string
  /** When present, the delete is refused unless the live revision matches. */
  readonly ifRevision?: number
  readonly actor: string
  /**
   * The caller's key for this delete. While the path's latest tombstone is the
   * one this operation made, repeating the call returns that tombstone instead
   * of a conflict. Honoured only by a store that sets
   * {@link WorkspaceStore.idempotentOperations}.
   */
  readonly operationId?: string
}

/**
 * Versioned path store for one or many tenants. Every write is a compare-and-set
 * on `revision`; a mismatch throws {@link WorkspaceConflictError}. Delete erases
 * content and bytes and records a {@link WorkspaceTombstone}.
 */
export interface WorkspaceStore {
  get(workspaceId: string, path: string): Promise<WorkspaceEntry | null>
  /** Live entries whose path starts with `prefix`, sorted by path. */
  list(workspaceId: string, prefix: string): Promise<WorkspaceEntry[]>
  put(input: WorkspacePutInput): Promise<WorkspaceEntry>
  /** Returns the tombstone, or `null` when nothing was live and no `ifRevision` was given. */
  delete(input: WorkspaceDeleteInput): Promise<WorkspaceTombstone | null>
  /** Erasure audit rows whose path starts with `prefix`, oldest first. */
  tombstones(workspaceId: string, prefix?: string): Promise<WorkspaceTombstone[]>
  /** True when put and delete honour `operationId`; the contract then checks it. */
  readonly idempotentOperations?: boolean
}

/** A write lost a compare-and-set race or targeted the wrong revision. Re-read and retry. */
export class WorkspaceConflictError extends Error {
  readonly code = 'conflict' as const
  constructor(
    readonly path: string,
    readonly expected: number | null,
    readonly actual: number | null,
  ) {
    super(
      `${path} is at revision ${actual ?? 'none'}, expected ${expected ?? 'none'}; read it again`,
    )
    this.name = 'WorkspaceConflictError'
  }
}

const SEGMENT = /^[^/\s\\][^/\\]*$/
const MAX_PATH = 512

/** Refuse anything but an absolute, normalized path such as `/files/report.md`. */
export function assertWorkspacePath(path: string): void {
  if (typeof path !== 'string' || path.length > MAX_PATH || !path.startsWith('/')) {
    throw new TypeError(`workspace path must be absolute and at most ${MAX_PATH} chars: ${path}`)
  }
  const segments = path.slice(1).split('/')
  for (const segment of segments) {
    if (!SEGMENT.test(segment) || segment === '.' || segment === '..') {
      throw new TypeError(`workspace path is not normalized: ${path}`)
    }
  }
}

/** The member a path belongs to, or `null` for workspace-scoped paths. */
export function memberIdFromPath(path: string): string | null {
  const match = /^\/memories\/members\/([^/]+)\//.exec(path)
  return match ? match[1]! : null
}

/** Validate a put before any adapter touches storage; adapters call this first. */
export function checkWorkspacePut(input: WorkspacePutInput): void {
  assertWorkspacePath(input.path)
  if (!input.workspaceId) throw new TypeError('workspaceId is required')
  if (!input.actor) throw new TypeError('actor is required')
  if ((input.content === undefined) === (input.bytes === undefined)) {
    throw new TypeError(`${input.path}: exactly one of content and bytes is required`)
  }
  if (input.ifRevision !== null && !Number.isSafeInteger(input.ifRevision)) {
    throw new TypeError(`${input.path}: ifRevision must be an integer or null`)
  }
  checkOperationId(input.path, input.operationId)
}

const MAX_OPERATION_ID = 256

/** Refuse an `operationId` that is present but empty, not a string, or over 256 chars. */
function checkOperationId(path: string, operationId: unknown): void {
  if (operationId === undefined) return
  if (typeof operationId !== 'string' || !operationId || operationId.length > MAX_OPERATION_ID) {
    throw new TypeError(
      `${path}: operationId must be a non-empty string of at most ${MAX_OPERATION_ID} chars`,
    )
  }
}

function sameBytes(left?: WorkspaceBytesRef, right?: WorkspaceBytesRef): boolean {
  if (!left || !right) return left === right
  return (
    left.key === right.key &&
    left.size === right.size &&
    left.contentType === right.contentType &&
    left.sha256 === right.sha256
  )
}

/** Whether `entry` is exactly what `input` would write: same kind, content and bytes. */
function isSameWorkspaceWrite(entry: WorkspaceEntry, input: WorkspacePutInput): boolean {
  return (
    entry.kind === input.kind &&
    entry.content === input.content &&
    sameBytes(entry.bytes, input.bytes)
  )
}

/** Process-local adapter for tests, previews, and single-instance hosts. */
export function createInMemoryWorkspaceStore(
  options: { now?: () => Date; newId?: () => string } = {},
): WorkspaceStore {
  const now = () => (options.now ?? (() => new Date()))().toISOString()
  const newId = options.newId ?? (() => crypto.randomUUID())
  const live = new Map<string, Map<string, WorkspaceEntry>>()
  // Last revision per path survives deletion so re-created paths stay monotonic.
  const lastRevision = new Map<string, number>()
  const erased: WorkspaceTombstone[] = []
  // The operation behind each path's live entry, and behind its latest tombstone.
  const wroteLive = new Map<string, string>()
  const erasedBy = new Map<string, { operationId: string; tombstone: WorkspaceTombstone }>()
  const pathKey = (workspaceId: string, path: string) => `${workspaceId}\u0000${path}`
  const tenant = (workspaceId: string) => {
    let entries = live.get(workspaceId)
    if (!entries) {
      entries = new Map()
      live.set(workspaceId, entries)
    }
    return entries
  }

  return {
    idempotentOperations: true,
    async get(workspaceId, path) {
      const entry = live.get(workspaceId)?.get(path)
      return entry ? structuredClone(entry) : null
    },
    async list(workspaceId, prefix) {
      return [...(live.get(workspaceId)?.values() ?? [])]
        .filter((entry) => entry.path.startsWith(prefix))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        .map((entry) => structuredClone(entry))
    },
    async put(input) {
      checkWorkspacePut(input)
      const entries = tenant(input.workspaceId)
      const current = entries.get(input.path)
      const key = pathKey(input.workspaceId, input.path)
      if (
        current &&
        input.operationId !== undefined &&
        wroteLive.get(key) === input.operationId &&
        isSameWorkspaceWrite(current, input)
      ) {
        return structuredClone(current)
      }
      if ((current?.revision ?? null) !== input.ifRevision) {
        throw new WorkspaceConflictError(input.path, input.ifRevision, current?.revision ?? null)
      }
      const revision = (lastRevision.get(key) ?? 0) + 1
      const at = now()
      const entry: WorkspaceEntry = {
        workspaceId: input.workspaceId,
        id: current?.id ?? input.id ?? newId(),
        path: input.path,
        kind: input.kind,
        scope: memberIdFromPath(input.path) === null ? 'workspace' : 'member',
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.bytes !== undefined ? { bytes: structuredClone(input.bytes) } : {}),
        revision,
        createdBy: current?.createdBy ?? input.actor,
        createdAt: current?.createdAt ?? at,
        updatedBy: input.actor,
        updatedAt: at,
      }
      entries.set(input.path, entry)
      lastRevision.set(key, revision)
      if (input.operationId === undefined) wroteLive.delete(key)
      else wroteLive.set(key, input.operationId)
      return structuredClone(entry)
    },
    async delete(input) {
      assertWorkspacePath(input.path)
      checkOperationId(input.path, input.operationId)
      const entries = tenant(input.workspaceId)
      const current = entries.get(input.path)
      const key = pathKey(input.workspaceId, input.path)
      const previous = erasedBy.get(key)
      if (
        !current &&
        input.operationId !== undefined &&
        previous?.operationId === input.operationId
      ) {
        return { ...previous.tombstone }
      }
      if (input.ifRevision !== undefined && current?.revision !== input.ifRevision) {
        throw new WorkspaceConflictError(input.path, input.ifRevision, current?.revision ?? null)
      }
      if (!current) return null
      const revision = current.revision + 1
      const tombstone: WorkspaceTombstone = {
        workspaceId: input.workspaceId,
        id: current.id,
        path: current.path,
        revision,
        deletedBy: input.actor,
        deletedAt: now(),
      }
      entries.delete(input.path)
      lastRevision.set(key, revision)
      wroteLive.delete(key)
      if (input.operationId === undefined) erasedBy.delete(key)
      else erasedBy.set(key, { operationId: input.operationId, tombstone })
      erased.push(tombstone)
      return { ...tombstone }
    },
    async tombstones(workspaceId, prefix = '/') {
      return erased
        .filter((row) => row.workspaceId === workspaceId && row.path.startsWith(prefix))
        .map((row) => ({ ...row }))
    },
  }
}
