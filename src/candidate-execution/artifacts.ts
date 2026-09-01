import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { lstat, open, readdir, readlink, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import type {
  AgentCandidateArtifactRef,
  AgentCandidateCapturedArtifact,
  AgentCandidateProfilePlanMaterial,
  AgentCandidateWorkspaceManifestMaterial,
  AgentCandidateWorkspaceSnapshotEvidence,
  Sha256Digest,
} from '@tangle-network/agent-interface'

import { canonicalCandidateBytes, sha256Bytes } from './digest'
import type { AgentCandidateArtifactPort } from './types'

export function artifactCacheKey(artifact: AgentCandidateCapturedArtifact): string {
  return `${artifact.sha256}:${artifact.byteLength}`
}

export async function readVerifiedArtifact(
  artifact: AgentCandidateCapturedArtifact,
  port: AgentCandidateArtifactPort,
): Promise<Uint8Array> {
  const bytes =
    'content' in artifact
      ? Buffer.from(artifact.content, 'base64')
      : await port.read(artifact as AgentCandidateArtifactRef)
  verifyBytes(bytes, artifact.sha256, artifact.byteLength, 'candidate artifact')
  return Uint8Array.from(bytes)
}

export function verifyBytes(
  bytes: Uint8Array,
  digest: string,
  byteLength: number,
  label: string,
): void {
  if (bytes.byteLength !== byteLength) {
    throw new Error(`${label} byte length ${bytes.byteLength} does not match ${byteLength}`)
  }
  const actual = sha256Bytes(bytes)
  if (actual !== digest) {
    throw new Error(`${label} digest ${actual} does not match ${digest}`)
  }
}

export async function verifyWorkspaceSnapshotArtifacts(
  snapshot: AgentCandidateWorkspaceSnapshotEvidence,
  port: AgentCandidateArtifactPort,
): Promise<{ manifest: Uint8Array; archive: Uint8Array }> {
  const [manifest, archive] = await Promise.all([
    readVerifiedArtifact(snapshot.manifest, port),
    readVerifiedArtifact(snapshot.archive, port),
  ])
  const canonicalManifest = canonicalCandidateBytes(snapshot.material)
  if (!Buffer.from(manifest).equals(Buffer.from(canonicalManifest))) {
    throw new Error('workspace manifest artifact is not the exact canonical manifest material')
  }
  if (sha256Bytes(canonicalManifest) !== snapshot.digest) {
    throw new Error('workspace snapshot digest does not match its canonical manifest material')
  }
  return { manifest, archive }
}

/** The per-scan caps a bounded capture applies. */
export interface WorkspaceScanLimits {
  readonly maxFiles: number
  readonly maxFileBytes: number
  readonly maxTotalFileBytes: number
}

/** What a workspace scan reads and how it records a file's permission bits. */
export interface WorkspaceScanOptions {
  readonly ignoredProtectedRootEntries?: readonly ('.git' | '.sidecar')[]
  readonly limits?: WorkspaceScanLimits
  /**
   * Record Git's two file modes instead of the filesystem's exact permission bits: `0o755` when
   * any execute bit is set, `0o644` otherwise. A checkout umask then cannot move a manifest
   * digest, while a real permission change still does.
   *
   * This is the normalization `readCandidateGitTreeFiles` already applies to a Git tree
   * (`100644`/`100755`), so one tree scanned from disk and the same tree read out of Git produce
   * the same manifest. Off by default: the flag changes the digest, so a capture and the verify
   * that checks it must agree on it.
   */
  readonly portableTree?: boolean
}

export async function verifyMaterializedWorkspace(
  root: string,
  expected: AgentCandidateWorkspaceManifestMaterial,
  options: Omit<WorkspaceScanOptions, 'limits'> = {},
): Promise<void> {
  assertWorkspaceManifest(await scanMaterializedWorkspaceManifest(root, options), expected)
}

/**
 * The canonical manifest of one materialized workspace, read without holding any file.
 *
 * Every file is digested by streaming, so the size of the largest file does not decide whether the
 * workspace can be described. `FileHandle.readFile` refuses anything above 2 GiB with
 * `ERR_FS_FILE_TOO_LARGE`, which made a workspace holding one such artifact impossible to verify
 * against a manifest it already matched. The digest is sha-256 over the same bytes either way, so
 * a manifest a buffered read produced is reproduced exactly.
 */
export async function scanMaterializedWorkspaceManifest(
  root: string,
  options: WorkspaceScanOptions = {},
): Promise<AgentCandidateWorkspaceManifestMaterial> {
  return workspaceManifestFromEntries(await walkWorkspace(root, options, false))
}

export async function captureMaterializedWorkspace(
  root: string,
  options: WorkspaceScanOptions = {},
): Promise<{
  manifest: AgentCandidateWorkspaceManifestMaterial
  files: ReadonlyArray<{ path: string; mode: number; bytes: Uint8Array }>
}> {
  const entries = await walkWorkspace(root, options, true)
  return {
    manifest: workspaceManifestFromEntries(entries),
    files: entries.map((entry) => ({
      path: entry.path,
      mode: entry.mode,
      bytes: Uint8Array.from(capturedBytes(entry)),
    })),
  }
}

/** Capture exact verified regular-file bytes for fresh isolated materialization. */
export async function readMaterializedWorkspaceFiles(
  root: string,
  expected: AgentCandidateWorkspaceManifestMaterial,
  options: WorkspaceScanOptions = {},
): Promise<ReadonlyArray<{ path: string; mode: number; bytes: Uint8Array }>> {
  const observed = await captureMaterializedWorkspace(root, options)
  assertWorkspaceManifest(observed.manifest, expected)
  return observed.files.map((file) =>
    Object.freeze({ path: file.path, mode: file.mode, bytes: Uint8Array.from(file.bytes) }),
  )
}

export function candidateWorkspaceManifest(
  files: ReadonlyArray<{ path: string; mode: number; bytes: Uint8Array }>,
  options: { portableTree?: boolean } = {},
): AgentCandidateWorkspaceManifestMaterial {
  return workspaceManifestFromEntries(
    files.map((file) => ({
      path: file.path,
      mode: options.portableTree === true ? portableFileMode(file.mode) : file.mode,
      sha256: sha256Bytes(file.bytes),
      byteLength: file.bytes.byteLength,
    })),
  )
}

function workspaceManifestFromEntries(
  entries: ReadonlyArray<{
    path: string
    mode: number
    sha256: Sha256Digest
    byteLength: number
  }>,
): AgentCandidateWorkspaceManifestMaterial {
  return {
    kind: 'agent-candidate-workspace-manifest',
    files: entries
      .map((entry) => ({
        path: entry.path,
        mode: entry.mode,
        sha256: entry.sha256,
        byteLength: entry.byteLength,
      }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  }
}

/** Git records exactly two file modes, and a portable-tree scan records the same two. */
function portableFileMode(mode: number): number {
  return (mode & 0o111) !== 0 ? 0o755 : 0o644
}

function capturedBytes(entry: ScannedWorkspaceEntry): Buffer {
  if (!entry.bytes) throw new Error(`workspace file was digested without its bytes: ${entry.path}`)
  return entry.bytes
}

function assertWorkspaceManifest(
  observed: AgentCandidateWorkspaceManifestMaterial,
  expected: AgentCandidateWorkspaceManifestMaterial,
): void {
  if (Buffer.from(canonicalCandidateBytes(observed)).equals(canonicalCandidateBytes(expected))) {
    return
  }
  // The one mismatch a caller can produce by passing `portableTree` on one side of a
  // capture/verify pair and not the other. Named, because the general refusal below reads as
  // changed bytes and would send a reader looking for a file that never changed. Comparing the
  // two manifests already in hand costs no second walk.
  if (
    Buffer.from(canonicalCandidateBytes(withPortableModes(observed))).equals(
      canonicalCandidateBytes(withPortableModes(expected)),
    )
  ) {
    throw new Error(
      'materialized workspace files do not match the signed manifest: only the file modes differ, ' +
        'so the capture and this verify disagree about portableTree',
    )
  }
  throw new Error('materialized workspace files, modes, or bytes do not match the signed manifest')
}

function withPortableModes(
  material: AgentCandidateWorkspaceManifestMaterial,
): AgentCandidateWorkspaceManifestMaterial {
  return {
    ...material,
    files: material.files.map((file) => ({ ...file, mode: portableFileMode(file.mode) })),
  }
}

export async function verifyMaterializedProfileWorkspace(
  root: string,
  expected: AgentCandidateProfilePlanMaterial,
  fileRoot: 'workspace' | 'agent' = 'workspace',
): Promise<void> {
  const observed = await scanMaterializedWorkspaceManifest(root)
  const observedProfile = observed.files.map(({ path, mode, sha256 }) => ({
    relPath: path,
    mode,
    contentSha256: sha256,
  }))
  const expectedFiles = expected.files
    .filter((file) => (file.root ?? 'workspace') === fileRoot)
    .map(({ root: _root, ...file }) => file)
  if (
    !Buffer.from(canonicalCandidateBytes(observedProfile)).equals(
      canonicalCandidateBytes(expectedFiles),
    )
  ) {
    throw new Error(
      `profile ${fileRoot} staging files, modes, or bytes do not match the signed profile plan`,
    )
  }
}

interface ScannedWorkspaceEntry {
  readonly path: string
  readonly mode: number
  readonly sha256: Sha256Digest
  readonly byteLength: number
  /** Present only when the walk was asked to keep bytes. */
  readonly bytes?: Buffer
}

async function walkWorkspace(
  root: string,
  options: WorkspaceScanOptions,
  keepBytes: boolean,
): Promise<ScannedWorkspaceEntry[]> {
  const ignoredProtectedRootEntries = new Set<string>(options.ignoredProtectedRootEntries ?? [])
  const limits = options.limits
  // Scan the RESOLVED root. The property this guards is that every captured path lies under
  // one real directory with no aliasing, which resolving satisfies directly — rejecting a
  // symlinked prefix outright does not, and makes the scan impossible on macOS, where the
  // OS itself hands out temp paths under /var, a symlink to /private/var. Symlinks INSIDE
  // the workspace are still refused entry by entry below, with O_NOFOLLOW on every open.
  const requestedRoot = resolve(root)
  const rootStats = await lstat(requestedRoot)
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error('workspace root must be a real directory')
  }
  const absoluteRoot = await realpath(requestedRoot)
  const resolvedStats = await lstat(absoluteRoot)
  if (!resolvedStats.isDirectory() || resolvedStats.isSymbolicLink()) {
    throw new Error('workspace root must resolve to a real directory')
  }
  const scanned: ScannedWorkspaceEntry[] = []
  let totalBytes = 0

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (directory === absoluteRoot && ignoredProtectedRootEntries.has(entry.name)) {
        continue
      }
      const absolute = resolve(directory, entry.name)
      const relPath = relative(absoluteRoot, absolute).split(sep).join('/')
      if (!relPath || relPath.startsWith('../') || relPath.includes('/../')) {
        throw new Error(`workspace entry escapes root: ${relPath}`)
      }
      const stats = await lstat(absolute)
      if (stats.isSymbolicLink()) {
        throw new Error(await symlinkRefusal(absolute, relPath, absoluteRoot))
      }
      if (stats.isDirectory()) {
        await visit(absolute)
        continue
      }
      if (!stats.isFile()) {
        throw new Error(`workspace contains a non-regular entry: ${relPath}`)
      }
      if (limits && scanned.length >= limits.maxFiles) {
        throw new Error('workspace exceeds maxFiles')
      }
      const descriptor = await open(
        absolute,
        fsConstants.O_RDONLY |
          (typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0),
      )
      try {
        const openedStats = await descriptor.stat()
        if (!openedStats.isFile()) {
          throw new Error(`workspace contains a non-regular entry: ${relPath}`)
        }
        if (openedStats.nlink !== 1) {
          throw new Error(`workspace contains a hard-linked file: ${relPath}`)
        }
        const mode =
          options.portableTree === true
            ? portableFileMode(openedStats.mode)
            : openedStats.mode & 0o777
        if (limits && openedStats.size > limits.maxFileBytes) {
          throw new Error(`workspace file exceeds maxFileBytes: ${relPath}`)
        }
        const remainingBytes = limits ? limits.maxTotalFileBytes - totalBytes : undefined
        if (remainingBytes !== undefined && openedStats.size > remainingBytes) {
          throw new Error('workspace exceeds maxTotalFileBytes')
        }
        const read = await readWorkspaceFile(
          descriptor,
          limits ? Math.min(limits.maxFileBytes, remainingBytes ?? limits.maxFileBytes) : undefined,
          keepBytes,
          relPath,
        )
        totalBytes += read.byteLength
        scanned.push({
          path: relPath,
          mode,
          sha256: read.sha256,
          byteLength: read.byteLength,
          ...(read.bytes === undefined ? {} : { bytes: read.bytes }),
        })
      } finally {
        await descriptor.close()
      }
    }
  }

  await visit(absoluteRoot)
  return scanned
}

/**
 * Why one symbolic link is refused, in the terms that separate a portable link from a link that
 * reaches outside the tree.
 *
 * Every link is refused, in both mode policies. `AgentCandidateWorkspaceManifestMaterial` has no
 * representation for one — `mode`, `sha256` and `byteLength` describe a regular file — so a link
 * recorded as a file would let two different trees share one digest. The reason says which kind of
 * link it was, so a caller can tell a link it can rewrite from one it cannot.
 */
async function symlinkRefusal(
  absolute: string,
  relPath: string,
  absoluteRoot: string,
): Promise<string> {
  const target = await readlink(absolute)
  if (isAbsolute(target)) {
    return `workspace contains an absolute symlink: ${relPath} -> ${target}`
  }
  if (!isWithin(absoluteRoot, resolve(dirname(absolute), target))) {
    return `workspace contains a symlink that escapes its tree: ${relPath} -> ${target}`
  }
  let physical: string
  try {
    physical = await realpath(absolute)
  } catch {
    return `workspace contains an unresolved symlink: ${relPath} -> ${target}`
  }
  if (!isWithin(absoluteRoot, physical)) {
    return `workspace contains a symlink that resolves outside its tree: ${relPath} -> ${target}`
  }
  return `workspace contains a symlink: ${relPath} -> ${target}`
}

function isWithin(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`)
}

/**
 * Read one open regular file into its digest, keeping the bytes only when the caller needs them.
 *
 * The content reaches the hash in 1 MiB chunks and is never held whole for a digest-only walk, so
 * the size of the largest file does not decide whether a workspace can be described.
 * `FileHandle.readFile` refuses anything above 2 GiB with `ERR_FS_FILE_TOO_LARGE`. Hashing the
 * chunks in order equals hashing the whole buffer, so a manifest a buffered read produced is
 * reproduced byte for byte.
 */
async function readWorkspaceFile(
  descriptor: Awaited<ReturnType<typeof open>>,
  maxBytes: number | undefined,
  keepBytes: boolean,
  path: string,
): Promise<{ sha256: Sha256Digest; byteLength: number; bytes?: Buffer }> {
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  const chunks: Buffer[] = []
  let total = 0
  while (true) {
    const { bytesRead } = await descriptor.read(buffer, 0, buffer.byteLength, null)
    if (bytesRead === 0) break
    total += bytesRead
    if (maxBytes !== undefined && total > maxBytes) {
      throw new Error(`workspace file exceeds its capture limit: ${path}`)
    }
    const chunk = buffer.subarray(0, bytesRead)
    hash.update(chunk)
    // The read buffer is reused, so a kept chunk has to be copied out of it.
    if (keepBytes) chunks.push(Buffer.from(chunk))
  }
  const sha256 = `sha256:${hash.digest('hex')}` as Sha256Digest
  return keepBytes
    ? { sha256, byteLength: total, bytes: Buffer.concat(chunks, total) }
    : { sha256, byteLength: total }
}
