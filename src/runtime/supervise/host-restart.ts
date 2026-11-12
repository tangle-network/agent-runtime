import { sleep } from '../util'
import { causeChain, errorHttpStatus } from './error-message'
import { cappedDoublingMs } from './upstream-unavailable'

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
 * An explicit 503 capacity refusal asking to retry later uses the capacity window, giving
 * autoscaling room to arrive before the same retained invocation counts as a failed attempt.
 * `settled` opens a new window after progress; the caller's signal still bounds every wait.
 */
export function hostRestartReconnect(signal: AbortSignal, now: () => number = Date.now) {
  let since: number | undefined
  let waits = 0
  const ms = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  return {
    async retry(error: unknown): Promise<boolean> {
      const capacity = causeChain(error).find(
        (cause) =>
          cause instanceof Error &&
          errorHttpStatus(cause) === 503 &&
          /\bcapacity\b.*\bretry later\b/iu.test(cause.message),
      )
      const code = (cause: object) => Reflect.get(cause, 'code') === 'HOST_AGENT_RESTARTING'
      const refusal = capacity ?? causeChain(error).find(code)
      if (refusal === undefined || signal.aborted) return false
      since ??= now()
      const left = since + (capacity ? CAPACITY_RETRY_WINDOW_MS : HOST_RESTART_WINDOW_MS) - now()
      if (left <= 0) return false
      const wanted = Math.max(
        ms(Reflect.get(refusal, 'retryAfterMs')),
        ms(Reflect.get(refusal, 'retryUntil')) - now(),
        cappedDoublingMs(++waits, 1_000, 30_000),
      )
      await sleep(Math.min(left, 30_000, wanted), signal)
      return !signal.aborted
    },
    settled(): void {
      since = undefined
      waits = 0
    },
  }
}
