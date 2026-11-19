import type { CheckVerdict, DeliverableSpec } from '../../runtime/supervise/completion-gate'
import { failedItems, NOTE_FAILURE_LINES } from '../../runtime/supervise/continuation'
/** The completion decision and the evidence the deliverable permits the manager to see. */
export function refusalText(verdict: CheckVerdict, deliverable: DeliverableSpec<unknown>): string {
  const total = Object.keys(verdict.items ?? {}).length
  const failed = failedItems(verdict).length
  const score =
    verdict.composite === undefined
      ? ''
      : ` (composite ${verdict.composite}${verdict.threshold === undefined ? '' : `, passes at ${verdict.threshold}`})`
  const items = total > 0 ? ` ${failed} of ${total} checked items failed.` : ''
  const head = `Submission declined${score}.${items}`
  if (deliverable.feedback === 'pass-only') return head
  const lines = verdict.failures ?? []
  if (lines.length === 0) {
    return deliverable.describe ? `${head} Expected: ${deliverable.describe}` : head
  }
  const shown = lines.slice(0, NOTE_FAILURE_LINES)
  return [
    head,
    ...shown,
    ...(lines.length > shown.length ? [`${lines.length - shown.length} more failure lines.`] : []),
  ].join('\n')
}
