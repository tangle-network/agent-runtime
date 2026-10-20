import type { EventBus } from '../../runtime/supervise/event-bus'
import type { CoordinationToolsOptions } from './coordination-contracts'
import type { CoordinationEvent } from './coordination-events'
import { level, str, urgency, urgencyPriority } from './coordination-input'
import type {
  Question,
  QuestionDecision,
  QuestionEscalationOutcome,
  QuestionEscalationRecord,
  QuestionInput,
  QuestionRecord,
} from './coordination-questions'

export function createQuestionLedger({
  opts,
  bus,
}: {
  readonly opts: CoordinationToolsOptions
  readonly bus: EventBus<CoordinationEvent>
}) {
  let questionSeq = 0
  const questions: QuestionRecord[] = [...(opts.priorQuestions ?? [])]
  const questionPolicy = opts.questionPolicy ?? 'auto'

  const nextQuestionId = (from: string): string => {
    for (;;) {
      const id = `${from}:q${questionSeq++}`
      if (!questions.some((question) => question.id === id)) return id
    }
  }
  const normalizeQuestion = (q: QuestionInput, fallbackFrom: string): Question => {
    const from = str(q.from ?? fallbackFrom, 'from')
    return {
      id: typeof q.id === 'string' && q.id.length > 0 ? q.id : nextQuestionId(from),
      from,
      level: level(q.level),
      question: str(q.question, 'question'),
      reason: str(q.reason, 'reason'),
      ...(q.options ? { options: q.options } : {}),
      urgency: urgency(q.urgency),
    }
  }
  const addQuestion = (
    raw: QuestionInput,
    fallbackFrom: string,
    decision?: QuestionDecision,
  ): { question: QuestionRecord; added: boolean } => {
    const q = normalizeQuestion(raw, fallbackFrom)
    const existing = questions.find((x) => x.id === q.id)
    if (existing) return { question: existing, added: false }
    const effectiveDecision =
      decision ??
      (questionPolicy === 'bubble'
        ? ({
            kind: 'escalate',
            to: 'parent',
            reason: 'question policy bubbled to parent',
          } as const)
        : undefined)
    const status: QuestionRecord['status'] =
      effectiveDecision?.kind === 'answer'
        ? 'answered'
        : effectiveDecision?.kind === 'defer'
          ? 'deferred'
          : effectiveDecision?.kind === 'escalate'
            ? 'escalated'
            : 'open'
    const record: QuestionRecord = {
      ...q,
      status,
      openedAt: Date.now(),
      ...(effectiveDecision ? { decision: effectiveDecision } : {}),
    }
    questions.push(record)
    return { question: record, added: true }
  }
  const emitNewQuestion = async (record: {
    question: QuestionRecord
    added: boolean
  }): Promise<QuestionRecord> => {
    if (record.added)
      await bus.publish(
        { type: 'question', question: record.question },
        { priority: urgencyPriority(record.question.urgency) },
      )
    return record.question
  }
  /** The refusal every `answer_question` path returns for an id this manager has no question for.
   *  A THROW here reaches the manager as a transport error with no vocabulary it can act on, and
   *  this is the verb the `no-parent` guidance tells it to use — so it names the condition. */
  const unknownQuestion = (questionId: string) => ({
    error: 'unknown-question' as const,
    reason: `this manager has no question with the id ${JSON.stringify(questionId)}; call list_questions for the ids you may decide`,
  })
  const decideQuestion = (questionId: string, decision: QuestionDecision): QuestionRecord => {
    const idx = questions.findIndex((q) => q.id === questionId)
    if (idx < 0) throw new Error(`unknown questionId ${JSON.stringify(questionId)}`)
    const prior = questions[idx] as QuestionRecord
    const status: QuestionRecord['status'] =
      decision.kind === 'answer' ? 'answered' : decision.kind === 'defer' ? 'deferred' : 'escalated'
    const next: QuestionRecord = { ...prior, status, decision }
    questions[idx] = next
    return next
  }
  // ── ask_parent, and the honest answer when nothing is above ───────────────────
  //
  // A manager that escalates a BLOCKING question and reads a bare receipt waits for an answer. When
  // no parent inbox exists, that wait never ends, and a fail-closed stop policy then refuses every
  // `stop` for the rest of the run — the question is counted as unresolved forever. So the outcome
  // is stated, every time: `queued-for-parent` when something took the question, `no-parent` when
  // nothing did, and in the second case the manager is told it is the last decider.
  const escalations: QuestionEscalationRecord[] = [...(opts.priorEscalations ?? [])]
  const escalate = async (question: QuestionRecord): Promise<QuestionEscalationRecord> => {
    let outcome: QuestionEscalationOutcome
    if (opts.escalateQuestion === undefined) {
      outcome = {
        delivered: false,
        reason:
          'this manager has no parent inbox in this run, so nothing above it can receive the question',
      }
    } else {
      try {
        outcome = await opts.escalateQuestion(question)
      } catch (error) {
        // A broken parent channel is an UNDELIVERED escalation, never a delivered one: reading a
        // throw as success is exactly the silent wait this verb exists to remove.
        outcome = {
          delivered: false,
          reason: `the parent channel refused the question: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    }
    const record: QuestionEscalationRecord = Object.freeze({
      questionId: question.id,
      from: question.from,
      urgency: question.urgency,
      delivered: outcome.delivered,
      ...(outcome.delivered ? { to: outcome.to } : { reason: outcome.reason }),
      at: Date.now(),
    })
    escalations.push(record)
    await bus.publish({ type: 'escalation', escalation: record }, { queue: false })
    return record
  }

  const blockingQuestionsForStop = (): QuestionRecord[] => {
    if (questionPolicy === 'auto' || questionPolicy === 'bubble') return []
    return questions.filter((q) => {
      const blocking = q.urgency === 'blocks-step' || q.urgency === 'blocks-run'
      if (!blocking) return false
      if (questionPolicy === 'mustDecide') return q.status === 'open'
      return q.status !== 'answered' && q.status !== 'deferred'
    })
  }

  return {
    questions,
    addQuestion,
    emitNewQuestion,
    unknownQuestion,
    decideQuestion,
    escalations,
    escalate,
    blockingQuestionsForStop,
  }
}
