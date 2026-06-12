/**
 * @experimental
 *
 * `delegation_status` MCP tool — synchronous poll. Returns the current
 * state machine + optional progress + final result (when terminal).
 */

import { NotFoundError } from '../../errors'
import type {
  DelegationStatusArgs,
  DelegationStatusResult,
  DelegationTaskQueue,
} from '../task-queue'

/** @experimental */
export const DELEGATION_STATUS_TOOL_NAME = 'delegation_status'

/** @experimental */
export const DELEGATION_STATUS_DESCRIPTION = [
  'Poll the status of an async delegation. Returns the current state',
  '(pending | running | completed | failed | cancelled), optional progress,',
  'and the final result when status === "completed".',
  '',
  'Use when: you previously called delegate_code or delegate_research and',
  "need to know whether the work is done. The agent's right rhythm is to",
  'call this every minute or two while waiting; do not busy-poll.',
  '',
  'For a completed coder task, `result.output` is a CoderOutput with branch,',
  'patch, test/typecheck results, and diff stats. For a completed research',
  'task, `result.output` is the items + citations + proposedWrites bundle.',
  '',
  'Pass includeTrace: true to also receive the journaled loop-trace span',
  'tree (loop → round → iteration, with placement/cost/verdict metadata).',
  'Default false — keep routine polls light.',
  '',
  'Throws NotFoundError when taskId is unknown — never silently returns',
  '`pending` for a typo.',
].join('\n')

/** @experimental */
export const DELEGATION_STATUS_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    taskId: { type: 'string', description: 'Returned by delegate_code / delegate_research.' },
    includeTrace: {
      type: 'boolean',
      description:
        'Also return the journaled loop-trace span tree for this delegation. Default false.',
    },
  },
  required: ['taskId'],
  additionalProperties: false,
} as const

/** @experimental */
export function validateDelegationStatusArgs(raw: unknown): DelegationStatusArgs {
  if (raw === null || typeof raw !== 'object') {
    throw new TypeError('delegation_status: arguments must be an object')
  }
  const value = raw as Record<string, unknown>
  const taskId = value.taskId
  if (typeof taskId !== 'string' || taskId.trim().length === 0) {
    throw new TypeError('delegation_status: `taskId` must be a non-empty string')
  }
  const out: DelegationStatusArgs = { taskId: taskId.trim() }
  if (value.includeTrace !== undefined) {
    if (typeof value.includeTrace !== 'boolean') {
      throw new TypeError('delegation_status: `includeTrace` must be a boolean')
    }
    out.includeTrace = value.includeTrace
  }
  return out
}

/** @experimental */
export interface DelegationStatusHandlerOptions {
  queue: DelegationTaskQueue
}

/** @experimental */
export function createDelegationStatusHandler(
  options: DelegationStatusHandlerOptions,
): (raw: unknown) => Promise<DelegationStatusResult> {
  return async (raw) => {
    const args = validateDelegationStatusArgs(raw)
    const status = options.queue.status(
      args.taskId,
      args.includeTrace !== undefined ? { includeTrace: args.includeTrace } : undefined,
    )
    if (!status) {
      throw new NotFoundError(`delegation_status: unknown taskId "${args.taskId}"`)
    }
    return status
  }
}
