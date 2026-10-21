import type { CheckVerdict, DeliverableSpec } from '../../runtime/supervise/completion-gate'
import { failedItems, NOTE_FAILURE_LINES } from '../../runtime/supervise/continuation'
/**
 * The refusal a failed check reading returns to `submit_result`: the verdict as a located fact,
 * the FAIL lines unless the check's tests must stay hidden, and how many times the manager has
 * read the check.
 */
export function refusalText(
  verdict: CheckVerdict,
  deliverable: DeliverableSpec<unknown>,
  read: number,
): string {
  const total = Object.keys(verdict.items ?? {}).length
  const failed = failedItems(verdict).length
  const score =
    verdict.composite === undefined
      ? ''
      : ` (composite ${verdict.composite}${verdict.threshold === undefined ? '' : `, passes at ${verdict.threshold}`})`
  const head =
    total > 0
      ? `The outside check failed: ${failed} of ${total} items fail${score}. Check read ${read}.`
      : `The outside check failed${score}. Check read ${read}.`
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
