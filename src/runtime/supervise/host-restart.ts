import { sleep } from '../util'
import { causeChain } from './error-message'
import { cappedDoublingMs, placementRefusal } from './upstream-unavailable'

/** A release roll restarts a host agent for about 18 s; past this window the failure stands. */
export const HOST_RESTART_WINDOW_MS = 3 * 60_000
const CAPACITY_RETRY_WINDOW_MS = 10 * 60_000

/**
 * Sandbox answers a request that outlived a planned host-agent restart's hold with 503
 * `HOST_AGENT_RESTARTING`, `retryUntil` and `Retry-After` (agent-container
 * apps/orchestrator/src/routes/sidecars/proxy/request.ts); the sidecar runs a run/stream POST
 * resent under one execution id once and replays its events
 * (apps/sidecar/tests/integration/run-stream-resend.test.ts). `retry` waits, Retry-After at least, then doubling to `retryUntil`,
 * 30 s per wait, and answers true; any other error, an abort or a spent window answers false.
 * A placement refusal waits for room until `deadlineMs` when the run has one, else for the
 * capacity window, before the same retained invocation counts as a failed attempt; `refused` is
 * the refusal the last wait was for, which a wait the signal cut ends on instead of the abort.
 * `settled` opens a new window after progress; the caller's signal still bounds every wait.
 */
export function hostRestartReconnect(signal: AbortSignal, deadlineMs = 0) {
  let since: number | undefined
  let waits = 0
  let refused: object | undefined
  const ms = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  return {
    async retry(error: unknown): Promise<boolean> {
      const capacity = placementRefusal(error)
      const code = (cause: object) => Reflect.get(cause, 'code') === 'HOST_AGENT_RESTARTING'
      const refusal = capacity ?? causeChain(error).find(code)
      if (refusal === undefined || signal.aborted) return false
      since ??= Date.now()
      const end =
        capacity === undefined
          ? since + HOST_RESTART_WINDOW_MS
          : deadlineMs > 0
            ? deadlineMs
            : since + CAPACITY_RETRY_WINDOW_MS
      const left = end - Date.now()
      if (left <= 0) return false
      refused = capacity
      const wanted = Math.max(
        ms(Reflect.get(refusal, 'retryAfterMs')),
        ms(Reflect.get(refusal, 'retryUntil')) - Date.now(),
        cappedDoublingMs(++waits, 1_000, 30_000),
      )
      await sleep(Math.min(left, 30_000, wanted), signal)
      return !signal.aborted
    },
    get refused(): object | undefined {
      return refused
    },
    settled(): void {
      since = undefined
      waits = 0
      refused = undefined
    },
  }
}
