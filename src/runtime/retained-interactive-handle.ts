import type {
  AgentInteractiveSessionRef,
  AgentInteractiveSessionStart,
  AgentInteractiveSessionStatus,
  AgentTerminalSession,
} from '@tangle-network/agent-interface'
import {
  AgentInteractiveSessionRefSchema,
  AgentInteractiveSessionStatusSchema,
  agentInteractiveSessionStatusMatchesRef,
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
import { awaitAbortable } from './retained-run-binding'
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
    status: async (options?: { signal?: AbortSignal }) =>
      exactStatus(
        ref,
        await awaitAbortable(
          Promise.resolve().then(() => source.status(options)),
          options?.signal,
        ),
        requestedStart,
      ),
    attach: async (
      request?: { cols?: number; rows?: number },
      options?: { signal?: AbortSignal },
    ) =>
      exactTerminal(
        ref,
        await awaitAbortable(
          Promise.resolve().then(() => source.attach(request, options)),
          options?.signal,
        ),
      ),
    sendPrompt: async (prompt: string, options?: { signal?: AbortSignal }) =>
      await awaitAbortable(
        Promise.resolve().then(() => source.sendPrompt!(prompt, options)),
        options?.signal,
      ),
    stop: async (options?: { signal?: AbortSignal }) =>
      exactStatus(
        ref,
        await awaitAbortable(
          Promise.resolve().then(() => source.stop(options)),
          options?.signal,
        ),
        requestedStart,
      ),
  })
}

export function freezeInteractiveRef(
  value: AgentInteractiveSessionRef,
): AgentInteractiveSessionRef {
  const ref = AgentInteractiveSessionRefSchema.parse(value)
  return Object.freeze({ ...ref, run: Object.freeze({ ...ref.run }) })
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
  terminal: AgentTerminalSession,
): AgentTerminalSession {
  const terminalRef = TerminalSessionRefSchema.parse(terminal.ref)
  TerminalReplayWindowSchema.parse(terminal.cursors)
  if (terminalRef.parentExecutionId !== ref.run.executionId) {
    throw new Error('provider attached a terminal from another interactive run')
  }
  return terminal
}

function sameInteractiveRef(
  left: AgentInteractiveSessionRef,
  right: AgentInteractiveSessionRef,
): boolean {
  return canonicalCandidateDigest(left) === canonicalCandidateDigest(right)
}
