import type { AgentProfile, InputPart } from '@tangle-network/agent-interface'
import type {
  AgentProfileRef,
  AgentTurnInput,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import type {
  BackendType,
  CreateSandboxOptions,
  PromptInputPart,
  PromptOptions,
} from '@tangle-network/sandbox'
import { ValidationError } from './environment-provider-adapters'
import { profileAsSandboxProfile, sandboxProfileAsProfile } from './sandbox-backend'

/** Resolve a named profile before passing it to Sandbox, which accepts inline profiles only. */
export type ResolveSandboxProfile = (profileId: string) => AgentProfile | Promise<AgentProfile>

export function createInputFromSandboxOptions(
  options: CreateSandboxOptions | undefined,
): Partial<CreateAgentEnvironmentInput> {
  const profile = options?.backend?.profile
  const backend = options?.backend?.type
  const workspace = {
    ...(options?.environment ? { environment: options.environment } : {}),
    ...(options?.git?.url ? { repoUrl: options.git.url } : {}),
    ...(options?.git?.ref ? { gitRef: options.git.ref } : {}),
  }
  return {
    ...(profile !== undefined ? { profile: sandboxProfileAsProfile(profile) } : {}),
    ...(backend ? { backend } : {}),
    ...(Object.keys(workspace).length > 0 ? { workspace } : {}),
    ...(options?.resources
      ? { resources: options.resources as CreateAgentEnvironmentInput['resources'] }
      : {}),
    ...(options?.env ? { env: options.env } : {}),
    ...(options?.secrets ? { secrets: options.secrets } : {}),
    ...(options?.metadata ? { metadata: options.metadata } : {}),
    ...(options?.name ? { name: options.name } : {}),
    ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    providerOptions: { sandboxCreateOptions: options ?? {} },
  }
}

export async function sandboxOptionsFromCreateInput(
  input: CreateAgentEnvironmentInput,
  defaultBackend: BackendType,
  resolveProfile?: ResolveSandboxProfile,
): Promise<CreateSandboxOptions> {
  const backendType = (input.backend ?? defaultBackend) as BackendType
  const workspace = input.workspace ?? {}
  const environment = sandboxEnvironmentFromWorkspace(workspace)
  const providerOptions = input.providerOptions?.sandboxCreateOptions
  const base =
    providerOptions && typeof providerOptions === 'object'
      ? ({ ...(providerOptions as CreateSandboxOptions) } as CreateSandboxOptions)
      : ({} satisfies CreateSandboxOptions)
  assertSandboxSecretNames(input.secrets)
  assertSandboxSecretNames((base as { secrets?: unknown }).secrets)
  const profile = await sandboxProfileFromReference(input.profile, resolveProfile)
  const { profile: _baseProfile, ...baseBackend } = base.backend ?? {}
  return {
    ...base,
    ...(environment ? { environment } : {}),
    ...(workspace.repoUrl ? { git: { url: workspace.repoUrl, ref: workspace.gitRef } } : {}),
    ...(input.resources ? { resources: input.resources as CreateSandboxOptions['resources'] } : {}),
    ...(input.env ? { env: input.env } : {}),
    ...(Array.isArray(input.secrets) ? { secrets: input.secrets } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    ...(input.name ? { name: input.name } : {}),
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    backend: { ...baseBackend, type: backendType, profile: profileAsSandboxProfile(profile) },
  }
}

function assertSandboxSecretNames(secrets: unknown): asserts secrets is string[] | undefined {
  if (
    secrets !== undefined &&
    (!Array.isArray(secrets) ||
      secrets.some((secret) => typeof secret !== 'string' || secret.trim().length === 0))
  ) {
    throw new ValidationError(
      'Tangle Sandbox secret names must be non-empty strings; secret values are unsupported',
    )
  }
}

function sandboxEnvironmentFromWorkspace(
  workspace: NonNullable<CreateAgentEnvironmentInput['workspace']>,
): string | undefined {
  if (
    workspace.environment !== undefined &&
    workspace.image !== undefined &&
    workspace.environment !== workspace.image
  ) {
    throw new ValidationError(
      'Tangle Sandbox accepts one environment value; workspace.environment and workspace.image must match',
    )
  }
  return workspace.environment ?? workspace.image
}

async function sandboxProfileFromReference(
  profile: AgentProfileRef,
  resolveProfile?: ResolveSandboxProfile,
): Promise<AgentProfile> {
  if (typeof profile !== 'string') return profile
  if (!resolveProfile) {
    throw new ValidationError(
      `Tangle Sandbox requires an inline AgentProfile; named profile "${profile}" needs SandboxClientProviderOptions.resolveProfile`,
    )
  }
  return resolveProfile(profile)
}

export function turnInputFromPrompt(
  message: string | PromptInputPart[],
  options?: PromptOptions,
): AgentTurnInput {
  return {
    ...(typeof message === 'string' ? { prompt: message } : { parts: message }),
    ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options?.model ? { model: options.model } : {}),
    ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options?.context ? { context: options.context } : {}),
    ...(options?.executionId ? { executionId: options.executionId } : {}),
    ...(options?.lastEventId ? { lastEventId: options.lastEventId } : {}),
    ...(options?.turnId ? { turnId: options.turnId } : {}),
    ...(options?.detach !== undefined ? { detach: options.detach } : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
    ...(options?.backend ? { providerOptions: { backend: options.backend } } : {}),
  }
}

export function promptFromTurnInput(input: AgentTurnInput): string | PromptInputPart[] {
  if (input.parts) return input.parts.map(promptPartFromInputPart)
  return input.prompt ?? ''
}

function promptPartFromInputPart(part: InputPart): PromptInputPart {
  if (part.type === 'text' || part.type === 'image') return part
  if (part.content !== undefined || part.path !== undefined) {
    throw new ValidationError(
      'Tangle Sandbox file prompt parts require a URL; inline content and local paths are not representable',
    )
  }
  if (!part.filename || !part.url) {
    throw new ValidationError('Tangle Sandbox file prompt parts require both filename and URL')
  }
  return {
    type: 'file',
    filename: part.filename,
    ...(part.mediaType ? { mediaType: part.mediaType } : {}),
    url: part.url,
  }
}

export function promptOptionsFromTurnInput(input: AgentTurnInput): PromptOptions {
  return {
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.context ? { context: input.context } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.executionId ? { executionId: input.executionId } : {}),
    ...(input.lastEventId ? { lastEventId: input.lastEventId } : {}),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.detach !== undefined ? { detach: input.detach } : {}),
  }
}

export function taskToTurnInput(task: unknown, signal: AbortSignal): AgentTurnInput {
  return { prompt: taskToPrompt(task), signal }
}

function taskToPrompt(task: unknown): string {
  if (typeof task === 'string') return task
  if (task && typeof task === 'object') {
    const record = task as Record<string, unknown>
    for (const key of ['prompt', 'content', 'task', 'message']) {
      if (typeof record[key] === 'string') return record[key]
    }
  }
  return JSON.stringify(task)
}
