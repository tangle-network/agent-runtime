/**
 * `openSandboxRun` — the ONE harness-agnostic seam for running an agent in a
 * sandbox over a persistent artifact: run it, stream it, RESUME the same session
 * across turns. Domain-agnostic: a coding agent, a research agent, a tax/legal
 * agent — all flow through this; the domain lives only in the `Deliverable<Out>`
 * the caller supplies, never in a per-domain copy of this function.
 *
 * It is a thin facade (NOT a new layer) over code that already exists and is
 * already hardened:
 *   - `acquireSandbox` — cold-start / 502-503-504 / gateway-timeout recovery,
 *   - `buildBackendOptions` — the harness IS `backend.type` (opencode / codex /
 *     claude-code / kimi-code / hermes / pi); the only "which agent" knob,
 *   - `createSandboxLineage` — `start` mints a session; `resume` continues the
 *     SAME server-side session with a fail-loud `assertSessionLive`.
 *
 * The one genuinely-new piece is {@link Deliverable}: it widens the pure
 * `OutputAdapter.parse(events)` to ALSO admit a post-turn read off the box FS —
 * the structural gap that made the bench gates hand-roll `box.fs.read`, because a
 * large produced file (a git diff, a generated document) truncates in the chat
 * stream and a pure events-parser cannot reach the workspace. Per the SDK, a
 * RELATIVE `deliverable.path` resolves from the workspace root and an ABSOLUTE one
 * (e.g. `/tmp/solution.patch`) reads the container filesystem directly — both are
 * valid; pick the one the agent actually wrote to. Avoid `..` traversal segments.
 *
 * What this deliberately does NOT do (so it stays a facade, not slop): no custom
 * reconnect/replay (the SDK + platform own per-session buffering + `Last-Event-ID`);
 * no fork verb (platform CRIU is probe-gated and currently absent — fork lives in
 * `SandboxLineage.fork` behind the capability probe, surfaced only if it returns).
 * It is also distinct from `runLoop`: `runLoop` is the multi-round, driver-driven
 * kernel (fresh box per round, events deliverable); this is a SINGLE rollout +
 * artifact-or-events deliverable + resume over ONE persistent box.
 */

import type { SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { probeSandboxCapabilities } from './sandbox-capabilities'
import { createSandboxLineage, type SandboxLineageHandle } from './sandbox-lineage'
import type { AgentRunSpec, LoopSandboxClient } from './types'
import { throwIfAborted } from './util'

/**
 * @experimental
 * How a typed deliverable `Out` is materialized from a finished turn.
 * - `events`   — pure parse over the event array (identical to `OutputAdapter`).
 * - `artifact` — read a file off the box AFTER the turn drains, then map it (+ the
 *                events). For diffs/codebases/documents that don't fit the chat
 *                stream. `path` relative ⇒ workspace root; absolute ⇒ container FS.
 */
export type Deliverable<Out> =
  | { kind: 'events'; fromEvents: (events: SandboxEvent[]) => Out }
  | { kind: 'artifact'; path: string; fromArtifact: (raw: string, events: SandboxEvent[]) => Out }

/**
 * @experimental
 * One finished turn over the artifact. A failed FS read is surfaced in `readError`
 * (never masked as an empty deliverable) so a caller distinguishes "agent produced
 * nothing" from a transport/FS fault.
 */
export interface TurnResult<Out> {
  out: Out
  events: SandboxEvent[]
  readError?: string
}

/** @experimental A live run over ONE persistent artifact (box + session). Close it
 *  when done — `close()` tears the box down. */
export interface SandboxRun<Out> {
  readonly box: SandboxInstance
  readonly sessionId: string
  /** First turn over the fresh box (mints the session). Throws if already started. */
  start(prompt: string): Promise<TurnResult<Out>>
  /** Continue THE SAME session over THE SAME artifact — a resumed turn/rollout. */
  resume(prompt: string): Promise<TurnResult<Out>>
  close(): Promise<void>
}

/** @experimental */
export interface OpenSandboxRunOptions {
  /** Profile + sandbox env/overrides. `sandboxOverrides.backend.type` is the harness. */
  agentRun: AgentRunSpec<string>
  signal: AbortSignal
  /** Bounds box-creation bursts inside lineage fanout. Default from lineage. */
  maxConcurrency?: number
}

/**
 * @experimental
 * Open a sandbox run. Harness-agnostic: the harness lives in
 * `options.agentRun.sandboxOverrides.backend.type`, so opencode/codex/claude-code/
 * kimi-code all flow through this one entrypoint with identical env/auth wiring.
 */
export async function openSandboxRun<Out>(
  client: LoopSandboxClient,
  options: OpenSandboxRunOptions,
  deliverable: Deliverable<Out>,
): Promise<SandboxRun<Out>> {
  const capabilities = await probeSandboxCapabilities(client)
  const lineage = createSandboxLineage(client, capabilities, {
    ...(options.maxConcurrency !== undefined ? { maxConcurrency: options.maxConcurrency } : {}),
  })
  let handle: SandboxLineageHandle | undefined
  let started = false

  // `box` is passed in (not read from the closed-over `handle`) so the invariant
  // is type-level, not call-order discipline.
  async function settle(
    box: SandboxInstance,
    events: AsyncIterable<SandboxEvent>,
  ): Promise<TurnResult<Out>> {
    const collected: SandboxEvent[] = []
    for await (const ev of events) collected.push(ev)
    if (deliverable.kind === 'events') {
      return { out: deliverable.fromEvents(collected), events: collected }
    }
    throwIfAborted(options.signal)
    let raw = ''
    let readError: string | undefined
    try {
      raw = await box.fs.read(deliverable.path)
    } catch (err) {
      readError = err instanceof Error ? err.message : String(err)
    }
    return {
      out: deliverable.fromArtifact(raw, collected),
      events: collected,
      ...(readError !== undefined ? { readError } : {}),
    }
  }

  return {
    get box(): SandboxInstance {
      if (!handle) throw new Error('openSandboxRun: box unavailable before start()')
      return handle.box
    },
    get sessionId(): string {
      if (!handle) throw new Error('openSandboxRun: sessionId unavailable before start()')
      return handle.sessionId
    },
    async start(prompt) {
      if (started)
        throw new Error(
          'openSandboxRun: start() already called — use resume() to continue the session',
        )
      started = true
      // lineage.start uses only spec.profile + sandboxOverrides (the prompt is passed
      // directly, not via taskToPrompt), so the task type is irrelevant here.
      const r = await lineage.start(
        options.agentRun as AgentRunSpec<unknown>,
        prompt,
        options.signal,
      )
      handle = r.handle
      return settle(handle.box, r.events)
    },
    async resume(prompt) {
      if (!handle) throw new Error('openSandboxRun: resume() called before start()')
      return settle(handle.box, await lineage.continue(handle, prompt, options.signal))
    },
    async close() {
      await lineage.teardown()
    },
  }
}
