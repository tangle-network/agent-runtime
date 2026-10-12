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

/**
 * Project environment creation input into public digest material.
 *
 * Opaque values never enter the material or its digest. Public scalar fields
 * remain bound directly, while opaque records retain only their key names.
 * Secret names remain public binding data, so changing requested credentials
 * still conflicts before provider effects begin.
 */
/**
 * The pre-interface5 create-material projection: `requestedId`, `egress`,
 * `billingOwner`, and the workspace `snapshot` digest omitted — the shape
 * records persisted by the previous version digested. Accepted only when
 * validating replayed records (an upgrade must not strand an in-flight run
 * whose provider creation already completed); every new admission digests the
 * current projection.
 */
export function legacyRetainedCreateMaterial(
  environment: CreateAgentEnvironmentInput,
): Record<string, unknown> {
  const {
    requestedId: _requestedId,
    egress: _egress,
    billingOwner: _billingOwner,
    workspace,
    ...preInterface5
  } = environment
  const legacyEnvironment =
    workspace === undefined
      ? preInterface5
      : {
          ...preInterface5,
          workspace: (() => {
            const { snapshot: _snapshot, ...legacyWorkspace } = workspace
            return legacyWorkspace
          })(),
        }
  return retainedCreateMaterial(legacyEnvironment as CreateAgentEnvironmentInput)
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
      : { environmentVariableNames: retainedObjectNames(environment.env) }),
    ...(environment.secrets === undefined
      ? {}
      : { secretNames: retainedSecretNames(environment.secrets) }),
    ...(environment.metadata === undefined
      ? {}
      : { metadataKeys: retainedObjectNames(environment.metadata) }),
    ...(environment.providerOptions === undefined
      ? {}
      : { providerOptionNames: retainedObjectNames(environment.providerOptions) }),
  }
}

/** Add the retained ownership marker without attaching turn identity. */
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
      : { providerOptionNames: retainedObjectNames(workspace.providerOptions) }),
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
      : { providerOptionNames: retainedObjectNames(resources.providerOptions) }),
  }
}

function retainedObjectNames(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort()
}

function retainedSecretNames(
  secrets: NonNullable<CreateAgentEnvironmentInput['secrets']>,
): string[] {
  return Array.isArray(secrets) ? [...secrets].sort() : Object.keys(secrets).sort()
}

/** Project one headless turn into the material that `freshTurnInput` forwards. */
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
    ...(input.providerOptions === undefined ? {} : { providerOptions: input.providerOptions }),
    ...(contextTransfer === undefined
      ? {}
      : { contextTransferRequestDigest: contextTransfer.requestDigest }),
  }
}
