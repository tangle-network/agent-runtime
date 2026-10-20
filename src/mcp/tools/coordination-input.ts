import type { ContinuityMode } from './coordination-messages'
import type { Question, QuestionUrgency } from './coordination-questions'

export // Urgency → bus priority: a blocking question is bumped ahead of queued settles/findings so the
// driver sees it FIRST when it drains the inbox (and pass-through already delivered it the instant
// it was raised). Non-blocking messages share priority 0 and resolve FIFO.
const urgencyPriority = (u: QuestionUrgency): number =>
  u === 'blocks-run' ? 20 : u === 'blocks-step' ? 10 : 0

export const str = (v: unknown, field: string): string => {
  if (typeof v !== 'string' || v.length === 0)
    throw new Error(`coordination tools: "${field}" must be a non-empty string`)
  return v
}

export const obj = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object')
    throw new Error('coordination tools: arguments must be an object')
  return raw as Record<string, unknown>
}

export const level = (v: unknown): Question['level'] => {
  if (v === 'worker' || v === 'driver' || v === 'loop') return v
  throw new Error('coordination tools: "level" must be worker, driver, or loop')
}

export const urgency = (v: unknown): Question['urgency'] => {
  if (v === 'continue-without' || v === 'blocks-step' || v === 'blocks-run') return v
  throw new Error(
    'coordination tools: "urgency" must be continue-without, blocks-step, or blocks-run',
  )
}

export const parseContinuity = (v: unknown): ContinuityMode | undefined => {
  if (v === undefined) return undefined
  if (v === 'fresh' || v === 'resume') return v
  throw new Error('coordination tools: "continuity" must be "fresh" or "resume"')
}
