import type {
  AgentCandidateArtifactRef,
  AgentCandidateCapturedArtifact,
  AgentCandidateProfilePlanMaterial,
  AgentCandidateWorkspaceManifestMaterial,
  AgentCandidateWorkspaceSnapshotEvidence,
} from '@tangle-network/agent-interface'
import { captureFilesystemTree } from '../filesystem-snapshot'
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
  const observed = await captureFilesystemTree(root, {
    label: 'workspace',
    excludedRootEntries: ignoredProtectedRootEntries,
    includeDirectories: false,
    symlinks: 'reject',
    hardlinks: 'reject',
    limits: limits
      ? { ...limits, maxPathBytes: Number.MAX_SAFE_INTEGER }
      : {
          maxFiles: Number.MAX_SAFE_INTEGER,
          maxFileBytes: Number.MAX_SAFE_INTEGER,
          maxTotalFileBytes: Number.MAX_SAFE_INTEGER,
          maxPathBytes: Number.MAX_SAFE_INTEGER,
        },
  })
  const capturedFiles = observed.entries
    .filter((entry) => entry.kind === 'file')
    .map((entry) => ({ path: entry.path, mode: entry.mode, bytes: entry.bytes }))
  return {
    manifest: candidateWorkspaceManifest(capturedFiles),
    files: capturedFiles,
  }
}
