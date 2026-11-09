import { sleep } from '../util'
import { causeChain } from './error-message'
import { cappedDoublingMs } from './upstream-unavailable'

/** A release roll restarts a host agent for about 18 s; past this window the failure stands. */
export const HOST_RESTART_WINDOW_MS = 3 * 60_000

/**
 * Sandbox answers a request that outlived a planned host-agent restart's hold with 503
 * `HOST_AGENT_RESTARTING`, `retryUntil` and `Retry-After` (agent-container
 * apps/orchestrator/src/routes/sidecars/proxy/request.ts); the sidecar runs a run/stream POST
 * resent under one execution id once and replays its events
 * (apps/sidecar/tests/integration/run-stream-resend.test.ts). `retry` waits, Retry-After at least, then doubling to `retryUntil`,
 * 30 s per wait, and answers true; any other error, an abort or a spent window answers false.
 * `settled` opens a new window after progress.
 */
export function hostRestartReconnect(signal: AbortSignal, now: () => number = Date.now) {
  let since: number | undefined
  let waits = 0
  const ms = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  return {
    async retry(error: unknown): Promise<boolean> {
      const code = (cause: object) => Reflect.get(cause, 'code') === 'HOST_AGENT_RESTARTING'
      const refusal = causeChain(error).find(code)
      if (refusal === undefined || signal.aborted) return false
      since ??= now()
      const left = since + HOST_RESTART_WINDOW_MS - now()
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
