import type { AgentProfile, AgentProfileValidationResult } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentEnvironmentStatus,
  AgentTurnInput,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import { ValidationError } from '../errors'
import type { AgentSpec, Executor, ExecutorFactory, ExecutorResult } from './supervise/types'
import { abortError, throwIfAborted } from './util'

export interface InlineEnvironmentProviderOptions {
  /** Provider name reported by environments. Default `inline`. */
  name?: string
  /** Override the default capabilities when the executor supports less. */
  capabilities?: AgentEnvironmentCapabilities
  /** Validate profiles before an executor is created. */
  validateProfile?: (
    profile: AgentProfile,
  ) => AgentProfileValidationResult | Promise<AgentProfileValidationResult>
}

/**
 * Adapt an executor factory into an environment provider.
 *
 * One executor is created per turn and always torn down after it settles.
 */
export function inlineEnvironmentProvider(
  factory: ExecutorFactory<unknown>,
  options: InlineEnvironmentProviderOptions = {},
): AgentEnvironmentProvider {
  const providerName = options.name ?? 'inline'
  if (providerName.trim().length === 0) {
    throw new ValidationError('inline environment provider name must be non-empty')
  }
  let sequence = 0

  const validateProfile = async (
    profile: AgentProfile | string,
  ): Promise<AgentProfileValidationResult> => {
    if (typeof profile === 'string') {
      return {
        ok: false,
        issues: [
          {
            level: 'error',
            code: 'named_profile_unsupported',
            message: `${providerName}: named profiles require a provider catalog`,
          },
        ],
      }
    }
    return (
      (await options.validateProfile?.(profile)) ?? {
        ok: true,
        issues: [],
        normalizedProfile: profile,
      }
    )
  }

  return {
    name: providerName,
    capabilities: () => options.capabilities ?? defaultInlineCapabilities(),
    validateProfile,
    async create(input: CreateAgentEnvironmentInput): Promise<AgentEnvironment> {
      throwIfAborted(input.signal)
      const validation = await validateProfile(input.profile)
      const profile = validatedProfile(providerName, input.profile, validation)
      throwIfAborted(input.signal)

      const id = `inline-${sequence++}`
      const environmentController = new AbortController()
      const activeExecutors = new Set<Executor<unknown>>()
      const teardownByExecutor = new WeakMap<Executor<unknown>, Promise<void>>()
      let destroyed = false
      let destroyPromise: Promise<void> | undefined

      const teardown = (executor: Executor<unknown>): Promise<void> => {
        const existing = teardownByExecutor.get(executor)
        if (existing) return existing
        const pending = Promise.resolve()
          .then(() => executor.teardown('brutalKill'))
          .then(() => undefined)
          .catch(() => undefined)
        teardownByExecutor.set(executor, pending)
        return pending
      }
      const destroy = (): Promise<void> => {
        if (destroyPromise) return destroyPromise
        destroyed = true
        environmentController.abort()
        destroyPromise = Promise.all(Array.from(activeExecutors, teardown)).then(() => undefined)
        return destroyPromise
      }

      const environment: AgentEnvironment = {
        id,
        provider: providerName,
        ...(input.name ? { name: input.name } : {}),
        async status(): Promise<AgentEnvironmentStatus> {
          return destroyed ? 'stopped' : 'running'
        },
        async *stream(turn: AgentTurnInput): AsyncIterable<AgentEnvironmentEvent> {
          if (destroyed) {
            throw new ValidationError(`${providerName}: environment has been destroyed`)
          }
          const signal = combinedSignal(environmentController.signal, turn.signal)
          throwIfAborted(signal)
          const spec: AgentSpec = { profile, harness: null }
          const executor = factory(spec, {
            signal,
            seams: { createInput: input, turnInput: turn },
          })
          activeExecutors.add(executor)
          try {
            const artifact = await settle(executor, turn.parts ?? turn.prompt ?? '', signal)
            throwIfAborted(signal)
            const tokensIn = artifact.spent.tokens.input
            const tokensOut = artifact.spent.tokens.output
            const costUsd = artifact.spent.usd
            const costKnown = artifact.spent.usdKnown !== false
            yield {
              type: 'llm_call',
              data: { tokensIn, tokensOut, ...(costKnown ? { costUsd } : {}) },
              usage: {
                inputTokens: tokensIn,
                outputTokens: tokensOut,
                ...(costKnown ? { cost: costUsd } : {}),
              },
            }
            yield {
              type: 'result',
              data: {
                finalText: outputText(artifact.out),
                tokenUsage: { inputTokens: tokensIn, outputTokens: tokensOut },
                ...(costKnown ? { costUsd } : {}),
              },
            }
          } finally {
            await teardown(executor)
            activeExecutors.delete(executor)
          }
        },
        async placement() {
          return { kind: 'local', providerMetadata: { runtime: 'inline' } }
        },
        destroy,
      }

      return environment
    },
  }
}

async function settle(
  executor: Executor<unknown>,
  task: unknown,
  signal: AbortSignal,
): Promise<ExecutorResult<unknown>> {
  const result = executor.execute(task, signal)
  if (!isAsyncIterable(result)) {
    return abortable(Promise.resolve(result), signal)
  }

  const iterator = result[Symbol.asyncIterator]()
  try {
    while (true) {
      const next = await abortable(iterator.next(), signal)
      if (next.done) break
    }
  } finally {
    if (signal.aborted) {
      try {
        const returned = iterator.return?.()
        void returned?.catch(() => undefined)
      } catch {
        // Cancellation already tears the executor down below.
      }
    } else {
      const returned = iterator.return?.()
      await returned
    }
  }
  return executor.resultArtifact()
}

function defaultInlineCapabilities(): AgentEnvironmentCapabilities {
  return {
    profile: {
      namedProfiles: false,
      systemPrompt: true,
      instructions: true,
      tools: false,
      permissions: false,
      mcp: false,
      subagents: false,
      resources: {
        files: false,
        instructions: false,
        tools: false,
        skills: false,
        agents: false,
        commands: false,
      },
      hooks: false,
      modes: false,
      runtimeUpdate: false,
      validation: true,
    },
    streaming: { live: false, replay: false, detach: false, turnIdempotency: false },
    sessions: { continue: true, list: false, messages: false },
    workspace: {
      read: false,
      write: false,
      exec: false,
      git: false,
      upload: false,
      download: false,
    },
    branching: { checkpoint: false, fork: false },
    placement: true,
    usage: true,
    confidential: false,
  }
}

function validatedProfile(
  providerName: string,
  profile: AgentProfile | string,
  validation: AgentProfileValidationResult,
): AgentProfile {
  if (!validation.ok || typeof profile === 'string') {
    const reasons = validation.issues
      .filter((issue) => issue.level === 'error')
      .map((issue) => issue.message)
      .join('; ')
    throw new ValidationError(`${providerName}: profile validation failed: ${reasons}`)
  }
  return validation.normalizedProfile ?? profile
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === 'object' && value !== null && Symbol.asyncIterator in value
}

function combinedSignal(parent: AbortSignal, child?: AbortSignal): AbortSignal {
  return child ? AbortSignal.any([parent, child]) : parent
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function outputText(output: unknown): string {
  if (typeof output === 'string') return output
  if (output && typeof output === 'object' && 'content' in output) {
    const content = (output as { content?: unknown }).content
    if (typeof content === 'string') return content
  }
  return ''
}
