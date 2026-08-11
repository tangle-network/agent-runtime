import type { ContextTransferRequest } from '@tangle-network/agent-interface'
import type { AgentTurnInput } from '@tangle-network/agent-interface/environment-provider'

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
