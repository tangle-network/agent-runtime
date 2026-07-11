import type { CodeSurface } from '@tangle-network/agent-eval/campaign'
import { verifyCodeSurface } from '@tangle-network/agent-eval/campaign'
import type {
  AgentCandidateCodeDisabled,
  AgentCandidateCodeNoOp,
  AgentCandidateExecution,
  AgentCandidateGitHubRepository,
  AgentCandidateKnowledge,
  AgentCandidateLineage,
  AgentCandidateMemoryPolicy,
  AgentCandidateProfile,
  AgentProfile,
  AgentProfileDiff,
} from '@tangle-network/agent-interface'
import { agentProfileDiffSchema, applyAgentProfileDiff } from '@tangle-network/agent-interface'

import { type AgentCandidateBundleInput, sealAgentCandidateBundle } from './bundle'
import {
  canonicalCandidateBytes,
  canonicalCandidateDigest,
  embeddedCandidateArtifact,
} from './digest'
import {
  freezeGenericAgentCandidateProfile,
  parseExactAgentProfile,
  parseExactCandidateProfile,
} from './profile'

/** A complete profile that can be frozen without losing behavior. */
export type AgentCandidateProfileSource =
  | {
      kind: 'profile'
      profile: AgentProfile
    }
  | {
      kind: 'profile-diffs'
      base: AgentProfile
      /** Applied in order. Each exact diff is content-addressed into lineage. */
      diffs: readonly AgentProfileDiff[]
    }
  | {
      kind: 'candidate-profile'
      /** Already converted to the closed, secret-free candidate profile contract. */
      profile: AgentCandidateProfile
    }

/** The only accepted path from an agent-eval code candidate to executable bytes. */
export interface AgentCandidateCodeSurfaceSource {
  kind: 'code-surface'
  surface: CodeSurface
  repository: AgentCandidateGitHubRepository
  /** Optional parent directory used to resolve a relative `surface.worktreeRef`. */
  worktreeDir?: string
}

/** Explicit control/no-op code or one finalized CodeSurface whose bytes must still verify. */
export type AgentCandidateCodeSource =
  | AgentCandidateCodeDisabled
  | AgentCandidateCodeNoOp
  | AgentCandidateCodeSurfaceSource

/** Complete measured surfaces and execution policy compiled into one candidate bundle. */
export interface BuildAgentCandidateBundleInput {
  profile: AgentCandidateProfileSource
  code: AgentCandidateCodeSource
  execution: AgentCandidateExecution
  knowledge?: AgentCandidateKnowledge
  memory: AgentCandidateMemoryPolicy
  /** `profileDiffIds` is derived from `profile`; callers cannot contradict it. */
  lineage: Omit<AgentCandidateLineage, 'profileDiffIds'>
}

/**
 * Compile one measured profile/code candidate into the immutable execution
 * contract. Code bytes are re-read and verified by agent-eval before they are
 * embedded. The returned bundle is schema-validated, canonically digested, and
 * deeply immutable; call `verifyAgentCandidateBundle` at the execution boundary
 * to re-read external knowledge, memory, repository, and workspace artifacts.
 */
export function buildAgentCandidateBundle(
  input: BuildAgentCandidateBundleInput,
): ReturnType<typeof sealAgentCandidateBundle> {
  if (Object.hasOwn(input.lineage, 'profileDiffIds')) {
    throw new Error('profileDiffIds is derived from the profile source and cannot be supplied')
  }
  const compiledProfile = compileCandidateProfile(input.profile)
  const profileDiffIds = compiledProfile.profileDiffIds
  const bundle: AgentCandidateBundleInput = {
    schemaVersion: 1,
    kind: 'agent-candidate-bundle',
    digestAlgorithm: 'rfc8785-sha256',
    profile: compiledProfile.profile,
    code: compileCandidateCode(input.code),
    execution: input.execution,
    ...(input.knowledge ? { knowledge: input.knowledge } : {}),
    memory: input.memory,
    lineage: {
      ...input.lineage,
      ...(profileDiffIds.length > 0 ? { profileDiffIds } : {}),
    },
  }
  return sealAgentCandidateBundle(bundle)
}

function compileCandidateProfile(source: AgentCandidateProfileSource): {
  profile: AgentCandidateProfile
  profileDiffIds: string[]
} {
  if (source.kind === 'candidate-profile') {
    return {
      profile: parseExactCandidateProfile(source.profile),
      profileDiffIds: [],
    }
  }

  if (source.kind === 'profile') {
    return { profile: freezeGenericAgentCandidateProfile(source.profile), profileDiffIds: [] }
  }

  if (source.kind !== 'profile-diffs') {
    throw new Error(
      `unsupported candidate profile source: ${String((source as { kind?: unknown }).kind)}`,
    )
  }
  if (source.diffs.length === 0) {
    throw new Error('profile-diffs source requires at least one AgentProfileDiff')
  }
  let profile = parseExactAgentProfile(source.base, 'base profile')
  const profileDiffIds: string[] = []
  for (const [index, inputDiff] of source.diffs.entries()) {
    const diff = parseExactProfileDiff(inputDiff, index)
    profile = omitUndefinedObjectFields(applyAgentProfileDiff(profile, diff)) as AgentProfile
    profileDiffIds.push(canonicalCandidateDigest(diff))
  }
  return { profile: freezeGenericAgentCandidateProfile(profile), profileDiffIds }
}

function compileCandidateCode(source: AgentCandidateCodeSource): AgentCandidateBundleInput['code'] {
  if (source.kind === 'disabled' || source.kind === 'no-op') return source
  if (source.kind !== 'code-surface') {
    throw new Error(
      `unsupported candidate code source: ${String((source as { kind?: unknown }).kind)}`,
    )
  }

  const verified = verifyCodeSurface(source.surface, source.worktreeDir)
  const patch = embeddedCandidateArtifact(verified.patchBytes)
  if (
    patch.sha256 !== source.surface.patch.sha256 ||
    patch.byteLength !== source.surface.patch.byteLength
  ) {
    throw new Error('verified CodeSurface patch bytes do not match its content identity')
  }
  return {
    kind: 'git-patch',
    repository: source.repository,
    baseCommit: source.surface.baseCommit,
    baseTree: source.surface.baseTree,
    candidateTree: source.surface.candidateTree,
    patch: { format: 'git-diff-binary', artifact: patch },
  }
}

function parseExactProfileDiff(input: unknown, index: number): AgentProfileDiff {
  const parsed = agentProfileDiffSchema.parse(input) as AgentProfileDiff
  assertCanonicalParse(input, parsed, `profile diff ${index}`)
  return parsed
}

function assertCanonicalParse(input: unknown, parsed: unknown, label: string): void {
  if (!Buffer.from(canonicalCandidateBytes(input)).equals(canonicalCandidateBytes(parsed))) {
    throw new Error(`${label} contains unsupported or non-canonical fields`)
  }
}

function omitUndefinedObjectFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (entry === undefined) {
        throw new Error(`profile diff application produced an undefined array entry at ${index}`)
      }
      return omitUndefinedObjectFields(entry)
    })
  }
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, omitUndefinedObjectFields(entry)]),
  )
}
