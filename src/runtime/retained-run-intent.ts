import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
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
export function retainedCreateMaterial(
  environment: CreateAgentEnvironmentInput,
): Record<string, unknown> {
  return {
    ...(environment.backend === undefined ? {} : { backend: environment.backend }),
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
export function retainedTurnMaterial(input: AgentTurnInput): Record<string, unknown> {
  return {
    ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
    ...(input.parts === undefined ? {} : { parts: input.parts }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.context === undefined ? {} : { context: input.context }),
    ...(input.interactions === undefined ? {} : { interactions: input.interactions }),
    ...(input.providerOptions === undefined ? {} : { providerOptions: input.providerOptions }),
  }
}
