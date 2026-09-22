import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentTurnInput,
} from '@tangle-network/agent-interface/environment-provider'
import { ValidationError } from '../errors'
import { createEnvironmentForSpec } from './environment-create'
import type { AgentRunSpec, MountRecorder } from './types'
import {
  mapWithConcurrency,
  raceWithAbort,
  randomUuid,
  throwAbort,
  throwIfAborted,
  withTimeout,
} from './util'

const TEARDOWN_TIMEOUT_MS = 15_000
const DEFAULT_FORK_CONCURRENCY = 4

type TurnOptions = Omit<AgentTurnInput, 'prompt' | 'parts' | 'sessionId' | 'signal'>

async function* pollTurnEvents(
  environment: AgentEnvironment,
  prompt: string,
  sessionId: string,
  signal: AbortSignal,
  options?: TurnOptions,
): AsyncIterable<AgentEnvironmentEvent> {
  if (!environment.dispatch || !environment.session) {
    throw new ValidationError(
      `provider "${environment.provider}" does not support detached sessions required by polling`,
    )
  }
  throwIfAborted(signal)
  const dispatched = await environment.dispatch({ ...options, prompt, sessionId, signal })
  const session = environment.session(dispatched.id)
  const result = await raceWithAbort(session.result(), signal, () => session.cancel())
  throwIfAborted(signal)
  yield {
    type: 'result',
    id: dispatched.id,
    data: {
      finalText: result.text,
      success: result.success,
      ...(result.error ? { error: result.error } : {}),
    },
    ...(result.usage ? { usage: result.usage } : {}),
  }
}

/** Stream one environment turn through SSE or polling. */
export function turnEvents(
  streaming: 'sse' | 'poll',
  environment: AgentEnvironment,
  prompt: string,
  sessionId: string,
  signal: AbortSignal,
  options?: TurnOptions,
): AsyncIterable<AgentEnvironmentEvent> {
  return streaming === 'poll'
    ? pollTurnEvents(environment, prompt, sessionId, signal, options)
    : environment.stream({ ...options, prompt, sessionId, signal })
}

export interface EnvironmentLineageHandle {
  environment: AgentEnvironment
  sessionId: string
}

export interface EnvironmentLineage {
  adopt(environment: AgentEnvironment, sessionId: string): EnvironmentLineageHandle
  start(
    spec: AgentRunSpec<unknown>,
    prompt: string,
    signal: AbortSignal,
    options?: TurnOptions,
  ): Promise<{
    handle: EnvironmentLineageHandle
    events: AsyncIterable<AgentEnvironmentEvent>
  }>
  continue(
    handle: EnvironmentLineageHandle,
    prompt: string,
    signal: AbortSignal,
    options?: TurnOptions,
  ): Promise<AsyncIterable<AgentEnvironmentEvent>>
  fork(
    parent: EnvironmentLineageHandle,
    prompts: string[],
    specs: AgentRunSpec<unknown>[],
    signal: AbortSignal,
  ): Promise<
    {
      handle: EnvironmentLineageHandle
      events: AsyncIterable<AgentEnvironmentEvent>
    }[]
  >
  prune(keep: Iterable<EnvironmentLineageHandle>): Promise<void>
  teardown(): Promise<void>
}

/** Create, fork, resume, and prune related agent environments. */
export function createEnvironmentLineage(
  provider: AgentEnvironmentProvider,
  capabilities: AgentEnvironmentCapabilities,
  options: {
    maxConcurrency?: number
    streaming?: 'sse' | 'poll'
    recordMount?: MountRecorder
  } = {},
): EnvironmentLineage {
  if (!provider || typeof provider.create !== 'function') {
    throw new ValidationError('createEnvironmentLineage: provider.create is required')
  }
  const streaming = options.streaming ?? 'sse'
  const recordMount: MountRecorder = options.recordMount ?? (() => {})
  const forkConcurrency = Math.max(
    1,
    Math.floor(options.maxConcurrency ?? DEFAULT_FORK_CONCURRENCY),
  )
  const owned: AgentEnvironment[] = []

  const acquireFresh = async (
    spec: AgentRunSpec<unknown>,
    signal: AbortSignal,
  ): Promise<AgentEnvironment> => {
    const environment = await createEnvironmentForSpec(provider, spec, signal, recordMount)
    owned.push(environment)
    return environment
  }

  return {
    adopt(environment, sessionId) {
      if (environment.provider !== provider.name) {
        throw new ValidationError(
          `provider "${provider.name}" cannot adopt environment "${environment.id}" owned by "${environment.provider}"`,
        )
      }
      if (!owned.includes(environment)) owned.push(environment)
      return { environment, sessionId }
    },

    async start(spec, prompt, signal, turnOptions) {
      const environment = await acquireFresh(spec, signal)
      const sessionId = mintSessionId()
      return {
        handle: { environment, sessionId },
        events: turnEvents(streaming, environment, prompt, sessionId, signal, turnOptions),
      }
    },

    async continue(handle, prompt, signal, turnOptions) {
      throwIfAborted(signal)
      if (!capabilities.sessions.continue) {
        throw new ValidationError(
          `provider "${handle.environment.provider}" does not support session continuation`,
        )
      }
      await assertSessionKnown(handle.environment, handle.sessionId, signal)
      return turnEvents(
        streaming,
        handle.environment,
        prompt,
        handle.sessionId,
        signal,
        turnOptions,
      )
    },

    async fork(parent, prompts, specs, signal) {
      if (prompts.length === 0) {
        throw new ValidationError('EnvironmentLineage.fork: prompts must be non-empty')
      }
      throwIfAborted(signal)

      const checkpoint =
        capabilities.branching.checkpoint && capabilities.branching.fork
          ? await checkpointForFork(parent.environment, signal)
          : undefined

      return mapWithConcurrency(prompts, forkConcurrency, async (prompt, index) => {
        throwIfAborted(signal)
        const spec = specs[index % specs.length]
        if (!spec) {
          throw new ValidationError('EnvironmentLineage.fork: no AgentRunSpec for branch')
        }
        const environment = checkpoint
          ? await forkFromCheckpoint(parent.environment, checkpoint, signal)
          : await acquireFresh(spec, signal)
        if (checkpoint) {
          owned.push(environment)
          await spec.prepareEnvironment?.(environment, { signal, recordMount })
        }
        const sessionId = mintSessionId()
        return {
          handle: { environment, sessionId },
          events: turnEvents(streaming, environment, prompt, sessionId, signal),
        }
      })
    },

    async prune(keep) {
      const retained = new Set<AgentEnvironment>()
      for (const handle of keep) retained.add(handle.environment)
      const survivors: AgentEnvironment[] = []
      const doomed: AgentEnvironment[] = []
      for (const environment of owned) {
        if (retained.has(environment)) survivors.push(environment)
        else doomed.push(environment)
      }
      if (doomed.length === 0) return
      owned.length = 0
      owned.push(...survivors)
      await destroyAllBounded(doomed)
    },

    async teardown() {
      const environments = owned.splice(0, owned.length)
      await destroyAllBounded(environments)
    },
  }
}

function mintSessionId(): string {
  return `round-session-${randomUuid()}`
}

async function checkpointForFork(environment: AgentEnvironment, signal: AbortSignal) {
  if (!environment.checkpoint || !environment.fork) {
    throw new ValidationError(
      `provider "${environment.provider}" advertised branching but the environment lacks checkpoint() or fork()`,
    )
  }
  throwIfAborted(signal)
  return environment.checkpoint()
}

async function forkFromCheckpoint(
  environment: AgentEnvironment,
  checkpoint: Awaited<ReturnType<NonNullable<AgentEnvironment['checkpoint']>>>,
  signal: AbortSignal,
): Promise<AgentEnvironment> {
  if (!environment.fork) {
    throw new ValidationError(
      `provider "${environment.provider}" advertised forking but the environment lacks fork()`,
    )
  }
  if (signal.aborted) throwAbort()
  return environment.fork(checkpoint)
}

async function assertSessionKnown(
  environment: AgentEnvironment,
  sessionId: string,
  signal: AbortSignal,
): Promise<void> {
  if (!environment.session) return
  const session = environment.session(sessionId)
  const status = await raceWithAbort(session.status(), signal, () => session.cancel())
  if (status === null) {
    throw new ValidationError(
      `provider "${environment.provider}" no longer recognizes session "${sessionId}"`,
    )
  }
}

async function destroyBounded(environment: AgentEnvironment): Promise<void> {
  if (!environment.destroy) return
  const outcome = await withTimeout(
    Promise.resolve()
      .then(() => environment.destroy?.())
      .then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      ),
    TEARDOWN_TIMEOUT_MS,
  )
  if (outcome === undefined) {
    throw new Error(
      `environment "${environment.id}" destruction timed out after ${TEARDOWN_TIMEOUT_MS}ms`,
    )
  }
  if (!outcome.ok) {
    const detail = outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
    throw new Error(`failed to destroy environment "${environment.id}": ${detail}`, {
      cause: outcome.error,
    })
  }
}

async function destroyAllBounded(environments: AgentEnvironment[]): Promise<void> {
  const outcomes = await Promise.allSettled(environments.map(destroyBounded))
  const failures = outcomes.flatMap((outcome) =>
    outcome.status === 'rejected' ? [outcome.reason] : [],
  )
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      `${failures.length} environment destruction operations failed`,
    )
  }
}
