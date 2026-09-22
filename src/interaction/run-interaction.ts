import { ValidationError } from '../errors'
import { extractEnvironmentTurnText, sumEnvironmentUsage } from '../runtime/environment-events'
import { type EnvironmentRun, openEnvironmentRun } from '../runtime/environment-run'
import {
  CircuitBreakerState,
  createAttemptSignal,
  defaultIsRetryable,
  retryDelay,
  type TurnCallPolicy,
} from './call-policy'
import type {
  InteractionActor,
  InteractionActorRef,
  InteractionDriveState,
  InteractionHaltReason,
  InteractionResult,
  InteractionStreamEvent,
  InteractionTurn,
  InteractionTurnOrder,
  RunInteractionOptions,
} from './types'

interface ActorTurnOutput {
  text: string
  usage: {
    inputTokens: number
    outputTokens: number
    costUsd: number
  }
}

interface OpenActor {
  run: EnvironmentRun<ActorTurnOutput>
  resumed: boolean
}

/** Run a bounded, resumable interaction and return its final state. */
export async function runInteraction(options: RunInteractionOptions): Promise<InteractionResult> {
  let result: InteractionResult | undefined
  for await (const event of streamInteraction(options)) {
    await options.onEvent?.(event)
    if (event.type === 'interaction_end') result = event.result
  }
  if (!result) throw new Error('interaction stream ended without an interaction_end event')
  return result
}

/** Stream every event from a bounded, resumable interaction. */
export async function* streamInteraction(
  options: RunInteractionOptions,
): AsyncIterable<InteractionStreamEvent> {
  validateOptions(options)
  const runId = options.runId ?? `interaction-${crypto.randomUUID()}`
  const definitionId = options.definitionId
  const journal = options.journal
  const existing = await journal?.load(runId)
  if (existing && existing.definitionId !== definitionId) {
    throw new ValidationError(
      `interaction "${runId}" definition changed: expected "${existing.definitionId}", received "${definitionId}"`,
    )
  }

  if (existing?.halted) {
    const result = resultFromFinished(existing)
    yield {
      type: 'interaction_resumed',
      runId,
      actors: options.actors.map((actor) => actor.name),
      transcript: result.transcript,
      timestamp: nowIso(),
    }
    yield { type: 'interaction_end', runId, result, timestamp: nowIso() }
    return
  }

  const startedAt = existing?.startedAt ?? nowIso()
  if (!existing && journal) {
    await journal.begin(runId, startedAt, requireDefinitionId(definitionId))
  }

  await preflightActors(options)
  const transcript = existing ? [...existing.turns] : []
  const refs = new Map((existing?.actors ?? []).map((ref) => [ref.name, ref]))
  validatePersistedRefs(options.actors, refs)
  const runs = new Map<string, OpenActor>()
  const readyActors = new Set<string>()
  const breakers = new Map(
    options.actors.map((actor) => [
      actor.name,
      new CircuitBreakerState(
        (actor.callPolicy ?? options.policy.defaultCallPolicy)?.circuitBreaker,
      ),
    ]),
  )
  const startedAtMs = Date.now()

  yield {
    type: existing ? 'interaction_resumed' : 'interaction_start',
    runId,
    actors: options.actors.map((actor) => actor.name),
    transcript: [...transcript],
    timestamp: nowIso(),
  }

  let halt: InteractionHaltReason | undefined
  try {
    for (let turnIndex = transcript.length; turnIndex < options.policy.maxTurns; turnIndex += 1) {
      const usage = sumTranscriptUsage(transcript)
      if (options.signal?.aborted) {
        halt = { kind: 'aborted' }
        break
      }
      if (options.policy.maxCostUsd !== undefined && usage.costUsd >= options.policy.maxCostUsd) {
        halt = {
          kind: 'max_cost',
          costUsd: usage.costUsd,
          maxCostUsd: options.policy.maxCostUsd,
        }
        break
      }

      const actorIndex = actorIndexFor(options.policy.turnOrder, options.actors.length, {
        transcript,
        turnIndex,
        costUsd: usage.costUsd,
      })
      const actor = options.actors[actorIndex]
      if (!actor) throw new Error(`interaction selected missing actor index ${actorIndex}`)
      const turnId = `${runId}.turn.${turnIndex}.${slug(actor.name)}`
      const callPolicy = actor.callPolicy ?? options.policy.defaultCallPolicy
      const totalAttempts = 1 + (callPolicy?.maxRetries ?? 0)
      const breaker = breakers.get(actor.name)
      if (!breaker) throw new Error(`missing circuit state for actor "${actor.name}"`)
      const prompt = promptForActor(actor.name, options.prompt, transcript)
      const turnStartedAt = nowIso()

      yield {
        type: 'turn_start',
        runId,
        turnId,
        index: turnIndex,
        actor: actor.name,
        attempt: 1,
        timestamp: turnStartedAt,
      }

      let output: ActorTurnOutput | undefined
      let attempts = 0
      let lastError: unknown
      for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
        attempts = attempt
        try {
          breaker.preflight(actor.name)
        } catch (error) {
          lastError = error
          break
        }

        if (attempt > 1) {
          yield {
            type: 'turn_retry',
            runId,
            turnId,
            index: turnIndex,
            actor: actor.name,
            attempt,
            reason: errorMessage(lastError),
            timestamp: nowIso(),
          }
        }

        const attemptSignal = createAttemptSignal(options.signal, callPolicy?.timeoutMs)
        try {
          const opened = await openActorRun({
            actor,
            runId,
            journal,
            refs,
            runs,
            signal: options.signal ?? neverAbortedSignal(),
            hooks: options.hooks,
          })
          const result = await opened.run.turn(prompt, {
            ...actor.turn,
            executionId: turnId,
            turnId,
            signal: attemptSignal.signal,
          })
          output = result.output
          breaker.recordSuccess()
          if (!readyActors.has(actor.name)) {
            const ref = refs.get(actor.name)
            if (!ref) throw new Error(`actor "${actor.name}" did not record its environment`)
            readyActors.add(actor.name)
            yield {
              type: 'actor_ready',
              runId,
              actor: actor.name,
              ref,
              resumed: opened.resumed,
              timestamp: nowIso(),
            }
          }
          break
        } catch (error) {
          breaker.recordFailure()
          lastError = attemptSignal.timeoutError() ?? error
          const ref = refs.get(actor.name)
          if (!ref) {
            const failed = runs.get(actor.name)
            runs.delete(actor.name)
            await failed?.run.close().catch(() => {})
          }
          if (ref && !readyActors.has(actor.name)) {
            readyActors.add(actor.name)
            yield {
              type: 'actor_ready',
              runId,
              actor: actor.name,
              ref,
              resumed: existing?.actors.some((candidate) => candidate.name === actor.name) === true,
              timestamp: nowIso(),
            }
          }
          if (options.signal?.aborted) break
          const isRetryable = callPolicy?.isRetryable ?? defaultIsRetryable
          if (attempt >= totalAttempts || !isRetryable(lastError)) break
          const delayMs = retryDelay(callPolicy?.retryBackoffMs, attempt)
          if (delayMs > 0) await sleep(delayMs, options.signal)
        } finally {
          attemptSignal.dispose()
        }
      }

      if (!output) {
        halt = options.signal?.aborted
          ? { kind: 'aborted' }
          : {
              kind: 'actor_error',
              actor: actor.name,
              message: errorMessage(lastError),
            }
        break
      }

      const ref = refs.get(actor.name)
      if (!ref) throw new Error(`actor "${actor.name}" has no persisted environment reference`)
      const turn: InteractionTurn = {
        index: turnIndex,
        actor: actor.name,
        turnId,
        environmentId: ref.environmentId,
        sessionId: ref.sessionId,
        text: output.text,
        usage: output.usage,
        attempts,
        startedAt: turnStartedAt,
        endedAt: nowIso(),
      }
      await journal?.appendTurn(runId, turn)
      transcript.push(turn)
      yield { type: 'turn_end', runId, turn, timestamp: nowIso() }

      if (options.policy.stopWhen) {
        const currentUsage = sumTranscriptUsage(transcript)
        const decision = await options.policy.stopWhen({
          transcript,
          turnIndex,
          costUsd: currentUsage.costUsd,
          lastTurn: turn,
        })
        if (decision === true) {
          halt = { kind: 'stop', reason: 'stop predicate returned true' }
          break
        }
        if (typeof decision === 'object' && decision?.stop) {
          halt = { kind: 'stop', reason: decision.reason }
          break
        }
      }
    }

    halt ??= { kind: 'max_turns', turns: transcript.length }
    await closeActorRuns(runs)
    const endedAt = nowIso()
    await journal?.finish(runId, halt, endedAt)
    const result: InteractionResult = {
      runId,
      transcript,
      turns: transcript.length,
      usage: sumTranscriptUsage(transcript),
      halted: halt,
      startedAt,
      endedAt,
      durationMs: Date.now() - startedAtMs,
    }
    yield { type: 'interaction_end', runId, result, timestamp: endedAt }
  } finally {
    await closeActorRuns(runs)
  }
}

async function preflightActors(options: RunInteractionOptions): Promise<void> {
  for (const actor of options.actors) {
    const current = await actor.provider.capabilities()
    if (!current.sessions.continue) {
      throw new ValidationError(
        `runInteraction: provider "${actor.provider.name}" does not support session continuation`,
      )
    }
    const policy = actor.callPolicy ?? options.policy.defaultCallPolicy
    if ((policy?.maxRetries ?? 0) > 0 && !current.streaming.turnIdempotency) {
      throw new ValidationError(
        `runInteraction: provider "${actor.provider.name}" cannot safely retry turns`,
      )
    }
    if (options.journal && (!actor.provider.get || !current.streaming.turnIdempotency)) {
      throw new ValidationError(
        `runInteraction: durable runs require provider "${actor.provider.name}" to support get() and idempotent turns`,
      )
    }
  }
}

async function openActorRun(input: {
  actor: InteractionActor
  runId: string
  journal: RunInteractionOptions['journal']
  refs: Map<string, InteractionActorRef>
  runs: Map<string, OpenActor>
  signal: AbortSignal
  hooks: RunInteractionOptions['hooks']
}): Promise<OpenActor> {
  const cached = input.runs.get(input.actor.name)
  if (cached) return cached
  const persisted = input.refs.get(input.actor.name)
  const opened: OpenActor = {
    resumed: persisted !== undefined,
    run: await openEnvironmentRun({
      provider: input.actor.provider,
      agentRun: {
        profile: input.actor.profile,
        name: input.actor.name,
        taskToPrompt: (task) => task,
        environment: {
          ...input.actor.environment,
          idempotencyKey:
            input.actor.environment?.idempotencyKey ??
            `${input.runId}.actor.${slug(input.actor.name)}`,
          metadata: {
            ...input.actor.environment?.metadata,
            interactionRunId: input.runId,
            interactionActor: input.actor.name,
          },
        },
        ...(input.actor.prepareEnvironment
          ? { prepareEnvironment: input.actor.prepareEnvironment }
          : {}),
      },
      deliverable: {
        kind: 'events',
        fromEvents: (events) => {
          const usage = sumEnvironmentUsage(events, input.actor.name)
          return {
            text: extractEnvironmentTurnText(events),
            usage: {
              inputTokens: usage.input,
              outputTokens: usage.output,
              costUsd: usage.costUsd,
            },
          }
        },
      },
      signal: input.signal,
      hooks: input.hooks,
      runId: `${input.runId}:${input.actor.name}`,
      ...(persisted
        ? {
            resumeFrom: {
              environmentId: persisted.environmentId,
              sessionId: persisted.sessionId,
            },
          }
        : {
            beforeStart: async ({ environment, sessionId }) => {
              const ref: InteractionActorRef = {
                name: input.actor.name,
                provider: input.actor.provider.name,
                environmentId: environment.id,
                sessionId,
              }
              await input.journal?.recordActor(input.runId, ref)
              input.refs.set(input.actor.name, ref)
            },
          }),
    }),
  }
  input.runs.set(input.actor.name, opened)
  return opened
}

function validateOptions(options: RunInteractionOptions): void {
  if (options.actors.length < 2) {
    throw new ValidationError('runInteraction requires at least two actors')
  }
  const names = new Set<string>()
  for (const actor of options.actors) {
    if (!actor.name.trim()) throw new ValidationError('interaction actor name must be non-empty')
    if (names.has(actor.name)) {
      throw new ValidationError(`interaction actor name "${actor.name}" is duplicated`)
    }
    names.add(actor.name)
    if (!actor.provider || typeof actor.provider.create !== 'function') {
      throw new ValidationError(`interaction actor "${actor.name}" has no environment provider`)
    }
  }
  if (!Number.isInteger(options.policy.maxTurns) || options.policy.maxTurns < 1) {
    throw new ValidationError('InteractionPolicy.maxTurns must be a positive integer')
  }
  if (
    options.policy.maxCostUsd !== undefined &&
    (!Number.isFinite(options.policy.maxCostUsd) || options.policy.maxCostUsd < 0)
  ) {
    throw new ValidationError('InteractionPolicy.maxCostUsd must be non-negative and finite')
  }
  if (options.policy.turnOrder === 'alternate' && options.actors.length !== 2) {
    throw new ValidationError('alternate turn order requires exactly two actors')
  }
  for (const actor of options.actors) validateCallPolicy(actor.callPolicy)
  validateCallPolicy(options.policy.defaultCallPolicy)
  if (options.journal) requireDefinitionId(options.definitionId)
}

function validateCallPolicy(policy: TurnCallPolicy | undefined): void {
  if (!policy) return
  if (
    policy.maxRetries !== undefined &&
    (!Number.isInteger(policy.maxRetries) || policy.maxRetries < 0)
  ) {
    throw new ValidationError('TurnCallPolicy.maxRetries must be a non-negative integer')
  }
}

function validatePersistedRefs(
  actors: readonly InteractionActor[],
  refs: ReadonlyMap<string, InteractionActorRef>,
): void {
  for (const ref of refs.values()) {
    const actor = actors.find((candidate) => candidate.name === ref.name)
    if (!actor)
      throw new ValidationError(`persisted actor "${ref.name}" is not in this interaction`)
    if (actor.provider.name !== ref.provider) {
      throw new ValidationError(
        `actor "${ref.name}" changed provider from "${ref.provider}" to "${actor.provider.name}"`,
      )
    }
  }
}

function actorIndexFor(
  order: InteractionTurnOrder | undefined,
  count: number,
  state: InteractionDriveState,
): number {
  const resolved = order ?? (count === 2 ? 'alternate' : 'round-robin')
  if (resolved === 'alternate' || resolved === 'round-robin') return state.turnIndex % count
  const index = resolved(state)
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new ValidationError(`interaction turn order returned invalid actor index ${index}`)
  }
  return index
}

function promptForActor(
  actor: string,
  initialPrompt: string,
  transcript: readonly InteractionTurn[],
): string {
  let lastOwnTurn = -1
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    if (transcript[index]?.actor === actor) {
      lastOwnTurn = index
      break
    }
  }
  const unseen = transcript.slice(lastOwnTurn + 1)
  if (lastOwnTurn < 0) {
    return [initialPrompt, ...unseen.map((turn) => `[${turn.actor}] ${turn.text}`)]
      .filter(Boolean)
      .join('\n\n')
  }
  return unseen.length > 0
    ? unseen.map((turn) => `[${turn.actor}] ${turn.text}`).join('\n\n')
    : 'Continue.'
}

function sumTranscriptUsage(transcript: readonly InteractionTurn[]): InteractionResult['usage'] {
  return transcript.reduce(
    (sum, turn) => ({
      inputTokens: sum.inputTokens + turn.usage.inputTokens,
      outputTokens: sum.outputTokens + turn.usage.outputTokens,
      costUsd: sum.costUsd + turn.usage.costUsd,
    }),
    { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  )
}

async function closeActorRuns(runs: Map<string, OpenActor>): Promise<void> {
  if (runs.size === 0) return
  const active = [...runs.values()]
  runs.clear()
  const results = await Promise.allSettled(active.map(({ run }) => run.close()))
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason)
  if (errors.length > 0)
    throw new AggregateError(errors, 'failed to close interaction environments')
}

function resultFromFinished(entry: {
  runId: string
  startedAt: string
  endedAt?: string
  turns: InteractionTurn[]
  halted?: InteractionHaltReason
}): InteractionResult {
  if (!entry.halted || !entry.endedAt) {
    throw new Error(`interaction "${entry.runId}" has incomplete terminal state`)
  }
  return {
    runId: entry.runId,
    transcript: [...entry.turns],
    turns: entry.turns.length,
    usage: sumTranscriptUsage(entry.turns),
    halted: entry.halted,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    durationMs: Math.max(0, Date.parse(entry.endedAt) - Date.parse(entry.startedAt)),
  }
}

function requireDefinitionId(value: string | undefined): string {
  if (!value?.trim()) {
    throw new ValidationError('runInteraction requires definitionId when journal is supplied')
  }
  return value
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function slug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'actor'
  )
}

function nowIso(): string {
  return new Date().toISOString()
}

function neverAbortedSignal(): AbortSignal {
  return new AbortController().signal
}

async function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) throw signal.reason
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort)
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    timer.unref?.()
    const abort = () => {
      clearTimeout(timer)
      cleanup()
      reject(signal?.reason ?? new Error('aborted'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}
