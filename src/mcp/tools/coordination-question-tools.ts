import type { McpToolDescriptor } from '../server'
import type { createDownMessages } from './coordination-down-messages'
import { level, obj, str, urgency } from './coordination-input'
import { downMessageRefusalReasons } from './coordination-messages'
import type { createQuestionLedger } from './coordination-question-ledger'
import { isQuestionEscalationTarget, questionEscalationTargets } from './coordination-questions'
export function createQuestionTools({
  questionLedger,
  messages,
}: {
  readonly questionLedger: ReturnType<typeof createQuestionLedger>
  readonly messages: ReturnType<typeof createDownMessages>
}): McpToolDescriptor[] {
  return [
    {
      name: 'list_questions',
      description:
        'List questions raised by workers, drivers, or analysts. Blocking stop behavior follows questionPolicy.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => Promise.resolve({ questions: questionLedger.questions }),
    },
    {
      name: 'answer_question',
      description: 'Record an answer, deferral, or escalation for a loop question.',
      inputSchema: {
        type: 'object',
        properties: {
          questionId: { type: 'string' },
          answer: { type: 'string' },
          by: { type: 'string', description: 'Node id or "user".' },
          deferReason: { type: 'string' },
          escalateTo: { type: 'string', enum: questionEscalationTargets },
          escalateReason: { type: 'string' },
        },
        required: ['questionId'],
      },
      handler: async (raw) => {
        const a = obj(raw)
        const questionId = str(a.questionId, 'questionId')
        if (typeof a.answer === 'string' && a.answer.length > 0) {
          const answer = a.answer
          const pendingQuestion = questionLedger.questions.find(
            (question) => question.id === questionId,
          )
          if (pendingQuestion === undefined) return questionLedger.unknownQuestion(questionId)
          // Route the answer DOWN to the worker that asked, unparking it, and record the down-leg.
          // A blocking question parked the worker, so deliver forcefully — it should resume on the
          // answer immediately, not wait for its next step boundary.
          const interrupt =
            pendingQuestion.urgency === 'blocks-run' || pendingQuestion.urgency === 'blocks-step'
          const authorized = messages.authorizeInstruction(
            'answer',
            pendingQuestion.from,
            answer,
            interrupt,
            questionId,
          )
          await messages.recordInstruction(authorized)
          const delivery = await messages.attemptDelivery(authorized, {
            answer: authorized.instruction,
            questionId,
            interrupt,
          })
          // Authorization is evidence of allowed bytes, not proof the blocked worker received them.
          // Resolve the question only after the durable delivery outcome says the live inbox accepted
          // the answer. A refusal stays open both in this process and after replay.
          const question = delivery.delivered
            ? questionLedger.decideQuestion(questionId, {
                kind: 'answer',
                answer: authorized.instruction,
                by: typeof a.by === 'string' && a.by.length > 0 ? a.by : 'user',
              })
            : pendingQuestion
          // Surface `delivered` like steer_agent — the caller must see whether the answer actually
          // reached a live worker (false when it already settled or has no inbox).
          return {
            question,
            delivered: delivery.delivered,
            ...(delivery.delivered
              ? {}
              : {
                  outcome: delivery.outcome,
                  reason: downMessageRefusalReasons[delivery.outcome],
                }),
          }
        }
        if (typeof a.deferReason === 'string' && a.deferReason.length > 0) {
          if (!questionLedger.questions.some((question) => question.id === questionId))
            return Promise.resolve(questionLedger.unknownQuestion(questionId))
          return Promise.resolve({
            question: questionLedger.decideQuestion(questionId, {
              kind: 'defer',
              reason: a.deferReason,
            }),
          })
        }
        if (typeof a.escalateTo === 'string' && a.escalateTo.length > 0) {
          if (!isQuestionEscalationTarget(a.escalateTo)) {
            return Promise.resolve({
              error: 'invalid-escalation-target' as const,
              reason: `escalateTo must be one of ${questionEscalationTargets.join(', ')}; received ${JSON.stringify(a.escalateTo)}`,
            })
          }
          if (!questionLedger.questions.some((question) => question.id === questionId))
            return Promise.resolve(questionLedger.unknownQuestion(questionId))
          const escalateReason =
            typeof a.escalateReason === 'string' && a.escalateReason.length > 0
              ? a.escalateReason
              : 'driver escalated'
          const decided = questionLedger.decideQuestion(questionId, {
            kind: 'escalate',
            to: a.escalateTo,
            reason: escalateReason,
          })
          // THE SAME PATH `ask_parent` TAKES, for the same reason. Marking a question 'escalated'
          // and stopping there is exactly the silent wait this change removes: under `failClosed`
          // an escalated question still blocks `stop`, so a manager that escalates to a parent that
          // is not configured would never finish and would never be told why. `escalateTo: 'user'`
          // addresses the operator, who reads the run record, so only the 'parent' target crosses
          // the runtime seam.
          if (a.escalateTo !== 'parent') return Promise.resolve({ question: decided })
          return questionLedger.escalate(decided).then((escalation) => ({
            question: decided,
            escalated: escalation.delivered,
            outcome: escalation.delivered ? ('queued-for-parent' as const) : ('no-parent' as const),
            reason: escalation.delivered
              ? `the question is held by ${escalation.to}`
              : escalation.reason,
            ...(escalation.delivered
              ? {}
              : {
                  guidance:
                    'No inbox above this manager is configured to receive it, so nothing will route an answer back to you. The question stays on the run record for anyone watching. Do not BLOCK on it: answer_question it yourself, or answer_question with deferReason to record that it stays open.',
                }),
          }))
        }
        return Promise.resolve({
          error: 'no-decision' as const,
          reason:
            'a decision is required: pass `answer` to answer the question, `deferReason` to record that it stays open, or `escalateTo` to hand it further up',
        })
      },
    },
    {
      name: 'ask_parent',
      description: 'Raise a question to the parent driver/Pi/user when this driver cannot decide.',
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          level: { type: 'string', enum: ['worker', 'driver', 'loop'] },
          question: { type: 'string' },
          reason: { type: 'string' },
          urgency: { type: 'string', enum: ['continue-without', 'blocks-step', 'blocks-run'] },
        },
        required: ['from', 'level', 'question', 'reason', 'urgency'],
      },
      handler: async (raw) => {
        const a = obj(raw)
        const from = str(a.from, 'from')
        const q = await questionLedger.emitNewQuestion(
          questionLedger.addQuestion(
            {
              from,
              level: level(a.level),
              question: str(a.question, 'question'),
              reason: str(a.reason, 'reason'),
              urgency: urgency(a.urgency),
            },
            from,
            { kind: 'escalate', to: 'parent', reason: 'asked parent' },
          ),
        )
        const escalation = await questionLedger.escalate(q)
        return {
          question: q,
          escalated: escalation.delivered,
          outcome: escalation.delivered ? ('queued-for-parent' as const) : ('no-parent' as const),
          reason: escalation.delivered
            ? `the question is held by ${escalation.to}`
            : escalation.reason,
          ...(escalation.delivered
            ? {}
            : {
                // The artifact is journaled either way; this line is the manager's instruction, and
                // it is the difference between deciding and waiting forever.
                guidance:
                  'Nobody above this manager received the question. It is journaled for the operator, and YOU are the last decider: answer_question it yourself, or answer_question with deferReason to record that it stays open. Do not wait for an answer.',
              }),
        }
      },
    },
  ]
}
