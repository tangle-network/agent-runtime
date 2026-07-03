/**
 *
 * `delegation_status` MCP tool — synchronous poll. Returns the current
 * state machine + optional progress + final result (when terminal).
 *
 * @experimental
 */

import { NotFoundError } from '../../errors'
import type {
  DelegationStatusArgs,
  DelegationStatusResult,
  DelegationTaskQueue,
} from '../task-queue'

/** MCP tool name for the `delegation_status` synchronous-poll tool. @experimental */
export const DELEGATION_STATUS_TOOL_NAME = 'delegation_status'

/** Human-readable description of the `delegation_status` MCP tool, injected into the tool manifest. @experimental */
export const DELEGATION_STATUS_DESCRIPTION = [
  'Poll the status of an async delegation. Returns the current state',
  '(pending | running | completed | failed | cancelled), optional progress,',
  'and the final result when status === "completed".',
  '',
  'Use when: you previously kicked off an async delegation (delegate_ui_audit)',
  "and need to know whether the work is done. The agent's right rhythm is to",
  'call this every minute or two while waiting; do not busy-poll.',
  '',
  'For a completed delegate_ui_audit run, `result.output` is the array of UI',
  'findings — one self-contained Markdown finding per issue, each with an',
  'embedded screenshot and a suggested fix.',
  '',
  'Pass includeTrace: true to also receive the journaled loop-trace span',
  'tree (loop → round → iteration, with placement/cost/verdict metadata).',
  'Default false — keep routine polls light.',
  '',
  'Throws NotFoundError when taskId is unknown — never silently returns',
  '`pending` for a typo.',
].join('\n')

/** JSON Schema for `delegation_status` tool arguments (`taskId` + optional `includeTrace`). @experimental */
export const DELEGATION_STATUS_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    taskId: { type: 'string', description: 'Returned by delegate_ui_audit.' },
    includeTrace: {
      type: 'boolean',
      description:
        'Also return the journaled loop-trace span tree for this delegation. Default false.',
    },
  },
  required: ['taskId'],
  additionalProperties: false,
} as const

/** Parse and validate raw MCP tool input into typed `DelegationStatusArgs`; throws `TypeError` on bad input. @experimental */
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

/** Build the MCP tool handler that polls a `DelegationTaskQueue` for task status. @experimental */
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
