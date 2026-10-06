import type { NodeStatus } from './types'

/** Which {@link NodeStatus} values mean the node is finished. */
const terminalNodeStatuses: ReadonlySet<NodeStatus> = new Set<NodeStatus>([
  'done',
  'failed',
  'cancelled',
])

/**
 * True once a node has reached a terminal status.
 *
 * The single owner of this rule. Written per call site it drifts silently: a status added to
 * `NodeStatus` is classified by whichever sites the author remembered, and the ones they missed
 * keep a dead node in the live set — a stop rule that never fires, mail delivered to a worker that
 * cannot read it, or a cancel answered `not_live` for a node that is still running.
 */
export function isTerminalNodeStatus(status: NodeStatus): boolean {
  return terminalNodeStatuses.has(status)
}

/** True while a node has not yet reached a terminal status. The complement of
 *  {@link isTerminalNodeStatus}, so the two can never disagree. */
export function isLiveNodeStatus(status: NodeStatus): boolean {
  return !terminalNodeStatuses.has(status)
}
