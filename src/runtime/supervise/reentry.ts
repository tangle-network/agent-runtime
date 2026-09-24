/**
 * The task a re-entered external driver receives, composed from Runtime's own records.
 *
 * A re-prompt used to send the unmet items alone, on the claim that it re-entered the SAME live
 * session. That holds on a backend that reattaches the harness session. It does not hold when the
 * previous environment is gone: the driver then starts in a new sandbox, with a new harness
 * session, and the unmet-items text is all it knows. Measured in Autopsy A (2026-09-16): three
 * root attempts, each in a new sandbox; the third reported an empty workspace, spent 20 minutes
 * and about 2.0M input tokens investigating infrastructure, and never consumed the child result
 * that had settled while it was gone.
 *
 * So the composer takes the drive harness's statement of what the next drive continues, and
 * writes the whole run state whenever the harness session is not proven continuous: the original
 * objective and completion contract, where the journal was read to, the events waiting and the
 * events delivered to a turn that died, every live and settled worker, the last refusal, and what
 * became of the workspace. A proven-continuous session gets the unmet items plus what changed.
 */

import type { ManagerReentryState } from '../../mcp/tools/coordination'
import type { DriverReentry } from './driver-retry'

/** What the next drive continues, as the drive harness can prove it before the turn starts. */
export interface ReentryContinuity {
  /** `continued`: the next turn is sent into the harness session that received the last one.
   *  `new`: a new harness session, which knows only what its task says. */
  readonly session: 'continued' | 'new'
  /** Whether the next drive runs in the environment the previous drive used. `replaced` names a
   *  previous environment the provider no longer holds. */
  readonly environment: 'same' | 'replaced' | 'unknown'
  readonly environmentId?: string
  readonly previousEnvironmentId?: string
  /** What the next environment holds of the previous one's files. `restored`: the files as of
   *  the checkpoint taken at `checkpointAt`; anything written after it is gone. */
  readonly workspace: 'kept' | 'restored' | 'lost' | 'unknown'
  readonly checkpointAt?: string
}

/** Continuity when nothing is proven: compose the full state. */
export const UNPROVEN_CONTINUITY: ReentryContinuity = Object.freeze({
  session: 'new',
  environment: 'unknown',
  workspace: 'unknown',
})

export interface ReentryTaskInput {
  /** The run's original task, exactly as the first drive received it. */
  readonly originalTask: unknown
  /** What the completion check requires, when the caller described it. */
  readonly contract?: string
  readonly reentry: DriverReentry
  readonly continuity: ReentryContinuity
  readonly state: ManagerReentryState
  /** 1-based driver attempt this task starts. */
  readonly attempt: number
}

/** Compose the task for one re-entered drive. */
export function composeReentryTask(input: ReentryTaskInput): string {
  const { reentry, continuity, state } = input
  if (reentry.reason === 'unmet-contract' && continuity.session === 'continued') {
    const changes = stateLines(state, false)
    return [reentry.steer, ...(changes.length > 0 ? ['', ...changes] : [])].join('\n')
  }
  const lines: string[] = [
    `You are re-entering a run that is already in progress (driver attempt ${input.attempt}). ` +
      'This is the same run and the same objective, not a new one.',
    whyLine(reentry),
    environmentLine(continuity),
    '',
    '## Objective',
    '',
    'This is the original task of the run, unchanged:',
    '',
    taskText(input.originalTask),
    '',
    '## Completion check',
    '',
    input.contract === undefined || input.contract.trim().length === 0
      ? 'The run ends when submit_result passes the independent check.'
      : `The run ends when submit_result passes the independent check. It expects: ${input.contract.trim()}`,
    ...(reentry.reason === 'unmet-contract' ? ['', 'What is still unmet:', '', reentry.steer] : []),
    '',
    '## Run state, from the coordinator',
    '',
    ...stateLines(state, true),
    '',
    '## What to do now',
    '',
    'Continue the run from this state.',
    'Receive the waiting events with await_event, and read the output of every settled worker before you spawn anything new.',
    'Do not spawn a replacement for a worker that is running or has settled.',
    'Your coordination tools are served by the same coordinator as before, and the state above comes from it.',
  ]
  return lines.join('\n')
}

/**
 * Why the driver is back, in one clause. The failure's own text stays in the attempt records and
 * never reaches the driver: measured 2026-09-11, a continuation told the details of a provider
 * failure spent two of its first four children probing the infrastructure, while its peer, told
 * only what to continue, spent all forty-five on the research.
 */
function whyLine(reentry: DriverReentry): string {
  if (reentry.reason === 'unmet-contract') {
    return `Your previous turn ended with the completion check unmet (re-prompt ${reentry.reprompt}).`
  }
  // A pause names no provider and no code: the operator owns the upstream, and the driver's
  // budget belongs to the objective.
  return reentry.reason === 'upstream-unavailable'
    ? 'Your previous turn was interrupted before it finished; the run itself is intact.'
    : `Your previous turn ended before it finished (retry ${reentry.retry}); the run itself is intact.`
}

function environmentLine(continuity: ReentryContinuity): string {
  if (continuity.environment === 'same') {
    return `You run in the same environment as before${continuity.environmentId === undefined ? '' : ` (${continuity.environmentId})`}, and your files are where you left them.`
  }
  if (continuity.environment === 'replaced') {
    return (
      `Your previous environment${continuity.previousEnvironmentId === undefined ? '' : ` (${continuity.previousEnvironmentId})`} is gone, and you run in a new one. ` +
      (continuity.workspace === 'kept'
        ? 'Its files were carried over.'
        : continuity.workspace === 'restored'
          ? `Its files were restored from a checkpoint taken at ${continuity.checkpointAt ?? 'your last coordination call'}; anything you wrote after that is not here. The coordinator and the knowledge store kept everything below.`
          : 'Files you wrote there are not here. The coordinator and the knowledge store kept everything below.')
    )
  }
  return 'You may be in a new environment. Check for files before you rely on them; the coordinator kept everything below.'
}

function stateLines(state: ManagerReentryState, full: boolean): string[] {
  const lines: string[] = []
  if (full || state.journalRows > state.journalReadTo) {
    lines.push(
      `Journal: ${state.journalRows} rows. You last read up to row ${state.journalReadTo}; call read_journal with sinceRow ${state.journalReadTo} to read what happened since, or sinceRow 0 to read the whole run.`,
    )
  }
  if (state.live.length > 0) {
    lines.push(
      `Workers running: ${state.live.map((worker) => `${worker.id} (${worker.label}, ${worker.status})`).join('; ')}.`,
    )
  } else if (full) {
    lines.push('Workers running: none.')
  }
  const settled = full ? state.settled : state.settled.filter((worker) => !worker.delivered)
  if (settled.length > 0) {
    lines.push(
      `Workers settled${full ? '' : ' that you have not received'}: ${settled
        .map(
          (worker) =>
            `${worker.id} (${worker.status}${worker.valid === undefined ? '' : worker.valid ? ', passed its check' : ', did not pass its check'}${worker.delivered ? '' : ', not yet received'})`,
        )
        .join('; ')}. Read an output with observe_agent and the worker id.`,
    )
  } else if (full) {
    lines.push('Workers settled: none.')
  }
  if (state.waiting.length > 0) {
    lines.push(
      `Events waiting for you in await_event: ${state.waiting.length} (${state.waiting
        .map((event) =>
          event.worker === undefined ? event.type : `${event.type} from ${event.worker}`,
        )
        .join('; ')}).`,
    )
  } else if (full) {
    lines.push('Events waiting for you in await_event: none.')
  }
  if (state.unacknowledged.length > 0) {
    lines.push(
      `Events delivered to a turn that did not finish, so treat them as unread: ${state.unacknowledged
        .map(
          (event) =>
            `#${event.seq} ${event.type}${event.worker === undefined ? '' : ` from ${event.worker}`}`,
        )
        .join(
          '; ',
        )}. Pass their numbers in await_event's acknowledge once you have processed them.`,
    )
  }
  if (state.lastRejection !== undefined) {
    lines.push(`Your last submit_result was refused: ${state.lastRejection.reason}`)
  }
  return lines
}

function taskText(task: unknown): string {
  if (typeof task === 'string') return task
  try {
    return JSON.stringify(task, null, 2) ?? String(task)
  } catch {
    return String(task)
  }
}
