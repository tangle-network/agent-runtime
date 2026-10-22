import { CheckUnavailableError, type CheckVerdict } from '../../runtime/supervise/completion-gate'
import { checkVerdictOf } from '../../runtime/supervise/continuation'
import type { EventBus } from '../../runtime/supervise/event-bus'
import { detachedFrozen } from '../../runtime/supervise/snapshot'
import type { McpToolDescriptor } from '../server'
import { refusalText } from './coordination-completion-refusal'
import type { CoordinationToolsOptions } from './coordination-contracts'
import type { CoordinationEvent, Delivery, EventAcknowledgement } from './coordination-events'
import { obj } from './coordination-input'
import { appendCheckRead, type ManagerState, notifyManagerStop } from './coordination-manager-state'
import type { createQuestionLedger } from './coordination-question-ledger'
import type { createWorkerObservation } from './coordination-worker-observation'

type ResultToolsEnv = {
  readonly opts: CoordinationToolsOptions
  readonly bus: EventBus<CoordinationEvent>
  readonly state: ManagerState
  readonly workers: ReturnType<typeof createWorkerObservation>
  readonly questionLedger: ReturnType<typeof createQuestionLedger>
  readonly acknowledge: (
    targets: ReadonlyArray<Delivery>,
    by: EventAcknowledgement['by'],
  ) => Promise<number[]>
}

type Deliverable = NonNullable<CoordinationToolsOptions['deliverable']>

/**
 * The tools that end a manager: `submit_result` when it has an independent check, otherwise
 * `stop`, then `read_continuation` when the run keeps continuation notes.
 */
export function createResultTools(env: ResultToolsEnv): McpToolDescriptor[] {
  const { opts } = env
  const { deliverable } = opts
  return [
    ...(deliverable ? [submitResultTool(env, deliverable)] : []),
    // A manager with a check ends only when the check passes or when a bound ends the run.
    // Measured before this rule (2026-09-24): 389 of 650
    // lead directors could call `stop`, which ended the run with no check and no second chance.
    ...(deliverable ? [] : [stopTool(env)]),
    ...(opts.readContinuation ? [readContinuationTool(opts)] : []),
  ]
}

const earlierPassingResult = () => ({
  accepted: true,
  retained: 'earlier-passing-result',
  stop: true,
})

function submitResultTool(env: ResultToolsEnv, deliverable: Deliverable): McpToolDescriptor {
  return {
    name: 'submit_result',
    description: [
      'Submit the complete result to the injected independent check.',
      'The first passing result is retained; stop work when accepted.',
      ...(deliverable.describe ? [`Expected result: ${deliverable.describe}`] : []),
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        result: {
          description: 'The complete result in the form requested by the task.',
        },
      },
      required: ['result'],
      additionalProperties: false,
    },
    handler: (raw: unknown) => submitResult(env, deliverable, raw),
  }
}

/**
 * A check that COULD NOT RUN and a check that FAILED are both "not delivered" — fail-closed is
 * unchanged — but they need opposite moves from the manager. A check that could not run is not a
 * verdict, and the refusal says so.
 */
async function runDeliverableCheck(deliverable: Deliverable, result: unknown) {
  let verdict: CheckVerdict | undefined
  let fault: { readonly unavailable: boolean; readonly message: string } | undefined
  try {
    verdict = checkVerdictOf(await deliverable.check(result))
  } catch (error) {
    fault = {
      unavailable: error instanceof CheckUnavailableError,
      message: error instanceof Error ? error.message : String(error),
    }
  }
  return { verdict, fault }
}

async function submitResult(
  env: ResultToolsEnv,
  deliverable: Deliverable,
  raw: unknown,
): Promise<unknown> {
  const { state, workers } = env
  if (state.submitted) return earlierPassingResult()
  const a = obj(raw)
  if (!Object.hasOwn(a, 'result')) {
    throw new Error('submit_result: "result" is required')
  }
  const open = workers.openWorkRefusal('submit_result')
  if (open !== undefined) {
    state.lastRejection = { at: Date.now(), reason: String(open.reason) }
    return { accepted: false, stop: false, ...open }
  }

  // Copy once at intake so the value checked below is the exact value retained after
  // acceptance, even when this handler is called directly rather than through JSON-RPC.
  const result = structuredClone(a.result)
  const { verdict, fault } = await runDeliverableCheck(deliverable, result)
  const read = appendCheckRead(state, {
    source: 'submit',
    ...(verdict === undefined ? {} : { verdict }),
    ...(fault === undefined ? {} : { unavailable: fault.message }),
  })
  if (verdict === undefined || !verdict.pass) {
    const refusal =
      verdict !== undefined
        ? refusalText(verdict, deliverable, read.read)
        : fault?.unavailable === true
          ? `the check could not run, so this result was not judged (check read ${read.read}): ${fault.message}`
          : `the independent check THREW, so nothing was accepted (check read ${read.read}): ${fault?.message}. This is a fault in the check, not necessarily in your result — report it rather than resubmitting unchanged`
    state.lastRejection = { at: Date.now(), reason: refusal }
    return {
      accepted: false,
      stop: false,
      reason: refusal,
      checkRead: read.read,
    }
  }
  // Two remote callers may submit concurrently. Whichever passing check completes
  // first owns the retained result; a later completion must never overwrite it.
  if (state.submitted) return earlierPassingResult()

  // Persist before acknowledging. The first caller that reaches this point owns the
  // result while the append is in flight; a concurrent caller waits for the same
  // durable fact instead of appending a second passing result.
  if (state.submissionInFlight) {
    await state.submissionInFlight
    return earlierPassingResult()
  }
  await commitSubmission(env, result)
  // An accepted result is the manager's processing of everything it had received.
  await env.acknowledge(state.deliveries, 'result-accepted')
  return { accepted: true, retained: 'this-result', stop: true }
}

async function commitSubmission({ opts, bus, state }: ResultToolsEnv, result: unknown) {
  const acceptedSubmission = detachedFrozen({ result })
  const commit = bus
    .publish({ type: 'submission', result: acceptedSubmission.result }, { queue: false })
    .then(() => {
      state.submitted = acceptedSubmission
      state.stopped = true
      state.reason = 'result-accepted'
      notifyManagerStop(state, opts)
    })
  state.submissionInFlight = commit
  try {
    await commit
  } finally {
    if (state.submissionInFlight === commit) state.submissionInFlight = undefined
  }
}

function stopTool(env: ResultToolsEnv): McpToolDescriptor {
  return {
    name: 'stop',
    description: 'Declare the run complete.',
    inputSchema: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'Why you are stopping.' } },
    },
    handler: (raw) => {
      const { opts, state, workers, questionLedger } = env
      const blocking = questionLedger.blockingQuestionsForStop()
      if (blocking.length)
        return Promise.resolve(blockingQuestionsRefusal(questionLedger, blocking))
      const open = workers.openWorkRefusal('stop')
      if (open !== undefined) return Promise.resolve({ stopped: false, ...open })
      state.stopped = true
      const r = obj(raw).reason
      state.reason = typeof r === 'string' ? r : undefined
      notifyManagerStop(state, opts)
      return Promise.resolve({ stopped: true })
    },
  }
}

/** Name the exit as well as the block. */
function blockingQuestionsRefusal(
  { escalations }: ResultToolsEnv['questionLedger'],
  blocking: ReturnType<ResultToolsEnv['questionLedger']['blockingQuestionsForStop']>,
) {
  // A question this manager escalated to nobody (`no-parent`) will never be answered from above,
  // so "wait for an answer" is not a strategy — the manager is the last decider and must answer or
  // defer it itself.
  const unheard = blocking.filter((question) =>
    escalations.some((record) => record.questionId === question.id && record.delivered === false),
  )
  return {
    stopped: false,
    error: 'unresolved-blocking-questions' as const,
    reason:
      `${blocking.length} blocking question${blocking.length === 1 ? '' : 's'} ${blocking.length === 1 ? 'is' : 'are'} still undecided` +
      (unheard.length > 0
        ? `, and ${unheard.length} of them reached no parent — nothing above this manager will answer ${unheard.length === 1 ? 'it' : 'them'}. Decide ${unheard.length === 1 ? 'it' : 'them'} with answer_question (answer, or deferReason to record that it stays open) and stop again.`
        : '. Decide each with answer_question (answer, deferReason, or escalateTo) and stop again.'),
    questions: blocking,
    ...(unheard.length > 0 ? { unheardQuestionIds: unheard.map((q) => q.id) } : {}),
  }
}

function readContinuationTool(opts: CoordinationToolsOptions): McpToolDescriptor {
  return {
    name: 'read_continuation',
    description: [
      "Read a continuation note in full: the note, every line of the check's verdict, and",
      "the question panel's answers. Omit continuation for the latest.",
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        continuation: {
          type: 'integer',
          minimum: 1,
          description: 'Which continuation, 1-based. Omit for the latest.',
        },
      },
      additionalProperties: false,
    },
    handler: async (raw: unknown) => {
      const value = obj(raw).continuation
      if (value !== undefined && (!Number.isInteger(value) || (value as number) < 1)) {
        throw new Error('read_continuation: "continuation" must be an integer >= 1')
      }
      return opts.readContinuation?.(value as number | undefined)
    },
  }
}
