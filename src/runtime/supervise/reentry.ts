import type { ManagerReentryState } from '../../mcp/tools/coordination-events'
import type { DriverReentry } from './driver-retry'

export interface ReentryContinuity {
  /** `continued` reuses the harness session. `new` knows only this task. */
  readonly session: 'continued' | 'new'
  /** `replaced` names an environment the provider no longer holds. */
  readonly environment: 'same' | 'replaced' | 'unknown'
  readonly environmentId?: string
  readonly previousEnvironmentId?: string
  /** `restored` is the checkpoint at `checkpointAt`. Later writes are gone. */
  readonly workspace: 'kept' | 'restored' | 'lost' | 'unknown'
  readonly checkpointAt?: string
}

/** What a re-entry may assume when nothing proved its session, environment or workspace. */
export const UNPROVEN_CONTINUITY: ReentryContinuity = Object.freeze({
  session: 'new',
  environment: 'unknown',
  workspace: 'unknown',
})

export interface ReentryTaskInput {
  readonly originalTask: unknown
  readonly contract?: string
  readonly tools?: ReadonlyArray<string>
  readonly reentry: DriverReentry
  readonly continuity: ReentryContinuity
  readonly state: ManagerReentryState
  readonly attempt: number
}

/** The task a re-entered driver receives: what changed, why it re-entered, and its objective. */
export function composeReentryTask(input: ReentryTaskInput): string {
  const { reentry, continuity, state } = input
  if (reentry.reason === 'unmet-contract' && continuity.session === 'continued') {
    const changes = stateLines(state, false, input.tools)
    return [
      ...barrenLines(reentry).flatMap((line) => [line, '']),
      reentry.steer,
      ...(changes.length > 0 ? ['', ...changes] : []),
    ].join('\n')
  }
  if (reentry.reason === 'wake' && continuity.session === 'continued') return reentry.input
  const lines: string[] = [
    `You are re-entering a run that is already in progress (driver attempt ${input.attempt}). ` +
      'This is the same run and the same objective, not a new one.',
    whyLine(reentry),
    environmentLine(continuity),
    ...(reentry.reason === 'unmet-contract' ? barrenLines(reentry) : []),
    '',
    '## Objective',
    '',
    'This is the original task of the run, unchanged:',
    '',
    taskText(input.originalTask),
    '',
    '## Completion check',
    '',
    ...(input.tools?.includes('submit_result') === true
      ? ['Call submit_result to request acceptance through the independent check.']
      : []),
    input.contract === undefined || input.contract.trim().length === 0
      ? 'No completion requirement was described.'
      : `The declared completion requirement is: ${input.contract.trim()}`,
    ...(reentry.reason === 'unmet-contract' ? ['', 'What is still unmet:', '', reentry.steer] : []),
    ...(reentry.reason === 'wake' ? ['', '## What woke you', '', reentry.input] : []),
    '',
    '## Run state, from the coordinator',
    '',
    ...stateLines(state, true, input.tools),
    '',
    '## What to do now',
    '',
    'Continue the run from this state.',
    ...(continuity.workspace === 'kept' || continuity.workspace === 'restored'
      ? [
          'Read the files you already wrote before you repeat any step of the task. A step whose file is there is done, and its content stands.',
        ]
      : []),
    ...(input.tools?.includes('observe_agent') === true
      ? [
          'Read the output of every settled worker with observe_agent before you spawn anything new.',
        ]
      : []),
    'Do not spawn a replacement for a worker that is running or has settled.',
    'Your coordination tools are served by the same coordinator as before, and the state above comes from it.',
  ]
  return lines.join('\n')
}

function whyLine(reentry: DriverReentry): string {
  if (reentry.reason === 'unmet-contract') {
    return `Your previous turn ended with the completion check unmet (continuation ${reentry.continuation}).`
  }
  if (reentry.reason === 'wake') {
    return 'Your previous turn ended while your workers ran, and Runtime woke you with what happened.'
  }
  if (reentry.reason === 'run-reentered') return restartLine(reentry)
  return reentry.reason === 'upstream-unavailable'
    ? 'Your previous turn was interrupted before it finished; the run itself is intact.'
    : `Your previous turn ended before it finished (retry ${reentry.retry}); the run itself is intact.`
}

function barrenLines(reentry: Extract<DriverReentry, { reason: 'unmet-contract' }>): string[] {
  if (reentry.barren === undefined) return []
  const minutes = Math.round(reentry.barren.pausedMs / 60_000)
  const unjudged =
    reentry.steer.includes('has not judged') && reentry.steer.includes('verdict reaches you')
  return [
    `Your last ${reentry.barren.streak} turns ended with the check unmet and delivered nothing: no accepted result, no worker that passed its check, and no rise in the check's score. Runtime waited ${minutes} minutes before this turn.`,
    unjudged
      ? [
          'The check has not judged this run yet, and its verdict reaches you as feedback.',
          'End your turn and let that verdict wake you.',
          'Do not sleep, poll, or record another release to poke the check.',
        ].join(' ')
      : 'If you are waiting on long work of your own, such as a build, a proof or a job you started, do not end your turn to wait for it. Wait inside the turn with your wake or wait tool, or a command that blocks until the work finishes, then act on its result. Each turn in a row that ends with nothing delivered doubles the wait before the next, up to an hour.',
  ]
}

function restartLine(reentry: Extract<DriverReentry, { reason: 'run-reentered' }>): string {
  const replaced = new Set(reentry.replaced)
  const gone = reentry.live.filter((id) => !replaced.has(id))
  return [
    'The process supervising this run stopped before the run ended, and a new process took it over; the run itself is intact.',
    reentry.live.length === 0
      ? 'None of your workers was running when it stopped.'
      : `Workers that were running when it stopped: ${reentry.live.join(', ')}.`,
    ...(reentry.replaced.length === 0 ? [] : [`Running again: ${reentry.replaced.join(', ')}.`]),
    ...(gone.length === 0
      ? []
      : [
          `Gone, and they will not report: ${gone.join(', ')}. Their unfinished work is lost; spawn a replacement for any you still need.`,
        ]),
  ].join(' ')
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

function stateLines(
  state: ManagerReentryState,
  full: boolean,
  tools: ReadonlyArray<string> | undefined,
): string[] {
  const lines: string[] = []
  if (full || state.journalRows > state.journalReadTo) {
    lines.push(
      `Journal: ${state.journalRows} rows. You last read up to row ${state.journalReadTo}.` +
        (tools?.includes('read_journal') === true
          ? ` Call read_journal with sinceRow ${state.journalReadTo} to read what happened since, or sinceRow 0 to read the whole run.`
          : ''),
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
        .join('; ')}.` +
        (tools?.includes('observe_agent') === true
          ? ' Read an output with observe_agent and the worker id.'
          : ''),
    )
  } else if (full) {
    lines.push('Workers settled: none.')
  }
  if (state.waiting.length > 0) {
    lines.push(
      `Events waiting for you: ${state.waiting.length} (${state.waiting
        .map((event) =>
          event.worker === undefined ? event.type : `${event.type} from ${event.worker}`,
        )
        .join('; ')}).`,
    )
  } else if (full) {
    lines.push('Events waiting for you: none.')
  }
  if (state.unacknowledged.length > 0) {
    lines.push(
      `Events delivered to a turn that has not finished, so treat them as unread (${state.unacknowledged.length}):`,
      ...state.unacknowledged.map((event) => `- ${JSON.stringify(event.event)}`),
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
