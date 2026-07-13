import type {
  AgentCandidateBundle,
  AgentCandidateCapturedArtifact,
  AgentCandidateResourceRef,
  Sha256Digest,
} from '@tangle-network/agent-interface'
import { agentCandidateBundleSchema } from '@tangle-network/agent-interface'

import {
  artifactCacheKey,
  readVerifiedArtifact,
  verifyBytes,
  verifyWorkspaceSnapshotArtifacts,
} from './artifacts'
import {
  canonicalCandidateBytes,
  canonicalCandidateDigest,
  deepFreezeCandidate,
  omitTopLevelDigest,
} from './digest'
import { readCandidateGitHubResource, verifyCandidateCode } from './git-materialize'
import { assertCandidateProfileExecutionSupport } from './profile'
import {
  type AgentCandidateVerificationPorts,
  type VerifiedAgentCandidate,
  verifiedCandidateBrand,
} from './types'

interface VerifiedCandidateState {
  ports: AgentCandidateVerificationPorts
  artifactBytes: Map<string, Uint8Array>
  resourceBytes: Map<string, Uint8Array>
}

const verifiedCandidateState = new WeakMap<VerifiedAgentCandidate, VerifiedCandidateState>()

/** Surfaces admitted by Runtime's verifier before an environment adapter is selected. */
export const AGENT_CANDIDATE_EXECUTION_SUPPORT = Object.freeze({
  outcomes: Object.freeze(['workspace', 'output'] as const),
  code: Object.freeze(['disabled', 'no-op', 'git-patch'] as const),
  memory: Object.freeze(['disabled', 'isolated'] as const),
  knowledge: false,
  profile: Object.freeze({
    mcpTransports: Object.freeze(['stdio'] as const),
    remoteMcp: false,
    tools: false,
    permissions: false,
    modes: false,
    confidential: false,
  }),
})

/** Verifies every digest, resource, workspace, and Git object in a candidate bundle. */
export async function verifyAgentCandidateBundle(
  input: unknown,
  ports: AgentCandidateVerificationPorts,
): Promise<VerifiedAgentCandidate> {
  const parsed = agentCandidateBundleSchema.parse(input)
  const withoutDigest = omitTopLevelDigest(parsed)
  const actualDigest = canonicalCandidateDigest(withoutDigest)
  if (actualDigest !== parsed.digest) {
    throw new Error(`candidate bundle digest ${parsed.digest} does not match ${actualDigest}`)
  }
  const canonicalBytes = canonicalCandidateBytes(withoutDigest)
  verifyBytes(canonicalBytes, parsed.digest, canonicalBytes.byteLength, 'candidate bundle')
  assertCandidateProfileExecutionSupport(parsed.profile)
  if (parsed.knowledge) {
    throw new Error(
      'candidate knowledge execution is unsupported; promote the approved exact candidate through agent-runtime/knowledge',
    )
  }

  const artifactBytes = new Map<string, Uint8Array>()
  const readArtifact = async (artifact: AgentCandidateCapturedArtifact): Promise<Uint8Array> => {
    const key = artifactCacheKey(artifact)
    const existing = artifactBytes.get(key)
    if (existing) return Uint8Array.from(existing)
    const bytes = await readVerifiedArtifact(artifact, ports.artifacts)
    artifactBytes.set(key, Uint8Array.from(bytes))
    return bytes
  }

  let patchBytes: Uint8Array | undefined
  if (parsed.code.kind === 'git-patch') {
    patchBytes = await readArtifact(parsed.code.patch.artifact)
  }
  const materializedTree = await verifyCandidateCode(parsed.code, ports.repositories, patchBytes)

  const resourceBytes = new Map<string, Uint8Array>()
  for (const resource of candidateResources(parsed)) {
    const bytes =
      resource.kind === 'inline'
        ? Buffer.from(resource.content, 'utf8')
        : await readCandidateGitHubResource(resource, ports.repositories)
    verifyBytes(
      bytes,
      resource.sha256,
      resource.byteLength,
      `candidate resource ${resource.name ?? (resource.kind === 'github' ? resource.path : '<unnamed>')}`,
    )
    resourceBytes.set(resourceKey(resource), Uint8Array.from(bytes))
    resourceBytes.set(resource.sha256, Uint8Array.from(bytes))
  }

  if (parsed.execution.workspace) {
    const workspace = await verifyWorkspaceSnapshotArtifacts(
      parsed.execution.workspace,
      ports.artifacts,
    )
    artifactBytes.set(artifactCacheKey(parsed.execution.workspace.manifest), workspace.manifest)
    artifactBytes.set(artifactCacheKey(parsed.execution.workspace.archive), workspace.archive)
  }
  if (parsed.memory.mode === 'isolated' && parsed.memory.seed)
    await readArtifact(parsed.memory.seed)

  deepFreezeCandidate(parsed)
  const verified = Object.freeze({
    bundle: parsed,
    ...(materializedTree === undefined ? {} : { materializedTree }),
    [verifiedCandidateBrand]: true as const,
  })
  verifiedCandidateState.set(verified, { ports, artifactBytes, resourceBytes })
  return verified
}

export function getVerifiedCandidateState(
  candidate: VerifiedAgentCandidate,
): VerifiedCandidateState {
  const state = verifiedCandidateState.get(candidate)
  if (!state || candidate[verifiedCandidateBrand] !== true) {
    throw new Error('candidate must come from verifyAgentCandidateBundle')
  }
  return state
}

export async function verifiedArtifactBytes(
  candidate: VerifiedAgentCandidate,
  artifact: AgentCandidateCapturedArtifact,
): Promise<Uint8Array> {
  const state = getVerifiedCandidateState(candidate)
  const key = artifactCacheKey(artifact)
  const existing = state.artifactBytes.get(key)
  if (existing) return Uint8Array.from(existing)
  const bytes = await readVerifiedArtifact(artifact, state.ports.artifacts)
  state.artifactBytes.set(key, Uint8Array.from(bytes))
  return bytes
}

export function verifiedResourceBytes(
  candidate: VerifiedAgentCandidate,
  resource: AgentCandidateResourceRef,
): Uint8Array {
  const bytes = getVerifiedCandidateState(candidate).resourceBytes.get(resourceKey(resource))
  if (!bytes) {
    throw new Error(
      `candidate resource was not verified: ${resource.name ?? (resource.kind === 'github' ? resource.path : '<unnamed>')}`,
    )
  }
  return Uint8Array.from(bytes)
}

export function verifiedResourceTextByDigest(
  candidate: VerifiedAgentCandidate,
): ReadonlyMap<Sha256Digest, string> {
  const output = new Map<Sha256Digest, string>()
  for (const resource of candidateResources(candidate.bundle)) {
    const bytes = getVerifiedCandidateState(candidate).resourceBytes.get(resource.sha256)
    if (!bytes) throw new Error(`candidate resource digest was not verified: ${resource.sha256}`)
    output.set(resource.sha256, new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  }
  return output
}

function candidateResources(bundle: AgentCandidateBundle): AgentCandidateResourceRef[] {
  const resources = bundle.profile.resources
  if (!resources) return []
  const output: AgentCandidateResourceRef[] = []
  for (const mount of resources.files ?? []) output.push(mount.resource)
  output.push(...(resources.tools ?? []))
  output.push(...(resources.skills ?? []))
  output.push(...(resources.agents ?? []))
  output.push(...(resources.commands ?? []))
  if (typeof resources.instructions === 'object') output.push(resources.instructions)
  return output
}

function resourceKey(resource: AgentCandidateResourceRef): string {
  return canonicalCandidateDigest(resource)
}
