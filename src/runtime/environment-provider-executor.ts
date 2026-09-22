import type { AgentProfile } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentTurnInput,
} from '@tangle-network/agent-interface/environment-provider'
import { canonicalEventFromEnvironmentEvent } from './environment-provider-adapters'
import {
  isTerminalEnvironmentEvent,
  resultFromEvents,
  textFromEnvironmentEvent,
  usageFromEnvironmentEvent,
} from './environment-provider-events'
import { taskToTurnInput } from './environment-provider-input'
import { contentRef, mergeAbortSignals } from './environment-provider-support'
import { extractTransportEventIdentity } from './sandbox-transport-events'
import type {
  Executor,
  ExecutorContext,
  ExecutorFactory,
  ExecutorResult,
  Runtime,
  Spend,
  UsageEvent,
} from './supervise/types'
import { abortableAsyncIterable, awaitAbortable } from './turn-timeout'
import { zeroTokenUsage } from './util'

/** Options for running an environment provider as a supervise-mode executor. @experimental */
export interface ProviderExecutorOptions {
  defaults?: Partial<
    import('@tangle-network/agent-interface/environment-provider').CreateAgentEnvironmentInput
  >
  runtime?: Runtime
  destroyOnSettle?: boolean
  requireTerminalEvent?: boolean
  taskToTurn?: (task: unknown, specProfile: AgentProfile) => AgentTurnInput
}

/** Adapt an environment provider into an ExecutorFactory for createExecutor. @experimental */
export function providerAsExecutor(
  provider: AgentEnvironmentProvider,
  options: ProviderExecutorOptions = {},
): ExecutorFactory<unknown> {
  return (spec, ctx) => createProviderExecutor(provider, spec.profile, ctx, options)
}

function createProviderExecutor(
  provider: AgentEnvironmentProvider,
  profile: AgentProfile,
  ctx: ExecutorContext,
  options: ProviderExecutorOptions,
): Executor<unknown> {
  const controller = new AbortController()
  const abortIfSignalled = () => {
    if (ctx.signal.aborted) controller.abort(ctx.signal.reason)
  }
  abortIfSignalled()
  if (!ctx.signal.aborted) ctx.signal.addEventListener('abort', abortIfSignalled, { once: true })

  let environment: AgentEnvironment | undefined
  let artifact: ExecutorResult<unknown> | undefined
  return {
    runtime: options.runtime ?? (provider.name as Runtime),
    execute(task, signal): AsyncIterable<UsageEvent> {
      return streamProviderExecutor({
        provider,
        profile,
        task,
        signal,
        controller,
        options,
        onEnvironment: (next) => {
          environment = next
        },
        onArtifact: (next) => {
          artifact = next
        },
      })
    },
    async teardown(_grace): Promise<{ destroyed: boolean }> {
      ctx.signal.removeEventListener('abort', abortIfSignalled)
      controller.abort()
      if (environment) {
        try {
          await awaitAbortable(
            Promise.resolve().then(() => environment?.destroy?.()),
            ctx.signal,
          )
        } catch (error) {
          if (!ctx.signal.aborted) throw error
        }
      }
      return { destroyed: true }
    },
    resultArtifact(): ExecutorResult<unknown> {
      if (!artifact) {
        throw new Error(
          `providerAsExecutor(${provider.name}): resultArtifact() read before stream drained`,
        )
      }
      return artifact
    },
  }
}

interface StreamProviderExecutorArgs {
  provider: AgentEnvironmentProvider
  profile: AgentProfile
  task: unknown
  signal: AbortSignal
  controller: AbortController
  options: ProviderExecutorOptions
  onEnvironment: (environment: AgentEnvironment) => void
  onArtifact: (artifact: ExecutorResult<unknown>) => void
}

async function* streamProviderExecutor(
  args: StreamProviderExecutorArgs,
): AsyncIterable<UsageEvent> {
  const started = Date.now()
  const linked = mergeAbortSignals(args.signal, args.controller.signal)
  let environment: AgentEnvironment | undefined
  let cleanupFailed = false
  let cleanupError: unknown
  try {
    environment = await args.provider.create({
      ...(args.options.defaults ?? {}),
      profile: args.profile,
      signal: linked.signal,
    })
    args.onEnvironment(environment)
    const turn =
      args.options.taskToTurn?.(args.task, args.profile) ??
      taskToTurnInput(args.task, linked.signal)
    const events: AgentEnvironmentEvent[] = []
    const tokens = zeroTokenUsage()
    let usd = 0
    let text = ''
    let terminal = false
    for await (const event of abortableAsyncIterable(
      environment.stream({ ...turn, signal: linked.signal }),
      linked.signal,
    )) {
      events.push(event)
      const canonical = canonicalEventFromEnvironmentEvent(event)
      if (canonical) {
        const identity = extractTransportEventIdentity(event)
        yield {
          kind: 'runtime_event',
          event: canonical,
          ...(identity.eventId === undefined ? {} : { eventId: identity.eventId }),
          ...(identity.cursor === undefined ? {} : { cursor: identity.cursor }),
          ...(identity.sequence === undefined ? {} : { sequence: identity.sequence }),
          ...(identity.occurredAt === undefined ? {} : { occurredAt: identity.occurredAt }),
        }
      }
      text += textFromEnvironmentEvent(event)
      const usage = usageFromEnvironmentEvent(event)
      if (usage.input || usage.output) {
        tokens.input += usage.input
        tokens.output += usage.output
        yield { kind: 'tokens', input: usage.input, output: usage.output }
      }
      if (usage.usd) {
        usd += usage.usd
        yield { kind: 'cost', usd: usage.usd }
      }
      if (isTerminalEnvironmentEvent(event)) terminal = true
    }
    if ((args.options.requireTerminalEvent ?? true) && !terminal) {
      throw new Error(
        `providerAsExecutor(${args.provider.name}): stream ended without a terminal result/done/status event`,
      )
    }
    yield { kind: 'iteration' }
    const result = resultFromEvents(events, text)
    const spent: Spend = { iterations: 1, tokens, usd, ms: Date.now() - started }
    args.onArtifact({
      outRef: contentRef(`provider:${args.provider.name}`, result),
      out: result,
      spent,
    })
  } finally {
    try {
      if ((args.options.destroyOnSettle ?? true) && environment) {
        try {
          await awaitAbortable(
            Promise.resolve().then(() => environment?.destroy?.()),
            linked.signal,
          )
        } catch (error) {
          if (!linked.signal.aborted) {
            cleanupFailed = true
            cleanupError = error
          }
        }
      }
    } finally {
      linked.dispose()
    }
  }
  if (cleanupFailed) throw cleanupError
}
