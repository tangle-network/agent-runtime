import { randomUUID } from 'node:crypto'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import type { EventBus } from '../../runtime/supervise/event-bus'
import { INBOX_RECEIPT_KEY, type InboxReceipt } from '../../runtime/supervise/inbox'
import { isLiveNodeStatus } from '../../runtime/supervise/node-status'
import { detachedFrozen } from '../../runtime/supervise/snapshot'
import type { CoordinationToolsOptions } from './coordination-contracts'
import type { CoordinationEvent, EventAcknowledgement } from './coordination-events'
import { str } from './coordination-input'
import type {
  ContinuationInstruction,
  DownMessageDeliveryAttempt,
  DownMessageDeliveryOutcome,
  DownMessageEvent,
} from './coordination-messages'

export function createDownMessages({
  opts,
  bus,
  lifetime,
}: {
  readonly opts: CoordinationToolsOptions
  readonly bus: EventBus<CoordinationEvent>
  readonly lifetime: AbortSignal | undefined
}) {
  // The down-leg: record a parent→child message on the bus for the audit trail (history +
  // subscribers) WITHOUT enqueuing it — the parent must never pull its own outbound message back.
  // Overloaded so the `answer` kind REQUIRES a questionId (no silent `?? ''` fallback to mask a bug).
  function sendDown(type: 'steer', down: DownMessageEvent, analyst?: string): Promise<void>
  function sendDown(type: 'answer', down: DownMessageEvent, questionId: string): Promise<void>
  async function sendDown(
    type: 'steer' | 'answer',
    down: DownMessageEvent,
    questionIdOrAnalyst?: string,
  ): Promise<void> {
    await bus.publish(
      type === 'answer'
        ? { type, down, questionId: str(questionIdOrAnalyst, 'questionId') }
        : questionIdOrAnalyst !== undefined
          ? { type, down, analyst: questionIdOrAnalyst }
          : { type, down },
      { queue: false },
    )
  }

  const authorizeInstruction = (
    kind: 'steer' | 'answer',
    workerId: string,
    instruction: string,
    interrupt: boolean,
    questionId?: string,
  ): ContinuationInstruction => {
    const workerIdentity = opts.scope.view.nodes.find((node) => node.id === workerId)?.identity
    let authorizedInstruction = instruction
    if (opts.authorizeDownMessage) {
      if (workerIdentity === undefined) {
        throw new Error(
          `coordination tools: cannot authorize ${kind} for worker ${JSON.stringify(workerId)} without durable identity`,
        )
      }
      const decision = detachedFrozen(
        opts.authorizeDownMessage(
          detachedFrozen({
            kind,
            workerId,
            workerIdentity,
            instruction,
            interrupt,
            ...(questionId !== undefined ? { questionId } : {}),
          }),
        ),
      )
      if (
        typeof decision !== 'object' ||
        decision === null ||
        Array.isArray(decision) ||
        typeof decision.instruction !== 'string' ||
        decision.instruction.length === 0
      ) {
        throw new Error('coordination tools: authorizeDownMessage must return an instruction')
      }
      authorizedInstruction = decision.instruction
    }
    return detachedFrozen({
      receiptId: randomUUID(),
      kind,
      toWorker: workerId,
      instruction: authorizedInstruction,
      instructionDigest: canonicalCandidateDigest(authorizedInstruction),
      ...(workerIdentity !== undefined ? { workerIdentity } : {}),
      interrupt,
      ...(questionId !== undefined ? { questionId } : {}),
    })
  }

  /** Publish before `scope.send`: an awaited durable subscriber therefore commits the exact bytes
   * before the worker can observe them. */
  const recordInstruction = async (instruction: ContinuationInstruction): Promise<void> => {
    await bus.publish({ type: 'instruction', instruction }, { queue: false })
  }

  /** Commit delivery intent after the authorization receipt and before `Scope.send`. An attempt with
   * no matching outcome after a crash is explicitly unknown and must never be replayed. */
  const recordDeliveryAttempt = async (
    instruction: ContinuationInstruction,
  ): Promise<DownMessageDeliveryAttempt> => {
    const attempt = detachedFrozen({
      receiptId: instruction.receiptId,
      kind: instruction.kind,
      toWorker: instruction.toWorker,
      instructionDigest: instruction.instructionDigest,
      interrupt: instruction.interrupt,
      ...(instruction.questionId !== undefined ? { questionId: instruction.questionId } : {}),
    })
    await bus.publish({ type: 'delivery-attempt', attempt }, { queue: false })
    return attempt
  }

  const deliveryOutcome = (workerId: string, delivered: boolean): DownMessageDeliveryOutcome => {
    if (delivered) return 'delivered'
    if (opts.scope.signal.aborted) return 'scope-stopped'
    const node = opts.scope.view.nodes.find((candidate) => candidate.id === workerId)
    if (!node) return 'unknown-worker'
    if (!isLiveNodeStatus(node.status)) return 'already-settled'
    return 'runtime-has-no-inbox'
  }

  const recordReceipt = (receipt: InboxReceipt): void => {
    bus
      .publish(
        {
          type: 'acknowledgement',
          acknowledgement: detachedFrozen<EventAcknowledgement>({
            seqs: [],
            by: receipt.status,
            messageId: receipt.messageId,
            ...(receipt.status === 'consumed'
              ? { attemptId: receipt.attemptId }
              : { reason: receipt.reason }),
          }),
        },
        { queue: false },
      )
      .catch(() => undefined)
  }

  const attemptDelivery = async (
    instruction: ContinuationInstruction,
    message: Record<string, unknown>,
    origin?: { readonly analyst?: string },
  ): Promise<DownMessageEvent> => {
    await recordDeliveryAttempt(instruction)
    let delivered = false
    let outcome: DownMessageDeliveryOutcome
    let error: string | undefined
    try {
      if (lifetime?.aborted) {
        outcome = 'scope-stopped'
      } else {
        delivered = opts.scope.send(instruction.toWorker, {
          ...message,
          messageId: instruction.receiptId,
          [INBOX_RECEIPT_KEY]: recordReceipt,
        })
        outcome = deliveryOutcome(instruction.toWorker, delivered)
      }
    } catch (cause) {
      outcome = 'runtime-error'
      error = cause instanceof Error ? cause.message : String(cause)
    }
    const down = detachedFrozen({
      receiptId: instruction.receiptId,
      toWorker: instruction.toWorker,
      instruction: instruction.instruction,
      instructionDigest: instruction.instructionDigest,
      delivered,
      outcome,
      ...(error !== undefined ? { error } : {}),
    })
    if (instruction.kind === 'answer') {
      await sendDown('answer', down, str(instruction.questionId, 'questionId'))
    } else {
      await sendDown('steer', down, origin?.analyst)
    }
    if (error !== undefined) throw new Error(`coordination tools: delivery failed: ${error}`)
    return down
  }

  const steerWorker = async (
    workerId: string,
    instruction: string,
    options: { readonly interrupt?: boolean } = {},
  ): Promise<DownMessageEvent> => {
    const interrupt = options.interrupt === true
    const authorized = authorizeInstruction('steer', workerId, instruction, interrupt)
    await recordInstruction(authorized)
    return await attemptDelivery(authorized, {
      steer: authorized.instruction,
      interrupt,
    })
  }

  return { sendDown, authorizeInstruction, recordInstruction, attemptDelivery, steerWorker }
}
