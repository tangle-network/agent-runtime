import type { AgentProfile } from '@tangle-network/agent-interface'
import type { AgentTurnInput } from '@tangle-network/agent-interface/environment-provider'
import { BackendTransportError, ValidationError } from '../errors'
import type {
  AgentBackendContext,
  AgentExecutionBackend,
  BackendErrorDetail,
  RuntimeStreamEvent,
} from '../types'
import { streamAgentTurn } from './stream-agent-turn'
import { executableAgentProfileSnapshot } from './supervise/executable-spec'
import type { ExecutorFactory } from './supervise/types'

/**
 * Bind one exact profile and Runtime executor to the stable `AgentExecutionBackend` contract used
 * by `runAgentTaskStream` and conversations.
 *
 * Runtime still owns the model call through `streamAgentTurn`.
 * The adapter only translates the two stream protocols and carries the caller's request headers
 * into `ExecutorContext` so an HTTP executor can preserve authorization, recursion depth, and
 * trace identity.
 *
 * @stable
 */
export function createProfileExecutionBackend(options: {
  profile: AgentProfile
  executor: ExecutorFactory<unknown>
}): AgentExecutionBackend {
  const profile = executableAgentProfileSnapshot(options.profile, 'createProfileExecutionBackend')
  const executor = options.executor

  return {
    kind: 'runtime-profile',
    async *stream(input, context) {
      const propagatedHeaders = snapshotPropagatedHeaders(context.propagatedHeaders)
      const contextualExecutor: ExecutorFactory<unknown> = (spec, executorContext) =>
        executor(spec, {
          ...executorContext,
          ...(propagatedHeaders === undefined ? {} : { propagatedHeaders }),
        })
      const providerMessages = input.providerOptions?.messages
      const turnInput: AgentTurnInput =
        input.messages !== undefined
          ? { providerOptions: { messages: input.messages.map((message) => ({ ...message })) } }
          : Array.isArray(providerMessages)
            ? { providerOptions: { messages: structuredClone(providerMessages) } }
            : { prompt: input.message ?? context.task.intent }
      let terminal = false
      let emittedText = false

      for await (const event of streamAgentTurn(
        { kind: 'executor', profile, factory: contextualExecutor },
        turnInput,
        {
          signal: context.signal,
          ...(context.turnId ? { callId: context.turnId } : {}),
          ...(context.runId ? { correlationId: context.runId } : {}),
        },
      )) {
        if (event.type === 'backend_start') continue
        if (event.type === 'backend_error') throw backendError(event.error, event.message)
        if (event.type === 'final') {
          terminal = true
          if (event.status !== 'completed') {
            throw backendError(event.error, event.reason)
          }
          if (!emittedText && event.text) {
            yield {
              type: 'text_delta',
              task: context.task,
              session: context.session,
              text: event.text,
              timestamp: event.timestamp,
            }
          }
          continue
        }
        if (event.type === 'text_delta') emittedText = true
        yield rebindEvent(event, context)
      }

      if (!terminal) {
        throw new ValidationError(
          'createProfileExecutionBackend: streamAgentTurn ended without a terminal event',
        )
      }
    },
  }
}

function snapshotPropagatedHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined {
  if (headers === undefined) return undefined
  const snapshot: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== 'string') {
      throw new ValidationError(
        `createProfileExecutionBackend: propagated header ${JSON.stringify(name)} must be a string`,
      )
    }
    snapshot[name] = value
  }
  return Object.freeze(snapshot)
}

function backendError(detail: BackendErrorDetail | undefined, message: string): Error {
  if (detail?.kind === 'transport') {
    return new BackendTransportError('runtime-profile', detail.message, {
      status: detail.status,
      body: detail.body,
    })
  }
  return new Error(detail?.message ?? message)
}

function rebindEvent(event: RuntimeStreamEvent, context: AgentBackendContext): RuntimeStreamEvent {
  return {
    ...event,
    task: context.task,
    session: context.session,
  } as RuntimeStreamEvent
}
