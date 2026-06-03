/**
 * @experimental
 *
 * UI auditor task + output shapes — what one iteration of the audit loop
 * does and what it returns.
 *
 * An iteration is one (lens × route × viewport) audit pass. The driver
 * decides which iterations to plan (lens-cycling, route-cycling,
 * refine-on-low-yield, etc.); the iteration itself captures screenshots
 * and asks a vision judge to identify findings under that lens.
 */

import type { UiFinding, UiLens } from './substrate'

/** @experimental */
export interface UiAuditViewport {
  width: number
  height: number
}

/** @experimental */
export interface UiAuditCaptureRequest {
  /**
   * Logical route name (e.g. `home`, `checkout-step-2`). Used in screenshot
   * filenames and finding metadata.
   */
  route: string
  /** Fully qualified URL the iteration audits. */
  url: string
  /** Default `{ width: 1280, height: 800 }`. */
  viewport?: UiAuditViewport
  /** Default `false`. */
  fullPage?: boolean
  /** CSS selector to wait for before capturing. */
  waitFor?: string
  /** Extra milliseconds to wait after navigation settles. Default `500`. */
  waitMs?: number
  /** Optional CSS selector — capture only the matched element. */
  elementSelector?: string
  /** Optional human-readable label appended to the screenshot filename. */
  label?: string
}

/**
 * One iteration's task: audit a single (lens × route) pair, capturing the
 * surfaces the lens needs.
 *
 * `captures` lists the screenshots to take BEFORE the judge is invoked.
 * The judge sees all captures from this iteration plus the lens-specific
 * brief.
 *
 * @experimental
 */
export interface UiAuditTask {
  /** The audit lens that scopes which findings are valid this iteration. */
  lens: UiLens
  /** Required captures. Order is preserved; index 0 is the primary frame. */
  captures: readonly UiAuditCaptureRequest[]
  /**
   * Free-form context the consumer wants the judge to know about (product
   * name, target audience, copy tone). Surfaced as a prompt prelude.
   */
  productContext?: string
  /**
   * IDs of findings already on file across earlier iterations. The judge
   * uses these to mark cross-references via `similarTo` instead of filing
   * pile-on duplicates.
   */
  knownFindingIds?: readonly number[]
}

/** @experimental */
export interface UiAuditCapture {
  /** Workspace-relative path to the screenshot file. */
  path: string
  viewport: string
  fullPage: boolean
  elementSelector?: string
  label?: string
  route: string
  url: string
  /** Wall-clock when the capture completed. */
  capturedAt: string
}

/**
 * Output of one iteration. `findings` is the headline payload; `captures`
 * is the screenshot manifest the writer needs to link evidence. `notes`
 * carries judge commentary that didn't rise to a finding.
 *
 * @experimental
 */
export interface UiAuditOutput {
  lens: UiLens
  findings: UiFinding[]
  captures: UiAuditCapture[]
  /** Optional judge commentary (debug / triage aid). */
  notes?: string
}
