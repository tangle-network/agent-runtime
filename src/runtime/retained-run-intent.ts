import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import type {
  AgentTurnInput,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'

/**
 * Project environment creation input into public digest material.
 *
 * Values from the `secrets` channel never enter the material or its digest.
 * Secret names remain public binding data, so changing which credentials are
 * requested still conflicts before provider effects begin.
 */
export function retainedCreateMaterial(
  environment: CreateAgentEnvironmentInput,
): Record<string, unknown> {
  return {
    ...(environment.backend === undefined ? {} : { backend: environment.backend }),
    ...(environment.workspace === undefined
      ? {}
      : { workspaceDigest: canonicalCandidateDigest(environment.workspace) }),
    ...(environment.resources === undefined
      ? {}
      : { resourcesDigest: canonicalCandidateDigest(environment.resources) }),
    ...(environment.name === undefined ? {} : { name: environment.name }),
    ...(environment.env === undefined
      ? {}
      : { envDigest: canonicalCandidateDigest(environment.env) }),
    ...(environment.secrets === undefined
      ? {}
      : { secretNames: retainedSecretNames(environment.secrets) }),
    ...(environment.metadata === undefined
      ? {}
      : { metadataDigest: canonicalCandidateDigest(environment.metadata) }),
    ...(environment.providerOptions === undefined
      ? {}
      : { providerOptionsDigest: canonicalCandidateDigest(environment.providerOptions) }),
  }
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
