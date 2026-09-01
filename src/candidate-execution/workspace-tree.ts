/**
 * A content digest over a DIRECTORY TREE, and the per-file seed that fills one.
 *
 * The question this answers is "is this workspace the same workspace" — the question every launch
 * and every close of a branchable run has to answer, about a tree that a live process is still
 * writing to. That is a different question from the one
 * {@link scanMaterializedWorkspaceManifest} answers, and the difference decides the policies here:
 *
 *  - A candidate manifest describes ONE EXACT regular-file workspace. It refuses a symbolic link
 *    outright, because `AgentCandidateWorkspaceManifestMaterial` has no representation for one, and
 *    it refuses an entry that disappears, because a signed manifest describes a settled tree.
 *  - A tree descriptor describes what a RUN PRODUCED. A python venv writes
 *    `bin/python -> /usr/bin/python3` as a matter of course, and a work directory can lose an entry
 *    between two directory reads. Refusing on either aborts the close, and a run that never wrote
 *    its digest can never be branched from.
 *
 * So the two policies are the caller's, one for links and one for vanishing entries, and both
 * default to `'refuse'` — the strict reading, correct for an INPUT seed, where a link that leaves
 * the tree means the seed describes bytes it does not contain. `'exclude'` is the reading a close
 * needs: the entry is never followed, it is recorded, and the exclusion itself is hashed, so two
 * trees that differ only in an excluded entry cannot share a digest.
 *
 * NOTHING is held in memory. A file reaches the tree digest as its own streamed sha-256 plus its
 * length, so the largest file in the tree does not decide whether the tree can be described:
 * `readFile` refuses anything above 2 GiB with `ERR_FS_FILE_TOO_LARGE`, and a single multi-gigabyte
 * artifact is exactly what a run leaves behind.
 *
 * @module
 * @experimental
 */

import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { cp, lstat, open, readdir, readlink, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Sha256Digest } from '@tangle-network/agent-interface'

/**
 * `'tree-v1'` records a file's exact permission bits. `'portable-tree-v1'` records the two modes
 * Git stores — `755` when any execute bit is set, `644` otherwise, and `755` for a directory — so a
 * digest survives a checkout whose umask differs. Both stamp the algorithm into the digest, so one
 * tree cannot produce the same digest under both.
 */
export type WorkspaceTreeAlgorithm = 'tree-v1' | 'portable-tree-v1'

/** What a walk does with an entry it refuses to describe: fail, or record and continue. */
export type WorkspaceTreeEntryPolicy = 'refuse' | 'exclude'

/** Why one entry contributed its name instead of its content. */
export type WorkspaceTreeExclusionReason =
  | 'absolute-symlink'
  | 'symlink-escapes-tree'
  | 'symlink-resolves-outside-tree'
  | 'unresolved-symlink'
  | 'entry-disappeared'

/** One entry the walk recorded but did not describe. Reported rather than dropped: a digest that
 *  silently omitted an entry would be a different digest with no way to tell why. */
export interface WorkspaceTreeExclusion {
  /** Tree-relative path, `/`-separated. */
  readonly path: string
  readonly reason: WorkspaceTreeExclusionReason
  /** The link target exactly as it was written, for a symbolic-link exclusion. */
  readonly target?: string
}

export interface WorkspaceTreeDescriptor {
  readonly algorithm: WorkspaceTreeAlgorithm
  readonly digest: Sha256Digest
  readonly files: number
  readonly directories: number
  /** Links kept INSIDE the tree. An excluded link is counted in `excluded`, never here. */
  readonly symlinks: number
  /** Total described regular-file bytes. */
  readonly bytes: number
  readonly excluded: ReadonlyArray<WorkspaceTreeExclusion>
}

export interface DescribeWorkspaceTreeOptions {
  /** Default `'tree-v1'`. */
  readonly algorithm?: WorkspaceTreeAlgorithm
  /**
   * A symbolic link that is absolute, leaves the tree lexically, resolves outside it, or does not
   * resolve at all. `'refuse'` (default) is correct for an input seed. `'exclude'` is correct for a
   * close-time walk over a tree a run wrote. The link is NEVER followed in either policy: an
   * escaping link must not contribute bytes from outside the tree to a content address.
   */
  readonly onEscapingLink?: WorkspaceTreeEntryPolicy
  /**
   * An entry that vanished between the directory read that named it and the walk that reached it.
   * `'refuse'` (default) is correct for a settled tree; `'exclude'` is correct for a workspace a
   * live process still writes to.
   */
  readonly onMissingEntry?: WorkspaceTreeEntryPolicy
}

export interface SeedWorkspaceTreeInput {
  /** The tree to copy FROM. Described, then copied entry by entry. */
  readonly source: string
  /** The tree to copy INTO. Must exist, and must not lie inside `source`. */
  readonly destination: string
  /** Default `'tree-v1'`; decides only the digest this returns, never the bytes it writes. */
  readonly algorithm?: WorkspaceTreeAlgorithm
}

const TREE_ALGORITHMS: ReadonlySet<string> = new Set<WorkspaceTreeAlgorithm>([
  'tree-v1',
  'portable-tree-v1',
])

const ENTRY_POLICIES: ReadonlySet<string> = new Set<WorkspaceTreeEntryPolicy>(['refuse', 'exclude'])

/**
 * Describe one directory tree by content, streaming every file.
 *
 * The digest covers, for every entry in sorted order: its kind, its tree-relative path, its mode
 * under the selected algorithm, and then — for a file, its length and its own sha-256; for a kept
 * link, its target; for an excluded entry, the reason and the target. A file's content therefore
 * never enters the tree hash directly, which is what removes any in-memory size ceiling: the tree
 * hash consumes 32 bytes per file however large the file is.
 *
 * A hard-linked regular file is described like any other regular file. Its content is what the
 * digest is about, and a package manager that links a store into `node_modules` is ordinary
 * content, not a reason to refuse a workspace.
 */
export async function describeWorkspaceTree(
  directory: string,
  options: DescribeWorkspaceTreeOptions = {},
): Promise<WorkspaceTreeDescriptor> {
  const algorithm = options.algorithm ?? 'tree-v1'
  const onEscapingLink = options.onEscapingLink ?? 'refuse'
  const onMissingEntry = options.onMissingEntry ?? 'refuse'
  if (!TREE_ALGORITHMS.has(algorithm)) {
    throw new Error(`unsupported workspace tree algorithm: ${algorithm}`)
  }
  for (const [name, policy] of [
    ['onEscapingLink', onEscapingLink],
    ['onMissingEntry', onMissingEntry],
  ] as const) {
    if (!ENTRY_POLICIES.has(policy)) {
      throw new Error(`unsupported workspace tree ${name} policy: ${policy}`)
    }
  }

  const root = resolve(directory)
  const rootStats = await lstatIfPresent(root)
  if (rootStats === null || !rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error(`workspace tree root must be a real directory: ${directory}`)
  }
  // Resolve the root once. Every physical containment test below compares against the RESOLVED
  // root, so a symlinked prefix — which is what macOS hands out for a temp directory — does not
  // make every entry look like it escapes.
  const physicalRoot = await realpath(root)

  const hash = createHash('sha256')
  // The algorithm is part of the digest. Without this, a tree whose modes already are 755/644
  // produces one digest under both algorithms, and two different questions share one answer.
  hash.update(`workspace-tree\0${algorithm}\0`)
  const counts = { files: 0, directories: 0, symlinks: 0, bytes: 0 }
  const excluded: WorkspaceTreeExclusion[] = []

  const exclude = (path: string, reason: WorkspaceTreeExclusionReason, target?: string): void => {
    const name = treePath(root, path)
    excluded.push(
      Object.freeze(target === undefined ? { path: name, reason } : { path: name, reason, target }),
    )
    // The reason is hashed with the entry. Two trees that differ only in WHY an entry was excluded
    // are different trees, and a refusal must not become a way to hide a difference.
    hash.update(`excluded\0${name}\0${reason}\0${target ?? ''}\0`)
  }

  /** True when the caller asked to continue past a vanished entry, and it was not the root. */
  const recordMissing = (path: string): boolean => {
    if (onMissingEntry === 'refuse' || path === root) return false
    exclude(path, 'entry-disappeared')
    return true
  }

  const visit = async (path: string): Promise<void> => {
    const info = await lstatIfPresent(path)
    if (info === null) {
      if (recordMissing(path)) return
      throw new Error(`workspace tree entry disappeared during the walk: ${treePath(root, path)}`)
    }
    const name = treePath(root, path)
    const mode = entryMode(info.mode, algorithm, info.isDirectory(), info.isSymbolicLink())

    if (info.isDirectory()) {
      let entries: string[]
      try {
        entries = await readdir(path)
      } catch (error) {
        if (isMissing(error) && recordMissing(path)) return
        throw error
      }
      counts.directories += 1
      hash.update(`directory\0${name}\0${mode}\0`)
      for (const entry of entries.sort()) await visit(join(path, entry))
      return
    }

    if (info.isSymbolicLink()) {
      await visitSymbolicLink(path, name, mode)
      return
    }

    if (!info.isFile()) {
      throw new Error(`workspace tree contains an unsupported entry: ${name}`)
    }
    const read = await digestFile(path)
    if (read === null) {
      if (recordMissing(path)) return
      throw new Error(`workspace tree entry disappeared during the walk: ${name}`)
    }
    counts.files += 1
    counts.bytes += read.byteLength
    hash.update(`file\0${name}\0${mode}\0${read.byteLength}\0${read.sha256}\0`)
  }

  const visitSymbolicLink = async (path: string, name: string, mode: string): Promise<void> => {
    let target: string
    try {
      target = await readlink(path)
    } catch (error) {
      if (isMissing(error) && recordMissing(path)) return
      throw error
    }
    const refuse = (reason: WorkspaceTreeExclusionReason): void => {
      if (onEscapingLink === 'refuse') {
        throw new Error(
          `workspace tree contains a link that ${reasonText(reason)}: ${name} -> ${target}`,
        )
      }
      exclude(path, reason, target)
    }
    if (isAbsolute(target)) return refuse('absolute-symlink')
    if (!isWithin(root, resolve(dirname(path), target))) return refuse('symlink-escapes-tree')
    let physicalTarget: string
    try {
      physicalTarget = await realpath(path)
    } catch {
      // A dangling link is a fact about the tree, not a reason to make the run unrecoverable.
      return refuse('unresolved-symlink')
    }
    if (!isWithin(physicalRoot, physicalTarget)) return refuse('symlink-resolves-outside-tree')
    counts.symlinks += 1
    hash.update(`symlink\0${name}\0${mode}\0${target}\0`)
  }

  await visit(root)
  return Object.freeze({
    algorithm,
    digest: `sha256:${hash.digest('hex')}` as Sha256Digest,
    files: counts.files,
    directories: counts.directories,
    symlinks: counts.symlinks,
    bytes: counts.bytes,
    excluded: Object.freeze(excluded),
  })
}

/**
 * Seed a workspace from a directory, one entry at a time, and return the digest of what was
 * seeded.
 *
 * Nothing is packed: `cp` walks and copies file by file, so a multi-gigabyte seed costs one file
 * handle rather than one archive in memory. Existing destination entries are never overwritten —
 * a seed that could replace a file the workspace already holds would make the resulting tree
 * depend on the order two seeds ran in.
 *
 * Links are copied verbatim, exactly as they were written. Following them would copy bytes from
 * outside the seed into the workspace, which is the same rule {@link describeWorkspaceTree}
 * applies to the digest.
 */
export async function seedWorkspaceTree(
  input: SeedWorkspaceTreeInput,
): Promise<WorkspaceTreeDescriptor> {
  const source = resolve(input.source)
  const destination = resolve(input.destination)
  if (source === destination || isWithin(source, destination)) {
    throw new Error('workspace seed must not contain its destination')
  }
  const destinationStats = await lstatIfPresent(destination)
  if (destinationStats === null || !destinationStats.isDirectory()) {
    throw new Error(
      `workspace seed destination must be an existing directory: ${input.destination}`,
    )
  }
  // Described BEFORE anything is copied, so a seed this refuses leaves the destination untouched.
  const descriptor = await describeWorkspaceTree(source, {
    ...(input.algorithm === undefined ? {} : { algorithm: input.algorithm }),
  })
  for (const name of (await readdir(source)).sort()) {
    if ((await lstatIfPresent(join(destination, name))) !== null) {
      throw new Error(`workspace seed would overwrite an existing entry: ${name}`)
    }
    await cp(join(source, name), join(destination, name), {
      recursive: true,
      force: false,
      errorOnExist: true,
      verbatimSymlinks: true,
    })
  }
  return descriptor
}

/** Stream one regular file into its own digest, or `null` when it vanished mid-read. */
async function digestFile(
  path: string,
): Promise<{ sha256: Sha256Digest; byteLength: number } | null> {
  let descriptor: Awaited<ReturnType<typeof open>>
  try {
    descriptor = await open(
      path,
      fsConstants.O_RDONLY |
        (typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0),
    )
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
  try {
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let total = 0
    while (true) {
      const { bytesRead } = await descriptor.read(buffer, 0, buffer.byteLength, null)
      if (bytesRead === 0) break
      total += bytesRead
      hash.update(buffer.subarray(0, bytesRead))
    }
    // The length comes from the READ, never from `lstat`, so a file that grew between the two is
    // described by the bytes that reached the digest rather than refused for ordinary churn.
    return { sha256: `sha256:${hash.digest('hex')}` as Sha256Digest, byteLength: total }
  } finally {
    await descriptor.close()
  }
}

/** Git records exactly two file modes; a portable tree records the same two, plus 755 for a
 *  directory and 777 for a link, which is what every filesystem reports for one. */
function entryMode(
  mode: number | bigint,
  algorithm: WorkspaceTreeAlgorithm,
  isDirectory: boolean,
  isSymbolicLink: boolean,
): string {
  const bits = Number(mode)
  if (algorithm !== 'portable-tree-v1') return String(bits & 0o777)
  if (isDirectory) return '755'
  if (isSymbolicLink) return '777'
  return (bits & 0o111) !== 0 ? '755' : '644'
}

function reasonText(reason: WorkspaceTreeExclusionReason): string {
  switch (reason) {
    case 'absolute-symlink':
      return 'is absolute'
    case 'symlink-escapes-tree':
      return 'escapes its tree'
    case 'symlink-resolves-outside-tree':
      return 'resolves outside its tree'
    default:
      return 'does not resolve'
  }
}

function treePath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/') || '.'
}

function isWithin(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`)
}

function isMissing(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'ENOENT'
}

async function lstatIfPresent(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path)
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}
