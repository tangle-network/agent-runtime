import type { EventBus } from '../../runtime/supervise/event-bus'
import { INBOX_RECEIPT_KEY, type InboxReceipt } from '../../runtime/supervise/inbox'
import { detachedFrozen } from '../../runtime/supervise/snapshot'
import type { CoordinationTools, CoordinationToolsOptions } from './coordination-contracts'
import type { CoordinationEvent, LeadMessage, ToolOutcomeEvent } from './coordination-events'

interface OpenToolReceipt {
  readonly tool: string
  readonly startedAt: number
  outcome?: Extract<CoordinationEvent, { type: 'tool-outcome' }>
  publishing?: Promise<void>
}

/**
 * What reaches a manager from outside its tools: lead messages from its parent, and the outcomes
 * of tool calls that outlived their response fence. Both are open work until they are delivered.
 */
export function createLeadIntake({
  opts,
  bus,
  leadReceipts,
}: {
  readonly opts: CoordinationToolsOptions
  readonly bus: EventBus<CoordinationEvent>
  readonly leadReceipts: Map<string, (receipt: InboxReceipt) => void>
}) {
  // Tool calls that outlived their response fence, by receipt. Each is open work: its outcome
  // reaches the manager as a `tool-outcome` event on the next wake.
  const openReceipts = new Map<string, OpenToolReceipt>()
  let receiptSeq = 0
  // Lead messages accepted and still being published. The sender is told `delivered` the moment the
  // message is accepted, so a manager that ends its turn then must still count it as open work.
  let leadPublishing = 0

  const receiveLeadMessage: CoordinationTools['receiveLeadMessage'] = (message) => {
    const parsed = leadMessageOf(message)
    if (parsed === undefined) return false
    const receipt = (message as Record<string, unknown>)[INBOX_RECEIPT_KEY]
    if (parsed.messageId !== undefined && typeof receipt === 'function') {
      leadReceipts.set(parsed.messageId, receipt as (receipt: InboxReceipt) => void)
    }
    leadPublishing += 1
    bus
      .publish({ type: 'lead-message', message: parsed })
      .catch((error: unknown) => {
        console.error('Runtime could not queue a lead message for its manager', {
          manager: opts.scope.view.root,
          error: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => {
        leadPublishing -= 1
      })
    return true
  }

  const openToolReceipt: CoordinationTools['openToolReceipt'] = (tool) => {
    receiptSeq += 1
    const receipt = `${tool}#${receiptSeq}`
    openReceipts.set(receipt, { tool, startedAt: Date.now() })
    return receipt
  }

  function publishOutcome(
    receipt: string,
    open: OpenToolReceipt,
    event: NonNullable<OpenToolReceipt['outcome']>,
  ): Promise<void> {
    // Keep the receipt open until every subscriber acknowledges and the manager can pull it.
    // Retry the same event after a lost acknowledgement so its sequence and timestamp survive.
    open.publishing ??= Promise.resolve()
      .then(() => bus.publish(event))
      .then(() => {
        openReceipts.delete(receipt)
      })
      .finally(() => {
        delete open.publishing
      })
    return open.publishing
  }

  const settleToolReceipt: CoordinationTools['settleToolReceipt'] = async (receipt, outcome) => {
    const open = openReceipts.get(receipt)
    if (open === undefined) return
    open.outcome ??= {
      type: 'tool-outcome',
      outcome: detachedFrozen<ToolOutcomeEvent>({
        receipt,
        tool: open.tool,
        ...(outcome.ok
          ? { ok: true, value: outcome.value }
          : {
              ok: false,
              error: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
            }),
        elapsedMs: Date.now() - open.startedAt,
      }),
    }
    await publishOutcome(receipt, open, open.outcome)
  }

  async function retryToolOutcomes(): Promise<void> {
    for (const [receipt, open] of openReceipts) {
      if (open.outcome !== undefined && open.publishing === undefined)
        await publishOutcome(receipt, open, open.outcome)
    }
  }

  return {
    receiveLeadMessage,
    openToolReceipt,
    settleToolReceipt,
    retryToolOutcomes,
    leadPublishing: () => leadPublishing,
    openReceiptCount: () => openReceipts.size,
  }
}

function leadMessageOf(message: unknown): LeadMessage | undefined {
  if (message === null || typeof message !== 'object') return undefined
  const m = message as Record<string, unknown>
  const interrupt = m.interrupt === true
  const id =
    typeof m.messageId === 'string' && m.messageId.length > 0 ? { messageId: m.messageId } : {}
  if (typeof m.steer === 'string') return { ...id, kind: 'steer', text: m.steer, interrupt }
  if (typeof m.answer === 'string') {
    return {
      ...id,
      kind: 'answer',
      text: m.answer,
      ...(typeof m.questionId === 'string' ? { questionId: m.questionId } : {}),
      interrupt,
    }
  }
  return undefined
}
