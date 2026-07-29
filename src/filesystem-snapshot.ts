import { createHash } from 'node:crypto'
import { type BigIntStats, constants as fsConstants } from 'node:fs'
import { chmod, lstat, mkdir, open, readdir, readlink, realpath, symlink } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep, win32 } from 'node:path'

/** Resource bounds applied while hashing a filesystem tree. */
export interface FilesystemSnapshotLimits {
  readonly maxFiles: number
  readonly maxFileBytes: number
  readonly maxTotalFileBytes: number
  readonly maxPathBytes: number
}

export type FilesystemSnapshotEntry =
  | {
      readonly kind: 'directory'
      readonly path: string
      readonly mode: number
    }
  | {
      readonly kind: 'file'
      readonly path: string
      readonly mode: number
      readonly sha256: `sha256:${string}`
      readonly byteLength: number
    }
  | {
      readonly kind: 'symlink'
      readonly path: string
      readonly target: string
    }

export type CapturedFilesystemEntry =
  | Extract<FilesystemSnapshotEntry, { kind: 'directory' }>
  | (Extract<FilesystemSnapshotEntry, { kind: 'file' }> & {
      readonly bytes: Uint8Array
    })
  | Extract<FilesystemSnapshotEntry, { kind: 'symlink' }>

export interface CapturedFilesystemTree {
  readonly entries: readonly CapturedFilesystemEntry[]
  readonly manifest: readonly FilesystemSnapshotEntry[]
  readonly totalFileBytes: number
}

export interface ScannedFilesystemTree {
  readonly manifest: readonly FilesystemSnapshotEntry[]
  readonly totalFileBytes: number
}

type InternalFilesystemEntry =
  | Extract<FilesystemSnapshotEntry, { kind: 'directory' | 'symlink' }>
  | (Extract<FilesystemSnapshotEntry, { kind: 'file' }> & {
      readonly bytes?: Uint8Array
    })

export interface CaptureFilesystemTreeOptions {
  readonly label?: string
  readonly excludedRootEntries?: ReadonlySet<string>
  readonly includeDirectories?: boolean
  readonly symlinks?: 'reject' | 'internal'
  readonly hardlinks?: 'reject' | 'copy'
  /** Count directories and symlinks, not only files, against `limits.maxFiles`. */
  readonly countAllEntriesAgainstMaxFiles?: boolean
  readonly rejectNestedGitMetadata?: boolean
  readonly forbiddenSymlinkPrefixes?: readonly string[]
  /**
   * Decide whether an entry is admitted before it is opened or traversed.
   * `skip` on a directory skips its complete subtree.
   */
  readonly entryPolicy?: (
    path: string,
    kind: 'directory' | 'file' | 'symlink' | 'other',
  ) => 'include' | 'skip' | 'reject'
  readonly limits: FilesystemSnapshotLimits
}

/**
 * Read a directory without following links and retain the exact bytes needed to
 * materialize it elsewhere. File identity is checked before and after each read;
 * callers should compare two complete captures when the source may change.
 */
export async function captureFilesystemTree(
  rootInput: string,
  options: CaptureFilesystemTreeOptions,
): Promise<CapturedFilesystemTree> {
  const observed = await scanFilesystemTreeInternal(rootInput, options, true)
  const entries = observed.entries.map((entry) => {
    if (entry.kind !== 'file' || entry.bytes !== undefined) return entry as CapturedFilesystemEntry
    throw new Error('filesystem capture did not retain required file bytes')
  })
  return Object.freeze({
    entries: Object.freeze(entries),
    manifest: observed.manifest,
    totalFileBytes: observed.totalFileBytes,
  })
}

/** Hash and describe a directory without retaining file contents in memory. */
export async function scanFilesystemTree(
  rootInput: string,
  options: CaptureFilesystemTreeOptions,
): Promise<ScannedFilesystemTree> {
  const observed = await scanFilesystemTreeInternal(rootInput, options, false)
  return Object.freeze({
    manifest: observed.manifest,
    totalFileBytes: observed.totalFileBytes,
  })
}

async function scanFilesystemTreeInternal(
  rootInput: string,
  options: CaptureFilesystemTreeOptions,
  retainBytes: boolean,
): Promise<{
  entries: readonly InternalFilesystemEntry[]
  manifest: readonly FilesystemSnapshotEntry[]
  totalFileBytes: number
}> {
  const root = resolve(rootInput)
  const label = options.label ?? 'filesystem tree'
  const rootStats = await lstat(root)
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error(`${label} root must be a real directory`)
  }
  if ((await realpath(root)) !== root) {
    throw new Error(`${label} root has a symlinked path component`)
  }
  validateLimits(options.limits, label)

  const entries: InternalFilesystemEntry[] = []
  const collisionPaths = new Map<string, string>()
  let fileCount = 0
  let admittedEntryCount = 0
  let totalFileBytes = 0

  async function visit(directory: string): Promise<void> {
    const children = await readdir(directory, { withFileTypes: true })
    children.sort((left, right) => comparePath(left.name, right.name))
    for (const child of children) {
      if (directory === root && options.excludedRootEntries?.has(child.name)) continue
      const absolute = resolve(directory, child.name)
      const path = safeRelativePath(root, absolute, options.limits.maxPathBytes, label)
      const entryKind = child.isDirectory()
        ? 'directory'
        : child.isFile()
          ? 'file'
          : child.isSymbolicLink()
            ? 'symlink'
            : 'other'
      const admission = options.entryPolicy?.(path, entryKind) ?? 'include'
      if (admission === 'reject') {
        throw new Error(`${label} contains a refused entry: ${path}`)
      }
      if (admission === 'skip') continue
      if (options.countAllEntriesAgainstMaxFiles && admittedEntryCount >= options.limits.maxFiles) {
        throw new Error(`${label} exceeds maxFiles`)
      }
      admittedEntryCount++
      assertPortablePath(path, collisionPaths, label)
      if (
        options.rejectNestedGitMetadata &&
        path.split('/').some((segment) => portableSegment(segment) === '.git')
      ) {
        throw new Error(`${label} contains nested Git metadata: ${path}`)
      }

      const before = await lstat(absolute, { bigint: true })
      if (before.isSymbolicLink()) {
        if ((options.symlinks ?? 'reject') === 'reject') {
          throw new Error(`${label} contains a symlink: ${path}`)
        }
        const target = await readlink(absolute)
        await assertInternalSymlink(root, absolute, path, target, options, label)
        const after = await lstat(absolute, { bigint: true })
        assertSameFilesystemIdentity(before, after, path, label)
        entries.push(Object.freeze({ kind: 'symlink', path, target }))
        continue
      }

      if (before.isDirectory()) {
        if (options.includeDirectories !== false) {
          entries.push(
            Object.freeze({ kind: 'directory', path, mode: Number(before.mode & 0o777n) }),
          )
        }
        await visit(absolute)
        const after = await lstat(absolute, { bigint: true })
        assertSameFilesystemIdentity(before, after, path, label)
        continue
      }

      if (!before.isFile()) {
        throw new Error(`${label} contains a non-regular entry: ${path}`)
      }
      if ((options.hardlinks ?? 'reject') === 'reject' && before.nlink !== 1n) {
        throw new Error(`${label} contains a hard-linked file: ${path}`)
      }
      if (!options.countAllEntriesAgainstMaxFiles && fileCount >= options.limits.maxFiles) {
        throw new Error(`${label} exceeds maxFiles`)
      }
      if (before.size > BigInt(options.limits.maxFileBytes)) {
        throw new Error(`${label} file exceeds maxFileBytes: ${path}`)
      }
      if (before.size > BigInt(options.limits.maxTotalFileBytes - totalFileBytes)) {
        throw new Error(`${label} exceeds maxTotalFileBytes`)
      }

      const descriptor = await open(
        absolute,
        fsConstants.O_RDONLY |
          (typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0),
      )
      let captured:
        | {
            sha256: `sha256:${string}`
            byteLength: number
            bytes?: Uint8Array
            openedBefore: BigIntStats
            openedAfter: BigIntStats
          }
        | undefined
      try {
        const openedBefore = await descriptor.stat({ bigint: true })
        if (!openedBefore.isFile()) {
          throw new Error(`${label} contains a non-regular entry: ${path}`)
        }
        if ((options.hardlinks ?? 'reject') === 'reject' && openedBefore.nlink !== 1n) {
          throw new Error(`${label} contains a hard-linked file: ${path}`)
        }
        const content = await readAndHashBoundedFile(
          descriptor,
          Math.min(options.limits.maxFileBytes, options.limits.maxTotalFileBytes - totalFileBytes),
          path,
          label,
          retainBytes,
        )
        const openedAfter = await descriptor.stat({ bigint: true })
        captured = { ...content, openedBefore, openedAfter }
      } finally {
        await descriptor.close()
      }
      if (!captured) throw new Error(`${label} could not capture file: ${path}`)
      const after = await lstat(absolute, { bigint: true })
      assertSameFilesystemIdentity(before, captured.openedBefore, path, label)
      assertSameFilesystemIdentity(captured.openedBefore, captured.openedAfter, path, label)
      assertSameFilesystemIdentity(captured.openedAfter, after, path, label)

      fileCount++
      totalFileBytes += captured.byteLength
      entries.push(
        Object.freeze({
          kind: 'file',
          path,
          mode: Number(captured.openedAfter.mode & 0o777n),
          sha256: captured.sha256,
          byteLength: captured.byteLength,
          ...(captured.bytes ? { bytes: Uint8Array.from(captured.bytes) } : {}),
        }),
      )
    }
  }

  await visit(root)
  entries.sort(compareEntries)
  return Object.freeze({
    entries: Object.freeze(entries),
    manifest: Object.freeze(entries.map(stripInternalBytes)),
    totalFileBytes,
  })
}

/** Materialize one captured tree into an existing empty real directory. */
export async function materializeFilesystemTree(
  destinationInput: string,
  entriesInput: readonly CapturedFilesystemEntry[],
): Promise<void> {
  const destination = resolve(destinationInput)
  const stats = await lstat(destination)
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    (await realpath(destination)) !== destination
  ) {
    throw new Error('filesystem snapshot destination must be an empty real directory')
  }
  if ((await readdir(destination)).length > 0) {
    throw new Error('filesystem snapshot destination must be empty')
  }

  const entries = [...entriesInput].sort(compareEntries)
  const collisions = new Map<string, string>()
  for (const entry of entries) assertPortablePath(entry.path, collisions, 'filesystem snapshot')

  const directories = entries.filter(
    (entry): entry is Extract<CapturedFilesystemEntry, { kind: 'directory' }> =>
      entry.kind === 'directory',
  )
  for (const entry of directories) {
    await mkdir(snapshotPath(destination, entry.path), { recursive: true, mode: 0o700 })
  }

  for (const entry of entries) {
    if (entry.kind === 'directory') continue
    const path = snapshotPath(destination, entry.path)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    if (entry.kind === 'symlink') {
      assertMaterializedSymlink(destination, path, entry.path, entry.target)
      await symlink(entry.target, path)
      continue
    }
    if (entry.bytes.byteLength !== entry.byteLength || sha256(entry.bytes) !== entry.sha256) {
      throw new Error(`filesystem snapshot file bytes do not match manifest: ${entry.path}`)
    }
    const descriptor = await open(
      path,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        (typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0),
      0o600,
    )
    try {
      await descriptor.writeFile(entry.bytes)
      const written = await descriptor.stat({ bigint: true })
      if (!written.isFile() || written.nlink !== 1n) {
        throw new Error(`filesystem snapshot file identity changed while writing: ${entry.path}`)
      }
      await descriptor.chmod(entry.mode)
    } finally {
      await descriptor.close()
    }
  }

  directories.sort((left, right) => pathDepth(right.path) - pathDepth(left.path))
  for (const directory of directories) {
    await chmod(snapshotPath(destination, directory.path), directory.mode)
  }
}

function stripInternalBytes(entry: InternalFilesystemEntry): FilesystemSnapshotEntry {
  if (entry.kind !== 'file') return entry
  const { bytes: _bytes, ...material } = entry
  return Object.freeze(material)
}

async function readAndHashBoundedFile(
  descriptor: Awaited<ReturnType<typeof open>>,
  maxBytes: number,
  path: string,
  label: string,
  retainBytes: boolean,
): Promise<{
  sha256: `sha256:${string}`
  byteLength: number
  bytes?: Uint8Array
}> {
  const chunks: Buffer[] = []
  const hash = createHash('sha256')
  let total = 0
  while (true) {
    const remaining = maxBytes - total
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining + 1))
    const { bytesRead } = await descriptor.read(chunk, 0, chunk.byteLength, null)
    if (bytesRead === 0) break
    total += bytesRead
    if (total > maxBytes) {
      throw new Error(`${label} file exceeds its capture limit: ${path}`)
    }
    const bytes = chunk.subarray(0, bytesRead)
    hash.update(bytes)
    if (retainBytes) chunks.push(bytes)
  }
  return {
    sha256: `sha256:${hash.digest('hex')}`,
    byteLength: total,
    ...(retainBytes ? { bytes: Buffer.concat(chunks, total) } : {}),
  }
}

async function assertInternalSymlink(
  root: string,
  absolutePath: string,
  path: string,
  target: string,
  options: CaptureFilesystemTreeOptions,
  label: string,
): Promise<void> {
  if (
    !target ||
    !isWellFormedUnicode(target) ||
    target.includes('\0') ||
    hasControlCharacter(target) ||
    isAbsolute(target) ||
    win32.isAbsolute(target)
  ) {
    throw new Error(`${label} contains an unsafe symlink target: ${path}`)
  }
  const resolvedTarget = resolve(dirname(absolutePath), target)
  if (resolvedTarget !== root && !resolvedTarget.startsWith(`${root}${sep}`)) {
    throw new Error(`${label} contains an escaping symlink: ${path}`)
  }
  for (const forbidden of options.forbiddenSymlinkPrefixes ?? []) {
    const prefix = resolve(forbidden)
    if (resolvedTarget === prefix || resolvedTarget.startsWith(`${prefix}${sep}`)) {
      throw new Error(`${label} symlink targets protected metadata: ${path}`)
    }
  }
  let physicalTarget: string
  try {
    physicalTarget = await realpath(resolvedTarget)
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) {
      throw new Error(`${label} contains a dangling symlink: ${path}`)
    }
    throw error
  }
  if (physicalTarget !== root && !physicalTarget.startsWith(`${root}${sep}`)) {
    throw new Error(`${label} contains an escaping symlink chain: ${path}`)
  }
}

function assertMaterializedSymlink(
  root: string,
  absolutePath: string,
  path: string,
  target: string,
): void {
  const resolvedTarget = resolve(dirname(absolutePath), target)
  if (resolvedTarget !== root && !resolvedTarget.startsWith(`${root}${sep}`)) {
    throw new Error(`filesystem snapshot contains an escaping symlink: ${path}`)
  }
}

function assertSameFilesystemIdentity(
  left: BigIntStats,
  right: BigIntStats,
  path: string,
  label: string,
): void {
  const same =
    String(left.dev) === String(right.dev) &&
    String(left.ino) === String(right.ino) &&
    String(left.mode) === String(right.mode) &&
    String(left.nlink) === String(right.nlink) &&
    String(left.size) === String(right.size) &&
    String(left.mtimeNs ?? left.mtimeMs) === String(right.mtimeNs ?? right.mtimeMs) &&
    String(left.ctimeNs ?? left.ctimeMs) === String(right.ctimeNs ?? right.ctimeMs)
  if (!same) throw new Error(`${label} changed while being captured: ${path}`)
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
}

function safeRelativePath(
  root: string,
  absolute: string,
  maxPathBytes: number,
  label: string,
): string {
  const path = relative(root, absolute).split(sep).join('/')
  if (
    !path ||
    !isWellFormedUnicode(path) ||
    Buffer.byteLength(path, 'utf8') > maxPathBytes ||
    path.includes('\\') ||
    path.includes('\0') ||
    hasControlCharacter(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`${label} contains an unsafe path: ${path}`)
  }
  return path
}

function assertPortablePath(path: string, observed: Map<string, string>, label: string): void {
  const key = path.split('/').map(portableSegment).join('/')
  const existing = observed.get(key)
  if (existing !== undefined && existing !== path) {
    throw new Error(`${label} contains a case or Unicode path collision: ${existing}, ${path}`)
  }
  observed.set(key, path)
}

function portableSegment(segment: string): string {
  return segment
    .normalize('NFC')
    .replace(/[ .]+$/u, '')
    .toLowerCase()
}

function snapshotPath(root: string, path: string): string {
  const absolute = resolve(root, path)
  if (!absolute.startsWith(`${root}${sep}`)) {
    throw new Error(`filesystem snapshot path escapes destination: ${path}`)
  }
  return absolute
}

function compareEntries(left: { path: string }, right: { path: string }): number {
  return comparePath(left.path, right.path)
}

function comparePath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function pathDepth(path: string): number {
  return path.split('/').length
}

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function validateLimits(limits: FilesystemSnapshotLimits, label: string): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${label} ${name} must be a positive safe integer`)
    }
  }
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index++
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false
    }
  }
  return true
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}
