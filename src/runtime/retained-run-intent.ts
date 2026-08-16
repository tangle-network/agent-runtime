import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import type {
  AgentTurnInput,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'

/**
 * Project environment creation input into digest-only material.
 *
 * Secret values and provider options never enter an admission record. Their
 * digests still bind a replay to the exact request without retaining them.
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
      : { secretsDigest: canonicalCandidateDigest(environment.secrets) }),
    ...(environment.metadata === undefined
      ? {}
      : { metadataDigest: canonicalCandidateDigest(environment.metadata) }),
    ...(environment.providerOptions === undefined
      ? {}
      : { providerOptionsDigest: canonicalCandidateDigest(environment.providerOptions) }),
  }
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
