import { constants as fsConstants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

import type {
  AgentCandidateArtifactRef,
  AgentCandidateCapturedArtifact,
  AgentCandidateProfilePlanMaterial,
  AgentCandidateWorkspaceManifestMaterial,
  AgentCandidateWorkspaceSnapshotEvidence,
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

export async function verifyMaterializedWorkspace(
  root: string,
  expected: AgentCandidateWorkspaceManifestMaterial,
  options: { ignoredProtectedRootEntries?: readonly ('.git' | '.sidecar')[] } = {},
): Promise<void> {
  const observed = await scanWorkspace(root, new Set(options.ignoredProtectedRootEntries ?? []))
  assertWorkspaceManifest(observed.manifest, expected)
}

export async function captureMaterializedWorkspace(
  root: string,
  options: {
    ignoredProtectedRootEntries?: readonly ('.git' | '.sidecar')[]
    limits?: {
      maxFiles: number
      maxFileBytes: number
      maxTotalFileBytes: number
    }
  } = {},
): Promise<{
  manifest: AgentCandidateWorkspaceManifestMaterial
  files: ReadonlyArray<{ path: string; mode: number; bytes: Uint8Array }>
}> {
  const observed = await scanWorkspace(
    root,
    new Set(options.ignoredProtectedRootEntries ?? []),
    options.limits,
  )
  return {
    manifest: observed.manifest,
    files: observed.files.map((file) => ({
      path: file.path,
      mode: file.mode,
      bytes: Uint8Array.from(file.bytes),
    })),
  }
}

/** Capture exact verified regular-file bytes for fresh isolated materialization. */
export async function readMaterializedWorkspaceFiles(
  root: string,
  expected: AgentCandidateWorkspaceManifestMaterial,
  options: { ignoredProtectedRootEntries?: readonly ('.git' | '.sidecar')[] } = {},
): Promise<ReadonlyArray<{ path: string; mode: number; bytes: Uint8Array }>> {
  const observed = await captureMaterializedWorkspace(root, options)
  assertWorkspaceManifest(observed.manifest, expected)
  return observed.files.map((file) =>
    Object.freeze({ path: file.path, mode: file.mode, bytes: Uint8Array.from(file.bytes) }),
  )
}

export function candidateWorkspaceManifest(
  files: ReadonlyArray<{ path: string; mode: number; bytes: Uint8Array }>,
): AgentCandidateWorkspaceManifestMaterial {
  return {
    kind: 'agent-candidate-workspace-manifest',
    files: files
      .map((file) => ({
        path: file.path,
        mode: file.mode,
        sha256: sha256Bytes(file.bytes),
        byteLength: file.bytes.byteLength,
      }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  }
}

function assertWorkspaceManifest(
  observed: AgentCandidateWorkspaceManifestMaterial,
  expected: AgentCandidateWorkspaceManifestMaterial,
): void {
  if (!Buffer.from(canonicalCandidateBytes(observed)).equals(canonicalCandidateBytes(expected))) {
    throw new Error(
      'materialized workspace files, modes, or bytes do not match the signed manifest',
    )
  }
}

export async function verifyMaterializedProfileWorkspace(
  root: string,
  expected: AgentCandidateProfilePlanMaterial,
): Promise<void> {
  const observed = await scanWorkspace(root, new Set())
  const observedProfile = observed.manifest.files.map(({ path, mode, sha256 }) => ({
    relPath: path,
    mode,
    contentSha256: sha256,
  }))
  if (
    !Buffer.from(canonicalCandidateBytes(observedProfile)).equals(
      canonicalCandidateBytes(expected.files),
    )
  ) {
    throw new Error('profile staging files, modes, or bytes do not match the signed profile plan')
  }
}

async function scanWorkspace(
  root: string,
  ignoredProtectedRootEntries: ReadonlySet<string>,
  limits?: {
    maxFiles: number
    maxFileBytes: number
    maxTotalFileBytes: number
  },
): Promise<{
  manifest: AgentCandidateWorkspaceManifestMaterial
  files: Array<{ path: string; mode: number; bytes: Uint8Array }>
}> {
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
  const capturedFiles: Array<{ path: string; mode: number; bytes: Uint8Array }> = []
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
        throw new Error(`workspace contains a symlink: ${relPath}`)
      }
      if (stats.isDirectory()) {
        await visit(absolute)
        continue
      }
      if (!stats.isFile()) {
        throw new Error(`workspace contains a non-regular entry: ${relPath}`)
      }
      if (limits && capturedFiles.length >= limits.maxFiles) {
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
        const mode = openedStats.mode & 0o777
        if (limits && openedStats.size > limits.maxFileBytes) {
          throw new Error(`workspace file exceeds maxFileBytes: ${relPath}`)
        }
        const remainingBytes = limits ? limits.maxTotalFileBytes - totalBytes : undefined
        if (remainingBytes !== undefined && openedStats.size > remainingBytes) {
          throw new Error('workspace exceeds maxTotalFileBytes')
        }
        const bytes = await readBoundedFile(
          descriptor,
          limits ? Math.min(limits.maxFileBytes, remainingBytes ?? limits.maxFileBytes) : undefined,
          relPath,
        )
        totalBytes += bytes.byteLength
        capturedFiles.push({ path: relPath, mode, bytes: Uint8Array.from(bytes) })
      } finally {
        await descriptor.close()
      }
    }
  }

  await visit(absoluteRoot)
  return {
    manifest: candidateWorkspaceManifest(capturedFiles),
    files: capturedFiles,
  }
}

async function readBoundedFile(
  descriptor: Awaited<ReturnType<typeof open>>,
  maxBytes: number | undefined,
  path: string,
): Promise<Buffer> {
  if (maxBytes === undefined) return await descriptor.readFile()
  const chunks: Buffer[] = []
  let total = 0
  while (true) {
    const remaining = maxBytes - total
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining + 1))
    const { bytesRead } = await descriptor.read(chunk, 0, chunk.byteLength, null)
    if (bytesRead === 0) break
    total += bytesRead
    if (total > maxBytes) throw new Error(`workspace file exceeds its capture limit: ${path}`)
    chunks.push(chunk.subarray(0, bytesRead))
  }
  return Buffer.concat(chunks, total)
}
