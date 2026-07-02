/**
 *
 * Server-Sent Events serialization for runtime telemetry streams.
 *
 * Newline-safe by construction: any newline in `id` or `event` is collapsed to
 * a space (browsers terminate fields on newline), and multi-line `data`
 * payloads are split into one `data:` line per source line so JSON.stringify
 * output transports cleanly.
 *
 * @stable
 */

import type { KnowledgeReadinessReport } from '@tangle-network/agent-eval'
import type { RuntimeTelemetryOptions } from './sanitize'
import { sanitizeKnowledgeReadinessReport, sanitizeRuntimeStreamEvent } from './sanitize'
import type { RuntimeStreamEvent } from './types'

/** @stable */
export interface ServerSentEventOptions {
  event?: string
  id?: string
  retry?: number
}

/** @stable */
export function encodeServerSentEvent(data: unknown, options: ServerSentEventOptions = {}): string {
  const lines: string[] = []
  if (options.id) lines.push(`id: ${stripNewlines(options.id)}`)
  if (options.event) lines.push(`event: ${stripNewlines(options.event)}`)
  if (typeof options.retry === 'number' && Number.isFinite(options.retry) && options.retry >= 0) {
    lines.push(`retry: ${Math.floor(options.retry)}`)
  }

  const payload = typeof data === 'string' ? data : JSON.stringify(data)
  for (const line of payload.split(/\r?\n/)) {
    lines.push(`data: ${line}`)
  }
  return `${lines.join('\n')}\n\n`
}

/** @stable */
export function readinessServerSentEvent(
  report: KnowledgeReadinessReport,
  options: RuntimeTelemetryOptions & ServerSentEventOptions = {},
): string {
  const { event, id, retry, ...telemetryOptions } = options
  return encodeServerSentEvent(
    {
      type: 'readiness',
      readiness: sanitizeKnowledgeReadinessReport(report, telemetryOptions),
    },
    { event, id, retry },
  )
}

/** @stable */
export function runtimeStreamServerSentEvent(
  event: RuntimeStreamEvent,
  options: RuntimeTelemetryOptions & ServerSentEventOptions = {},
): string {
  const { event: sseEvent, id, retry, ...telemetryOptions } = options
  return encodeServerSentEvent(sanitizeRuntimeStreamEvent(event, telemetryOptions), {
    event: sseEvent,
    id,
    retry,
  })
}

function stripNewlines(value: string): string {
  return value.replace(/[\r\n]/g, ' ')
}
