/**
 *
 * `delegation_history` MCP tool — synchronous read of past delegations.
 * The agent uses this for self-introspection — "have I delegated this
 * kind of task before? did it work?" — and calibration.
 *
 * @stable
 */

import type {
  DelegationHistoryArgs,
  DelegationHistoryResult,
  DelegationProfile,
  DelegationTaskQueue,
} from '../task-queue'
import { delegationProfiles } from '../types'

/** MCP tool name for the `delegation_history` read-past-delegations tool. @stable */
export const DELEGATION_HISTORY_TOOL_NAME = 'delegation_history'

/** Human-readable description of the `delegation_history` MCP tool, injected into the tool manifest. @stable */
export const DELEGATION_HISTORY_DESCRIPTION = [
  'Read past delegations newest-first. Each entry carries the original',
  'arguments, current status, cost, and any feedback attached via',
  'delegate_feedback.',
  '',
  'Use when: you want to introspect prior decisions — "have I asked this',
  'question before?',
  'did the last patch land?',
  "what's the historical",
  'success rate of coder delegations on this repo?". Feed the results back',
  'into your own routing and calibration.',
  '',
  'Each entry carries `hasTrace` — when true, the full loop-trace span tree',
  'is retrievable via delegation_status { taskId, includeTrace: true }.',
  '',
  `Filters: \`namespace\` (multi-tenant scope), \`profile\` (${delegationProfiles
    .map((profile) => `"${profile}"`)
    .join(' | ')}),`,
  '`since` (ISO date — only delegations started at-or-after). `limit` defaults',
  'to 50, capped at 500.',
].join('\n')

/** JSON Schema for `delegation_history` tool arguments (optional `namespace`, `profile`, `since`, `limit`). @stable */
export const DELEGATION_HISTORY_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    namespace: { type: 'string' },
    profile: { type: 'string', enum: delegationProfiles },
    since: { type: 'string', description: 'ISO datetime — earliest startedAt to include.' },
    limit: { type: 'integer', minimum: 1, maximum: 500 },
  },
  additionalProperties: false,
} as const

/** Parse and validate raw MCP tool input into typed `DelegationHistoryArgs`; throws `TypeError` on bad input. @stable */
export function validateDelegationHistoryArgs(raw: unknown): DelegationHistoryArgs {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object') {
    throw new TypeError('delegation_history: arguments must be an object')
  }
  const value = raw as Record<string, unknown>
  const out: DelegationHistoryArgs = {}
  if (value.namespace !== undefined) {
    if (typeof value.namespace !== 'string') {
      throw new TypeError('delegation_history: `namespace` must be a string')
    }
    out.namespace = value.namespace
  }
  if (value.profile !== undefined) {
    if (!delegationProfiles.includes(value.profile as DelegationProfile)) {
      throw new TypeError(
        `delegation_history: \`profile\` must be one of ${delegationProfiles.join(', ')}`,
      )
    }
    out.profile = value.profile as DelegationProfile
  }
  if (value.since !== undefined) {
    if (typeof value.since !== 'string' || Number.isNaN(Date.parse(value.since))) {
      throw new TypeError('delegation_history: `since` must be an ISO datetime')
    }
    out.since = value.since
  }
  if (value.limit !== undefined) {
    const n = Number(value.limit)
    if (!Number.isFinite(n) || n < 1 || n > 500) {
      throw new RangeError('delegation_history: `limit` must be an integer in [1, 500]')
    }
    out.limit = Math.trunc(n)
  }
  return out
}

/** @stable */
export interface DelegationHistoryHandlerOptions {
  queue: DelegationTaskQueue
}

/** Build the MCP tool handler that reads filtered past delegations from a `DelegationTaskQueue`. @stable */
export function createDelegationHistoryHandler(
  options: DelegationHistoryHandlerOptions,
): (raw: unknown) => Promise<DelegationHistoryResult> {
  return async (raw) => {
    const args = validateDelegationHistoryArgs(raw)
    return { delegations: options.queue.history(args) }
  }
}
