/**
 * @experimental
 *
 * `delegate_feedback` MCP tool — synchronous record of agent / user /
 * downstream-judge feedback on a delegation, artifact, or outcome.
 *
 * The store is append-only. Every rating is its own event; no dedupe.
 * When `refersTo.kind === 'delegation'`, the snapshot is also attached
 * to the matching queue record so `delegation_history` surfaces it
 * inline without a join.
 */

import type { FeedbackStore } from '../feedback-store'
import { eventToSnapshot } from '../feedback-store'
import type { DelegationTaskQueue } from '../task-queue'
import type {
  DelegateFeedbackArgs,
  DelegateFeedbackResult,
  FeedbackRating,
  FeedbackRefersTo,
} from '../types'

/** @experimental */
export const DELEGATE_FEEDBACK_TOOL_NAME = 'delegate_feedback'

/** @experimental */
export const DELEGATE_FEEDBACK_DESCRIPTION = [
  'Record feedback on a delegation, artifact, or outcome. Synchronous — the',
  'event is durably stored when this call returns.',
  '',
  'Use when: you (the agent), the user, or a downstream judge has formed an',
  'opinion about a piece of work and want it persisted for calibration,',
  'pricing, or future routing. Every call is a new event — multiple ratings',
  'on the same target are expected and never deduped.',
  '',
  '`refersTo.kind`:',
  '  - "delegation": ref is a taskId returned by delegate_code/delegate_research',
  '  - "artifact":   ref is a URI/path/git-sha — anything you can dereference',
  '  - "outcome":    ref is a free-form description of a downstream result',
  '',
  '`by`:',
  '  - "agent":            the agent itself rated the work',
  '  - "user":             the human user rated it',
  '  - "downstream-judge": an automated evaluator emitted the rating',
  '',
  'When ref names a known taskId, the rating is also attached to the',
  'delegation record so delegation_history surfaces it inline.',
].join('\n')

/** @experimental */
export const DELEGATE_FEEDBACK_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    refersTo: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['delegation', 'artifact', 'outcome'] },
        ref: { type: 'string' },
      },
      required: ['kind', 'ref'],
      additionalProperties: false,
    },
    rating: {
      type: 'object',
      properties: {
        score: { type: 'number', minimum: 0, maximum: 1 },
        label: { type: 'string', enum: ['good', 'bad', 'neutral', 'mixed'] },
        notes: { type: 'string' },
      },
      required: ['score', 'notes'],
      additionalProperties: false,
    },
    by: { type: 'string', enum: ['agent', 'user', 'downstream-judge'] },
    capturedAt: { type: 'string' },
    namespace: { type: 'string' },
  },
  required: ['refersTo', 'rating', 'by'],
  additionalProperties: false,
} as const

/** @experimental */
export function validateDelegateFeedbackArgs(raw: unknown): DelegateFeedbackArgs {
  if (raw === null || typeof raw !== 'object') {
    throw new TypeError('delegate_feedback: arguments must be an object')
  }
  const value = raw as Record<string, unknown>
  const refersTo = validateRefersTo(value.refersTo)
  const rating = validateRating(value.rating)
  const by = value.by
  if (by !== 'agent' && by !== 'user' && by !== 'downstream-judge') {
    throw new TypeError(
      'delegate_feedback: `by` must be one of "agent" | "user" | "downstream-judge"',
    )
  }
  const args: DelegateFeedbackArgs = { refersTo, rating, by }
  if (value.capturedAt !== undefined) {
    if (typeof value.capturedAt !== 'string' || Number.isNaN(Date.parse(value.capturedAt))) {
      throw new TypeError('delegate_feedback: `capturedAt` must be an ISO datetime')
    }
    args.capturedAt = value.capturedAt
  }
  if (typeof value.namespace === 'string') args.namespace = value.namespace
  return args
}

function validateRefersTo(raw: unknown): FeedbackRefersTo {
  if (raw === null || typeof raw !== 'object') {
    throw new TypeError('delegate_feedback: `refersTo` must be an object')
  }
  const value = raw as Record<string, unknown>
  const kind = value.kind
  if (kind !== 'delegation' && kind !== 'artifact' && kind !== 'outcome') {
    throw new TypeError(
      'delegate_feedback: `refersTo.kind` must be one of "delegation" | "artifact" | "outcome"',
    )
  }
  const ref = value.ref
  if (typeof ref !== 'string' || ref.trim().length === 0) {
    throw new TypeError('delegate_feedback: `refersTo.ref` must be a non-empty string')
  }
  return { kind, ref: ref.trim() }
}

function validateRating(raw: unknown): FeedbackRating {
  if (raw === null || typeof raw !== 'object') {
    throw new TypeError('delegate_feedback: `rating` must be an object')
  }
  const value = raw as Record<string, unknown>
  const score = Number(value.score)
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new RangeError('delegate_feedback: `rating.score` must be a number in [0, 1]')
  }
  const notes = value.notes
  if (typeof notes !== 'string') {
    throw new TypeError('delegate_feedback: `rating.notes` must be a string')
  }
  const rating: FeedbackRating = { score, notes }
  const label = value.label
  if (label !== undefined) {
    if (label !== 'good' && label !== 'bad' && label !== 'neutral' && label !== 'mixed') {
      throw new TypeError(
        'delegate_feedback: `rating.label` must be one of "good" | "bad" | "neutral" | "mixed"',
      )
    }
    rating.label = label
  }
  return rating
}

/** @experimental */
export interface DelegateFeedbackHandlerOptions {
  queue: DelegationTaskQueue
  store: FeedbackStore
  generateId?: () => string
  now?: () => string
}

/** @experimental */
export function createDelegateFeedbackHandler(
  options: DelegateFeedbackHandlerOptions,
): (raw: unknown) => Promise<DelegateFeedbackResult> {
  const generateId = options.generateId ?? randomFeedbackId
  const now = options.now ?? (() => new Date().toISOString())
  return async (raw) => {
    const args = validateDelegateFeedbackArgs(raw)
    const id = generateId()
    const event = {
      id,
      refersTo: args.refersTo,
      rating: args.rating,
      by: args.by,
      capturedAt: args.capturedAt ?? now(),
      namespace: args.namespace,
    }
    await options.store.put(event)
    if (args.refersTo.kind === 'delegation') {
      options.queue.attachFeedback(args.refersTo.ref, eventToSnapshot(event))
    }
    return { recorded: true, id }
  }
}

function randomFeedbackId(): string {
  const t = Date.now().toString(36)
  const r = Math.random().toString(36).slice(2, 10)
  return `fbk-${t}-${r}`
}
