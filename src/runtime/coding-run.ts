/**
 * `openCodingRun` — the ONE harness-agnostic seam for running a coding agent in a
 * sandbox over a persistent artifact: run it, stream it, RESUME the same session
 * across rollouts. It is a thin facade (no new layer) over code that already exists
 * and is already hardened:
 *   - `acquireSandbox` (cold-start / 502-503-504 / gateway-timeout recovery),
 *   - `buildBackendOptions` (the harness IS `backend.type` — opencode / codex /
 *     claude-code / kimi-code / hermes / pi; the only "which agent" knob),
 *   - `createSandboxLineage` (`start` mints a session; `continue` resumes the SAME
 *     server-side session with a fail-loud `assertSessionLive`).
 *
 * The one genuinely-new piece is {@link Deliverable}: it widens the pure
 * `OutputAdapter.parse(events)` to ALSO admit a post-turn read off the box FS,
 * because the real deliverable of a coding agent (a large git diff) truncates in
 * the chat stream and must be read from the workspace. Reads are WORKSPACE-RELATIVE
 * (`box.fs.read('solution.patch')`) — absolute `/tmp` / `/work` reads fail
 * "outside allowed roots" on the platform.
 *
 * Reconnect/replay, session buffering and idempotent dispatch are owned by the
 * SDK + platform (per-session event buffering + `Last-Event-ID`); this facade does
 * NOT re-roll any of that — it only drives the existing seams. Fork is deliberately
 * NOT exposed (the platform's CRIU checkpoint is probe-gated and currently absent).
 */

import type { SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { probeSandboxCapabilities } from './sandbox-capabilities'
import { createSandboxLineage, type SandboxLineageHandle } from './sandbox-lineage'
import type { AgentRunSpec, LoopSandboxClient } from './types'

/**
 * How a typed deliverable `Out` is materialized from a finished turn.
 * - `events`   — pure parse over the event array (identical to `OutputAdapter`).
 * - `artifact` — read a WORKSPACE-RELATIVE file off the box AFTER the turn drains,
 *                then map it (+ the events). For diffs/codebases that don't fit the
 *                chat stream.
 */
export type Deliverable<Out> =
  | { kind: 'events'; fromEvents: (events: SandboxEvent[]) => Out }
  | { kind: 'artifact'; path: string; fromArtifact: (raw: string, events: SandboxEvent[]) => Out }

/** One finished turn over the artifact. A failed FS read is surfaced (never masked
 *  as an empty deliverable) so a caller distinguishes "agent produced nothing" from
 *  a transport/FS fault. */
export interface TurnResult<Out> {
  out: Out
  events: SandboxEvent[]
  readError?: string
}

/** A live run over ONE persistent artifact (box + session). Close it when done. */
export interface CodingRun<Out> {
  readonly box: SandboxInstance
  readonly sessionId: string
  /** First turn over the fresh box (mints the session). */
  start(prompt: string): Promise<TurnResult<Out>>
  /** Continue THE SAME session over THE SAME artifact — a resumed rollout. */
  resume(prompt: string): Promise<TurnResult<Out>>
  close(): Promise<void>
}

export interface OpenCodingRunOptions {
  /** Profile + sandbox env/overrides. `sandboxOverrides.backend.type` is the harness. */
  agentRun: AgentRunSpec<string>
  signal: AbortSignal
  /** Bounds box-creation bursts inside lineage fanout. Default from lineage. */
  maxConcurrency?: number
}

/**
 * Open a coding run. Harness-agnostic: the harness lives in
 * `options.agentRun.sandboxOverrides.backend.type`, so opencode/codex/claude-code/
 * kimi-code all flow through this one entrypoint with identical env/auth wiring.
 */
export async function openCodingRun<Out>(
  client: LoopSandboxClient,
  options: OpenCodingRunOptions,
  deliverable: Deliverable<Out>,
): Promise<CodingRun<Out>> {
  const capabilities = await probeSandboxCapabilities(client)
  const lineage = createSandboxLineage(client, capabilities, {
    ...(options.maxConcurrency !== undefined ? { maxConcurrency: options.maxConcurrency } : {}),
  })
  let handle: SandboxLineageHandle | undefined

  async function settle(events: AsyncIterable<SandboxEvent>): Promise<TurnResult<Out>> {
    const collected: SandboxEvent[] = []
    for await (const ev of events) collected.push(ev)
    if (deliverable.kind === 'events') {
      return { out: deliverable.fromEvents(collected), events: collected }
    }
    let raw = ''
    let readError: string | undefined
    try {
      raw = await handle!.box.fs.read(deliverable.path)
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
      if (!handle) throw new Error('openCodingRun: box not available before start()')
      return handle.box
    },
    get sessionId(): string {
      if (!handle) throw new Error('openCodingRun: sessionId not available before start()')
      return handle.sessionId
    },
    async start(prompt) {
      // lineage.start uses only spec.profile + sandboxOverrides (the prompt is passed
      // directly, not via taskToPrompt), so the task type is irrelevant here.
      const r = await lineage.start(options.agentRun as AgentRunSpec<unknown>, prompt, options.signal)
      handle = r.handle
      return settle(r.events)
    },
    async resume(prompt) {
      if (!handle) throw new Error('openCodingRun: resume() called before start()')
      return settle(await lineage.continue(handle, prompt, options.signal))
    },
    async close() {
      await lineage.teardown()
    },
  }
}
