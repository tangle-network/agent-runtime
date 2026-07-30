/**
 *
 * WAIT-STATES — a supervision-tree node that waits on wall-clock time or an external condition
 * without holding a worker, an executor, a sandbox, or a single LLM turn.
 *
 * A long-horizon run spends most of its wall-clock NOT computing: waiting for CI to finish,
 * for a nightly job to land, for a human to reply, for a rate-limit window to reopen. Before
 * this, the only way to express that was to keep something alive and re-ask — which spends
 * driver tokens per re-ask and pins a process to the wait.
 *
 * Two node kinds, both first-class:
 *   - `timer` — wake at an ABSOLUTE wall-clock instant (`untilMs`).
 *   - `poll`  — re-run a named predicate every `intervalMs` until it returns true, or until an
 *               absolute `timeoutAtMs` passes (CI status, file existence, an HTTP probe, an
 *               inbox message).
 *
 * ── How this differs from `await_event`'s caller-supplied poll fence ──
 *
 * They look similar and are not the same mechanism. `await_event` is an IN-RUN RENDEZVOUS: the
 * driver blocks on the coordination bus for the next event from a live worker, and the 15s fence
 * exists only so a remote MCP request does not exceed the client's timeout — the caller re-polls.
 * Every re-poll is another driver inference turn (real tokens) against a process that must stay
 * up, and nothing about that wait is recorded: kill the process and the wait is simply gone.
 *
 * A wait-state is a NODE, not a call. It has a node id in the tree, a journal record carrying its
 * ABSOLUTE deadline, and it settles through the same `Scope.next()` cursor as any worker. Nobody
 * is blocked on it — the driver can stop reasoning entirely, and the process can die. Cost while
 * waiting: zero LLM calls, zero executor, zero sandbox, zero conserved budget (a wait reserves
 * nothing from the pool). The only in-process residue is one timer entry.
 *
 * ── Why probes are NAMED, not passed as closures ────────────────────────────────────────────
 *
 * A wait must survive a process restart with its original deadline intact, and a closure cannot
 * be journaled. So a `poll` names its predicate (`probe: 'ci-green'`) and the run resolves it
 * through a `WaitProbeRegistry`. A brand-new process re-resolves the SAME name against its own
 * registry and re-arms the wait — which is what makes "kill the box, the wait keeps waiting"
 * true rather than aspirational.
 *
 * Absolute instants for the same reason: `untilMs` / `timeoutAtMs` are epoch ms, not durations,
 * so a resumed wait counts down from the original arm, not from the restart. `timerAt`/`pollFor`
 * build them from a duration when that is what the caller has.
 *
 * @experimental
 */

import { ValidationError } from '../../errors'

/** What a wait node is waiting for. Both variants carry ABSOLUTE epoch-ms instants so a wait
 *  re-armed by a later process keeps the deadline the first process set. */
export type WaitSpec =
  | {
      readonly kind: 'timer'
      /** Absolute epoch ms to wake at. A past instant fires immediately. */
      readonly untilMs: number
    }
  | {
      readonly kind: 'poll'
      /** Name of the predicate in the run's `WaitProbeRegistry`. Named (not a closure) so a
       *  resumed process can re-resolve it — see the module header. */
      readonly probe: string
      /** How often to re-run the predicate, in ms. Must be > 0. */
      readonly intervalMs: number
      /** Absolute epoch ms after which an unfired poll settles `timeout`. Omit = no timeout
       *  (then the run's own deadline is the only bound, and a run WITH a deadline refuses an
       *  unbounded poll — see `assertWaitWithinDeadline`). */
      readonly timeoutAtMs?: number
      /** Opaque JSON handed to the probe on every check. Journaled with the spec, so a resumed
       *  probe gets the same arguments. */
      readonly args?: Record<string, unknown>
    }

/** Build a `timer` spec from a DURATION. The instant is resolved once, at arm time — a resumed
 *  wait re-uses the journaled instant, never a fresh `now + ms`. */
export function timerAt(ms: number, now: number): WaitSpec {
  return { kind: 'timer', untilMs: now + ms }
}

/** Build a bounded `poll` spec from a duration. */
export function pollFor(
  probe: string,
  opts: {
    readonly intervalMs: number
    readonly timeoutMs?: number
    readonly args?: Record<string, unknown>
  },
  now: number,
): WaitSpec {
  return {
    kind: 'poll',
    probe,
    intervalMs: opts.intervalMs,
    ...(opts.timeoutMs !== undefined ? { timeoutAtMs: now + opts.timeoutMs } : {}),
    ...(opts.args ? { args: opts.args } : {}),
  }
}

/**
 * A named predicate a `poll` node re-checks. Returns true when the condition it watches has
 * flipped. A throw is treated as "not yet" (an unreachable CI endpoint is not a settled answer),
 * and is counted in the outcome's `probeErrors` so a probe that never works is visible rather
 * than silently polling forever.
 */
export type WaitProbe = (
  args: Record<string, unknown> | undefined,
  signal: AbortSignal,
) => boolean | Promise<boolean>

/** Resolves a `poll` spec's `probe` name to its predicate. Threaded through `SupervisorOpts` so
 *  the SAME registry a fresh run used is what a resumed run re-resolves against. */
export interface WaitProbeRegistry {
  resolve(name: string): WaitProbe | undefined
}

/** Registry over a plain name→predicate record. */
export function createWaitProbes(entries: Record<string, WaitProbe>): WaitProbeRegistry {
  const map = new Map(Object.entries(entries))
  return { resolve: (name) => map.get(name) }
}

/** The `out` a settled wait node delivers through `Scope.next()`. `settled` is the outcome the
 *  caller branches on: `'fired'` = the timer reached its instant or the predicate flipped;
 *  `'timeout'` = a bounded poll gave up. A timeout is a first-class ANSWER, not a failure — a
 *  wait only settles `down` when it is cancelled or aborted. */
export interface WaitOutcome {
  /** Tag for `isWaitOutcome` — a wait outcome arrives on the same cursor as worker outputs. */
  readonly waitOutcome: true
  readonly kind: WaitSpec['kind']
  readonly settled: 'fired' | 'timeout'
  readonly label: string
  /** The absolute instant this wait was armed for (timer `untilMs` / poll `timeoutAtMs`); absent
   *  for an unbounded poll. */
  readonly untilMs?: number
  /** Epoch ms the wait was FIRST armed — preserved across a resume, so `wokenAt - armedAt` is
   *  the true end-to-end wait even when it spanned several processes. */
  readonly armedAt: number
  readonly wokenAt: number
  /** Predicate checks performed in the process that settled it (a resume restarts this count). */
  readonly polls: number
  /** Probe checks that threw (counted, not fatal). */
  readonly probeErrors: number
  /** True when a later process re-armed this wait from the journal instead of creating it. */
  readonly resumed: boolean
}

/** Narrow a settlement's `out` to a wait outcome — a wait settles on the SAME cursor as workers,
 *  so a driver that mixes them tags them apart with this. */
export function isWaitOutcome(value: unknown): value is WaitOutcome {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { waitOutcome?: unknown }).waitOutcome === true
  )
}

/** A wait recorded in the journal that never woke — what a resumed run re-arms. */
export interface PendingWait {
  readonly id: string
  readonly label: string
  readonly spec: WaitSpec
  /** The ORIGINAL arm instant. A re-armed wait keeps it, so its deadline never slides. */
  readonly armedAt: number
  /** The wait ordinal in its parent scope, so a resumed scope continues past it. */
  readonly ordinal: number
}

/** Reject reasons for `Scope.wait`, mirroring `Scope.spawn`'s fail-closed admission shape. */
export type WaitRejection = 'invalid-spec' | 'unknown-probe' | 'deadline-exceeded'

/** The absolute instant a spec is bounded by, or `undefined` for an unbounded poll. */
export function waitUntil(spec: WaitSpec): number | undefined {
  return spec.kind === 'timer' ? spec.untilMs : spec.timeoutAtMs
}

/** Structural validation, independent of the run. Returns null when the spec is usable. */
export function validateWaitSpec(spec: WaitSpec): string | null {
  if (spec.kind === 'timer') {
    return Number.isFinite(spec.untilMs) ? null : 'timer.untilMs must be a finite epoch-ms instant'
  }
  if (typeof spec.probe !== 'string' || spec.probe.length === 0) {
    return 'poll.probe must be a non-empty probe name'
  }
  if (!Number.isFinite(spec.intervalMs) || spec.intervalMs <= 0) {
    return 'poll.intervalMs must be > 0'
  }
  if (spec.timeoutAtMs !== undefined && !Number.isFinite(spec.timeoutAtMs)) {
    return 'poll.timeoutAtMs must be a finite epoch-ms instant'
  }
  return null
}

/**
 * A wait must not silently outlive the run's HARD wall-clock ceiling. When the conserved pool
 * carries an absolute `deadlineMs`, a wait bounded past it — or an unbounded poll — is REFUSED at
 * arm time (`deadline-exceeded`) rather than sleeping through a ceiling the caller already set.
 * The alternative (extending the pool's deadline to cover the wait) would let a wait override a
 * hard budget guard, which is exactly what mechanic D forbids; a run that intends week-long waits
 * either sets a deadline that covers them or sets none.
 */
export function assertWaitWithinDeadline(spec: WaitSpec, deadlineMs: number): boolean {
  if (deadlineMs <= 0) return true
  const until = waitUntil(spec)
  if (until === undefined) return false
  return until <= deadlineMs
}

/** How a wait finished, as the scope's settle path sees it. */
export type WaitResolution =
  | { readonly kind: 'woke'; readonly outcome: WaitOutcome }
  | { readonly kind: 'cancelled'; readonly reason: string }

export interface RunWaitArgs {
  readonly spec: WaitSpec
  readonly label: string
  readonly armedAt: number
  readonly resumed: boolean
  readonly signal: AbortSignal
  readonly probes?: WaitProbeRegistry
  readonly now: () => number
  /** Injected sleeper so a test drives a week-long wait in microseconds. Defaults to
   *  `setTimeout`, cleared on abort so a cancelled wait never keeps the event loop alive. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

/**
 * Drive one wait to its resolution. Spends nothing: a `timer` is one sleep, a `poll` is a sleep
 * between predicate checks. No LLM call, no executor, no box, no budget reservation.
 */
export async function runWait(args: RunWaitArgs): Promise<WaitResolution> {
  const { spec, label, armedAt, resumed, signal, now } = args
  const sleep = args.sleep ?? defaultSleep
  if (signal.aborted) return { kind: 'cancelled', reason: 'aborted before arming' }

  if (spec.kind === 'timer') {
    const remaining = spec.untilMs - now()
    if (remaining > 0) await sleep(remaining, signal)
    if (signal.aborted) return { kind: 'cancelled', reason: 'wait aborted' }
    return {
      kind: 'woke',
      outcome: outcome('timer', 'fired', label, spec.untilMs, armedAt, now(), 0, 0, resumed),
    }
  }

  const probe = args.probes?.resolve(spec.probe)
  if (!probe) {
    // Unresolvable at RUN time (it passed admission, so this is a registry that changed under a
    // resumed run). Fail loud rather than polling a predicate that can never answer.
    throw new ValidationError(
      `wait '${label}': poll probe '${spec.probe}' is not registered in this run's WaitProbeRegistry`,
    )
  }
  let polls = 0
  let probeErrors = 0
  for (;;) {
    if (signal.aborted) return { kind: 'cancelled', reason: 'wait aborted' }
    polls += 1
    let fired = false
    try {
      fired = await probe(spec.args, signal)
    } catch {
      probeErrors += 1
    }
    if (fired) {
      return {
        kind: 'woke',
        outcome: outcome(
          'poll',
          'fired',
          label,
          spec.timeoutAtMs,
          armedAt,
          now(),
          polls,
          probeErrors,
          resumed,
        ),
      }
    }
    if (spec.timeoutAtMs !== undefined && now() >= spec.timeoutAtMs) {
      return {
        kind: 'woke',
        outcome: outcome(
          'poll',
          'timeout',
          label,
          spec.timeoutAtMs,
          armedAt,
          now(),
          polls,
          probeErrors,
          resumed,
        ),
      }
    }
    const nextCheck =
      spec.timeoutAtMs === undefined
        ? spec.intervalMs
        : Math.min(spec.intervalMs, Math.max(0, spec.timeoutAtMs - now()))
    await sleep(nextCheck, signal)
  }
}

function outcome(
  kind: WaitSpec['kind'],
  settled: 'fired' | 'timeout',
  label: string,
  untilMs: number | undefined,
  armedAt: number,
  wokenAt: number,
  polls: number,
  probeErrors: number,
  resumed: boolean,
): WaitOutcome {
  return {
    waitOutcome: true,
    kind,
    settled,
    label,
    ...(untilMs !== undefined ? { untilMs } : {}),
    armedAt,
    wokenAt,
    polls,
    probeErrors,
    resumed,
  }
}

/** `setTimeout` that resolves early (and clears) when the scope aborts, so a cancelled wait
 *  releases the event loop immediately instead of holding the process to its deadline. */
function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort(): void {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
