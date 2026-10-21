import { lstat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import {
  type AgentCandidateArtifactRef,
  type AgentCandidateWorkspaceSnapshotEvidence,
  agentCandidateArtifactRefSchema,
  agentCandidateWorkspaceManifestMaterialSchema,
  agentCandidateWorkspaceSnapshotEvidenceSchema,
} from '@tangle-network/agent-interface'
import { verifiedArtifactChunks } from './artifact-streams'
import { canonicalCandidateBytes, deepFreezeCandidate } from './digest'
import type { AgentCandidateArtifactPort } from './types'
import { type AgentCandidateWorkspaceArchiveLimits, workspaceLimits } from './workspace-archive'
import {
  type CaptureAgentCandidateWorkspaceOptions,
  captureAgentCandidateWorkspace,
  createAgentCandidateWorkspacePort,
} from './workspace-archive-local'

/** The canonical workspace evidence without manifest material or embedded file bytes. */
export type AgentCandidateWorkspaceSnapshotReferences = Pick<
  AgentCandidateWorkspaceSnapshotEvidence,
  'kind' | 'digest'
> & {
  readonly manifest: AgentCandidateArtifactRef
  readonly archive: AgentCandidateArtifactRef
}

export type CaptureAgentWorkspaceSnapshotOptions = Omit<
  CaptureAgentCandidateWorkspaceOptions,
  'artifactPersistence'
> & {
  artifactPersistence: NonNullable<CaptureAgentCandidateWorkspaceOptions['artifactPersistence']>
}

/**
 * Capture through the canonical archive owner and return references only.
 * The caller holds its existing private source workspace lease throughout capture, and binds
 * its public source provenance at the SDK boundary. Choose includeRepository and working-tree
 * explicitly when staged, dirty, deleted and unignored untracked Git files must travel.
 */
export async function captureAgentWorkspaceSnapshot(
  root: string,
  options: CaptureAgentWorkspaceSnapshotOptions,
): Promise<AgentCandidateWorkspaceSnapshotReferences> {
  if (!options?.artifactPersistence) {
    throw new Error('portable workspace capture requires artifactPersistence')
  }
  const captured = await captureAgentCandidateWorkspace(root, {
    ...options,
    ...(options.limits ? { limits: { ...options.limits } } : {}),
    artifactPersistence: { ...options.artifactPersistence },
  })
  return workspaceReferences(captured.snapshot)
}

export interface MaterializeAgentWorkspaceSnapshotOptions {
  snapshot: AgentCandidateWorkspaceSnapshotReferences
  /** Authorizes each immutable reference for the accepted transfer owner; must stream reads. */
  artifacts: AgentCandidateArtifactPort
  /** Absent destination inside a caller-owned private allocation scope. */
  destination: string
  limits?: Partial<AgentCandidateWorkspaceArchiveLimits>
  signal?: AbortSignal
}

/**
 * Restore canonical workspace references before an agent starts.
 * The SDK boundary validates source provenance and the accepted snapshot digest before this
 * byte-level composition runs. Artifact references identify content; the injected port owns
 * authorization. The archive owner verifies all files and Git state before publishing fresh
 * staging. Destinations present before or during artifact reads are refused. The caller owns
 * the allocation scope against other writers; Node directory rename is not atomic no-replace.
 */
export async function materializeAgentWorkspaceSnapshot(
  input: MaterializeAgentWorkspaceSnapshotOptions,
): Promise<void> {
  input.signal?.throwIfAborted()
  const snapshot = workspaceReferences(input.snapshot)
  const limits = workspaceLimits(input.limits)
  if (!input.artifacts.readStream) {
    throw new Error('portable workspace restore requires an authorized readStream')
  }
  if (!isAbsolute(input.destination)) {
    throw new Error('portable workspace destination must be absolute')
  }
  const destination = resolve(input.destination)
  await assertAbsentDestination(destination)
  for (const artifact of [snapshot.manifest, snapshot.archive]) {
    if (artifact.byteLength > limits.maxArchiveBytes) {
      throw new Error('portable workspace artifact exceeds maxArchiveBytes')
    }
  }
  const manifest = await readArtifact(snapshot.manifest, input.artifacts, input.signal)
  const material = agentCandidateWorkspaceManifestMaterialSchema.parse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifest)),
  )
  if (!Buffer.from(canonicalCandidateBytes(material)).equals(manifest)) {
    throw new Error('workspace manifest artifact is not the exact canonical manifest material')
  }
  const evidence = agentCandidateWorkspaceSnapshotEvidenceSchema.parse({ ...snapshot, material })
  const archive = await readArtifact(snapshot.archive, input.artifacts, input.signal)
  input.signal?.throwIfAborted()
  // The artifact resolver may await remote storage. A destination that appeared while waiting
  // belongs to its creator, even when it is empty.
  await assertAbsentDestination(destination)
  input.signal?.throwIfAborted()
  await createAgentCandidateWorkspacePort({ limits }).materialize({
    role: 'task',
    snapshot: evidence,
    archive,
    destination,
    ...(input.signal ? { signal: input.signal } : {}),
  })
}

function workspaceReferences(
  snapshot: Pick<
    AgentCandidateWorkspaceSnapshotEvidence,
    'kind' | 'digest' | 'manifest' | 'archive'
  >,
): AgentCandidateWorkspaceSnapshotReferences {
  if (snapshot.kind !== 'agent-candidate-workspace-snapshot') {
    throw new Error('portable workspace snapshot kind is invalid')
  }
  const manifest = agentCandidateArtifactRefSchema.parse(snapshot.manifest)
  const archive = agentCandidateArtifactRefSchema.parse(snapshot.archive)
  for (const artifact of [manifest, archive]) {
    if (!Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 1) {
      throw new Error('portable workspace artifacts require positive safe byte lengths')
    }
  }
  if (snapshot.digest !== manifest.sha256) {
    throw new Error('workspace digest must equal the canonical manifest hash')
  }
  return deepFreezeCandidate({ kind: snapshot.kind, digest: snapshot.digest, manifest, archive })
}

async function readArtifact(
  reference: AgentCandidateArtifactRef,
  artifacts: AgentCandidateArtifactPort,
  signal?: AbortSignal,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of verifiedArtifactChunks(reference, artifacts, signal)) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function assertAbsentDestination(destination: string): Promise<void> {
  try {
    await lstat(destination)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  throw new Error('portable workspace destination already exists')
}
