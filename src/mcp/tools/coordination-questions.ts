export type QuestionLevel = 'worker' | 'driver' | 'loop'

export type QuestionUrgency = 'continue-without' | 'blocks-step' | 'blocks-run'

export interface QuestionOption {
  readonly label: string
  readonly tradeoff: string
}

export interface Question {
  readonly id: string
  readonly from: string
  readonly level: QuestionLevel
  readonly question: string
  readonly reason: string
  readonly urgency: QuestionUrgency
  readonly options?: ReadonlyArray<QuestionOption>
}

/** Where a question this driver cannot answer goes next. `answer_question` accepts these and
 *  nothing else, so the decision type states them and nothing else. */
export const questionEscalationTargets = ['parent', 'user'] as const

export type QuestionEscalationTarget = (typeof questionEscalationTargets)[number]

export const isQuestionEscalationTarget = (value: unknown): value is QuestionEscalationTarget =>
  (questionEscalationTargets as ReadonlyArray<unknown>).includes(value)

export type QuestionDecision =
  | { readonly kind: 'answer'; readonly answer: string; readonly by: string }
  | { readonly kind: 'defer'; readonly reason: string }
  | {
      readonly kind: 'escalate'
      readonly to: QuestionEscalationTarget
      readonly reason: string
    }

export interface QuestionRecord extends Question {
  readonly status: 'open' | 'answered' | 'deferred' | 'escalated'
  readonly decision?: QuestionDecision
  readonly openedAt: number
}

export type QuestionInput = Omit<Question, 'id'> & { readonly id?: string }

export type QuestionPolicy = 'auto' | 'mustDecide' | 'bubble' | 'failClosed'

/** The result of handing a question this manager cannot answer to whatever is above it. */
export type QuestionEscalationOutcome =
  | { readonly delivered: true; readonly to: string }
  | { readonly delivered: false; readonly reason: string }

/**
 * Where a question leaves this manager when `ask_parent` is called.
 *
 * Absent means NO INBOX IS CONFIGURED above this manager: `ask_parent` then answers `no-parent`
 * instead of appearing to succeed. That distinction is the whole point of the seam — a manager that
 * escalates a blocking question and reads a bare receipt BLOCKS on an answer nothing is routing to
 * it, and a fail-closed stop policy then refuses to let it finish.
 *
 * `no-parent` is not "the question vanished". It is still published on the bus and journaled, so an
 * external answerer watching the run — the coordination MCP's own `answer_question`, an operator
 * console, a product observer on `onCoordinationEvent` — can still decide it. What `no-parent` says
 * is that the RUNTIME will carry it nowhere by itself, so the manager must not sit and wait.
 *
 * An implementation returns `{ delivered: true, to }` naming who holds the question now, or
 * `{ delivered: false, reason }`. A THROW is also a refusal: its message becomes the reason, so a
 * broken parent channel reads as an undelivered escalation, never as a delivered one.
 */
export type EscalateQuestion = (
  question: QuestionRecord,
) => Promise<QuestionEscalationOutcome> | QuestionEscalationOutcome

/**
 * A manager's intake for an `ask_parent` question raised by a worker it spawned that manages work
 * of its own. `assignmentId` is the assignment the parent gave that worker. The question joins the
 * parent's questions under that worker's id, so the parent's next wake carries it and
 * `answer_question` delivers the answer back down to the asker.
 */
export type ChildQuestionInbox = (
  assignmentId: string,
  question: QuestionRecord,
) => Promise<QuestionEscalationOutcome>

/** The operator-facing artifact written for every `ask_parent`: which question left, whether
 *  anything received it, and — when nothing did — that the manager itself is now the last decider.
 *  Journaled record-only, so the run's durable coordination log holds every question that was
 *  raised and went unheard. */
export interface QuestionEscalationRecord {
  readonly questionId: string
  readonly from: string
  readonly urgency: QuestionUrgency
  readonly delivered: boolean
  /** Who holds the question now. Absent when nothing received it. */
  readonly to?: string
  /** Why it was not delivered. Absent on a delivered escalation. */
  readonly reason?: string
  readonly at: number
}
