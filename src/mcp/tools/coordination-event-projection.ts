import type { CoordinationEvent } from './coordination-events'

export const eventWorker = (event: CoordinationEvent): string | undefined =>
  event.type === 'settled'
    ? event.worker.id
    : event.type === 'finding'
      ? event.finding.fromWorker
      : event.type === 'question'
        ? event.question.from
        : event.type === 'map'
          ? event.map.sourceWorker
          : undefined

export // Consumer projection: the wire shape the driver sees for a pulled bus event.
const projectEvent = (ev: CoordinationEvent): Record<string, unknown> => {
  if (ev.type === 'settled') {
    const { id, status, ...evidence } = ev.worker
    return {
      type: 'settled',
      settled: id,
      status,
      ...evidence,
      ...(status === 'done' && evidence.valid === undefined ? { assessment: 'unassessed' } : {}),
      ...(evidence.outRef === undefined
        ? {}
        : {
            outputRead: { tool: 'observe_agent', arguments: { workerId: id } },
          }),
    }
  }
  if (ev.type === 'question') return { type: 'question', question: ev.question }
  if (ev.type === 'finding') return { type: 'finding', ...ev.finding }
  if (ev.type === 'submission') return { type: 'submission', result: ev.result }
  if (ev.type === 'answer') return { type: 'answer', ...ev.down, questionId: ev.questionId }
  if (ev.type === 'instruction') return { type: 'instruction', ...ev.instruction }
  if (ev.type === 'delivery-attempt') return { type: 'delivery-attempt', ...ev.attempt }
  // Peer mail is sideways and record-only, so the driver never pulls it either. Projected
  // explicitly rather than through the `down` fallback below: a member with no `down` property
  // spread through that fallback would yield a bare `{ type }` and drop the whole payload.
  if (ev.type === 'mail') return { type: 'mail', ...ev.mail }
  // Record-only like mail, and with no `down` leg, so it is projected explicitly.
  if (ev.type === 'escalation') return { type: 'escalation', ...ev.escalation }
  // A definition is record-only for the same reason, and carries no `down` leg either.
  if (ev.type === 'analyst-defined') return { type: 'analyst-defined', ...ev.analyst }
  if (ev.type === 'analyst-assignment') return { type: 'analyst-assignment', ...ev.assignment }
  // Record-only as well: the manager already holds what it acknowledged.
  if (ev.type === 'acknowledgement') return { type: 'acknowledgement', ...ev.acknowledgement }
  if (ev.type === 'tool-outcome') return { type: 'tool-outcome', ...ev.outcome }
  if (ev.type === 'lead-message') return { type: 'lead-message', ...ev.message }
  if (ev.type === 'map') return { type: 'map', ...ev.map }
  // Down-leg `steer` is record-only (never queued), so the driver never pulls it; project
  // defensively for completeness.
  return { type: ev.type, ...ev.down }
}
