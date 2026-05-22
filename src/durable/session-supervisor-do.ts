/**
 * `SessionSupervisorDO` — the Cloudflare Durable Object host for
 * `runSupervisedTurn`.
 *
 * A stateless Worker isolate is the wrong place to own a 15-minute run: it
 * dies on a deploy roll or CPU limit. A Durable Object is addressable by
 * session id and survives across requests — it is the right home for the
 * supervisor. This host is deliberately thin: all the durability logic lives
 * in the platform-agnostic `runSupervisedTurn`; the DO only hosts it and
 * uses an `alarm()` to re-attach a run the response stream abandoned.
 *
 * - `fetch` resolves the run, records it, arms the orphan-check alarm, and
 *   streams the supervised events back. If the client disconnects, the
 *   supervisor stops being pulled and its short lease lapses.
 * - `alarm()` is the recovery mechanism: it finds a recorded-but-unfinished
 *   run and re-drives `runSupervisedTurn` headlessly to completion (events
 *   land in the durable log; a later `fetch` replays them). A run still held
 *   by a live `fetch` raises `DurableRunLeaseHeldError` — not orphaned, so
 *   the alarm just re-arms.
 *
 * Structural CF types (`DurableObjectStateLike`) are defined locally so
 * agent-runtime keeps no dependency on `@cloudflare/workers-types` — the same
 * discipline as `D1DatabaseLike` in `d1-store.ts`.
 */

import type { RunSupervisorOptions } from './supervisor'
import { runSupervisedTurn } from './supervisor'
import { DurableRunLeaseHeldError } from './types'

/** Minimal Durable Object storage surface this host uses. Compatible with
 *  Cloudflare's `DurableObjectStorage`. */
export interface DurableObjectStorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>
  put<T = unknown>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  /** Schedule the next `alarm()` invocation at an epoch-ms time. */
  setAlarm(scheduledTime: number): Promise<void>
}

/** Minimal Durable Object state surface — the `state` ctor argument. */
export interface DurableObjectStateLike {
  storage: DurableObjectStorageLike
}

/**
 * Product-supplied wiring for the host. `resolveRun` / `resolveOrphan` build
 * the supervisor inputs (store, adapter, manifest) — the host owns no
 * product policy.
 */
export interface SupervisorHostConfig<TEvent, TEnv> {
  /** Build supervisor inputs for an incoming request. `undefined` → 404. */
  resolveRun(
    request: Request,
    env: TEnv,
    state: DurableObjectStateLike,
  ): Promise<RunSupervisorOptions<TEvent> | undefined>
  /** Rebuild supervisor inputs for an orphan re-attach, from the recorded
   *  runId. `undefined` → the run is untrackable; the host stops tracking it. */
  resolveOrphan(
    runId: string,
    env: TEnv,
    state: DurableObjectStateLike,
  ): Promise<RunSupervisorOptions<TEvent> | undefined>
  /** Serialize one event into a response-stream chunk (an SSE or NDJSON
   *  line — the product owns the framing). */
  encodeEvent(event: TEvent): string
  /** Delay before the orphan-check alarm fires. Default 60_000. */
  orphanCheckMs?: number
  /** Time source — tests pin this. */
  now?: () => number
}

/** The host instance surface — what a Cloudflare DO runtime invokes. */
export interface SessionSupervisorDO {
  fetch(request: Request): Promise<Response>
  alarm(): Promise<void>
}

/** DO-storage key under which the host records the in-flight run id, so the
 *  orphan-check `alarm()` can find a run a dropped response stream left behind. */
export const ACTIVE_RUN_KEY = 'agent-runtime:active-run-id'

/** Drain a supervised stream without a consumer — events land in the durable
 *  log via the supervisor; nothing forwards them. */
async function drainHeadless<TEvent>(stream: AsyncGenerator<TEvent>): Promise<void> {
  let next = await stream.next()
  while (!next.done) next = await stream.next()
}

/**
 * Build the `SessionSupervisorDO` class for a product. Export the result from
 * the Worker entrypoint and bind it in `wrangler.toml`:
 *
 *   export const SessionSupervisor = createSessionSupervisorDO(config)
 *
 *   # wrangler.toml
 *   [[durable_objects.bindings]]
 *   name = "SESSION_SUPERVISOR"
 *   class_name = "SessionSupervisor"
 *   [[migrations]]
 *   tag = "v1"
 *   new_classes = ["SessionSupervisor"]
 */
export function createSessionSupervisorDO<TEvent, TEnv>(
  config: SupervisorHostConfig<TEvent, TEnv>,
): new (
  state: DurableObjectStateLike,
  env: TEnv,
) => SessionSupervisorDO {
  const orphanCheckMs = config.orphanCheckMs ?? 60_000
  const now = config.now ?? (() => Date.now())

  return class implements SessionSupervisorDO {
    constructor(
      private readonly state: DurableObjectStateLike,
      private readonly env: TEnv,
    ) {}

    async fetch(request: Request): Promise<Response> {
      const opts = await config.resolveRun(request, this.env, this.state)
      if (!opts) return new Response('no run for this request', { status: 404 })

      // Record the run + arm the orphan check before streaming, so a crash
      // mid-stream still leaves a recovery trail.
      await this.state.storage.put(ACTIVE_RUN_KEY, opts.runId)
      await this.state.storage.setAlarm(now() + orphanCheckMs)

      const supervised = runSupervisedTurn(opts)
      const storage = this.state.storage
      const encoder = new TextEncoder()
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await supervised.stream.next()
            if (next.done) {
              await storage.delete(ACTIVE_RUN_KEY)
              controller.close()
              return
            }
            controller.enqueue(encoder.encode(config.encodeEvent(next.value)))
          } catch (err) {
            controller.error(err instanceof Error ? err : new Error(String(err)))
          }
        },
      })
      return new Response(body, {
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
      })
    }

    async alarm(): Promise<void> {
      const runId = await this.state.storage.get<string>(ACTIVE_RUN_KEY)
      if (!runId) return

      const opts = await config.resolveOrphan(runId, this.env, this.state)
      if (!opts) {
        await this.state.storage.delete(ACTIVE_RUN_KEY)
        return
      }

      try {
        // Re-drive the run headlessly. startOrResume inside resolves the
        // path: replay (already done), resume (orphaned + in-flight), or a
        // fresh run. Events land in the durable log regardless.
        await drainHeadless(runSupervisedTurn(opts).stream)
        await this.state.storage.delete(ACTIVE_RUN_KEY)
      } catch (err) {
        if (err instanceof DurableRunLeaseHeldError) {
          // A live fetch still owns the run — not orphaned. Re-check later.
          await this.state.storage.setAlarm(now() + orphanCheckMs)
          return
        }
        // The run failed for real — stop tracking it.
        await this.state.storage.delete(ACTIVE_RUN_KEY)
      }
    }
  }
}
