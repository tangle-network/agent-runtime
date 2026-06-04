/**
 * @experimental
 *
 * `SandboxLineage` — the backend-blind owner of box + session handles for a
 * single `runLoop` invocation. It exists so `run-loop.ts` never references a
 * backend (Docker / Firecracker): the lineage turns "continue this session" and
 * "fork this branch" into capability-gated sandbox-SDK calls and degrades to
 * fresh boxes when a capability is absent.
 *
 * Three operations, mirroring the kernel's per-iteration choices:
 *   - `start(spec, prompt)`  → a fresh box; the FIRST `streamPrompt` carries a
 *      minted `sessionId` so later `continue` calls reuse the same server-side
 *      conversation instead of re-injecting prior context as prompt text.
 *   - `continue(handle, prompt)` → the SAME box, `streamPrompt({ sessionId })`.
 *      The context lives in the sandbox; the prompt is only the new turn.
 *   - `fork(handle, n, ...)` → when `canFork`, `checkpoint({ leaveRunning })` on
 *      the parent then `fork(checkpointId)` × n so N branches inherit a shared
 *      context prefix; otherwise N independent fresh boxes (same result, no
 *      prefix). Either way each branch streams its own turn.
 *
 * Invariant: the lineage OWNS every box it starts or forks and tears them all
 * down on `teardown()`. It never tears down a box mid-flight — the kernel
 * decides when a handle is done. Streaming itself stays in `run-loop.ts`; the
 * lineage only hands back the live `streamPrompt` iterable so the kernel keeps
 * ownership of event collection, cost accounting, and trace emission.
 */

import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { ValidationError } from '../errors'
import type { SandboxCapabilities } from './sandbox-capabilities'
import { acquireSandbox } from './sandbox-acquire'
import { buildBackendOptions } from './sandbox-backend'
import type { AgentRunSpec, LoopSandboxClient } from './types'
import { deleteBoxSafe, randomUuid, throwAbort, withTimeout } from './util'

const TEARDOWN_TIMEOUT_MS = 15_000

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
   * the shared context comes from the checkpoint, not a shared session id.
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
  ): Promise<{ handle: SandboxLineageHandle; events: AsyncIterable<SandboxEvent> }>
  /**
   * Continue an existing handle's session with one more turn on the SAME box.
   * The prior context is server-side; `prompt` is only the new turn.
   */
  continue(
    handle: SandboxLineageHandle,
    prompt: string,
    signal: AbortSignal,
  ): Promise<AsyncIterable<SandboxEvent>>
  /**
   * Branch `count` children from `parent`. When the platform can fork, each
   * child inherits `parent`'s checkpoint (shared context prefix); otherwise each
   * is an independent fresh box. Each child's first turn streams `prompts[i]`.
   * `specs[i]` supplies the fresh-box profile for child `i` (fork inherits the
   * parent's image, so a degraded fork still round-robins specs).
   */
  fork(
    parent: SandboxLineageHandle,
    prompts: string[],
    specs: AgentRunSpec<unknown>[],
    signal: AbortSignal,
  ): Promise<{ handle: SandboxLineageHandle; events: AsyncIterable<SandboxEvent> }[]>
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
  client: LoopSandboxClient,
  capabilities: SandboxCapabilities,
): SandboxLineage {
  if (!client || typeof client.create !== 'function') {
    throw new ValidationError('createSandboxLineage: client.create is required')
  }
  const owned: SandboxInstance[] = []

  const acquireFresh = async (
    spec: AgentRunSpec<unknown>,
    signal: AbortSignal,
  ): Promise<SandboxInstance> => {
    if (signal.aborted) throwAbort()
    const opts: CreateSandboxOptions = buildBackendOptions(spec.profile, spec.sandboxOverrides)
    const box = await acquireSandbox(client, opts, { signal })
    owned.push(box)
    return box
  }

  return {
    async start(spec, prompt, signal) {
      const box = await acquireFresh(spec, signal)
      const sessionId = mintSessionId()
      const events = box.streamPrompt(prompt, { sessionId, signal })
      return { handle: { box, sessionId }, events }
    },

    async continue(handle, prompt, signal) {
      if (signal.aborted) throwAbort()
      // Same box, same session id — the server continues the conversation; we do
      // NOT re-acquire and do NOT re-inject prior context as prompt text.
      return handle.box.streamPrompt(prompt, { sessionId: handle.sessionId, signal })
    },

    async fork(parent, prompts, specs, signal) {
      if (prompts.length === 0) {
        throw new ValidationError('SandboxLineage.fork: prompts must be non-empty')
      }
      if (signal.aborted) throwAbort()
      const checkpointId = capabilities.canFork
        ? await checkpointForFork(parent.box, signal)
        : undefined
      // checkpointId === undefined ⇒ either the platform can't fork or the
      // checkpoint call yielded nothing usable: degrade to independent fresh
      // boxes. Never silently reuse the parent box for a branch.
      return Promise.all(
        prompts.map(async (prompt, i) => {
          const spec = specs[i % specs.length]
          if (!spec) throw new ValidationError('SandboxLineage.fork: no AgentRunSpec for branch')
          if (checkpointId !== undefined) {
            const box = await forkFromCheckpoint(parent.box, checkpointId, signal)
            owned.push(box)
            const sessionId = mintSessionId()
            return { handle: { box, sessionId }, events: box.streamPrompt(prompt, { sessionId, signal }) }
          }
          const box = await acquireFresh(spec, signal)
          const sessionId = mintSessionId()
          return { handle: { box, sessionId }, events: box.streamPrompt(prompt, { sessionId, signal }) }
        }),
      )
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
 * Checkpoint the parent leaving it running, returning the checkpoint id to fork
 * from, or `undefined` when the box exposes no `checkpoint` (the loop's fakes)
 * or the call produced no id. `undefined` makes the caller degrade to fresh
 * boxes — a fork that can't checkpoint must not pretend to share context.
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
 */
async function forkFromCheckpoint(
  box: SandboxInstance,
  checkpointId: string,
  signal: AbortSignal,
): Promise<SandboxInstance> {
  const fork = (box as ForkCapableBox).fork
  if (typeof fork !== 'function') {
    throw new ValidationError(
      'SandboxLineage.fork: capabilities report canFork but the box has no fork() method',
    )
  }
  if (signal.aborted) throwAbort()
  return fork.call(box, checkpointId)
}

async function destroyBounded(box: SandboxInstance): Promise<void> {
  await withTimeout(deleteBoxSafe(box), TEARDOWN_TIMEOUT_MS)
}

/**
 * Loop-side widening of the box's optional checkpoint method. The
 * `LoopSandboxClient`/`SandboxInstance` surface the kernel relies on does not
 * require checkpointing; this reads it optionally so the lineage can probe-gate
 * without importing sandbox-backend specifics. @experimental
 */
export interface CheckpointCapableBox {
  checkpoint?: (options?: { leaveRunning?: boolean; tags?: string[] }) => Promise<{
    checkpointId: string
  }>
}

/** Loop-side widening of the box's optional fork method. @experimental */
export interface ForkCapableBox {
  fork?: (checkpointId: string, options?: { name?: string }) => Promise<SandboxInstance>
}
