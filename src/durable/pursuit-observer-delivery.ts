import type { PursuitProjection } from './observer-projection'

/**
 * Where a pursuit's observer projection is delivered while it runs, so a run started anywhere is
 * findable in one place by its pursuit id.
 *
 * Intelligence persists the projection on its run spine (`runtime-observer:pursuit:<pursuitId>`)
 * and records the id of the API key that delivered it, which joins the run to that key's spend.
 * Delivery is an observation, never a dependency: a refused, slow or unreachable endpoint is
 * reported once and the run continues exactly as it would without it.
 */
export interface PursuitObserverDelivery {
  /** Intelligence base URL, e.g. `https://intelligence.tangle.tools`. */
  readonly baseUrl: string
  /** Platform API key presented as the Bearer; Intelligence resolves the tenant from it. */
  readonly apiKey: string
  /** The Intelligence subject (project) the pursuit belongs to. */
  readonly subjectKey: string
  readonly subjectName?: string
  /**
   * Flat facts the caller owns about the run, recorded on the pursuit row unchanged, such as the
   * program and idea a registration names. Runtime neither reads nor validates their meaning.
   */
  readonly attributes?: Readonly<Record<string, string>>
  /** How often a live run re-delivers its projection. Default 60 s; the last delivery is liveness. */
  readonly intervalMs?: number
  /** Per-request bound. Default 10 s. */
  readonly timeoutMs?: number
  readonly fetch?: typeof fetch
}

/** The execution state Runtime reports. It never claims the pursuit's semantic success. */
export type PursuitObserverState = 'running' | 'done' | 'failed'

export type PursuitObserverDeliveryOutcome =
  | { readonly succeeded: true; readonly status: number }
  | { readonly succeeded: false; readonly reason: string }

/** The Intelligence route that persists a delivered projection on its run spine. */
export const PURSUIT_OBSERVER_DELIVERY_PATH = '/v1/ingest/pursuit-observer'

const DEFAULT_INTERVAL_MS = 60_000
const DEFAULT_TIMEOUT_MS = 10_000

/** POST one projection. Never throws; the outcome says whether Intelligence accepted it. */
export async function deliverPursuitObserver(
  delivery: PursuitObserverDelivery,
  state: PursuitObserverState,
  projection: PursuitProjection,
): Promise<PursuitObserverDeliveryOutcome> {
  const send = delivery.fetch ?? globalThis.fetch
  const url = `${delivery.baseUrl.replace(/\/+$/u, '')}${PURSUIT_OBSERVER_DELIVERY_PATH}`
  try {
    const response = await send(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${delivery.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        subjectKey: delivery.subjectKey,
        ...(delivery.subjectName === undefined ? {} : { subjectName: delivery.subjectName }),
        state,
        ...(delivery.attributes === undefined ? {} : { attributes: delivery.attributes }),
        projection,
      }),
      signal: AbortSignal.timeout(delivery.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
    if (response.ok) return { succeeded: true, status: response.status }
    const detail = (await response.text().catch(() => '')).slice(0, 300)
    return { succeeded: false, reason: `HTTP ${response.status}${detail ? `: ${detail}` : ''}` }
  } catch (error) {
    return { succeeded: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

export interface PursuitObserverDeliverer {
  /** Queue a delivery of the current projection. Deliveries never overlap; a burst collapses to one. */
  push(state: PursuitObserverState): void
  /** Stop the liveness timer, deliver the terminal state, and wait for it within the timeout. */
  close(state: Exclude<PursuitObserverState, 'running'>): Promise<PursuitObserverDeliveryOutcome>
}

/**
 * Deliver a live run's projection at start, on an interval, and at settlement. `read` projects
 * the run's own journal at the moment of each delivery, so every delivery is the whole record.
 */
export function startPursuitObserverDelivery(
  delivery: PursuitObserverDelivery,
  read: () => Promise<PursuitProjection>,
  warn: (message: string) => void = (message) => console.warn(message),
): PursuitObserverDeliverer {
  let chain: Promise<PursuitObserverDeliveryOutcome | undefined> = Promise.resolve(undefined)
  let pending: PursuitObserverState | undefined
  let warned = false
  let closed = false

  const deliver = async (state: PursuitObserverState) => {
    let projection: PursuitProjection
    try {
      projection = await read()
    } catch (error) {
      return report({
        succeeded: false,
        reason: `observer projection unreadable: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
    return report(await deliverPursuitObserver(delivery, state, projection))
  }
  const report = (outcome: PursuitObserverDeliveryOutcome) => {
    if (!outcome.succeeded && !warned) {
      warned = true
      warn(
        `supervisePursuit: pursuit observer delivery to ${delivery.baseUrl} failed (${outcome.reason}); the run continues and later deliveries retry`,
      )
    }
    return outcome
  }
  const push = (state: PursuitObserverState) => {
    if (closed) return
    if (pending !== undefined) return
    pending = state
    chain = chain.then(() => {
      const next = pending as PursuitObserverState
      pending = undefined
      return deliver(next)
    })
  }

  const timer = setInterval(() => push('running'), delivery.intervalMs ?? DEFAULT_INTERVAL_MS)
  timer.unref?.()
  push('running')

  return {
    push,
    async close(state) {
      closed = true
      clearInterval(timer)
      const terminal = chain.then(() => deliver(state))
      chain = terminal
      const bound = delivery.timeoutMs ?? DEFAULT_TIMEOUT_MS
      let timeout: ReturnType<typeof setTimeout> | undefined
      const expired = new Promise<PursuitObserverDeliveryOutcome>((resolve) => {
        timeout = setTimeout(
          () => resolve({ succeeded: false, reason: `terminal delivery exceeded ${bound} ms` }),
          bound * 2,
        )
        timeout.unref?.()
      })
      try {
        return await Promise.race([terminal, expired])
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}
