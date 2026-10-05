/**
 * How a manager waits: it ends its turn, and Runtime wakes it.
 *
 * A manager with nothing to do until its workers report back used to stay in its turn and call a
 * bounded wait tool again and again. Every call that came back empty was a full model turn that
 * re-read the whole cached context. Measured 2026-10-05 on two Discovery roots: 18 of 88 model
 * turns did nothing but wait.
 *
 * Now ending a turn is waiting, not completion. Only an accepted `submit_result`, `report_blocked`,
 * or a turn that ends with no open work ends a manager. When a turn ends with open work, Runtime
 * blocks on the coordination bus with no model turn, and starts the next turn when something
 * happens: a worker settled, a question or finding arrived, the lead sent a message, a tool call
 * that outlived its response fence finished, or the deadline warning came due. Everything that
 * arrived within the debounce rides one input. A heartbeat wakes a manager that heard nothing, so
 * it can reconsider.
 */

import type { ManagerWake } from '../../mcp/tools/coordination'

/** How Runtime wakes a manager that ended its turn with work open. */
export interface ManagerWakePolicy {
  /** Wake with no event after this long, so a waiting manager can reconsider. Default 15 min. */
  readonly heartbeatMs?: number
  /** After the first event, wait this long for more and deliver them together. Default 2 s. */
  readonly debounceMs?: number
  /** Wake once this long before the deadline and ask for the best result now. Default 15 min. */
  readonly deadlineWarningMs?: number
}

export const DEFAULT_WAKE_HEARTBEAT_MS = 15 * 60_000
export const DEFAULT_WAKE_DEBOUNCE_MS = 2_000
export const DEFAULT_DEADLINE_WARNING_MS = 15 * 60_000

/** The instruction every manager receives about waiting. */
export const WAIT_BY_ENDING_TURN =
  'When you are waiting for workers, end your turn. You will be woken with what happened: a ' +
  'worker settled, a question, a message from your lead, or the deadline approaching.'

export interface ResolvedWakePolicy {
  readonly heartbeatMs: number
  readonly debounceMs: number
  readonly deadlineWarningMs: number
}

export function resolveWakePolicy(policy: ManagerWakePolicy | undefined): ResolvedWakePolicy {
  const pick = (value: number | undefined, fallback: number, name: string): number => {
    const resolved = value ?? fallback
    if (!Number.isSafeInteger(resolved) || resolved < 0) {
      throw new TypeError(`wake.${name} must be a nonnegative safe integer of milliseconds`)
    }
    return resolved
  }
  return {
    heartbeatMs: pick(policy?.heartbeatMs, DEFAULT_WAKE_HEARTBEAT_MS, 'heartbeatMs'),
    debounceMs: pick(policy?.debounceMs, DEFAULT_WAKE_DEBOUNCE_MS, 'debounceMs'),
    deadlineWarningMs: pick(
      policy?.deadlineWarningMs,
      DEFAULT_DEADLINE_WARNING_MS,
      'deadlineWarningMs',
    ),
  }
}

/** The deadline warning, at most once per manager: the epoch ms to wake at, or undefined. */
export function deadlineWarningAt(
  deadlineMs: number,
  policy: ResolvedWakePolicy,
  warned: boolean,
): number | undefined {
  if (warned || deadlineMs <= 0 || policy.deadlineWarningMs <= 0) return undefined
  return deadlineMs - policy.deadlineWarningMs
}

/** The input a woken manager's next turn receives. */
export function composeWakeInput(
  wake: ManagerWake,
  context: {
    readonly tools?: ReadonlyArray<string>
    readonly deadlineMs?: number
    readonly now: number
  },
): string {
  const minutes = (ms: number) => Math.max(0, Math.round(ms / 60_000))
  const lines: string[] = []
  const waited = `You waited ${minutes(wake.idleMs)} min without spending a turn.`
  if (wake.reason === 'deadline') {
    const left = context.deadlineMs === undefined ? undefined : context.deadlineMs - context.now
    lines.push(
      `The run's deadline is ${left === undefined ? 'near' : `in ${minutes(left)} min`}. ${waited}`,
      context.tools?.includes('submit_result') === true
        ? 'Submit your best result now with submit_result. A run that reaches its deadline without an accepted result delivers nothing.'
        : 'Finish now with your best result.',
    )
  } else if (wake.reason === 'heartbeat') {
    lines.push(
      `Nothing reached your inbox. ${waited} Reconsider whether the running workers still serve the objective.`,
    )
  } else {
    lines.push(
      `${wake.events.length} event${wake.events.length === 1 ? '' : 's'} arrived. ${waited}`,
    )
  }
  if (wake.events.length > 0) {
    lines.push('', '## Events', '')
    for (const event of wake.events) lines.push(`- ${JSON.stringify(event)}`)
  }
  lines.push(
    '',
    wake.live.length === 0
      ? 'Workers running: none.'
      : `Workers running: ${wake.live.map((worker) => String(worker.id)).join(', ')}.`,
  )
  if (wake.freeSlots !== null) lines.push(`Free worker slots: ${wake.freeSlots}.`)
  lines.push('', WAIT_BY_ENDING_TURN)
  return lines.join('\n')
}
