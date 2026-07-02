/**
 *
 * Prompt formatter for the auditor profile. `formatAuditorPrompt` produces
 * the user message handed to the iteration — describes the captures to be
 * taken and the lens to apply. The system prompt comes from
 * `buildAuditorSystemPrompt(lens)` (lens-prompts.ts).
 *
 * The formatter prepends a machine-readable envelope (`<<UI_AUDIT_TASK>>`
 * … `<<UI_AUDIT_TASK_END>>`) carrying a JSON-serialised task. The
 * in-process auditor client recovers the task from this envelope so the
 * iteration is self-describing — robust to concurrent fanout, where any
 * per-client side state (e.g. a "current task" register) would race.
 *
 * The formatter is pure and deterministic — re-run on the same task
 * produces the same prompt. Tests and trace replays rely on this.
 *
 * @experimental
 */

import type { UiAuditTask } from './task'

const ENVELOPE_BEGIN = '<<UI_AUDIT_TASK>>'
const ENVELOPE_END = '<<UI_AUDIT_TASK_END>>'

/** @experimental */
export function encodeAuditTaskEnvelope(task: UiAuditTask): string {
  return `${ENVELOPE_BEGIN}${JSON.stringify(task)}${ENVELOPE_END}`
}

/**
 * Parse a task envelope back out of a prompt string. Returns undefined if
 * the prompt does not contain a complete envelope OR if the payload is
 * not valid JSON.
 *
 * @experimental
 */
export function decodeAuditTaskEnvelope(prompt: string): UiAuditTask | undefined {
  const start = prompt.indexOf(ENVELOPE_BEGIN)
  if (start === -1) return undefined
  const payloadStart = start + ENVELOPE_BEGIN.length
  const end = prompt.indexOf(ENVELOPE_END, payloadStart)
  if (end === -1) return undefined
  const payload = prompt.slice(payloadStart, end)
  try {
    const parsed = JSON.parse(payload) as unknown
    if (!parsed || typeof parsed !== 'object') return undefined
    const t = parsed as Partial<UiAuditTask>
    if (typeof t.lens !== 'string' || !Array.isArray(t.captures)) return undefined
    return t as UiAuditTask
  } catch {
    return undefined
  }
}

/** @experimental */
export function formatAuditorPrompt(task: UiAuditTask): string {
  const lines: string[] = []
  lines.push(`# UI audit iteration — lens: ${task.lens}`)
  lines.push('')
  if (task.productContext && task.productContext.trim().length > 0) {
    lines.push('## Product context')
    lines.push(task.productContext.trim())
    lines.push('')
  }
  lines.push('## Captures to take')
  task.captures.forEach((cap, i) => {
    const vp = cap.viewport ? `${cap.viewport.width}x${cap.viewport.height}` : '1280x800 (default)'
    const detail = [
      `viewport=${vp}`,
      cap.fullPage ? 'fullPage=true' : null,
      cap.elementSelector ? `selector=\`${cap.elementSelector}\`` : null,
      cap.waitFor ? `waitFor=\`${cap.waitFor}\`` : null,
      cap.waitMs !== undefined ? `waitMs=${cap.waitMs}` : null,
      cap.label ? `label=${cap.label}` : null,
    ]
      .filter((s): s is string => s !== null)
      .join(' · ')
    lines.push(`${i + 1}. route=\`${cap.route}\` url=${cap.url} ${detail ? `(${detail})` : ''}`)
  })
  lines.push('')
  if (task.knownFindingIds && task.knownFindingIds.length > 0) {
    lines.push('## Known findings (link via similarTo, do not refile)')
    lines.push(task.knownFindingIds.map((n) => `#${String(n).padStart(3, '0')}`).join(', '))
    lines.push('')
  }
  lines.push('## Output format')
  lines.push(
    'Emit a single JSON object with the shape `{ findings: UiFinding[], notes?: string }` where every finding has the fields enumerated in your system prompt. The screenshots field on each finding must reference the captures above by path. Do not emit findings outside the lens.',
  )
  return lines.join('\n')
}
