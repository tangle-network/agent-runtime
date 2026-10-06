/**
 *
 * `SandboxLineage` — the backend-blind owner of box + session handles for a
 * single `runAgentRounds` invocation. It exists so `run-loop.ts` never references a
 * backend (Docker / Firecracker): the lineage turns "continue this session" and
 * "fork this branch" into capability-gated sandbox-SDK calls and degrades to
 * fresh boxes when a capability is absent.
 *
 * Three operations, mirroring the kernel's per-iteration choices:
 *   - `start(spec, prompt)`  → a fresh box; the FIRST `streamPrompt` carries a
 *      minted `sessionId` so later `continue` calls reuse the same server-side
 *      conversation instead of re-injecting prior context as prompt text.
 *   - `continue(handle, prompt)` → the SAME box, `streamPrompt({ sessionId })`.
 *      The context lives in the sandbox; the prompt is only the new turn. Before
 *      streaming it ASSERTS the session is still live server-side (via
 *      `box.session(id).status()`): if the platform never honored the
 *      client-minted id (or reaped it), `status()` is `null` and `continue`
 *      fails loud rather than silently re-running the turn without prior context.
 *   - `fork(handle, n, ...)` → when the box exposes live `branch(count)`, branch
 *      the running parent in bounded waves so N children inherit its context
 *      prefix; otherwise start N independent fresh boxes. Either way each branch
 *      streams its own turn. Child-box creation is bounded by the lineage's
 *      `maxConcurrency`. The box itself is the one capability read: there is no
 *      separate client probe.
 *
 * Invariant: the lineage OWNS every box it starts or forks and tears them all
 * down on `teardown()` (or earlier via `prune`). It never tears down a box
 * mid-flight — the kernel decides when a handle is done. Streaming itself stays
 * in `run-loop.ts`; the lineage only hands back the live `streamPrompt` iterable
 * so the kernel keeps ownership of event collection, cost accounting, and trace
 * emission.
 *
 * @experimental
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import type {
  BranchOptions,
  CreateSandboxOptions,
  PromptOptions,
  SandboxEvent,
  SandboxInstance,
} from '@tangle-network/sandbox'
import { ValidationError } from '../errors'
import { acquireSandbox } from './sandbox-acquire'
import { buildBackendOptions } from './sandbox-backend'
import type { AgentRunSpec, MountRecorder, SandboxClient } from './types'
import {
  deleteBoxSafe,
  mapWithConcurrency,
  randomUuid,
  throwAbort,
  throwIfAborted,
  withTimeout,
} from './util'

const TEARDOWN_TIMEOUT_MS = 15_000
const DEFAULT_FORK_CONCURRENCY = 4

/**
 * One turn's event stream, in the lineage's chosen streaming mode.
 *
 * - `'sse'` (default): live `streamPrompt` — low latency, full per-token trace.
 *   Best for interactive chat.
 * - `'poll'`: fire-and-detach via `dispatchPrompt`, await the terminal result by
 *   status-polling (NOT a held SSE), then yield the answer as one synthesized
 *   event. A long, quiet in-box turn (clone + build + test) never holds a live
 *   stream a proxy idle-timeout can drop mid-execution — the failure mode that
 *   made batch eval runs lose their stream on both prod and staging. Lower trace
 *   fidelity (one terminal event, not per-token), so it is opt-in for batch.
 *
 * Both yield the same `SandboxEvent` vocabulary, so callers are agnostic.
 */
async function* pollPromptEvents(
  box: SandboxInstance,
  prompt: string,
  sessionId: string,
  signal: AbortSignal,
  promptOptions?: Omit<PromptOptions, 'signal' | 'sessionId'>,
): AsyncIterable<SandboxEvent> {
  if (signal.aborted) throwAbort()
  // dispatchPrompt returns the session id the platform actually assigned, which
  // may be one it MINTED rather than the supplied `sessionId`. Polling the
  // supplied id when the platform minted a different one 404s the session-events
  // endpoint ("Resource not found"). Always follow the assigned id.
  const dispatched = await box.dispatchPrompt(prompt, {
    ...(promptOptions ?? {}),
    sessionId,
    signal,
  })
  const activeSessionId = dispatched.sessionId
  const result = await box.session(activeSessionId).result()
  if (signal.aborted) throwAbort()
  const resultData = {
    finalText: result.response ?? '',
    success: result.success,
    ...(result.status ? { status: result.status } : {}),
    ...(result.error ? { error: result.error } : {}),
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    ...(result.toolInvocations ? { toolInvocations: result.toolInvocations } : {}),
    ...(result.approval ? { approval: result.approval } : {}),
    ...(result.question ? { question: result.question } : {}),
    ...(result.interaction ? { interaction: result.interaction } : {}),
    ...(result.plan ? { plan: result.plan } : {}),
    ...(result.usage ? { usage: result.usage } : {}),
    ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
  }
  yield {
    type: 'result',
    id: activeSessionId,
    data: resultData,
  }
  yield {
    type: 'done',
    id: activeSessionId,
    data: {
      ...resultData,
      outcome:
        result.status === 'awaiting_plan_decision' && result.plan
          ? { type: 'awaiting_plan_decision', plan: result.plan }
          : { type: 'completed' },
    },
  }
}

export function promptEvents(
  streaming: 'sse' | 'poll',
  box: SandboxInstance,
  prompt: string,
  sessionId: string,
  signal: AbortSignal,
  promptOptions?: Omit<PromptOptions, 'signal' | 'sessionId'>,
): AsyncIterable<SandboxEvent> {
  return streaming === 'poll'
    ? pollPromptEvents(box, prompt, sessionId, signal, promptOptions)
    : box.streamPrompt(prompt, { ...(promptOptions ?? {}), sessionId, signal })
}

/**
 * A live box plus the session that threads its iterations together. Handed back
 * by `start`/`fork`, passed into `continue`/`fork` to descend from. Opaque to
 * the kernel beyond `box` (for placement/teardown) and `sessionId` (trace).
 *
 * @experimental
 */
export interface SandboxLineageHandle {
  /** The owned, running sandbox this handle drives. */
  box: SandboxInstance
  /**
   * Stable session id threaded through this box's `streamPrompt` calls. Minted
   * by the lineage on `start`; reused on `continue` so the server continues the
   * same conversation. A forked handle starts a fresh session on its new box —
   * the shared context comes from the live branch, not a shared session id.
   */
  sessionId: string
}

/**
 * Owns box + session handles for one loop run and offers the three
 * capability-gated lifecycle moves. Construct via `createSandboxLineage`.
 *
 * @experimental
 */
export interface SandboxLineage {
  /**
   * Acquire a fresh box and begin a new session on it. Returns the handle and
   * the live `streamPrompt` iterable for the first turn (caller drains it).
   */
  start(
    spec: AgentRunSpec<unknown>,
    prompt: string,
    signal: AbortSignal,
    promptOptions?: Omit<PromptOptions, 'signal' | 'sessionId'>,
  ): Promise<{ handle: SandboxLineageHandle; events: AsyncIterable<SandboxEvent> }>
  /**
   * Continue an existing handle's session with one more turn on the SAME box.
   * The prior context is server-side; `prompt` is only the new turn. Asserts the
   * session is still known to the sandbox first (fail-loud) so a platform that
   * silently dropped the client-minted session id surfaces as an error instead
   * of a contextless turn the caller mistakes for a real continuation.
   */
  continue(
    handle: SandboxLineageHandle,
    prompt: string,
    signal: AbortSignal,
    promptOptions?: Omit<PromptOptions, 'signal' | 'sessionId'>,
  ): Promise<AsyncIterable<SandboxEvent>>
  /**
   * Branch `count` children from `parent`. When the platform exposes live
   * branching, each child inherits the parent's running state — and therefore
   * the parent's IMAGE and PROFILE: under a real fork `specs[i]` does NOT
   * re-select a per-branch
   * profile (the SDK forks the running box, it can't swap the image). `specs[i]`
   * picks the per-branch profile ONLY on the degraded fresh-box path (no live
   * branch support).
   * A heterogeneous-profile fanout therefore homogenizes to the parent's profile
   * when fork is available — pass a single shared spec for forked fanouts, or
   * use `random@k` (no fork) when branches must differ. Each child's first turn
   * streams `prompts[i]`. Child-box creation is bounded by `maxConcurrency`.
   * An implementation MUST forward `promptOptions` into every branch's first
   * prompt: the compiler accepts an implementation that ignores the argument, and
   * a branch that drops it runs without the caller's session credential.
   */
  fork(
    parent: SandboxLineageHandle,
    prompts: string[],
    specs: AgentRunSpec<unknown>[],
    signal: AbortSignal,
    promptOptions?: Omit<PromptOptions, 'signal' | 'sessionId'>,
    executionIds?: readonly string[],
  ): Promise<{ handle: SandboxLineageHandle; events: AsyncIterable<SandboxEvent> }[]>
  /**
   * Destroy every owned box whose handle is NOT in `keep`, freeing it before
   * loop end. The kernel calls this after a round when it can prove no future
   * round will descend from the pruned boxes (deterministic, monotonic branch
   * selection); boxes still reachable as a future branch source are retained.
   * Best-effort, bounded, parallel — a failed delete never throws.
   */
  prune(keep: Iterable<SandboxLineageHandle>): Promise<void>
  /** Destroy every box this lineage owns. Best-effort, bounded, parallel. */
  teardown(): Promise<void>
}

/**
 * Build a lineage bound to one client. Branching is read from each box.
 *
 * @experimental
 */
export function createSandboxLineage(
  client: SandboxClient,
  options: {
    maxConcurrency?: number
    streaming?: 'sse' | 'poll'
    /** Run provenance recorder forwarded to every `prepareBox` the lineage runs
     *  (fresh start, continue, and fork branches). Absent ⇒ mounts go unrecorded
     *  (a no-op recorder stands in so the ctx shape is always satisfied). */
    recordMount?: MountRecorder
    /** A failed delete must surface and leave the box available for evidence recovery. */
    failOnDestroyError?: boolean
    /** Capture and durably record evidence before the box is deleted. */
    beforeDelete?: (box: SandboxInstance) => Promise<void>
    onAcquire?: (box: SandboxInstance, profile: AgentProfile) => void
  } = {},
): SandboxLineage {
  if (!client || typeof client.create !== 'function') {
    throw new ValidationError('createSandboxLineage: client.create is required')
  }
  // 'sse' (default) preserves the byte-identical live-stream behavior; 'poll' is
  // the drop-resilient fire-and-detach path for long, quiet batch turns.
  const streaming = options.streaming ?? 'sse'
  const recordMount: MountRecorder = options.recordMount ?? (() => {})
  // Bounds the burst of box creation inside `fork` so an N-way fanout doesn't
  // provision N boxes simultaneously regardless of the loop's concurrency cap.
  const forkConcurrency = Math.max(
    1,
    Math.floor(options.maxConcurrency ?? DEFAULT_FORK_CONCURRENCY),
  )
  const owned: SandboxInstance[] = []
  const profiles = new Map<SandboxInstance, AgentProfile>()

  const acquireFresh = async (
    spec: AgentRunSpec<unknown>,
    signal: AbortSignal,
  ): Promise<SandboxInstance> => {
    if (signal.aborted) throwAbort()
    const opts: CreateSandboxOptions = buildBackendOptions(spec.profile, spec.sandboxOverrides)
    const box = await acquireSandbox(client, opts, {
      signal,
      ...(options.onAcquire === undefined
        ? {}
        : { onAcquire: (source: SandboxInstance) => options.onAcquire?.(source, spec.profile) }),
      ...(options.beforeDelete === undefined ? {} : { beforeDelete: options.beforeDelete }),
    })
    owned.push(box)
    profiles.set(box, spec.profile)
    options.onAcquire?.(box, spec.profile)
    try {
      await spec.prepareBox?.(box, { signal, recordMount })
    } catch (error) {
      try {
        await destroyBounded(box, options.failOnDestroyError, options.beforeDelete)
        owned.splice(owned.indexOf(box), 1)
      } catch (captureError) {
        throw new AggregateError(
          [error, captureError],
          'Sandbox preparation and evidence cleanup failed',
        )
      }
      throw error
    }
    return box
  }

  return {
    async start(spec, prompt, signal, promptOptions) {
      const box = await acquireFresh(spec, signal)
      const sessionId = mintSessionId()
      const events = promptEvents(streaming, box, prompt, sessionId, signal, promptOptions)
      return { handle: { box, sessionId }, events }
    },

    async continue(handle, prompt, signal, promptOptions) {
      if (signal.aborted) throwAbort()
      // Fail loud if the platform did not preserve the client-minted session:
      // continuing a dead/unknown session would silently lose all prior context.
      await assertSessionLive(handle.box, handle.sessionId)
      // Same box, same session id — the server continues the conversation; we do
      // NOT re-acquire and do NOT re-inject prior context as prompt text.
      return promptEvents(streaming, handle.box, prompt, handle.sessionId, signal, promptOptions)
    },

    async fork(parent, prompts, specs, signal, promptOptions, executionIds) {
      if (executionIds !== undefined && executionIds.length !== prompts.length) {
        throw new ValidationError('SandboxLineage.fork: execution IDs must match prompts')
      }
      const optionsFor = (index: number) =>
        executionIds === undefined
          ? promptOptions
          : { ...(promptOptions ?? {}), executionId: executionIds[index] }
      if (prompts.length === 0) {
        throw new ValidationError('SandboxLineage.fork: prompts must be non-empty')
      }
      if (signal.aborted) throwAbort()
      const branched = await branchParent(parent.box, prompts.length, forkConcurrency, signal)
      if (branched !== undefined) {
        // Track children before validating the fan-out so teardown can reap a
        // partial response if the platform reports fewer children than asked.
        owned.push(...branched)
        const inheritedProfile = profiles.get(parent.box)
        if (inheritedProfile !== undefined) {
          for (const box of branched) {
            profiles.set(box, inheritedProfile)
            options.onAcquire?.(box, inheritedProfile)
          }
        }
        if (branched.length !== prompts.length) {
          throw new ValidationError(
            `SandboxLineage.fork: Sandbox returned ${branched.length} of ${prompts.length} requested children`,
          )
        }
        return mapWithConcurrency(branched, forkConcurrency, async (box, i) => {
          throwIfAborted(signal)
          const spec = specs[i % specs.length]
          if (!spec) throw new ValidationError('SandboxLineage.fork: no AgentRunSpec for branch')
          if (inheritedProfile === undefined) {
            profiles.set(box, spec.profile)
            options.onAcquire?.(box, spec.profile)
          }
          await spec.prepareBox?.(box, { signal, recordMount })
          const sessionId = mintSessionId()
          return {
            handle: { box, sessionId },
            events: promptEvents(streaming, box, prompts[i]!, sessionId, signal, optionsFor(i)),
          }
        })
      }
      // No live branching: independent fresh boxes, created in waves of at most
      // `forkConcurrency`. A branch that cannot inherit context never pretends to.
      return mapWithConcurrency(prompts, forkConcurrency, async (prompt, i) => {
        throwIfAborted(signal)
        const spec = specs[i % specs.length]
        if (!spec) throw new ValidationError('SandboxLineage.fork: no AgentRunSpec for branch')
        const box = await acquireFresh(spec, signal)
        const sessionId = mintSessionId()
        return {
          handle: { box, sessionId },
          events: promptEvents(streaming, box, prompt, sessionId, signal, optionsFor(i)),
        }
      })
    },

    async prune(keep) {
      const keepBoxes = new Set<SandboxInstance>()
      for (const handle of keep) keepBoxes.add(handle.box)
      const survivors: SandboxInstance[] = []
      const doomed: SandboxInstance[] = []
      for (const box of owned) (keepBoxes.has(box) ? survivors : doomed).push(box)
      if (doomed.length === 0) return
      const results = await Promise.allSettled(
        doomed.map((box) => destroyBounded(box, options.failOnDestroyError, options.beforeDelete)),
      )
      const failed = results.flatMap((result, index) =>
        result.status === 'rejected' ? [doomed[index]!] : [],
      )
      owned.length = 0
      owned.push(...survivors, ...failed)
      if (failed.length > 0)
        throw new AggregateError(
          results
            .filter((result) => result.status === 'rejected')
            .map((result) => (result as PromiseRejectedResult).reason),
          'Sandbox evidence capture failed before prune',
        )
    },

    async teardown() {
      const boxes = owned.splice(0, owned.length)
      const results = await Promise.allSettled(
        boxes.map((box) => destroyBounded(box, options.failOnDestroyError, options.beforeDelete)),
      )
      const failed = results.flatMap((result, index) =>
        result.status === 'rejected' ? [boxes[index]!] : [],
      )
      owned.push(...failed)
      if (failed.length > 0)
        throw new AggregateError(
          results
            .filter((result) => result.status === 'rejected')
            .map((result) => (result as PromiseRejectedResult).reason),
          'Sandbox evidence capture failed before teardown',
        )
    },
  }
}

/** Stable, collision-resistant session id minted per box (the caller owns the id). */
function mintSessionId(): string {
  return `loop-sess-${randomUuid()}`
}

/**
 * Branch a running parent through the current Sandbox SDK, in bounded waves.
 * `undefined` means the box exposes no branching API, so the caller starts
 * fresh boxes.
 */
async function branchParent(
  box: SandboxInstance,
  count: number,
  concurrency: number,
  signal: AbortSignal,
): Promise<SandboxInstance[] | undefined> {
  const branch = (box as unknown as BranchCapableBox).branch
  if (typeof branch !== 'function') return undefined
  const children: SandboxInstance[] = []
  try {
    for (let offset = 0; offset < count; offset += concurrency) {
      throwIfAborted(signal)
      const requested = Math.min(concurrency, count - offset)
      const batch = await branch.call(box, requested)
      children.push(...batch)
      // Return partial batches to the caller so it can register every child for
      // teardown before rejecting the incomplete fan-out.
      if (batch.length !== requested) return children
    }
    return children
  } catch (error) {
    if (children.length) return children
    throw error
  }
}

/**
 * Fail loud when a handle's session is no longer known to the sandbox. The real
 * SDK box exposes `session(id).status()` which resolves `null` for an unknown /
 * reaped id; a `null` here means a `continue` would run WITHOUT the prior
 * context the caller believes is threaded — so refuse it. Boxes that expose no
 * `session` method (the loop's test fakes, or an SDK without the session API)
 * cannot be verified and are allowed through unchecked.
 */
async function assertSessionLive(box: SandboxInstance, sessionId: string): Promise<void> {
  const session = (box as SessionCapableBox).session
  if (typeof session !== 'function') return
  const info = await session.call(box, sessionId).status()
  if (info === null) {
    throw new ValidationError(
      `SandboxLineage.continue: session ${sessionId} is not known to the sandbox — the platform ` +
        'did not preserve the client-minted session id (or it was reaped). Continuing would run ' +
        'without prior context; refusing to silently lose conversation continuity.',
    )
  }
}

async function destroyBounded(
  box: SandboxInstance,
  failOnError = false,
  beforeDelete?: (box: SandboxInstance) => Promise<void>,
): Promise<void> {
  if (beforeDelete !== undefined) {
    await beforeDelete(box)
    return
  }
  if (failOnError) {
    await box.delete()
    return
  }
  await withTimeout(deleteBoxSafe(box), TEARDOWN_TIMEOUT_MS)
}

/** Loop-side view of the current Sandbox SDK's live branch method. @experimental */
export interface BranchCapableBox {
  branch?: (count: number, options?: BranchOptions) => Promise<SandboxInstance[]>
}

/**
 * Loop-side widening of the box's optional session accessor. The real
 * `SandboxInstance` exposes `session(id).status()`; the loop reads it optionally
 * so `continue` can assert session liveness without requiring it of the test
 * fakes. `status()` resolves `null` when the id is unknown to the sandbox.
 * @experimental
 */
export interface SessionCapableBox {
  session?: (id: string) => { status: () => Promise<unknown | null> }
}
