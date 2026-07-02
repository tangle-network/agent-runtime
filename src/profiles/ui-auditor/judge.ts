/**
 *
 * UI judge seam — consumer-supplied vision LLM hook the in-process
 * auditor client invokes to identify findings from captured screenshots.
 *
 * The seam stays model-agnostic so consumers can plug in OpenAI vision,
 * Anthropic vision, gemini, a local model, or a deterministic stub for
 * tests. The auditor handles browser capture + Markdown emission; the
 * judge owns the perception + judgment.
 *
 * Implementor contract:
 *   - Treat `lens` as authoritative — only emit findings that belong to
 *     that lens. Findings with `lens !== input.lens` will fail the
 *     iteration validator.
 *   - Reference screenshots via the `path` strings provided in
 *     `input.captures`. Inventing a path will cause the validator to
 *     reject the iteration.
 *   - Be conservative — a finding the judge cannot actually see in the
 *     screenshots is a hallucination and pollutes the audit.
 *   - Treat any exception thrown by the judge as the iteration's failure —
 *     do not swallow LLM errors. Per agent-runtime's fail-loud doctrine,
 *     surfacing the error to the kernel beats producing a silent zero.
 *
 * @experimental
 */

import type { UiFinding, UiLens } from './substrate'
import type { UiAuditCapture } from './task'

/** @experimental */
export interface UiJudgeTokenUsage {
  input: number
  output: number
}

/** @experimental */
export interface UiJudgeInput {
  lens: UiLens
  captures: readonly UiAuditCapture[]
  /** Free-form product context the consumer wants the judge to know. */
  productContext?: string
  /** Findings already on file across earlier iterations — for similarTo linkage. */
  knownFindingIds?: readonly number[]
  /** The full prompt the loop kernel synthesized for this iteration. */
  promptText: string
  /** Cooperative cancellation. */
  signal: AbortSignal
}

/** @experimental */
export interface UiJudgeOutput {
  findings: UiFinding[]
  /** Optional triage commentary. */
  notes?: string
  /** Optional usage; folded into the kernel cost ledger when present. */
  tokenUsage?: UiJudgeTokenUsage
  /** Optional total cost in USD. */
  costUsd?: number
}

/** @experimental */
export type UiJudge = (input: UiJudgeInput) => Promise<UiJudgeOutput>
