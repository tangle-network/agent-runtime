/**
 * Typed-findings accessor — the one place `unknown[]` findings become
 * `AnalystFinding[]`.
 *
 * agent-eval's `ProposeContext.findings` is `TFindings[] = unknown[]` on the
 * wire: the loop threads whatever the previous `analyzeGeneration` producer (or
 * the caller's static seed) returned. Consumers that need the typed envelope
 * (`claim`/`severity`/`recommended_action`) were down-casting with a bare
 * `as AnalystFinding[]` — a lie at runtime whenever the seed was a raw string
 * or an ad-hoc digest, which then rendered `undefined` into build prompts.
 *
 * `toAnalystFindings` replaces that cast: real findings pass through
 * unchanged (structural guard, fail-closed), and non-conforming values are
 * LIFTED into a real `AnalystFinding` envelope via `makeFinding` — the most
 * actionable text becomes the claim, the original value rides in `metadata.raw`
 * — so everything downstream of the accessor handles exactly one shape.
 */

import { type AnalystFinding, makeFinding } from '@tangle-network/agent-eval'

const SEVERITIES: ReadonlySet<string> = new Set(['critical', 'high', 'medium', 'low', 'info'])

/** Analyst id stamped on findings lifted from untyped seed values. */
export const LIFTED_FINDING_ANALYST_ID = 'lifted-seed'

/** Structural guard for the schema-versioned `AnalystFinding` envelope.
 *  Strict on the identity fields `makeFinding` always populates — a partial
 *  look-alike is lifted (re-enveloped), not trusted. */
export function isAnalystFinding(value: unknown): value is AnalystFinding {
  if (!value || typeof value !== 'object') return false
  const o = value as Record<string, unknown>
  return (
    o.schema_version === '1.0.0' &&
    typeof o.finding_id === 'string' &&
    typeof o.analyst_id === 'string' &&
    typeof o.severity === 'string' &&
    SEVERITIES.has(o.severity) &&
    typeof o.area === 'string' &&
    typeof o.claim === 'string' &&
    typeof o.confidence === 'number' &&
    Array.isArray(o.evidence_refs)
  )
}

/** The most actionable text of an untyped finding-ish value — mirrors the
 *  extraction order agent-eval's curator proposers use (`recommended_action` >
 *  `claim` > `lesson` > `notes` > `text` > `message`), so the two ends of the
 *  wire read the same field first. */
function liftedClaim(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    for (const key of ['recommended_action', 'claim', 'lesson', 'notes', 'text', 'message']) {
      const v = o[key]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    try {
      const json = JSON.stringify(value)
      if (json && json !== '{}' && json !== '[]') {
        return json.length > 400 ? `${json.slice(0, 399)}…` : json
      }
    } catch {
      /* circular / non-serializable → drop below */
    }
  }
  return null
}

export interface ToAnalystFindingsOptions {
  /** `analyst_id` stamped on lifted (non-conforming) values.
   *  Default {@link LIFTED_FINDING_ANALYST_ID}. */
  analystId?: string
  /** `area` stamped on lifted values. Default `'seed'`. */
  area?: string
}

/**
 * Normalize a mixed `unknown[]` findings array to `AnalystFinding[]`:
 * conforming findings pass through by reference; strings and finding-ish
 * objects are lifted into envelopes (claim = most actionable text, original
 * value under `metadata.raw`); values with no extractable text are dropped.
 * Never throws — a malformed seed must not kill a proposal round.
 */
export function toAnalystFindings(
  findings: readonly unknown[],
  opts: ToAnalystFindingsOptions = {},
): AnalystFinding[] {
  const analystId = opts.analystId ?? LIFTED_FINDING_ANALYST_ID
  const area = opts.area ?? 'seed'
  const out: AnalystFinding[] = []
  for (const f of findings) {
    if (isAnalystFinding(f)) {
      out.push(f)
      continue
    }
    const claim = liftedClaim(f)
    if (!claim) continue
    out.push(
      makeFinding({
        analyst_id: analystId,
        severity: 'info',
        area,
        confidence: 0.5,
        claim,
        evidence_refs: [],
        ...(f && typeof f === 'object' ? { metadata: { raw: f } } : {}),
      }),
    )
  }
  return out
}
