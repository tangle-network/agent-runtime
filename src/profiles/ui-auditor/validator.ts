/**
 * @experimental
 *
 * Auditor validator — scores a single iteration's findings for actionability
 * and gates the iteration result. The kernel uses `valid` + `score` for
 * winner selection across fanned-out iterations and to detect a degenerate
 * iteration (lens-violating findings, no screenshot evidence, no findings
 * at all on a route where we expected some).
 *
 * Hard fails (`valid = false`):
 *   - A finding is filed under a lens that does not match the iteration's
 *     lens. The whole iteration is bad — the judge isn't following the
 *     lens discipline and the resulting Markdown would mislead reviewers.
 *   - A finding has no screenshot reference.
 *   - A finding's screenshot references a path that wasn't captured in
 *     this iteration.
 *
 * Score (0..1, max two decimals stable):
 *   - 0.4 * specificityRatio    — proportion of findings with a selector
 *   - 0.4 * evidenceRatio       — proportion of findings whose screenshots resolve to captures
 *   - 0.2 * (1 - genericTitleRatio) — proportion of findings whose titles
 *     are concrete (not "improve UX", "fix layout", etc.)
 *
 * An iteration with zero findings scores 0.5 by convention — neither a
 * confident pass nor a hard failure (the judge might just have nothing to
 * say on this lens). The driver decides what to do with it.
 */

import type { DefaultVerdict } from '@tangle-network/agent-eval'
import type { Validator } from '../../runtime/types'
import type { UiAuditOutput, UiAuditTask } from './task'

const GENERIC_TITLE_PATTERNS = [
  /^improve\s/i,
  /^fix\s/i,
  /^update\s/i,
  /^better\s/i,
  /^bad\s/i,
  /^make\s.+\sbetter/i,
  /\bUX\b\s*$/i,
  /\bUI\b\s*$/i,
]

function isGenericTitle(title: string): boolean {
  const t = title.trim()
  if (t.length < 16) return true
  return GENERIC_TITLE_PATTERNS.some((re) => re.test(t))
}

/** @experimental */
export function createUiAuditorValidator(task: UiAuditTask): Validator<UiAuditOutput> {
  return {
    async validate(output) {
      const findings = output.findings
      const captures = output.captures
      const capturePaths = new Set(captures.map((c) => c.path))

      const offLens = findings.filter((f) => f.lens !== task.lens)
      if (offLens.length > 0) {
        const verdict: DefaultVerdict = {
          valid: false,
          score: 0,
          notes: `${offLens.length} finding(s) filed under wrong lens (expected ${task.lens}; got ${offLens.map((f) => f.lens).join(', ')})`,
          scores: { offLens: 0 },
        }
        return verdict
      }

      const missingEvidence = findings.filter(
        (f) => !Array.isArray(f.screenshots) || f.screenshots.length === 0,
      )
      if (missingEvidence.length > 0) {
        const verdict: DefaultVerdict = {
          valid: false,
          score: 0,
          notes: `${missingEvidence.length} finding(s) have no screenshot evidence`,
          scores: { evidence: 0 },
        }
        return verdict
      }

      const unresolvedShot = findings.filter((f) =>
        f.screenshots.some((s) => !capturePaths.has(s.path)),
      )
      if (unresolvedShot.length > 0) {
        const verdict: DefaultVerdict = {
          valid: false,
          score: 0,
          notes: `${unresolvedShot.length} finding(s) reference screenshot paths not captured this iteration`,
          scores: { evidence: 0 },
        }
        return verdict
      }

      if (findings.length === 0) {
        const verdict: DefaultVerdict = {
          valid: true,
          score: 0.5,
          notes: 'No findings reported. Neither a confident pass nor a failure.',
          scores: { specificity: 0, evidence: 1, titles: 1 },
        }
        return verdict
      }

      const withSelector = findings.filter((f) => typeof f.selector === 'string').length
      const specificity = withSelector / findings.length
      const generic = findings.filter((f) => isGenericTitle(f.title)).length
      const titles = 1 - generic / findings.length
      // Compute evidence honestly from the data: proportion of findings whose
      // screenshots are all resolvable against this iteration's captures. The
      // guards above hard-fail when this would be < 1, so today the result is
      // always 1; if a future change relaxes those guards into a soft-fail
      // mode, this still produces a truthful evidence ratio rather than a
      // stale constant inflating the score.
      const withFullEvidence = findings.filter(
        (f) =>
          Array.isArray(f.screenshots) &&
          f.screenshots.length > 0 &&
          f.screenshots.every((s) => capturePaths.has(s.path)),
      ).length
      const evidence = withFullEvidence / findings.length
      const score = Number((0.4 * specificity + 0.4 * evidence + 0.2 * titles).toFixed(4))

      const verdict: DefaultVerdict = {
        valid: true,
        score,
        notes: `${findings.length} finding(s) — specificity=${specificity.toFixed(2)} evidence=${evidence.toFixed(2)} titles=${titles.toFixed(2)}`,
        scores: { specificity, evidence, titles },
      }
      return verdict
    },
  }
}
