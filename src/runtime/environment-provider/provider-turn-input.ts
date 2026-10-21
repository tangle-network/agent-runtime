import { randomUUID } from 'node:crypto'
import { type AgentProfile, canonicalAgentProfileDigest } from '@tangle-network/agent-interface'
import type {
  AgentEnvironmentCapabilities,
  AgentTurnInput,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import type { PromptInputPart, PromptOptions } from '@tangle-network/sandbox'
import { promptOptionsFromAgentTurnInput } from '../turn-input'
import type { ProviderPromptOptions } from './provider-executor-admission'
import { ValidationError } from './provider-validation-error'

type ProviderTurnDefaults = Omit<
  AgentTurnInput,
  'model' | 'parts' | 'prompt' | 'sessionId' | 'signal'
>

/**
 * Lower the seam's prompt options onto turn fields, through the one mapper this module already
 * uses to raise a sandbox prompt into a provider turn. Reusing it is what keeps the two directions
 * from drifting: whatever `turnInputFromPrompt` decides a prompt option configures, the seam
 * declares the same way.
 */
export function providerTurnDefaults(
  options: ProviderPromptOptions | undefined,
  context: string,
): ProviderTurnDefaults | undefined {
  if (options === undefined) return undefined
  if ((options as { model?: unknown }).model !== undefined) {
    throw new ValidationError(
      `${context}: promptOptions.model is refused — this executor's materialization names AgentProfile's model, so a turn-level override would record a model the provider did not run`,
    )
  }
  const {
    prompt: _prompt,
    parts: _parts,
    model: _model,
    sessionId: _sessionId,
    signal: _signal,
    ...turn
  } = turnInputFromPrompt('', options)
  return turn
}

/**
 * Merge the declared turn defaults under one mapped turn.
 *
 * `providerOptions` is merged one level rather than replaced: the defaults carry the caller's
 * session credential and a `taskToTurn` that sets an unrelated provider option would otherwise
 * remove it, and a run that silently loses its credential fails inside the environment as an
 * authorization error that names nothing.
 */
export function providerTurnWithDefaults(
  defaults: ProviderTurnDefaults | undefined,
  turn: AgentTurnInput,
  signal: AbortSignal,
): AgentTurnInput {
  if (defaults === undefined) return { ...turn, signal }
  const providerOptions =
    defaults.providerOptions === undefined && turn.providerOptions === undefined
      ? undefined
      : { ...(defaults.providerOptions ?? {}), ...(turn.providerOptions ?? {}) }
  return {
    ...defaults,
    ...turn,
    ...(providerOptions === undefined ? {} : { providerOptions }),
    signal,
  }
}

/** Subscription selection needs its complete profile and one identity for each fresh turn. */
export function subscriptionTurnProfile(
  turn: AgentTurnInput,
  profile: AgentProfile,
): AgentTurnInput {
  if (profile.model?.metadata?.credentialSource !== 'subscription') return turn
  const backend = promptOptionsFromAgentTurnInput(turn).backend ?? {}
  const digest = canonicalAgentProfileDigest(profile)
  if (
    (turn.profile !== undefined && canonicalAgentProfileDigest(turn.profile) !== digest) ||
    (backend.profile !== undefined && canonicalAgentProfileDigest(backend.profile) !== digest)
  ) {
    throw new ValidationError('provider subscription turn cannot replace its exact AgentProfile')
  }
  return {
    ...turn,
    profile,
    ...(turn.turnId === undefined && turn.lastEventId === undefined && turn.controlRef === undefined
      ? { turnId: randomUUID() }
      : {}),
  }
}

export function hasRuntimeMcpAttachments(
  input: Partial<CreateAgentEnvironmentInput> | undefined,
): boolean {
  const mcp = input?.runtimeAttachments?.mcp
  return mcp !== undefined && Object.keys(mcp).length > 0
}

export function assertRuntimeMcpAttachments(
  provider: string,
  input: Partial<CreateAgentEnvironmentInput> | undefined,
  capabilities: AgentEnvironmentCapabilities | undefined,
): void {
  if (!hasRuntimeMcpAttachments(input)) return
  const create = capabilities?.create
  if (!create || !('runtimeAttachments' in create) || create.runtimeAttachments?.mcp !== true) {
    throw new ValidationError(
      `provider ${provider} does not advertise create.runtimeAttachments.mcp; no environment was created`,
    )
  }
}

export function turnInputFromPrompt(
  message: string | PromptInputPart[],
  options?: PromptOptions,
  profile?: AgentProfile,
): AgentTurnInput {
  const input: AgentTurnInput = {
    ...(typeof message === 'string' ? { prompt: message } : { parts: message }),
    ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options?.model ? { model: options.model } : {}),
    ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.executionId ? { executionId: options.executionId } : {}),
    ...(options?.lastEventId ? { lastEventId: options.lastEventId } : {}),
    ...(options?.turnId ? { turnId: options.turnId } : {}),
    ...(options?.detach !== undefined ? { detach: options.detach } : {}),
    ...(options?.context ? { context: options.context } : {}),
    ...(options?.runControlRef ? { controlRef: options.runControlRef } : {}),
    ...(options?.backend?.interactions ? { interactions: options.backend.interactions } : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
    ...(options?.backend ? { providerOptions: { backend: options.backend } } : {}),
  }
  return profile === undefined ? input : subscriptionTurnProfile(input, profile)
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
