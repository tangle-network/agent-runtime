import { type TokenUsage } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentSession,
  AgentSessionStatus,
  AgentTurnResult,
  CheckpointRequest,
  ForkRequest,
} from '@tangle-network/agent-interface/environment-provider'
import type {
  PromptInputPart,
  PromptOptions,
  PromptResult,
  SandboxEvent,
  SandboxInstance,
} from '@tangle-network/sandbox'
import {
  exactSessionCancel,
  exactSessionResult,
  terminalOutcomeFromEvents,
  ValidationError,
} from './environment-provider-adapters'
import {
  isTerminalEnvironmentEvent,
  mergeTokenUsage,
  resultFromEvents,
  sandboxDispatchResultFromSessionRef,
  sandboxEventFromEnvironmentEvent,
  textFromEnvironmentEvent,
  usageSandboxEvent,
} from './environment-provider-events'
import { turnInputFromPrompt } from './environment-provider-input'
import { type SandboxSessionLike } from './environment-provider-support'
import { abortableAsyncIterable, awaitAbortable } from './turn-timeout'

export function environmentAsSandboxInstance(
  environment: AgentEnvironment,
  options: { requireTerminalEvent: boolean },
): SandboxInstance {
  const box = {
    id: environment.id,
    name: environment.name,
    status: 'running',
    async refresh(): Promise<void> {
      await environment.refresh?.()
    },
    async *streamPrompt(
      message: string | PromptInputPart[],
      promptOptions?: PromptOptions,
    ): AsyncGenerator<SandboxEvent> {
      let terminal = false
      const input = turnInputFromPrompt(message, promptOptions)
      let cancellation: Promise<void> | undefined
      let cancellationStarted = false
      let cancellationFailed = false
      let cancellationError: unknown
      const cancel = () => {
        if (cancellationStarted || !input.sessionId || !environment.session) return
        cancellationStarted = true
        try {
          cancellation = exactSessionCancel(environment.session(input.sessionId), input.executionId)
            .then(() => undefined)
            .catch((error: unknown) => {
              cancellationFailed = true
              cancellationError = error
            })
        } catch (error) {
          cancellationFailed = true
          cancellationError = error
        }
      }
      input.signal?.addEventListener('abort', cancel, { once: true })
      if (input.signal?.aborted) cancel()
      let streamFailed = false
      let streamError: unknown
      try {
        const stream = environment.stream(input)
        const events = input.signal ? abortableAsyncIterable(stream, input.signal) : stream
        for await (const event of events) {
          if (isTerminalEnvironmentEvent(event)) terminal = true
          const usageEvent = usageSandboxEvent(event)
          if (usageEvent) yield usageEvent
          yield sandboxEventFromEnvironmentEvent(event)
        }
      } catch (error) {
        streamFailed = true
        streamError = error
      } finally {
        input.signal?.removeEventListener('abort', cancel)
        if (input.signal?.aborted) {
          cancel()
          if (cancellation) {
            try {
              await awaitAbortable(cancellation, input.signal)
            } catch {
              // Preserve the caller's abort reason; cancellation is best effort.
            }
          }
        }
      }
      if (input.signal?.aborted) {
        const causes = [
          ...(streamFailed ? [streamError] : []),
          ...(cancellationFailed ? [cancellationError] : []),
        ]
        const reason = input.signal.reason
        const abortError =
          causes.length === 0 && reason instanceof Error
            ? reason
            : new DOMException(
                reason === undefined
                  ? 'Provider session stream aborted'
                  : reason instanceof Error
                    ? reason.message
                    : String(reason),
                'AbortError',
              )
        if (causes.length > 0) {
          Object.defineProperty(abortError, 'cause', {
            value: causes.length === 1 ? causes[0] : new AggregateError(causes),
          })
        }
        throw abortError
      }
      if (streamFailed) throw streamError
      if (cancellationFailed) throw cancellationError
      if (options.requireTerminalEvent && !terminal) {
        throw new ValidationError(
          `providerAsSandboxClient(${environment.provider}): stream ended without a terminal result/done/status event`,
        )
      }
    },
    async prompt(
      message: string | PromptInputPart[],
      promptOptions?: PromptOptions,
    ): Promise<PromptResult> {
      const events: AgentEnvironmentEvent[] = []
      let text = ''
      let usage: TokenUsage | undefined
      let terminal = false
      const input = turnInputFromPrompt(message, promptOptions)
      const stream = environment.stream(input)
      const eventsStream = input.signal ? abortableAsyncIterable(stream, input.signal) : stream
      for await (const event of eventsStream) {
        events.push(event)
        if (isTerminalEnvironmentEvent(event)) terminal = true
        text += textFromEnvironmentEvent(event)
        usage = mergeTokenUsage(usage, event.usage)
      }
      if (options.requireTerminalEvent && !terminal) {
        throw new ValidationError(
          `providerAsSandboxClient(${environment.provider}): prompt ended without a terminal result/done/status event`,
        )
      }
      const outcome = terminalOutcomeFromEvents(events, isTerminalEnvironmentEvent)
      return {
        response: resultFromEvents(events, text).content,
        success: outcome.success,
        status: outcome.status,
        durationMs: 0,
        ...(outcome.error === undefined ? {} : { error: outcome.error }),
        ...(usage ? { usage } : {}),
      }
    },
    ...(environment.dispatch && environment.session
      ? {
          async dispatchPrompt(message: string | PromptInputPart[], promptOptions?: PromptOptions) {
            const session = await environment.dispatch?.(
              turnInputFromPrompt(message, promptOptions),
            )
            if (!session)
              throw new ValidationError('providerAsSandboxClient: dispatch returned no session')
            return sandboxDispatchResultFromSessionRef(session)
          },
        }
      : {}),
    ...(environment.session
      ? {
          session(id: string) {
            return sandboxSessionFromAgentSession(environment.session?.(id))
          },
        }
      : {}),
    ...(environment.read ? { read: environment.read.bind(environment) } : {}),
    ...(environment.write ? { write: environment.write.bind(environment) } : {}),
    ...(environment.exec ? { exec: environment.exec.bind(environment) } : {}),
    ...(environment.checkpoint
      ? {
          async checkpoint(checkpointOptions?: CheckpointRequest) {
            const checkpoint = await environment.checkpoint?.(checkpointOptions)
            return { checkpointId: checkpoint?.id, id: checkpoint?.id }
          },
        }
      : {}),
    ...(environment.fork
      ? {
          async fork(checkpointId: string, forkOptions?: ForkRequest) {
            const forked = await environment.fork?.({ id: checkpointId }, forkOptions)
            if (!forked)
              throw new ValidationError('providerAsSandboxClient: fork returned no environment')
            return environmentAsSandboxInstance(forked, options)
          },
        }
      : {}),
    async delete(): Promise<void> {
      await environment.destroy?.()
    },
  }
  return box as unknown as SandboxInstance
}

function sandboxSessionFromAgentSession(session: AgentSession | undefined): SandboxSessionLike {
  if (!session) throw new ValidationError('providerAsSandboxClient: session is unavailable')
  return {
    id: session.id,
    async status() {
      const status = await session.status()
      return status
        ? { id: session.id, status: sandboxSessionStatusFromAgentSessionStatus(status) }
        : null
    },
    async *events(options): AsyncGenerator<SandboxEvent> {
      const stream = session.events(options)
      const events = options?.signal ? abortableAsyncIterable(stream, options.signal) : stream
      for await (const event of events) yield sandboxEventFromEnvironmentEvent(event)
    },
    async result(options?: { executionId?: string }): Promise<PromptResult> {
      return promptResultFromAgentTurnResult(
        await exactSessionResult(session, options?.executionId),
      )
    },
    async prompt(message, options): Promise<PromptResult> {
      const input = turnInputFromPrompt(message, options)
      const prompt = session.prompt(input)
      const result = input.signal ? await awaitAbortable(prompt, input.signal) : await prompt
      return promptResultFromAgentTurnResult(result)
    },
    interrupt(options) {
      return exactSessionCancel(session, options?.executionId)
    },
  }
}

function sandboxSessionStatusFromAgentSessionStatus(
  status: AgentSessionStatus,
): 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' {
  switch (status) {
    case 'pending':
    case 'provisioning':
      return 'queued'
    case 'running':
      return 'running'
    case 'completed':
      return 'completed'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'failed'
  }
}

function promptResultFromAgentTurnResult(result: AgentTurnResult): PromptResult {
  return {
    response: result.text,
    success: result.success,
    status: result.success ? 'success' : 'failed',
    durationMs: 0,
    ...(result.error ? { error: result.error } : {}),
    ...(result.usage
      ? {
          usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
          ...(result.usage.cost === undefined ? {} : { costUsd: result.usage.cost }),
        }
      : {}),
    ...(typeof result.metadata?.executionId === 'string'
      ? { executionId: result.metadata.executionId }
      : {}),
    ...(result.contextTransferReceipt
      ? { contextTransferReceipt: result.contextTransferReceipt }
      : {}),
  }
}
