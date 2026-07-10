import { constants as fsConstants } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

import type {
  AgentCandidateArtifactRef,
  AgentCandidateCapturedArtifact,
  AgentCandidateProfilePlanMaterialV1,
  AgentCandidateWorkspaceManifestMaterialV1,
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
  expected: AgentCandidateWorkspaceManifestMaterialV1,
  options: { ignoredProtectedRootEntries?: readonly ('.git' | '.sidecar')[] } = {},
): Promise<void> {
  const observed = await scanWorkspace(root, new Set(options.ignoredProtectedRootEntries ?? []))
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error(
      'materialized workspace files, modes, or bytes do not match the signed manifest',
    )
  }
}

export async function verifyMaterializedProfileWorkspace(
  root: string,
  expected: AgentCandidateProfilePlanMaterialV1,
): Promise<void> {
  const observed = await scanWorkspace(root, new Set())
  const observedProfile = observed.files.map(({ path, mode, sha256 }) => ({
    relPath: path,
    mode,
    contentSha256: sha256,
  }))
  if (JSON.stringify(observedProfile) !== JSON.stringify(expected.files)) {
    throw new Error('profile staging files, modes, or bytes do not match the signed profile plan')
  }
}

async function scanWorkspace(
  root: string,
  ignoredProtectedRootEntries: ReadonlySet<string>,
): Promise<AgentCandidateWorkspaceManifestMaterialV1> {
  const absoluteRoot = resolve(root)
  const rootStats = await lstat(absoluteRoot)
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error('workspace root must be a real directory')
  }
  const files: AgentCandidateWorkspaceManifestMaterialV1['files'] = []

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
        if (mode !== 0o644 && mode !== 0o755) {
          throw new Error(`workspace file has unsupported mode ${mode.toString(8)}: ${relPath}`)
        }
        const bytes = await descriptor.readFile()
        files.push({
          path: relPath,
          mode,
          sha256: sha256Bytes(bytes),
          byteLength: bytes.byteLength,
        })
      } finally {
        await descriptor.close()
      }
    }
  }

  await visit(absoluteRoot)
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return {
    schemaVersion: 1,
    kind: 'agent-candidate-workspace-manifest',
    files,
  }
}
