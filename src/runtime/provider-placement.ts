import {
  type AgentProfile,
  WorkspaceCheckpointRefSchema,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import type { CreateAgentEnvironmentInput } from '@tangle-network/agent-interface/environment-provider'
import { ValidationError } from '../errors'
import type {
  ProviderExecutorOptions,
  ProviderPromptOptions,
} from './environment-provider/provider-executor-admission'
import { concreteProfileModel } from './supervise/model-policy'
import { detachedSnapshot } from './supervise/snapshot'
import type { ExecutorNodeContext } from './supervise/types'

/** Caller-declared execution placement. Matching never changes the authored profile.
 * @experimental */
export interface ProviderPlacement {
  id: string
  match: {
    harness: NonNullable<AgentProfile['harness']>
    provider?: string
    model?: string
  }
  create: Omit<
    Partial<CreateAgentEnvironmentInput>,
    'profile' | 'signal' | 'idempotencyKey' | 'requestedId' | 'runtimeAttachments' | 'backend'
  > & {
    backend: string
  }
  promptOptions?: ProviderPromptOptions
}

const placementMetadataKey = 'runtimeProviderPlacement'

/** Select exactly one declaration before any provider effects. Shared defaults carry infrastructure only. */
export function selectProviderPlacement<T extends ProviderExecutorOptions>(
  profile: AgentProfile,
  options: T,
  node?: ExecutorNodeContext,
): { options: T; identity?: { id: string; digest: string } } {
  const placed = declaredPlacement(profile, options)
  if (options.checkpointForNode === undefined) return placed
  if (!node) throw new ValidationError('checkpointForNode requires a supervised node')
  const value = options.checkpointForNode(detachedSnapshot(node, 'checkpointForNode assignment'))
  if (value === undefined) return placed
  const checkpoint = WorkspaceCheckpointRefSchema.parse(value)
  const defaults = placed.options.defaults ?? {}
  if (
    defaults.workspace?.checkpoint &&
    canonicalCandidateDigest(defaults.workspace.checkpoint) !== canonicalCandidateDigest(checkpoint)
  ) {
    throw new ValidationError('checkpointForNode disagrees with the declared workspace checkpoint')
  }
  if (!placed.identity && Object.hasOwn(defaults.metadata ?? {}, placementMetadataKey)) {
    throw new ValidationError('checkpointForNode: reserved placement metadata key')
  }
  const identity = {
    id: placed.identity?.id ?? 'node-workspace',
    digest: canonicalCandidateDigest({ placement: placed.identity ?? null, checkpoint }),
  }
  return {
    options: {
      ...placed.options,
      defaults: {
        ...defaults,
        workspace: { ...defaults.workspace, checkpoint },
        metadata: { ...defaults.metadata, [placementMetadataKey]: identity },
      },
    },
    identity,
  }
}

function declaredPlacement<T extends ProviderExecutorOptions>(
  profile: AgentProfile,
  options: T,
): { options: T; identity?: { id: string; digest: string } } {
  if (options.placements === undefined) return { options }
  if (
    options.defaults?.backend !== undefined ||
    options.defaults?.secrets !== undefined ||
    options.promptOptions !== undefined
  ) {
    throw new ValidationError(
      'provider placements: backend, secrets and promptOptions belong in each placement',
    )
  }
  for (const key of ['profile', 'idempotencyKey', 'requestedId']) {
    if (Object.hasOwn(options.defaults ?? {}, key)) {
      throw new ValidationError(`provider placements: defaults.${key} is owned by Runtime`)
    }
  }
  const placements = detachedSnapshot(options.placements, 'provider placements')
  const ids = new Set<string>()
  for (const placement of placements) {
    canonicalCandidateDigest(placement)
    if (
      Object.keys(placement).some(
        (key) => !['id', 'match', 'create', 'promptOptions'].includes(key),
      ) ||
      Object.keys(placement.match).some((key) => !['harness', 'provider', 'model'].includes(key))
    ) {
      throw new ValidationError('provider placements: unknown declaration or match field')
    }
    if (
      [placement.match.provider, placement.match.model].some(
        (value) => value !== undefined && (typeof value !== 'string' || !value.trim()),
      )
    ) {
      throw new ValidationError(
        'provider placements: provider and model selectors must be nonempty strings',
      )
    }
    if (!placement.id?.trim() || ids.has(placement.id)) {
      throw new ValidationError('provider placements: ids must be nonempty and unique')
    }
    ids.add(placement.id)
    if (!placement.match?.harness || placement.create?.backend !== placement.match.harness) {
      throw new ValidationError(
        'provider placements: create.backend must match the declared harness',
      )
    }
    for (const key of [
      'profile',
      'signal',
      'idempotencyKey',
      'requestedId',
      'runtimeAttachments',
    ]) {
      if (Object.hasOwn(placement.create, key)) {
        throw new ValidationError(`provider placements: create.${key} is owned by Runtime`)
      }
    }
    const backend = placement.promptOptions?.backend
    if (
      (backend?.type !== undefined && backend.type !== placement.match.harness) ||
      (backend?.model?.provider !== undefined &&
        backend.model.provider !== placement.match.provider) ||
      (backend?.model?.model !== undefined && backend.model.model !== placement.match.model)
    ) {
      throw new ValidationError(
        'provider placements: turn backend/model must match the declared profile selector',
      )
    }
  }
  const matches = placements.filter(
    ({ match }) =>
      profile.harness === match.harness &&
      (match.provider === undefined || profile.model?.provider === match.provider) &&
      (match.model === undefined || concreteProfileModel(profile) === match.model),
  )
  if (matches.length !== 1) {
    throw new ValidationError(
      `provider placements: expected one matching declaration, found ${matches.length}`,
    )
  }
  const placement = matches[0]!
  const common = options.defaults ?? {}
  if (
    Object.hasOwn(common.metadata ?? {}, placementMetadataKey) ||
    Object.hasOwn(placement.create.metadata ?? {}, placementMetadataKey)
  ) {
    throw new ValidationError('provider placements: reserved placement metadata key')
  }
  for (const key of Object.keys(placement.create.env ?? {})) {
    if (Object.hasOwn(common.env ?? {}, key)) {
      throw new ValidationError(
        'provider placements: placement cannot replace a shared environment variable',
      )
    }
  }
  const effectiveCreate = {
    ...common,
    ...placement.create,
    ...(common.env === undefined && placement.create.env === undefined
      ? {}
      : { env: { ...common.env, ...placement.create.env } }),
    metadata: { ...common.metadata, ...placement.create.metadata },
  }
  const identity = {
    id: placement.id,
    digest: canonicalCandidateDigest({
      id: placement.id,
      match: placement.match,
      create: publicCreateOptions(effectiveCreate),
      promptOptions: publicPromptOptions(placement.promptOptions),
    }),
  }
  return {
    identity,
    options: {
      ...options,
      placements: undefined,
      defaults: {
        ...effectiveCreate,
        metadata: { ...effectiveCreate.metadata, [placementMetadataKey]: identity },
      },
      promptOptions: placement.promptOptions,
    },
  }
}

// Credential rotation does not change public placement identity. Providers own opaque credential validation.
function publicPromptOptions(options: ProviderPromptOptions | undefined): unknown {
  if (options === undefined) return null
  const { backend, ...turn } = options
  if (backend === undefined) return turn
  const { model, ...backendOptions } = backend
  if (model === undefined) return { ...turn, backend: backendOptions }
  const { apiKey, authFiles, ...modelOptions } = model
  return {
    ...turn,
    backend: {
      ...backendOptions,
      model: {
        ...modelOptions,
        ...(apiKey === undefined ? {} : { apiKeyPresent: true }),
        ...(authFiles === undefined
          ? {}
          : { authFiles: authFiles.map(({ content: _content, ...file }) => file) }),
      },
    },
  }
}

function publicCreateOptions(create: Partial<CreateAgentEnvironmentInput>): unknown {
  // Runtime coordinates and authenticated attachments have their own retained-intent binding.
  const {
    env,
    secrets,
    signal: _signal,
    profile: _profile,
    idempotencyKey: _idempotencyKey,
    requestedId: _requestedId,
    runtimeAttachments: _runtimeAttachments,
    ...configuration
  } = create
  return {
    ...configuration,
    ...(env === undefined ? {} : { environmentVariableNames: Object.keys(env).sort() }),
    ...(secrets === undefined
      ? {}
      : {
          secretNames: Array.isArray(secrets) ? [...secrets].sort() : Object.keys(secrets).sort(),
        }),
  }
}
