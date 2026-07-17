import type { CodeSurface } from '@tangle-network/agent-eval/campaign'
import { verifyCodeSurface } from '@tangle-network/agent-eval/campaign'
import type {
  AgentCandidateCodeDisabled,
  AgentCandidateCodeNoOp,
  AgentCandidateExecution,
  AgentCandidateGitHubRepository,
  AgentCandidateKnowledge,
  AgentCandidateMemoryPolicy,
  AgentCandidateProfile,
  AgentProfile,
  AgentProfileDiff,
} from '@tangle-network/agent-interface'
import { type AgentCandidateBundleInput, sealAgentCandidateBundle } from './bundle'
import { embeddedCandidateArtifact } from './digest'
import {
  applyExactAgentProfileDiff,
  freezeGenericAgentCandidateProfile,
  parseExactAgentProfile,
  parseExactAgentProfileDiff,
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
      /** Applied in order before the resulting profile is frozen into the bundle. */
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
}

/**
 * Compile one measured profile/code candidate into the immutable execution
 * contract. Code bytes are re-read and verified by agent-eval before they are
 * embedded. The returned bundle is schema-validated, canonically digested, and
 * deeply immutable; call `verifyAgentCandidateBundle` at the execution boundary
 * to re-read external memory, repository, and workspace artifacts.
 */
export function buildAgentCandidateBundle(
  input: BuildAgentCandidateBundleInput,
): ReturnType<typeof sealAgentCandidateBundle> {
  const bundle: AgentCandidateBundleInput = {
    kind: 'agent-candidate-bundle',
    digestAlgorithm: 'rfc8785-sha256',
    profile: compileCandidateProfile(input.profile),
    code: compileCandidateCode(input.code),
    execution: input.execution,
    ...(input.knowledge !== undefined ? { knowledge: input.knowledge } : {}),
    memory: input.memory,
  }
  return sealAgentCandidateBundle(bundle)
}

function compileCandidateProfile(source: AgentCandidateProfileSource): AgentCandidateProfile {
  if (source.kind === 'candidate-profile') {
    return parseExactCandidateProfile(source.profile)
  }

  if (source.kind === 'profile') {
    return freezeGenericAgentCandidateProfile(source.profile)
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
  for (const [index, inputDiff] of source.diffs.entries()) {
    const diff = parseExactAgentProfileDiff(inputDiff, `profile diff ${index}`)
    profile = applyExactAgentProfileDiff(profile, diff, `profile diff ${index}`)
  }
  return freezeGenericAgentCandidateProfile(profile)
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
