/**
 * Deterministic self-check for the bad-design-audit reviewer mapper —
 * `tsx src/browser/adapters/bad-design-audit.verify.ts`.
 *
 * Proves the `bad design-audit --json` report maps to the neutral UiReviewRun with
 * the DETERMINISTIC floor intact, and that the panel verdict is then driven by that
 * measured floor — not the audit's self-reported healthScore.
 */

import { judgeUiFloor } from '../ui-reviewer'
import { badDesignAuditToReviewRuns, type BadDesignReport } from './bad-design-audit'

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`)
  else {
    failures += 1
    console.log(`  ✗ ${name} ${detail}`)
  }
}

// A bad design-audit --json report shaped exactly like the CLI writes: one clean
// page + one page whose MEASURED floor is blocking, while it self-reports a high
// healthScore (the dishonesty the floor verdict must override).
const report: BadDesignReport = {
  summary: { avgScore: 7, healthScore: 80 },
  pages: [
    {
      route: 'home',
      url: 'https://shop.test/',
      score: 8,
      healthScore: 88,
      findings: [
        { category: 'hierarchy', severity: 'major', title: 'Weak CTA hierarchy', description: 'primary + secondary look identical', recommendation: 'differentiate weight', selector: 'button.cta' },
      ],
      measurements: {
        contrast: { aaFailures: [{}, {}], totalChecked: 100, summary: { aaPassRate: 0.98 } },
        a11y: { violations: [{ id: 'image-alt', impact: 'moderate' }] },
      },
    },
    {
      route: 'checkout',
      url: 'https://shop.test/checkout',
      score: 4,
      healthScore: 95, // self-reports GREAT — but the measured floor is blocking
      findings: [],
      measurements: {
        contrast: { aaFailures: new Array(40).fill({}), totalChecked: 100, summary: { aaPassRate: 0.6 } },
        a11y: {
          violations: [
            { id: 'label', impact: 'critical' },
            { id: 'button-name', impact: 'critical' },
            { id: 'aria-required', impact: 'critical' },
            { id: 'link-name', impact: 'serious' },
            { id: 'color-contrast', impact: 'serious' },
          ],
        },
      },
    },
  ],
}

console.log('bad-design-audit reviewer mapper verify:')

const runs = badDesignAuditToReviewRuns(report)
check('maps one UiReviewRun per page', runs.length === 2, `got ${runs.length}`)
check('carries the deterministic floor (axe + contrast) on each page', runs.every((r) => r.measurements != null))
const home = runs.find((r) => r.route === 'home')!
check('home contrast pass rate mapped', home.measurements?.contrastAaPassRate === 0.98)
check('home finding mapped to a UiFinding (lens=category, severity preserved, selector kept)', home.findings.length === 1 && home.findings[0]?.lens === 'hierarchy' && home.findings[0]?.severity === 'major' && home.findings[0]?.selector === 'button.cta')
check('self-reported healthScore recorded but NOT the verdict', home.selfReportedScore === 88)

const verdict = judgeUiFloor(runs)
check('panel verdict is BLOCKING — the measured checkout floor (3 critical a11y + 40% contrast fail) overrides the 95 self-report', verdict.resolved === false, verdict.detail)
check('blocking score is low', verdict.score < 0.6, verdict.detail)

// A reviewer with NO measurements (e.g. a findings-only audit) contributes no floor.
const noFloor = badDesignAuditToReviewRuns({ pages: [{ route: 'x', findings: [], score: 5 }] } satisfies BadDesignReport)
check('a page without measurements yields no floor (subjective-only run)', noFloor[0]?.measurements === undefined)

if (failures > 0) {
  console.log(`\n❌ ${failures} check(s) failed`)
  process.exit(1)
}
console.log('\n✅ bad-design-audit reviewer verified — floor mapped from --json, verdict driven by the measured floor not the self-report')
