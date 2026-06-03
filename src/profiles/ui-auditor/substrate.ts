/**
 * @experimental
 *
 * UI audit finding substrate types — canonical home in this package for now.
 *
 * These shapes describe data that makes sense WITHOUT a running agent loop
 * (load a saved finding, ship-gate against a set of them, render in a
 * dashboard), so per the CLAUDE.md substrate test they will eventually
 * migrate into `@tangle-network/agent-eval`. They live here for now to
 * keep this PR self-contained; the substrate-promotion PR replaces every
 * `from './substrate'` import in this directory with
 * `from '@tangle-network/agent-eval'` and deletes this file.
 *
 * Promotion checklist (single follow-up PR):
 *   1. Land the agent-eval PR that adds these same types under
 *      `src/ui-finding.ts`.
 *   2. Bump `@tangle-network/agent-eval` to `^0.77.0` in
 *      `package.json` (dev + peer).
 *   3. Replace this file's contents with:
 *        export type {
 *          UiFinding, UiFindingScreenshot, UiFindingSeverity, UiLens,
 *        } from '@tangle-network/agent-eval'
 *        export { UI_FINDING_SEVERITIES, UI_LENSES } from '@tangle-network/agent-eval'
 *   4. Drop this file once consumers import directly from the substrate.
 */

/**
 * Canonical audit lenses. Each lens scopes a finding to a single class of
 * problem so a single audit pass can iterate them without pile-on findings
 * under a generic label.
 */
export type UiLens =
  | 'consistency'
  | 'hierarchy'
  | 'layout'
  | 'ux-flow'
  | 'duplication'
  | 'accessibility'
  | 'responsive'
  | 'states'
  | 'content'
  | 'interaction'
  | 'performance-perceived'
  | 'other'

/** Frozen tuple of lenses for validation + iteration. */
export const UI_LENSES: readonly UiLens[] = [
  'consistency',
  'hierarchy',
  'layout',
  'ux-flow',
  'duplication',
  'accessibility',
  'responsive',
  'states',
  'content',
  'interaction',
  'performance-perceived',
  'other',
] as const

/**
 * Severity scale.
 *   - `critical` — blocks a core task or is an accessibility blocker.
 *   - `high`     — confusing, broken-looking, or noticeable friction.
 *   - `med`      — visible polish issue, would be caught in code review.
 *   - `low`      — nitpick worth fixing eventually.
 */
export type UiFindingSeverity = 'low' | 'med' | 'high' | 'critical'

/** Frozen severity tuple, ordered worst → least bad for sort/report. */
export const UI_FINDING_SEVERITIES: readonly UiFindingSeverity[] = [
  'critical',
  'high',
  'med',
  'low',
] as const

/** Pointer to a screenshot referenced by a finding (workspace-relative path). */
export interface UiFindingScreenshot {
  path: string
  viewport?: string
  label?: string
}

/**
 * A single UI audit finding — the unit of work a contributor can act on.
 *
 * Every field except the documented optionals is required. The auditor
 * validator + writer hard-fail on missing screenshot evidence, missing
 * lens, missing title, etc.
 */
export interface UiFinding {
  /** Monotonic id assigned by the writer when persisting. Optional in-transit. */
  id?: number
  title: string
  lens: UiLens
  severity: UiFindingSeverity
  /** Logical route the finding was observed on (e.g. `home`, `checkout-step-2`). */
  route: string
  /** Fully qualified URL the finding was observed at. */
  url?: string
  /** Viewport string the offending capture was taken at (e.g. `1280x800`). */
  viewport?: string
  /** CSS selector pinning the offending element, when one can be identified. */
  selector?: string
  /** 1–3 sentences describing what the screenshot shows that is wrong. */
  observation: string
  /** Who is affected and how. */
  impact: string
  /** A specific change a contributor could apply without asking back. */
  suggestedFix: string
  /** Optional explicit reproduction steps. Writer synthesizes from route/url/selector when omitted. */
  reproSteps?: string
  /** Free-form tags. */
  tags?: readonly string[]
  /** Screenshot references — must be non-empty for actionable findings. */
  screenshots: readonly UiFindingScreenshot[]
  /** Cross-references to similar findings already on file, by id. */
  similarTo?: readonly number[]
  /** ISO-8601 creation timestamp set by the writer when persisted. */
  createdAt?: string
}
