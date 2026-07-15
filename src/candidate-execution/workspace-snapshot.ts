import type {
  AgentCandidateWorkspaceManifestMaterial,
  AgentCandidateWorkspaceSnapshotEvidence,
} from '@tangle-network/agent-interface'
import {
  agentCandidateWorkspaceManifestMaterialSchema,
  agentCandidateWorkspaceSnapshotEvidenceSchema,
} from '@tangle-network/agent-interface'

import {
  canonicalCandidateBytes,
  embeddedCandidateArtifact,
  immutableCandidateValue,
  sha256Bytes,
} from './digest'
import { persistCandidateOutputArtifact } from './output-artifacts'
import type { AgentCandidateOutputArtifactPort } from './types'

export interface ProvisionalCandidateWorkspaceSnapshot {
  readonly material: AgentCandidateWorkspaceManifestMaterial
  readonly manifestBytes: Uint8Array
  readonly snapshot: AgentCandidateWorkspaceSnapshotEvidence
}

/**
 * Build materialization-only evidence without parsing a large base64 field.
 * Every field is evaluator-derived, and callers must not persist or expose this
 * provisional value as receipt evidence.
 */
export function provisionalCandidateWorkspaceSnapshot(
  materialInput: AgentCandidateWorkspaceManifestMaterial,
  archive: Uint8Array,
): ProvisionalCandidateWorkspaceSnapshot {
  const material = immutableCandidateValue(
    agentCandidateWorkspaceManifestMaterialSchema.parse(materialInput),
  )
  const manifestBytes = canonicalCandidateBytes(material)
  const snapshot: AgentCandidateWorkspaceSnapshotEvidence = Object.freeze({
    schemaVersion: 2,
    kind: 'agent-candidate-workspace-snapshot',
    digest: sha256Bytes(manifestBytes),
    material,
    manifest: Object.freeze(embeddedCandidateArtifact(manifestBytes)),
    archive: Object.freeze(embeddedCandidateArtifact(archive)),
  })
  return Object.freeze({ material, manifestBytes, snapshot })
}

/** Persist verified workspace bytes and construct final reference-only evidence. */
export async function persistCandidateWorkspaceSnapshot(
  port: AgentCandidateOutputArtifactPort,
  input: {
    executionId: string
    material: AgentCandidateWorkspaceManifestMaterial
    archive: Uint8Array
    purpose: 'task' | 'memory-after'
    signal?: AbortSignal
  },
): Promise<AgentCandidateWorkspaceSnapshotEvidence> {
  input.signal?.throwIfAborted()
  const material = immutableCandidateValue(input.material)
  const manifestBytes = canonicalCandidateBytes(material)
  const [manifest, archive] = await Promise.all([
    persistCandidateOutputArtifact(port, {
      executionId: input.executionId,
      purpose: input.purpose === 'task' ? 'task-manifest' : 'memory-after-manifest',
      bytes: manifestBytes,
      ...(input.signal ? { signal: input.signal } : {}),
    }),
    persistCandidateOutputArtifact(port, {
      executionId: input.executionId,
      purpose: input.purpose === 'task' ? 'task-archive' : 'memory-after-archive',
      bytes: input.archive,
      ...(input.signal ? { signal: input.signal } : {}),
    }),
  ])
  return immutableCandidateValue(
    agentCandidateWorkspaceSnapshotEvidenceSchema.parse({
      schemaVersion: 2,
      kind: 'agent-candidate-workspace-snapshot',
      digest: sha256Bytes(manifestBytes),
      material,
      manifest,
      archive,
    }),
  )
}
