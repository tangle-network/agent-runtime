import type {
  AgentInteractiveSessionAttach,
  AgentInteractiveSessionControlClaimAcknowledgement,
  AgentInteractiveSessionControlClaimRequest,
  AgentInteractiveSessionPromptAcknowledgement,
  AgentInteractiveSessionPromptCommand,
  AgentInteractiveSessionRef,
  AgentInteractiveSessionStart,
  AgentInteractiveSessionStatus,
  AgentInteractiveSessionStopAcknowledgement,
  AgentInteractiveSessionStopCommand,
  AgentInteractiveTerminalSession,
} from '@tangle-network/agent-interface'
import {
  AgentInteractiveSessionControlClaimAcknowledgementSchema,
  AgentInteractiveSessionControlClaimSchema,
  AgentInteractiveSessionPromptAcknowledgementSchema,
  AgentInteractiveSessionRefSchema,
  AgentInteractiveSessionStatusSchema,
  AgentInteractiveSessionStopAcknowledgementSchema,
  agentInteractiveSessionControlClaimAcknowledgementMatchesRequest,
  agentInteractiveSessionControlClaimMatchesRef,
  agentInteractiveSessionPromptAcknowledgementMatchesCommand,
  agentInteractiveSessionStatusMatchesRef,
  agentInteractiveSessionStopAcknowledgementMatchesCommand,
  canonicalCandidateDigest,
  TerminalReplayWindowSchema,
  TerminalSessionRefSchema,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
} from '@tangle-network/agent-interface/environment-provider'
import { RetainedInteractiveBindingError } from '../errors'
import type { RetainedInteractiveRunHandle } from './retained-interactive-types'
import { awaitAbortable, RetainedRunProviderContractError } from './retained-run-binding'
import { detachedSnapshot } from './supervise/snapshot'

export function createRetainedInteractiveRunHandle(
  environment: AgentEnvironment,
  inputRef: AgentInteractiveSessionRef,
  capabilities: AgentEnvironmentCapabilities,
  requestedStart?: AgentInteractiveSessionStart,
): RetainedInteractiveRunHandle {
  const ref = freezeInteractiveRef(inputRef)
  const source = environment.interactive!(ref)
  if (!sameInteractiveRef(source.ref, ref)) {
    throw new Error('provider reconstructed a different interactive process')
  }
  if (!source.sendPrompt) {
    throw new Error('provider declared interactive prompt support but exposed no prompt method')
  }
  return Object.freeze({
    ref,
    capabilities,
    claimControl: async (
      request: AgentInteractiveSessionControlClaimRequest,
      options?: { signal?: AbortSignal },
    ): Promise<AgentInteractiveSessionControlClaimAcknowledgement> =>
      exactClaim(
        ref,
        request,
        await awaitAbortable(
          Promise.resolve().then(() => source.claimControl(request, options)),
          options?.signal,
        ),
      ),
    status: async (options?: { signal?: AbortSignal }) =>
      exactStatus(
        ref,
        await awaitAbortable(
          Promise.resolve().then(() => source.status(options)),
          options?.signal,
        ),
        requestedStart,
      ),
    attach: async (request: AgentInteractiveSessionAttach, options?: { signal?: AbortSignal }) =>
      exactTerminal(
        ref,
        request,
        await awaitAbortable(
          Promise.resolve().then(() => source.attach(request, options)),
          options?.signal,
        ),
      ),
    sendPrompt: async (
      command: AgentInteractiveSessionPromptCommand,
      options?: { signal?: AbortSignal },
    ): Promise<AgentInteractiveSessionPromptAcknowledgement> =>
      exactPrompt(
        ref,
        await awaitAbortable(
          Promise.resolve().then(() => source.sendPrompt!(command, options)),
          options?.signal,
        ),
        command,
      ),
    stop: async (
      command: AgentInteractiveSessionStopCommand,
      options?: { signal?: AbortSignal },
    ): Promise<AgentInteractiveSessionStopAcknowledgement> =>
      exactStop(
        ref,
        await awaitAbortable(
          Promise.resolve().then(() => source.stop(command, options)),
          options?.signal,
        ),
        command,
      ),
  })
}

export function freezeInteractiveRef(
  value: AgentInteractiveSessionRef,
): AgentInteractiveSessionRef {
  return detachedSnapshot(AgentInteractiveSessionRefSchema.parse(value), 'interactive session ref')
}

function exactClaim(
  ref: AgentInteractiveSessionRef,
  request: AgentInteractiveSessionControlClaimRequest,
  value: unknown,
): AgentInteractiveSessionControlClaimAcknowledgement {
  const acknowledgement = parseProviderAcknowledgement(
    AgentInteractiveSessionControlClaimAcknowledgementSchema,
    value,
    'control claim',
  )
  if (!agentInteractiveSessionControlClaimAcknowledgementMatchesRequest(request, acknowledgement)) {
    throw new RetainedRunProviderContractError(
      'provider returned a control claim acknowledgement for another request',
    )
  }
  if (
    acknowledgement.control &&
    !agentInteractiveSessionControlClaimMatchesRef(ref, acknowledgement.control)
  ) {
    throw new RetainedRunProviderContractError(
      'provider returned a control claim for another interactive process',
    )
  }
  return acknowledgement
}

function exactPrompt(
  ref: AgentInteractiveSessionRef,
  value: unknown,
  command: AgentInteractiveSessionPromptCommand,
): AgentInteractiveSessionPromptAcknowledgement {
  const acknowledgement = parseProviderAcknowledgement(
    AgentInteractiveSessionPromptAcknowledgementSchema,
    value,
    'prompt',
  )
  if (!agentInteractiveSessionPromptAcknowledgementMatchesCommand(command, acknowledgement)) {
    throw new RetainedRunProviderContractError(
      'provider returned a prompt acknowledgement for another request',
    )
  }
  if (!agentInteractiveSessionControlClaimMatchesRef(ref, acknowledgement.control)) {
    throw new RetainedRunProviderContractError(
      'provider returned a prompt acknowledgement for another interactive process',
    )
  }
  return acknowledgement
}

function exactStop(
  ref: AgentInteractiveSessionRef,
  value: unknown,
  command: AgentInteractiveSessionStopCommand,
): AgentInteractiveSessionStopAcknowledgement {
  const acknowledgement = parseProviderAcknowledgement(
    AgentInteractiveSessionStopAcknowledgementSchema,
    value,
    'stop',
  )
  if (!agentInteractiveSessionStopAcknowledgementMatchesCommand(command, acknowledgement)) {
    throw new RetainedRunProviderContractError(
      'provider returned a stop acknowledgement for another request',
    )
  }
  if (!agentInteractiveSessionControlClaimMatchesRef(ref, acknowledgement.control)) {
    throw new RetainedRunProviderContractError(
      'provider returned a stop acknowledgement for another interactive process',
    )
  }
  return acknowledgement
}

function parseProviderAcknowledgement<T>(
  schema: { parse(value: unknown): T },
  value: unknown,
  operation: string,
): T {
  try {
    return schema.parse(value)
  } catch {
    throw new RetainedRunProviderContractError(
      `provider returned an invalid interactive ${operation} acknowledgement`,
    )
  }
}

function exactStatus(
  ref: AgentInteractiveSessionRef,
  value: AgentInteractiveSessionStatus,
  requestedStart?: AgentInteractiveSessionStart,
): AgentInteractiveSessionStatus {
  let status: AgentInteractiveSessionStatus
  try {
    status = AgentInteractiveSessionStatusSchema.parse(value)
  } catch (error) {
    if (requestedStart === undefined) throw error
    throw new RetainedInteractiveBindingError(
      detachedSnapshot(requestedStart, 'interactive status binding request'),
      {},
      { cause: error },
    )
  }
  if (!agentInteractiveSessionStatusMatchesRef(ref, status)) {
    if (requestedStart !== undefined) {
      throw new RetainedInteractiveBindingError(
        detachedSnapshot(requestedStart, 'interactive status binding request'),
        detachedSnapshot(
          { status: detachedSnapshot(status, 'interactive provider status') },
          'interactive provider status result',
        ),
        { cause: new Error('provider returned status for another interactive process') },
      )
    }
    throw new Error('provider returned status for another interactive process')
  }
  return status
}

function exactTerminal(
  ref: AgentInteractiveSessionRef,
  request: AgentInteractiveSessionAttach,
  terminal: AgentInteractiveTerminalSession,
): AgentInteractiveTerminalSession {
  const terminalRef = TerminalSessionRefSchema.parse(terminal.ref)
  TerminalReplayWindowSchema.parse(terminal.cursors)
  if (terminalRef.parentExecutionId !== ref.run.executionId) {
    throw new Error('provider attached a terminal from another interactive run')
  }
  AgentInteractiveSessionControlClaimSchema.parse(terminal.control)
  if (!agentInteractiveSessionControlClaimMatchesRef(ref, terminal.control)) {
    throw new Error('provider attached a terminal with a claim for another interactive process')
  }
  if (canonicalCandidateDigest(terminal.control) !== canonicalCandidateDigest(request.control)) {
    throw new Error('provider attached a terminal with a different interactive control claim')
  }
  return terminal
}

function sameInteractiveRef(
  left: AgentInteractiveSessionRef,
  right: AgentInteractiveSessionRef,
): boolean {
  return canonicalCandidateDigest(left) === canonicalCandidateDigest(right)
}
