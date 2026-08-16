import {
  AgentExactRunControlRefSchema,
  type ContextTransferRequest,
  type InputPart,
} from '@tangle-network/agent-interface'
import type { AgentTurnInput } from '@tangle-network/agent-interface/environment-provider'
import type { PromptInputPart, PromptOptions } from '@tangle-network/sandbox'

/**
 * Copy only fields that describe a new provider turn.
 *
 * Session, replay, continuation, and transfer coordinates are runtime-owned
 * and are injected by the caller that owns that lifecycle. Keeping this copy
 * explicit also makes JavaScript callers subject to the same boundary.
 */
export function freshTurnInput(
  input: AgentTurnInput,
  runtime: {
    readonly turnId: string
    readonly detach: true
    readonly sessionId?: string
    readonly executionId?: string
    readonly contextTransfer?: ContextTransferRequest
  },
): AgentTurnInput {
  const fresh: AgentTurnInput = {
    ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
    ...(input.parts === undefined ? {} : { parts: input.parts }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.context === undefined ? {} : { context: input.context }),
    ...(input.interactions === undefined ? {} : { interactions: input.interactions }),
    ...(input.providerOptions === undefined ? {} : { providerOptions: input.providerOptions }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    turnId: runtime.turnId,
    detach: runtime.detach,
    ...(runtime.sessionId === undefined ? {} : { sessionId: runtime.sessionId }),
    ...(runtime.executionId === undefined ? {} : { executionId: runtime.executionId }),
    ...(runtime.contextTransfer === undefined ? {} : { contextTransfer: runtime.contextTransfer }),
  }
  return fresh
}

/** Project canonical turn parts onto the Sandbox prompt vocabulary once. */
export function promptFromAgentTurnInput(input: AgentTurnInput): string | PromptInputPart[] {
  if (input.parts !== undefined) return input.parts.map(promptPartFromInputPart)
  return input.prompt ?? ''
}

/** Project canonical turn controls onto the Sandbox prompt options once. */
export function promptOptionsFromAgentTurnInput(input: AgentTurnInput): PromptOptions {
  const providerBackend =
    input.providerOptions?.backend &&
    typeof input.providerOptions.backend === 'object' &&
    !Array.isArray(input.providerOptions.backend)
      ? (input.providerOptions.backend as NonNullable<PromptOptions['backend']>)
      : undefined
  const backend = {
    ...(providerBackend ?? {}),
    ...(input.interactions === undefined ? {} : { interactions: input.interactions }),
  }
  const runControlRef =
    input.controlRef === undefined
      ? undefined
      : AgentExactRunControlRefSchema.parse(input.controlRef)
  return {
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.context === undefined ? {} : { context: input.context }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.executionId === undefined ? {} : { executionId: input.executionId }),
    ...(input.lastEventId === undefined ? {} : { lastEventId: input.lastEventId }),
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.detach === undefined ? {} : { detach: input.detach }),
    ...(runControlRef === undefined ? {} : { runControlRef }),
    ...(Object.keys(backend).length === 0 ? {} : { backend }),
  }
}

/** Read a text fallback from provider-specific conversation options. */
export function providerMessageText(
  providerOptions: Record<string, unknown> | undefined,
): string | undefined {
  const messages = providerOptions?.messages
  if (!Array.isArray(messages)) return undefined
  const last = messages.at(-1)
  if (!last || typeof last !== 'object' || Array.isArray(last)) return undefined
  if (!('content' in last)) return undefined
  const content = last.content
  return typeof content === 'string' ? content : undefined
}

function promptPartFromInputPart(part: InputPart): PromptInputPart {
  if (part.type === 'text' || part.type === 'image') return part
  if (part.content !== undefined || part.path !== undefined) {
    throw new Error(
      'Sandbox file prompt parts require a URL; inline content and local paths are not representable',
    )
  }
  if (!part.filename || !part.url) {
    throw new Error('Sandbox file prompt parts require both filename and URL')
  }
  return {
    type: 'file',
    filename: part.filename,
    ...(part.mediaType === undefined ? {} : { mediaType: part.mediaType }),
    url: part.url,
  }
}
