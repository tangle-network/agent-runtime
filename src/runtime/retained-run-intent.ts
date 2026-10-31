import type { ContextTransferRequest } from '@tangle-network/agent-interface'
import {
  agentWorkspaceSnapshotRefDigest,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import type {
  AgentTurnInput,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'

export function legacyRetainedCreateMaterial(
  environment: CreateAgentEnvironmentInput,
): Record<string, unknown> {
  const { snapshot: _snapshot, ...workspace } = environment.workspace ?? {}
  return retainedCreateMaterial({
    ...environment,
    requestedId: undefined,
    egress: undefined,
    billingOwner: undefined,
    workspace: environment.workspace === undefined ? undefined : workspace,
  })
}

export function retainedCreateMaterial(
  environment: CreateAgentEnvironmentInput,
): Record<string, unknown> {
  return {
    ...(environment.metadata?.runtimeProviderPlacement === undefined
      ? {}
      : {
          placement: environment.metadata.runtimeProviderPlacement,
        }),
    ...(environment.backend === undefined ? {} : { backend: environment.backend }),
    ...(environment.requestedId === undefined ? {} : { requestedId: environment.requestedId }),
    ...(environment.egress === undefined ? {} : { egress: environment.egress }),
    ...(environment.billingOwner === undefined ? {} : { billingOwner: environment.billingOwner }),
    ...(environment.workspace === undefined
      ? {}
      : {
          workspaceDigest: canonicalCandidateDigest(publicWorkspaceMaterial(environment.workspace)),
        }),
    ...(environment.resources === undefined
      ? {}
      : {
          resourcesDigest: canonicalCandidateDigest(publicResourceMaterial(environment.resources)),
        }),
    ...(environment.runtimeAttachments === undefined
      ? {}
      : { runtimeAttachmentsDigest: canonicalCandidateDigest(environment.runtimeAttachments) }),
    ...(environment.name === undefined ? {} : { name: environment.name }),
    ...(environment.env === undefined
      ? {}
      : { environmentVariableNames: Object.keys(environment.env).sort() }),
    ...(environment.secrets === undefined
      ? {}
      : { secretNames: retainedSecretNames(environment.secrets) }),
    ...(environment.proxySecrets === undefined ? {} : { proxySecrets: environment.proxySecrets }),
    ...(environment.metadata === undefined
      ? {}
      : { metadataKeys: Object.keys(environment.metadata).sort() }),
    ...(environment.providerOptions === undefined
      ? {}
      : { providerOptionNames: Object.keys(environment.providerOptions).sort() }),
  }
}

export function retainedEnvironmentMetadata(
  metadata: Record<string, unknown> | undefined,
  idempotencyKey: string,
): Record<string, unknown> {
  return {
    ...metadata,
    retainedIdempotencyKey: idempotencyKey,
  }
}

function publicWorkspaceMaterial(
  workspace: NonNullable<CreateAgentEnvironmentInput['workspace']>,
): Record<string, unknown> {
  return {
    ...(workspace.environment === undefined ? {} : { environment: workspace.environment }),
    ...(workspace.image === undefined ? {} : { image: workspace.image }),
    ...(workspace.repoUrl === undefined ? {} : { repoUrl: workspace.repoUrl }),
    ...(workspace.gitRef === undefined ? {} : { gitRef: workspace.gitRef }),
    ...(workspace.cwd === undefined ? {} : { cwd: workspace.cwd }),
    ...(workspace.checkpoint === undefined ? {} : { checkpoint: workspace.checkpoint }),
    ...(workspace.snapshot === undefined
      ? {}
      : { snapshotDigest: agentWorkspaceSnapshotRefDigest(workspace.snapshot) }),
    ...(workspace.providerOptions === undefined
      ? {}
      : { providerOptionNames: Object.keys(workspace.providerOptions).sort() }),
  }
}

function publicResourceMaterial(
  resources: NonNullable<CreateAgentEnvironmentInput['resources']>,
): Record<string, unknown> {
  return {
    ...(resources.cpu === undefined ? {} : { cpu: resources.cpu }),
    ...(resources.memoryMb === undefined ? {} : { memoryMb: resources.memoryMb }),
    ...(resources.diskMb === undefined ? {} : { diskMb: resources.diskMb }),
    ...(resources.gpu === undefined ? {} : { gpu: resources.gpu }),
    ...(resources.providerOptions === undefined
      ? {}
      : { providerOptionNames: Object.keys(resources.providerOptions).sort() }),
  }
}

function retainedSecretNames(
  secrets: NonNullable<CreateAgentEnvironmentInput['secrets']>,
): NonNullable<CreateAgentEnvironmentInput['secrets']> {
  if (!Array.isArray(secrets)) return secrets === 'all' ? secrets : Object.keys(secrets).sort()
  if (secrets.every((entry) => typeof entry === 'string')) return [...secrets].sort()
  return [...secrets].sort((a, b) =>
    canonicalCandidateDigest(a).localeCompare(canonicalCandidateDigest(b)),
  )
}

export function retainedTurnMaterial(
  input: AgentTurnInput,
  contextTransfer: ContextTransferRequest | undefined,
): Record<string, unknown> {
  return {
    ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
    ...(input.parts === undefined ? {} : { parts: input.parts }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.profile === undefined
      ? {}
      : { profileDigest: canonicalAgentProfileDigest(input.profile) }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.context === undefined ? {} : { context: input.context }),
    ...(input.interactions === undefined ? {} : { interactions: input.interactions }),
    ...(input.providerOptions === undefined
      ? {}
      : { providerOptions: retainedTurnProviderOptions(input.providerOptions) }),
    ...(contextTransfer === undefined
      ? {}
      : { contextTransferRequestDigest: contextTransfer.requestDigest }),
  }
}

function retainedTurnProviderOptions(options: NonNullable<AgentTurnInput['providerOptions']>) {
  const backend = options.backend
  if (!backend || typeof backend !== 'object' || Array.isArray(backend)) return options
  const record = backend as Record<string, unknown>
  const secrets = record.runtimeSecrets
  if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets)) return options
  const { runtimeSecrets: _values, ...publicBackend } = record
  return {
    ...options,
    backend: { ...publicBackend, runtimeSecretNames: Object.keys(secrets).sort() },
  }
}
