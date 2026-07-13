import type {
  AgentCandidateConfigValue,
  AgentCandidateProfile,
  AgentCandidateProfileActivation,
  AgentCandidateProfilePlanEvidence,
  AgentCandidateResourceRef,
  AgentProfile,
  AgentProfileDiff,
  AgentProfileMcpServer,
  AgentProfileResourceRef,
  HarnessType,
} from '@tangle-network/agent-interface'
import {
  agentCandidateProfileActivationSchema,
  agentCandidateProfileSchema,
  agentProfileDiffSchema,
  agentProfileSchema,
  applyAgentProfileDiff,
} from '@tangle-network/agent-interface'
import type {
  AgentCandidateWorkspacePlan,
  HarnessId,
} from '@tangle-network/agent-profile-materialize'

import {
  canonicalCandidateBytes,
  canonicalCandidateDigest,
  canonicalCandidateDocument,
  embeddedCandidateArtifact,
  immutableCandidateValue,
  omitTopLevelDigest,
  sha256Bytes,
} from './digest'

const MATERIALIZER_HARNESSES = new Set<HarnessType>([
  'claude-code',
  'claude',
  'claudish',
  'nanoclaw',
  'codex',
  'opencode',
  'kimi-code',
  'kimi',
  'pi',
  'gemini',
  'hermes',
  'openclaw',
])

export function candidateMaterializerHarness(harness: HarnessType): HarnessId {
  if (!MATERIALIZER_HARNESSES.has(harness)) {
    throw new Error(
      `sealed candidate profile materialization is unsupported for harness ${harness}`,
    )
  }
  return harness as HarnessId
}

/** Bind exact native profile text to the canonical plan captured during preparation. */
export function createAgentCandidateProfileActivation(
  plan: AgentCandidateWorkspacePlan,
  profilePlan: AgentCandidateProfilePlanEvidence,
): AgentCandidateProfileActivation {
  const sourceByPath = new Map(plan.files.map((file) => [file.relPath, file]))
  if (sourceByPath.size !== plan.files.length) {
    throw new Error('candidate profile activation contains duplicate native file paths')
  }
  const files = profilePlan.material.files.map((expected) => {
    const source = sourceByPath.get(expected.relPath)
    const mode = source?.mode ?? 0o644
    if (!source || !Number.isSafeInteger(mode) || mode < 0 || mode > 0o777) {
      throw new Error('candidate profile activation does not contain every planned native file')
    }
    return { path: expected.relPath, mode, content: source.content }
  })
  if (files.length !== plan.files.length) {
    throw new Error('candidate profile activation contains unplanned native files')
  }
  return parseAgentCandidateProfileActivation(
    canonicalCandidateDocument<AgentCandidateProfileActivation>({
      schemaVersion: 1,
      kind: 'agent-candidate-profile-activation',
      profilePlan,
      files,
    }).value,
    profilePlan.digest,
  )
}

/** Parse and check every native file hash plus both canonical document digests. */
export function parseAgentCandidateProfileActivation(
  input: unknown,
  expectedProfilePlanDigest?: AgentCandidateProfilePlanEvidence['digest'],
): AgentCandidateProfileActivation {
  const activation = agentCandidateProfileActivationSchema.parse(input)
  const planBytes = canonicalCandidateBytes(activation.profilePlan.material)
  if (
    sha256Bytes(planBytes) !== activation.profilePlan.digest ||
    activation.profilePlan.artifact.sha256 !== activation.profilePlan.digest ||
    activation.profilePlan.artifact.byteLength !== planBytes.byteLength ||
    (expectedProfilePlanDigest !== undefined &&
      activation.profilePlan.digest !== expectedProfilePlanDigest)
  ) {
    throw new Error('candidate profile activation has an invalid canonical profile plan')
  }
  if (canonicalCandidateDigest(omitTopLevelDigest(activation)) !== activation.digest) {
    throw new Error('candidate profile activation digest does not match')
  }
  return immutableCandidateValue(activation)
}

const CANDIDATE_PROFILE_DIRECT_FIELDS = [
  'name',
  'description',
  'version',
  'tags',
  'prompt',
  'harness',
  'permissions',
  'tools',
  'confidential',
] as const

/** Convert only behavior-preserving generic profile fields into the closed candidate contract. */
export function freezeGenericAgentCandidateProfile(input: AgentProfile): AgentCandidateProfile {
  const profile = parseExactAgentProfile(input, 'profile')
  if (profile.connections !== undefined) unsupportedProfileField('connections')
  if (profile.metadata !== undefined) unsupportedProfileField('metadata')
  if (profile.extensions !== undefined) unsupportedProfileField('extensions')
  if (profile.model?.metadata !== undefined) unsupportedProfileField('model.metadata')

  const candidate: Record<string, unknown> = {}
  copyDirectProfileFields(candidate, profile as Record<string, unknown>)
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
  const parsed = parseExactCandidateProfile(candidate)
  assertCandidateProfileBinding(profile, parsed)
  return parsed
}

/** Prove the measured generic profile and sealed candidate profile describe the same behavior. */
export function assertCandidateProfileBinding(
  measuredInput: AgentProfile,
  bundled: AgentCandidateProfile,
): void {
  const measured = parseExactAgentProfile(measuredInput, 'proposal candidate profile')
  if (measured.connections || measured.metadata || measured.extensions) {
    throw new Error('proposal candidate profile contains fields unsupported by sealed candidates')
  }
  const normalized = agentCandidateProfileAsAgentProfile(bundled)
  if (canonicalCandidateDigest(measured) !== canonicalCandidateDigest(normalized)) {
    throw new Error('proposal candidateProfile does not match candidateBundle.profile')
  }
}

/** Parse a complete profile without silently discarding unsupported fields. */
export function parseExactAgentProfile(input: unknown, label: string): AgentProfile {
  const parsed = agentProfileSchema.parse(input) as AgentProfile
  assertCanonicalParse(input, parsed, label)
  return parsed
}

/** Parse a profile diff without silently discarding unsupported fields. */
export function parseExactAgentProfileDiff(input: unknown, label: string): AgentProfileDiff {
  const parsed = agentProfileDiffSchema.parse(input) as AgentProfileDiff
  assertCanonicalParse(input, parsed, label)
  return parsed
}

/** Apply one exact diff and reject any value that cannot be preserved canonically. */
export function applyExactAgentProfileDiff(
  baseInput: unknown,
  diffInput: unknown,
  label: string,
): AgentProfile {
  const base = parseExactAgentProfile(baseInput, `${label} base profile`)
  const diff = parseExactAgentProfileDiff(diffInput, `${label} diff`)
  const applied = omitUndefinedObjectFields(applyAgentProfileDiff(base, diff), label)
  return parseExactAgentProfile(applied, `${label} result`)
}

export function parseExactCandidateProfile(input: unknown): AgentCandidateProfile {
  const parsed = agentCandidateProfileSchema.parse(input)
  assertCanonicalParse(input, parsed, 'candidate profile')
  return parsed
}

/** Reject profile fields whose behavioral effect is not yet proven by candidate executors. */
export function assertCandidateProfileExecutionSupport(profile: AgentCandidateProfile): void {
  const fields = ['tools', 'permissions', 'modes', 'confidential'] as const
  const unsupported = fields.filter((field) => hasEntries(profile[field]))
  if (unsupported.length > 0) {
    throw new Error(
      `candidate execution cannot prove in-session effects for non-empty AgentProfile fields: ${unsupported.join(', ')}`,
    )
  }
}

export function agentCandidateProfileAsAgentProfile(
  candidate: AgentCandidateProfile,
): AgentProfile {
  const output: Record<string, unknown> = {}
  copyDirectProfileFields(output, candidate as unknown as Record<string, unknown>)
  if (candidate.model) output.model = { ...candidate.model }
  if (candidate.mcp) {
    output.mcp = Object.fromEntries(
      Object.entries(candidate.mcp).map(([name, server]) => [
        name,
        {
          ...server,
          ...(server.args ? { args: server.args.map(publicValue) } : {}),
          ...(server.env ? { env: mapPublicValues(server.env) } : {}),
        },
      ]),
    )
  }
  if (candidate.subagents) output.subagents = cloneRecord(candidate.subagents)
  if (candidate.modes) output.modes = cloneRecord(candidate.modes)
  if (candidate.hooks) {
    output.hooks = Object.fromEntries(
      Object.entries(candidate.hooks).map(([event, hooks]) => [
        event,
        hooks.map(({ executable, args, env, ...hook }) => ({
          ...hook,
          command: [executable, ...(args ?? []).map(publicValue)].map(shellQuote).join(' '),
          ...(env ? { env: mapPublicValues(env) } : {}),
        })),
      ]),
    )
  }
  if (candidate.resources) {
    if (candidate.resources.failOnError !== true) {
      throw new Error('proposal candidate profile contains fields unsupported by sealed candidates')
    }
    output.resources = {
      failOnError: true,
      ...(candidate.resources.files
        ? {
            files: candidate.resources.files.map((file) => ({
              ...file,
              resource: publicResource(file.resource),
            })),
          }
        : {}),
      ...(candidate.resources.tools
        ? { tools: candidate.resources.tools.map(publicResource) }
        : {}),
      ...(candidate.resources.skills
        ? { skills: candidate.resources.skills.map(publicResource) }
        : {}),
      ...(candidate.resources.agents
        ? { agents: candidate.resources.agents.map(publicResource) }
        : {}),
      ...(candidate.resources.commands
        ? { commands: candidate.resources.commands.map(publicResource) }
        : {}),
      ...(candidate.resources.instructions !== undefined
        ? {
            instructions:
              typeof candidate.resources.instructions === 'string'
                ? candidate.resources.instructions
                : publicResource(candidate.resources.instructions),
          }
        : {}),
    }
  }
  return output as AgentProfile
}

function omitUndefinedObjectFields(value: unknown, path: string): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (entry === undefined) {
        throw new Error(`${path} produced an undefined array entry at ${index}`)
      }
      return omitUndefinedObjectFields(entry, `${path}[${index}]`)
    })
  }
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, omitUndefinedObjectFields(entry, `${path}.${key}`)]),
  )
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
          ...(server.args ? { args: server.args.map(candidatePublicValue) } : {}),
          ...(server.env ? { env: mapCandidatePublicValues(server.env) } : {}),
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

function copyDirectProfileFields(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const key of CANDIDATE_PROFILE_DIRECT_FIELDS) {
    if (source[key] !== undefined) target[key] = source[key]
  }
}

function assertCanonicalParse(input: unknown, parsed: unknown, label: string): void {
  if (!Buffer.from(canonicalCandidateBytes(input)).equals(canonicalCandidateBytes(parsed))) {
    throw new Error(`${label} contains unsupported or non-canonical fields`)
  }
}

function publicResource(resource: AgentCandidateResourceRef): unknown {
  if (resource.kind === 'inline') {
    return { kind: 'inline', name: resource.name, content: resource.content }
  }
  return {
    kind: 'github',
    repository: `${resource.repository.owner}/${resource.repository.repo}`,
    path: resource.path,
    ref: resource.commit,
    ...(resource.name ? { name: resource.name } : {}),
  }
}

function candidatePublicValue(value: string): { kind: 'public'; value: string } {
  return { kind: 'public', value }
}

function mapCandidatePublicValues(
  values: Record<string, string>,
): Record<string, { kind: 'public'; value: string }> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, candidatePublicValue(value)]),
  )
}

function publicValue(value: AgentCandidateConfigValue): string {
  return value.value
}

function mapPublicValues(
  values: Record<string, AgentCandidateConfigValue>,
): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, publicValue(value)]))
}

function cloneRecord<T>(values: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { ...value }]),
  ) as Record<string, T>
}

function hasEntries(value: unknown): boolean {
  return value !== undefined && value !== null && typeof value === 'object'
    ? Object.keys(value).length > 0
    : false
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`
}

function unsupportedProfileField(path: string): never {
  throw new Error(
    `generic AgentProfile field ${path} is not representable in a sealed candidate profile`,
  )
}
