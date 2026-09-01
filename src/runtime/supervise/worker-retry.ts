/**
 * WORKER-SPAWN RETRY — the second chance `driverRetry` gives the root, given to a leaf.
 *
 * `driverRetry` guards the root and nothing else. A worker that dies is typed into a `down`
 * settlement, which is the right shape when the worker RAN. It is the wrong shape when the worker
 * never started, and one failure produces exactly that:
 *
 *   bridgeExecutor: bridge stream error: host-executor: acquire timeout after 60000ms
 *   (in_flight=4/4, queued=1)
 *
 * Measured 2026-08-22 on discovery-lab cells oscnp s2/s3: two live cells held 2 leads and up to 8
 * workers on one bridge whose host executor caps live harness children at 4. A worker spawn that
 * queued past the bridge's single 60 s acquire deadline died there, and the run lost that worker
 * permanently even though a slot freed seconds later. The bridge retries nothing.
 *
 * Retrying execution is dangerous by default, so this seam is FAIL-CLOSED on two independent
 * proofs that the attempt did no work:
 *
 *  1. The error carries a PRE-SPAWN signature — a refusal the backend emits before the harness
 *     child or the box exists ({@link isPreSpawnExecutorFailure}). No provider call started.
 *  2. The attempt yielded NO execution event. An attempt that streamed anything may have metered
 *     usage, and a blind re-run would double-spend, so it stays fatal whatever its message says.
 *
 * Either proof missing means no retry. This is deliberately NARROWER than "is this an
 * infrastructure hiccup": `ECONNRESET` is a transient transport failure and is NOT retried here,
 * because it can arrive mid-stream after a metered call.
 *
 * Re-entry re-invokes `execute` on the SAME executor object. Nothing is rebuilt, so the executor's
 * runtime-owned materialization attestation, its bound session id, and its inbox are all the ones
 * the kernel admitted. For the bridge backend a second `execute` is a fresh session stream over the
 * same durable execution id, and a saturation refusal happens before that session's child spawned.
 *
 * @experimental
 */

import { ValidationError } from '../../errors'
import type { MakeWorkerAgent } from '../../mcp/tools/coordination'
import { inheritRuntimeOwnedExecutorAttestation } from './materialization'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
  UsageEvent,
  WorkerInteractiveSession,
} from './types'

/**
 * The backend refusals that are emitted BEFORE any child process, box, or provider request exists.
 *
 * Each is a queue admission deadline: the executor asked for a slot, waited, and was refused
 * without anything being started. The three names are the pools cli-bridge and the container host
 * admit through — the host executor, one scoped per-run host executor, and the container pool.
 *
 * The pattern is anchored to the whole phrase, including the `after <n>ms` deadline, so a message
 * that merely mentions a queue does not qualify.
 */
const PRE_SPAWN_SIGNATURES: ReadonlyArray<RegExp> = Object.freeze([
  /\b(?:host-executor|scoped-host-executor|container-pool): acquire timeout after \d+ms\b/u,
])

/** One re-entry, reported before it waits. */
export interface WorkerSpawnRetryAttempt {
  /** 1-based: the attempt that just failed. */
  readonly attempt: number
  /** How long this seam waits before re-entering `execute`. */
  readonly waitMs: number
  /** The refused profile's name, when it declares one. */
  readonly worker?: string
  readonly error: string
}

/**
 * How hard a pre-spawn worker refusal is re-entered. Absent from `supervise` means NO retry — the
 * historical behaviour, and the conservative default: a worker failure already has a typed
 * settlement the driver can respond to, so adding silent latency to every run is not the runtime's
 * call to make.
 */
export interface WorkerSpawnRetryPolicy {
  /** `false` disables the seam while leaving the option in a recorded run configuration. */
  readonly enabled?: boolean
  /** Total wall-clock ms this seam may spend waiting for a slot, backoff included. Default 900000
   *  — the span measured between saturation and the next free slot on a four-way host executor. */
  readonly maxTotalMs?: number
  /** Wait before the first re-entry, doubling per attempt. Default 5000. */
  readonly initialBackoffMs?: number
  /** Ceiling on the doubling. Default 60000. */
  readonly maxBackoffMs?: number
  /**
   * Extra PRE-SPAWN signatures a consumer's own admission layer emits, added to the built-in set.
   *
   * This widens which messages qualify, and it can only be used safely for a refusal the consumer
   * knows is emitted before any provider call. The second proof — that the attempt yielded no
   * execution event — still applies to every added signature, so a mistake here cannot cause a
   * double-spend on a stream that had already started.
   */
  readonly additionalPreSpawnSignatures?: ReadonlyArray<RegExp>
}

export interface WorkerSpawnRetryHooks {
  readonly onRetry?: (attempt: WorkerSpawnRetryAttempt) => void
  readonly now?: () => number
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

/** A policy with every bound decided — what {@link retryPreSpawnRefusals} acts on. Produced by
 *  {@link resolveWorkerSpawnRetry}, never written by hand, so one reading of the defaults serves
 *  the `supervise` option and a caller-owned seam alike. */
export interface ResolvedWorkerSpawnRetry {
  readonly maxTotalMs: number
  readonly initialBackoffMs: number
  readonly maxBackoffMs: number
  readonly signatures: ReadonlyArray<RegExp>
}

const DEFAULT_MAX_TOTAL_MS = 900_000
const DEFAULT_INITIAL_BACKOFF_MS = 5_000
const DEFAULT_MAX_BACKOFF_MS = 60_000

/**
 * True when `error` is a backend refusal issued before anything ran.
 *
 * This answers "did this fail BEFORE any provider call", which is a strictly narrower question
 * than "is this an infrastructure hiccup". The broader question admits `ECONNRESET` and a bare
 * `fetch failed`, both of which can arrive after a metered call, and answering the broad question
 * where the narrow one is required is what makes a retry double-spend.
 */
export function isPreSpawnExecutorFailure(
  error: unknown,
  additionalSignatures: ReadonlyArray<RegExp> = [],
): boolean {
  const message = error instanceof Error ? error.message : String(error)
  for (const signature of PRE_SPAWN_SIGNATURES) if (signature.test(message)) return true
  for (const signature of additionalSignatures) if (signature.test(message)) return true
  return false
}

/** Read the policy, refusing a number a run cannot act on rather than silently clamping it. */
export function resolveWorkerSpawnRetry(
  policy: WorkerSpawnRetryPolicy | undefined,
): ResolvedWorkerSpawnRetry | undefined {
  if (policy === undefined || policy.enabled === false) return undefined
  const maxTotalMs = policy.maxTotalMs ?? DEFAULT_MAX_TOTAL_MS
  const initialBackoffMs = policy.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS
  const maxBackoffMs = policy.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS
  for (const [name, value] of [
    ['maxTotalMs', maxTotalMs],
    ['initialBackoffMs', initialBackoffMs],
    ['maxBackoffMs', maxBackoffMs],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new ValidationError(
        `workerRetry.${name} must be a nonnegative finite number of milliseconds`,
      )
    }
  }
  const signatures = policy.additionalPreSpawnSignatures ?? []
  for (const signature of signatures) {
    if (!(signature instanceof RegExp)) {
      throw new ValidationError(
        'workerRetry.additionalPreSpawnSignatures must contain RegExp values',
      )
    }
  }
  return Object.freeze({
    maxTotalMs,
    initialBackoffMs,
    maxBackoffMs: Math.max(initialBackoffMs, maxBackoffMs),
    signatures: Object.freeze([...signatures]),
  })
}

/**
 * Wrap a worker seam so a leaf whose spawn is refused before it runs is re-entered instead of
 * settling dead.
 *
 * The wrapper composes the agent's `executorFactory`, which is where a leaf executor is built with
 * the real child signal and node context, and it never replaces the executor object the factory
 * returned: the retry lives in one `execute` wrapper that carries the inner executor's attestation
 * forward and delegates every other surface to it.
 */
export function withWorkerSpawnRetry(
  make: MakeWorkerAgent,
  policy: WorkerSpawnRetryPolicy | undefined,
  hooks: WorkerSpawnRetryHooks = {},
): MakeWorkerAgent {
  const resolved = resolveWorkerSpawnRetry(policy)
  if (resolved === undefined) return make
  return (profile, spawnContext) => {
    const agent = make(profile, spawnContext)
    const spec = (agent as Agent<unknown, unknown> & { executorSpec?: AgentSpec }).executorSpec
    if (spec === undefined) return agent
    const seamHooks = {
      ...hooks,
      ...(typeof profile.name === 'string' ? { worker: profile.name } : {}),
    }
    // A factory is the backend-derived shape: the executor is built per spawn with the real child
    // signal. A bring-your-own executor is the other supported shape, and skipping it would make
    // this seam a silent no-op for a caller that uses it.
    if (spec.executorFactory !== undefined) {
      const innerFactory = spec.executorFactory
      const executorFactory: NonNullable<AgentSpec['executorFactory']> = (builtSpec, ctx) =>
        retryPreSpawnRefusals(innerFactory(builtSpec, ctx), resolved, seamHooks)
      return { ...agent, executorSpec: { ...spec, executorFactory } } as typeof agent
    }
    if (spec.executor !== undefined) {
      const executor = retryPreSpawnRefusals(spec.executor, resolved, seamHooks)
      return { ...agent, executorSpec: { ...spec, executor } } as typeof agent
    }
    return agent
  }
}

/**
 * Re-enter `execute` on one executor while a pre-spawn refusal keeps proving nothing ran.
 *
 * Exported so an owner of `makeLeafAgent` — which builds its own executors — gets the same seam
 * without reimplementing the two proofs.
 */
export function retryPreSpawnRefusals<Out>(
  inner: Executor<Out>,
  policy: ResolvedWorkerSpawnRetry,
  hooks: WorkerSpawnRetryHooks & { worker?: string } = {},
): Executor<Out> {
  const now = hooks.now ?? Date.now
  const sleep = hooks.sleep ?? defaultSleep

  /** The wait before the next attempt, or `null` when this failure stays fatal. */
  const nextWait = (
    error: unknown,
    attempt: number,
    yielded: boolean,
    startedAt: number,
    signal: AbortSignal | undefined,
  ): number | null => {
    // Proof two, checked first because it is the cheaper and the more dangerous to get wrong.
    if (yielded) return null
    if (signal?.aborted) return null
    if (!isPreSpawnExecutorFailure(error, policy.signatures)) return null
    const backoff = Math.min(policy.maxBackoffMs, policy.initialBackoffMs * 2 ** (attempt - 1))
    if (now() - startedAt + backoff >= policy.maxTotalMs) return null
    return backoff
  }

  const report = (error: unknown, attempt: number, waitMs: number): void => {
    hooks.onRetry?.({
      attempt,
      waitMs,
      ...(hooks.worker === undefined ? {} : { worker: hooks.worker }),
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const wrapped: Executor<Out> = {
    runtime: inner.runtime,
    ...(inner.budgetExempt !== undefined ? { budgetExempt: inner.budgetExempt } : {}),
    ...(inner.deliver ? { deliver: (message: unknown) => inner.deliver?.(message) } : {}),
    ...(inner.progress ? { progress: () => inner.progress?.() } : {}),
    ...(inner.traceSource ? { traceSource: () => inner.traceSource?.() } : {}),
    ...(inner.metered ? { metered: () => inner.metered?.() } : {}),
    ...(inner.interactive === undefined
      ? {}
      : { interactive: (): WorkerInteractiveSession => interactiveOf(inner) }),
    execute(task, signal) {
      const first = inner.execute(task, signal)
      const restart = () => inner.execute(task, signal)
      return isAsyncIterable(first)
        ? retryStream(first, restart, signal)
        : retryOneShot(first, restart, signal)
    },
    teardown: (grace) => inner.teardown(grace),
    resultArtifact: () => inner.resultArtifact(),
  }

  async function* retryStream(
    first: AsyncIterable<UsageEvent>,
    restart: () => Promise<ExecutorResult<Out>> | AsyncIterable<UsageEvent>,
    signal: AbortSignal | undefined,
  ): AsyncIterable<UsageEvent> {
    const startedAt = now()
    let execution = first
    for (let attempt = 1; ; attempt += 1) {
      let yielded = false
      try {
        for await (const event of execution) {
          yielded = true
          yield event
        }
        return
      } catch (error) {
        const waitMs = nextWait(error, attempt, yielded, startedAt, signal)
        if (waitMs === null) throw error
        report(error, attempt, waitMs)
        await sleep(waitMs, signal)
        const next = restart()
        if (!isAsyncIterable(next)) {
          // An executor keeps one execution shape for the life of one spawn. A re-entry that
          // changed shape would silently drop the event stream the conserved pool folds, so it is
          // named here rather than absorbed.
          throw new ValidationError(
            'retryPreSpawnRefusals: executor changed execution shape between attempts',
          )
        }
        execution = next
      }
    }
  }

  async function retryOneShot(
    first: Promise<ExecutorResult<Out>>,
    restart: () => Promise<ExecutorResult<Out>> | AsyncIterable<UsageEvent>,
    signal: AbortSignal | undefined,
  ): Promise<ExecutorResult<Out>> {
    const startedAt = now()
    let execution = first
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await execution
      } catch (error) {
        // A one-shot executor reports nothing until it resolves, so "yielded nothing" is the only
        // state it can be in when it rejects.
        const waitMs = nextWait(error, attempt, false, startedAt, signal)
        if (waitMs === null) throw error
        report(error, attempt, waitMs)
        await sleep(waitMs, signal)
        const next = restart()
        if (isAsyncIterable(next)) {
          throw new ValidationError(
            'retryPreSpawnRefusals: executor changed execution shape between attempts',
          )
        }
        execution = next
      }
    }
  }

  return inheritRuntimeOwnedExecutorAttestation(inner, wrapped)
}

/** Forward the inner executor's interactive contract exactly. The method is present only when the
 *  inner executor implements it, so the reachable call always has one to delegate to. */
function interactiveOf<Out>(inner: Executor<Out>): WorkerInteractiveSession {
  if (inner.interactive === undefined) {
    throw new ValidationError(
      'retryPreSpawnRefusals: inner executor exposes no interactive session',
    )
  }
  return inner.interactive()
}

function isAsyncIterable(value: unknown): value is AsyncIterable<UsageEvent> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as AsyncIterable<UsageEvent>)[Symbol.asyncIterator] === 'function'
  )
}

/** The wait stays REF'd: a worker waiting out a saturated executor is live work, and an unref'd
 *  timer lets the process exit mid-backoff when nothing else is pending. */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}
