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
import { recordValue } from '../record-value'

function definedMaterial(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
}

function recordNames(value: object | undefined): string[] | undefined {
  return value === undefined ? undefined : Object.keys(value).sort()
}

/** Replay-only projection of the create identity persisted before Interface 5. */
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
  const { workspace, resources } = environment
  return definedMaterial({
    placement: environment.metadata?.runtimeProviderPlacement,
    backend: environment.backend,
    requestedId: environment.requestedId,
    egress: environment.egress,
    billingOwner: environment.billingOwner,
    workspaceDigest: publicMaterialDigest(
      workspace,
      ['environment', 'image', 'repoUrl', 'gitRef', 'cwd', 'checkpoint'],
      workspace?.snapshot,
    ),
    resourcesDigest: publicMaterialDigest(resources, ['cpu', 'memoryMb', 'diskMb', 'gpu']),
    runtimeAttachmentsDigest:
      environment.runtimeAttachments === undefined
        ? undefined
        : canonicalCandidateDigest(environment.runtimeAttachments),
    name: environment.name,
    environmentVariableNames: recordNames(environment.env),
    secretNames:
      environment.secrets === undefined ? undefined : retainedSecretNames(environment.secrets),
    proxySecrets: environment.proxySecrets,
    metadataKeys: recordNames(environment.metadata),
    providerOptionNames: recordNames(environment.providerOptions),
  })
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

function publicMaterialDigest(
  value: { providerOptions?: Record<string, unknown> } | undefined,
  fields: readonly string[],
  snapshot?: NonNullable<CreateAgentEnvironmentInput['workspace']>['snapshot'],
): string | undefined {
  if (value === undefined) return undefined
  const material = recordValue(value) ?? {}
  const selected = definedMaterial({
    ...Object.fromEntries(fields.map((field) => [field, material[field]])),
    snapshotDigest: snapshot === undefined ? undefined : agentWorkspaceSnapshotRefDigest(snapshot),
    providerOptionNames: recordNames(value.providerOptions),
  })
  return canonicalCandidateDigest(selected)
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

/** Project one headless turn into the material that `freshTurnInput` forwards. */
export function retainedTurnMaterial(
  input: AgentTurnInput,
  contextTransfer: ContextTransferRequest | undefined,
  fields: Pick<AgentTurnInput, 'providerOptions'> = {},
): Record<string, unknown> {
  const backend = recordValue(input.providerOptions?.backend)
  const secrets = recordValue(backend?.runtimeSecrets)
  if (
    fields.providerOptions &&
    backend?.runtimeSecrets !== undefined &&
    (!secrets || Object.values(secrets).some((value) => typeof value !== 'string'))
  ) {
    throw new Error('retained legacy private replay material is not string-valued')
  }
  return definedMaterial({
    prompt: input.prompt,
    parts: input.parts,
    model: input.model,
    profileDigest:
      input.profile === undefined ? undefined : canonicalAgentProfileDigest(input.profile),
    timeoutMs: input.timeoutMs,
    context: input.context,
    interactions: input.interactions,
    providerOptions: secrets
      ? {
          ...input.providerOptions,
          backend: {
            ...backend,
            // Public nonstrings are wrapped so null cannot impersonate a masked string.
            runtimeSecrets: Object.fromEntries(
              Object.entries(secrets).map(([name, value]) => [
                name,
                typeof value === 'string' ? null : [value],
              ]),
            ),
          },
        }
      : input.providerOptions,
    contextTransferRequestDigest: contextTransfer?.requestDigest,
    ...fields,
  })
}
