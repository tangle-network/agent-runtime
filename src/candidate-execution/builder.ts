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
  AgentCandidateResourceRef,
  AgentProfile,
  AgentProfileDiff,
  AgentProfileMcpServer,
  AgentProfileResourceRef,
} from '@tangle-network/agent-interface'
import {
  agentCandidateProfileSchema,
  agentProfileDiffSchema,
  agentProfileSchema,
  applyAgentProfileDiff,
} from '@tangle-network/agent-interface'

import { type AgentCandidateBundleInput, sealAgentCandidateBundle } from './bundle'
import {
  canonicalCandidateBytes,
  canonicalCandidateDigest,
  embeddedCandidateArtifact,
} from './digest'

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
    return { profile: freezeGenericProfile(source.profile), profileDiffIds: [] }
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
  return { profile: freezeGenericProfile(profile), profileDiffIds }
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

function freezeGenericProfile(input: AgentProfile): AgentCandidateProfile {
  const profile = parseExactAgentProfile(input, 'profile')
  if (profile.connections !== undefined) unsupportedProfileField('connections')
  if (profile.metadata !== undefined) unsupportedProfileField('metadata')
  if (profile.extensions !== undefined) unsupportedProfileField('extensions')
  if (profile.model?.metadata !== undefined) unsupportedProfileField('model.metadata')

  const candidate: Record<string, unknown> = {}
  copyDefined(candidate, profile as Record<string, unknown>, [
    'name',
    'description',
    'version',
    'tags',
    'prompt',
    'harness',
    'permissions',
    'tools',
    'confidential',
  ])
  if (profile.model) {
    const { metadata: _metadata, ...model } = profile.model
    candidate.model = model
  }
  if (profile.mcp) candidate.mcp = freezeMcpServers(profile.mcp)
  if (profile.subagents) {
    candidate.subagents = Object.fromEntries(
      Object.entries(profile.subagents).map(([name, subagent]) => {
        if (subagent.metadata !== undefined) unsupportedProfileField(`subagents.${name}.metadata`)
        const { metadata: _metadata, ...value } = subagent
        return [name, value]
      }),
    )
  }
  if (profile.resources) candidate.resources = freezeResources(profile.resources)
  if (profile.hooks && Object.values(profile.hooks).some((commands) => commands.length > 0)) {
    throw new Error(
      'generic AgentProfile hooks cannot be safely tokenized; use a candidate-profile source with executable/args',
    )
  }
  if (profile.hooks) candidate.hooks = profile.hooks
  if (profile.modes) {
    candidate.modes = Object.fromEntries(
      Object.entries(profile.modes).map(([name, mode]) => {
        if (mode.metadata !== undefined) unsupportedProfileField(`modes.${name}.metadata`)
        const { metadata: _metadata, ...value } = mode
        return [name, value]
      }),
    )
  }
  return parseExactCandidateProfile(candidate)
}

function freezeMcpServers(servers: Record<string, AgentProfileMcpServer>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(servers).map(([name, server]) => {
      if (server.transport !== undefined && server.transport !== 'stdio') {
        unsupportedProfileField(`mcp.${name}.transport=${server.transport}`)
      }
      if (server.url !== undefined) unsupportedProfileField(`mcp.${name}.url`)
      if (server.headers !== undefined) unsupportedProfileField(`mcp.${name}.headers`)
      if (server.metadata !== undefined) unsupportedProfileField(`mcp.${name}.metadata`)
      return [
        name,
        {
          ...(server.transport ? { transport: server.transport } : {}),
          ...(server.command ? { command: server.command } : {}),
          ...(server.args ? { args: server.args.map(publicValue) } : {}),
          ...(server.env ? { env: mapPublicValues(server.env) } : {}),
          ...(server.cwd ? { cwd: server.cwd } : {}),
          ...(server.enabled === undefined ? {} : { enabled: server.enabled }),
        },
      ]
    }),
  )
}

function freezeResources(resources: NonNullable<AgentProfile['resources']>): unknown {
  if (resources.failOnError !== true) {
    throw new Error('candidate profile resources require failOnError: true')
  }
  return {
    failOnError: true,
    ...(resources.files
      ? {
          files: resources.files.map((file) => ({
            ...file,
            resource: freezeResource(file.resource),
          })),
        }
      : {}),
    ...(resources.tools ? { tools: resources.tools.map(freezeResource) } : {}),
    ...(resources.skills ? { skills: resources.skills.map(freezeResource) } : {}),
    ...(resources.agents ? { agents: resources.agents.map(freezeResource) } : {}),
    ...(resources.commands ? { commands: resources.commands.map(freezeResource) } : {}),
    ...(resources.instructions === undefined
      ? {}
      : {
          instructions:
            typeof resources.instructions === 'string'
              ? resources.instructions
              : freezeResource(resources.instructions),
        }),
  }
}

function freezeResource(resource: AgentProfileResourceRef): AgentCandidateResourceRef {
  if (resource.kind === 'github') {
    throw new Error(
      'generic GitHub profile resources do not carry byte identity; use a candidate-profile source with a pinned commit, digest, and byte length',
    )
  }
  const bytes = Buffer.from(resource.content, 'utf8')
  return {
    ...resource,
    sha256: embeddedCandidateArtifact(bytes).sha256,
    byteLength: bytes.byteLength,
  }
}

function parseExactAgentProfile(input: unknown, label: string): AgentProfile {
  const parsed = agentProfileSchema.parse(input) as AgentProfile
  assertCanonicalParse(input, parsed, label)
  return parsed
}

function parseExactProfileDiff(input: unknown, index: number): AgentProfileDiff {
  const parsed = agentProfileDiffSchema.parse(input) as AgentProfileDiff
  assertCanonicalParse(input, parsed, `profile diff ${index}`)
  return parsed
}

function parseExactCandidateProfile(input: unknown): AgentCandidateProfile {
  const parsed = agentCandidateProfileSchema.parse(input)
  assertCanonicalParse(input, parsed, 'candidate profile')
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

function publicValue(value: string): { kind: 'public'; value: string } {
  return { kind: 'public', value }
}

function mapPublicValues(
  values: Record<string, string>,
): Record<string, { kind: 'public'; value: string }> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, publicValue(value)]),
  )
}

function copyDefined(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  keys: readonly string[],
): void {
  for (const key of keys) {
    if (source[key] !== undefined) target[key] = source[key]
  }
}

function unsupportedProfileField(path: string): never {
  throw new Error(
    `generic AgentProfile field ${path} is not representable in a sealed candidate profile`,
  )
}
