import { resolve } from 'node:path'
import { type AgentProfile, agentProfileSchema } from '@tangle-network/agent-interface'
import { withProfileKb } from '@tangle-network/agent-interface/profile-kb'
import { ValidationError } from '../../errors'
import { isLoopbackHost } from './coordination-mcp'
import type { ExecutorConfig } from './runtime'
import { freezeDetachedProfile } from './supervise-identity'
import type { SuperviseOptions } from './supervise-options'
import type { SupervisorProfile } from './supervisor-agent'
import type { RootSegment } from './types'

/**
 * The composer `profileGuidance` selects, or `undefined` when no guidance is selected. The result
 * is re-validated as an AgentProfile, and a composition that breaks the schema is refused as a
 * ValidationError. `supervise` applies it to the root and to authored spawns; `runGraph` applies
 * it to pinned node profiles.
 */
export function profileGuidanceComposer(
  guidance: SuperviseOptions['profileGuidance'],
): ((profile: AgentProfile) => AgentProfile) | undefined {
  if (guidance === undefined) return undefined
  if (guidance !== 'profile-kb') {
    throw new ValidationError(
      `supervise: profileGuidance must be 'profile-kb' when set, got ${JSON.stringify(guidance)}`,
    )
  }
  return (profile) => {
    const composed = agentProfileSchema.safeParse(withProfileKb(profile))
    if (!composed.success) {
      throw new ValidationError(
        `supervise: profile-kb guidance produced an invalid AgentProfile: ${composed.error.message}`,
      )
    }
    return composed.data
  }
}

/**
 * The exact root profile `supervise` executes: `profile` parsed as an AgentProfile, with the
 * selected `profileGuidance` composed. The root's journaled `identity.profileDigest` is this
 * value's digest, so a reader that must match a recorded root derives it here, not by hand.
 */
export function superviseRootProfile(
  profile: SupervisorProfile,
  profileGuidance: SuperviseOptions['profileGuidance'],
): AgentProfile {
  const parsedProfile = agentProfileSchema.safeParse(profile)
  if (!parsedProfile.success) {
    throw new ValidationError(`supervise: invalid AgentProfile: ${parsedProfile.error.message}`)
  }
  const compose = profileGuidanceComposer(profileGuidance)
  return freezeDetachedProfile(compose ? compose(parsedProfile.data) : parsedProfile.data)
}

/** What a root profile runs on, as a `root-segment` record names it. */
export function rootSegmentOf(profile: AgentProfile): RootSegment {
  return {
    ...(profile.model?.provider === undefined ? {} : { provider: profile.model.provider }),
    ...(profile.model?.default === undefined ? {} : { model: profile.model.default }),
    ...(profile.model?.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: profile.model.reasoningEffort }),
    ...(profile.harness === undefined ? {} : { harness: profile.harness }),
  }
}

/** Refuse a segment that names nothing usable before any compute. */
export function admitSegment(segment: NonNullable<SuperviseOptions['segment']>): void {
  if (typeof segment !== 'object' || segment === null) {
    throw new ValidationError('supervise: segment must be an object')
  }
  for (const key of ['provider', 'model', 'harness'] as const) {
    const value = segment[key]
    if (value !== undefined && (typeof value !== 'string' || value.trim().length === 0)) {
      throw new ValidationError(`supervise: segment.${key} must name a ${key}`)
    }
  }
  if (typeof segment.reason !== 'string' || segment.reason.trim().length === 0) {
    throw new ValidationError('supervise: segment.reason must say why the segment starts')
  }
  if (segment.stack !== undefined) {
    if (
      typeof segment.stack !== 'object' ||
      segment.stack === null ||
      Array.isArray(segment.stack)
    ) {
      throw new ValidationError('supervise: segment.stack must map package names to versions')
    }
    for (const [name, version] of Object.entries(segment.stack)) {
      if (typeof version !== 'string' || version.length === 0) {
        throw new ValidationError(`supervise: segment.stack.${name} must be a version string`)
      }
    }
  }
}

/** The recorded root profile with only its provider, model, reasoning effort and harness replaced
 *  where the segment names them. */
export function withRootSegment(
  profile: AgentProfile,
  segment: NonNullable<SuperviseOptions['segment']>,
): AgentProfile {
  if (
    segment.provider === undefined &&
    segment.model === undefined &&
    segment.reasoningEffort === undefined &&
    segment.harness === undefined
  ) {
    return profile
  }
  return superviseRootProfile(
    {
      ...profile,
      ...(segment.harness === undefined ? {} : { harness: segment.harness }),
      model: {
        ...profile.model,
        ...(segment.provider === undefined ? {} : { provider: segment.provider }),
        ...(segment.model === undefined ? {} : { default: segment.model }),
        ...(segment.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: segment.reasoningEffort }),
      },
    },
    undefined,
  )
}

/** The directory a root manager's spawn may resolve an inline resource `path` under. Only a
 *  loopback bridge driver has one this process can read: its `cwd` is a directory on this host.
 *  A remote bridge, a provider sandbox, or an in-process driver with no cwd yields `undefined`. */
export function rootSpawnResourceRoot(backend: ExecutorConfig | undefined): string | undefined {
  if (backend === undefined || backend.backend !== 'bridge' || backend.cwd === undefined)
    return undefined
  let host: string
  try {
    host = new URL(backend.bridgeUrl).hostname
  } catch {
    return undefined
  }
  return isLoopbackHost(host) ? resolve(backend.cwd) : undefined
}
