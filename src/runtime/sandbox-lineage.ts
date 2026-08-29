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
 *   - `fork(handle, n, ...)` → when the Sandbox SDK exposes live `branch(count)`,
 *      branch the running parent in bounded waves so N children inherit its
 *      context prefix; otherwise use the legacy checkpoint path when its
 *      capability probe is positive, or N independent fresh boxes. Either way
 *      each branch streams its own turn. Child-box creation is bounded by the
 *      lineage's `maxConcurrency`.
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
import type { SandboxCapabilities } from './sandbox-capabilities'
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
   * the shared context comes from the live branch or legacy checkpoint, not a
   * shared session id.
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
   * picks the per-branch profile ONLY on the degraded fresh-box path (no branch
   * or legacy fork support).
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
 * Build a lineage bound to one client + its probed capabilities. The
 * capabilities are passed in (not re-probed) so the kernel probes once per run
 * and the lineage stays a pure function of "what this platform can do".
 *
 * @experimental
 */
export function createSandboxLineage(
  client: SandboxClient,
  capabilities: SandboxCapabilities,
  options: {
    maxConcurrency?: number
    streaming?: 'sse' | 'poll'
    /** Run provenance recorder forwarded to every `prepareBox` the lineage runs
     *  (fresh start, continue, and fork branches). Absent ⇒ mounts go unrecorded
     *  (a no-op recorder stands in so the ctx shape is always satisfied). */
    recordMount?: MountRecorder
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

  const acquireFresh = async (
    spec: AgentRunSpec<unknown>,
    signal: AbortSignal,
  ): Promise<SandboxInstance> => {
    if (signal.aborted) throwAbort()
    const opts: CreateSandboxOptions = buildBackendOptions(spec.profile, spec.sandboxOverrides)
    const box = await acquireSandbox(client, opts, { signal })
    await spec.prepareBox?.(box, { signal, recordMount })
    owned.push(box)
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

    async fork(parent, prompts, specs, signal, promptOptions) {
      if (prompts.length === 0) {
        throw new ValidationError('SandboxLineage.fork: prompts must be non-empty')
      }
      if (signal.aborted) throwAbort()
      const branched = await branchParent(parent.box, prompts.length, forkConcurrency, signal)
      if (branched !== undefined) {
        // Track children before validating the fan-out so teardown can reap a
        // partial response if the platform reports fewer children than asked.
        owned.push(...branched)
        if (branched.length !== prompts.length) {
          throw new ValidationError(
            `SandboxLineage.fork: Sandbox returned ${branched.length} of ${prompts.length} requested children`,
          )
        }
        return mapWithConcurrency(branched, forkConcurrency, async (box, i) => {
          throwIfAborted(signal)
          const spec = specs[i % specs.length]
          if (!spec) throw new ValidationError('SandboxLineage.fork: no AgentRunSpec for branch')
          await spec.prepareBox?.(box, { signal, recordMount })
          const sessionId = mintSessionId()
          return {
            handle: { box, sessionId },
            events: promptEvents(streaming, box, prompts[i]!, sessionId, signal, promptOptions),
          }
        })
      }
      const checkpointId = capabilities.canFork
        ? await checkpointForFork(parent.box, signal)
        : undefined
      // checkpointId === undefined ⇒ either the platform can't fork or the
      // checkpoint call yielded nothing usable: degrade to independent fresh
      // boxes. Never silently reuse the parent box for a branch.
      //
      // Bounded by `forkConcurrency`: an N-way fanout creates child boxes in
      // waves of at most `forkConcurrency`, not all N at once. Abort is checked
      // per branch (between waves), since the SDK's `fork`/`create` calls take no
      // signal and cannot be interrupted once in flight.
      return mapWithConcurrency(prompts, forkConcurrency, async (prompt, i) => {
        throwIfAborted(signal)
        const spec = specs[i % specs.length]
        if (!spec) throw new ValidationError('SandboxLineage.fork: no AgentRunSpec for branch')
        if (checkpointId !== undefined) {
          const box = await forkFromCheckpoint(parent.box, checkpointId, signal)
          owned.push(box)
          await spec.prepareBox?.(box, { signal, recordMount })
          const sessionId = mintSessionId()
          return {
            handle: { box, sessionId },
            events: promptEvents(streaming, box, prompt, sessionId, signal, promptOptions),
          }
        }
        const box = await acquireFresh(spec, signal)
        const sessionId = mintSessionId()
        return {
          handle: { box, sessionId },
          events: promptEvents(streaming, box, prompt, sessionId, signal, promptOptions),
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
      owned.length = 0
      owned.push(...survivors)
      await Promise.allSettled(doomed.map((box) => destroyBounded(box)))
    },

    async teardown() {
      const boxes = owned.splice(0, owned.length)
      await Promise.allSettled(boxes.map((box) => destroyBounded(box)))
    },
  }
}

/** Stable, collision-resistant session id minted per box (the caller owns the id). */
function mintSessionId(): string {
  return `loop-sess-${randomUuid()}`
}

/**
 * Branch a running parent through the current Sandbox SDK, in bounded waves.
 * `undefined` means the box exposes only the legacy checkpoint API (or no
 * branching API), so the caller may try the legacy capability-gated path.
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
}

/**
 * Checkpoint the parent leaving it running, returning the checkpoint id to fork
 * from, or `undefined` when the box exposes no legacy `checkpoint` method or
 * the call produced no id. `undefined` makes the caller use fresh boxes — a
 * fork that cannot preserve context must not pretend to share it.
 */
async function checkpointForFork(
  box: SandboxInstance,
  signal: AbortSignal,
): Promise<string | undefined> {
  const checkpoint = (box as CheckpointCapableBox).checkpoint
  if (typeof checkpoint !== 'function') return undefined
  if (signal.aborted) throwAbort()
  const result = await checkpoint.call(box, { leaveRunning: true })
  const id = result?.checkpointId
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/**
 * Fork a child box from `checkpointId`. The box exposes `fork` whenever the
 * platform advertised `canFork`; a missing `fork` here is a contract violation
 * (probe said yes, box says no) and fails loud rather than silently degrading.
 *
 * `signal` gates entry only: the legacy SDK's `fork(checkpointId, options)`
 * takes no abort signal, so an in-flight fork cannot be interrupted. The
 * caller checks abort per branch, so cancellation is responsive at boundaries.
 */
async function forkFromCheckpoint(
  box: SandboxInstance,
  checkpointId: string,
  signal: AbortSignal,
): Promise<SandboxInstance> {
  const fork = (box as unknown as ForkCapableBox).fork
  if (typeof fork !== 'function') {
    throw new ValidationError(
      'SandboxLineage.fork: capabilities report canFork but the box has no fork() method',
    )
  }
  if (signal.aborted) throwAbort()
  return fork.call(box, checkpointId)
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

async function destroyBounded(box: SandboxInstance): Promise<void> {
  await withTimeout(deleteBoxSafe(box), TEARDOWN_TIMEOUT_MS)
}

/**
 * Loop-side widening of the box's optional checkpoint method. The
 * `SandboxClient`/`SandboxInstance` surface the kernel relies on does not
 * require checkpointing; this reads it optionally so the lineage can probe-gate
 * without importing sandbox-backend specifics. @experimental
 */
export interface CheckpointCapableBox {
  checkpoint?: (options?: { leaveRunning?: boolean; tags?: string[] }) => Promise<{
    checkpointId: string
  }>
}

/** Loop-side view of the current Sandbox SDK's live branch method. @experimental */
export interface BranchCapableBox {
  branch?: (count: number, options?: BranchOptions) => Promise<SandboxInstance[]>
}

/** Loop-side widening of the legacy checkpoint fork method. @experimental */
export interface ForkCapableBox {
  fork?: (checkpointId: string, options?: { name?: string }) => Promise<SandboxInstance>
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
