/**
 * @experimental
 *
 * Sandbox-event stream → UiAuditOutput decoder. The custom auditor
 * `SandboxClient` emits events of the form:
 *
 *   { type: 'audit.capture', data: UiAuditCapture }
 *   { type: 'audit.finding', data: UiFinding }
 *   { type: 'audit.notes',   data: { notes: string } }
 *   { type: 'audit.lens',    data: { lens: UiLens } }
 *   { type: 'done',          data: { tokenUsage: { ... }, totalCostUsd?: number } }
 *
 * Other event types are tolerated and ignored. The adapter is pure: it
 * folds an already-collected event array into a UiAuditOutput.
 */

import type { SandboxEvent } from '@tangle-network/sandbox'
import { UI_LENSES, type UiFinding, type UiLens } from './substrate'
import type { UiAuditCapture, UiAuditOutput } from './task'

// Build the lens-validation set from the canonical UI_LENSES tuple so adding
// a lens to the substrate automatically extends the parser; otherwise a new
// lens would silently fail isUiLens() and parseAuditorEvents would drop
// every event using it.
const KNOWN_LENS_VALUES = new Set<UiLens>(UI_LENSES)

function isUiLens(v: unknown): v is UiLens {
  return typeof v === 'string' && KNOWN_LENS_VALUES.has(v as UiLens)
}

/** @experimental */
export function parseAuditorEvents(events: SandboxEvent[]): UiAuditOutput {
  const findings: UiFinding[] = []
  const captures: UiAuditCapture[] = []
  let lens: UiLens | undefined
  let notes: string | undefined

  for (const evt of events) {
    if (!evt || typeof evt !== 'object') continue
    const type = String(evt.type ?? '')
    const data =
      evt.data && typeof evt.data === 'object' ? (evt.data as Record<string, unknown>) : undefined
    if (!data) continue

    switch (type) {
      case 'audit.lens': {
        const v = data.lens
        if (isUiLens(v)) lens = v
        break
      }
      case 'audit.capture': {
        const cap = data as unknown as Partial<UiAuditCapture>
        if (
          typeof cap.path === 'string' &&
          typeof cap.viewport === 'string' &&
          typeof cap.fullPage === 'boolean' &&
          typeof cap.route === 'string' &&
          typeof cap.url === 'string' &&
          typeof cap.capturedAt === 'string'
        ) {
          const out: UiAuditCapture = {
            path: cap.path,
            viewport: cap.viewport,
            fullPage: cap.fullPage,
            route: cap.route,
            url: cap.url,
            capturedAt: cap.capturedAt,
          }
          if (cap.elementSelector) out.elementSelector = cap.elementSelector
          if (cap.label) out.label = cap.label
          captures.push(out)
        }
        break
      }
      case 'audit.finding': {
        const f = data as unknown as Partial<UiFinding>
        // Hard requirement: all the actionable fields must be present and
        // non-empty for a finding to enter the output. The validator does the
        // softer scoring; the adapter only filters structural junk.
        if (
          typeof f.title === 'string' &&
          f.title.trim().length > 0 &&
          isUiLens(f.lens) &&
          typeof f.severity === 'string' &&
          ['low', 'med', 'high', 'critical'].includes(f.severity) &&
          typeof f.route === 'string' &&
          typeof f.observation === 'string' &&
          typeof f.impact === 'string' &&
          typeof f.suggestedFix === 'string' &&
          Array.isArray(f.screenshots)
        ) {
          findings.push(f as UiFinding)
        }
        break
      }
      case 'audit.notes': {
        const n = data.notes
        if (typeof n === 'string' && n.trim().length > 0) notes = n
        break
      }
      default:
        // Tolerate cost/usage events and other backend chatter — extractLlmCallEvent
        // in run-loop.ts handles cost accounting upstream from the adapter.
        break
    }
  }

  const out: UiAuditOutput = { lens: lens ?? 'other', findings, captures }
  if (notes) out.notes = notes
  return out
}
