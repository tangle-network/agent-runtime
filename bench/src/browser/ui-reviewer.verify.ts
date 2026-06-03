/**
 * Deterministic self-check for the UI-reviewer panel — `tsx src/browser/ui-reviewer.verify.ts`.
 *
 * Defends the same property as the browser harness: the verdict is ATTESTABLE —
 * it comes from the measured deterministic floor (axe + contrast), never a
 * reviewer's subjective findings or self-reported headline score.
 */

import {
  judgeUiFloor,
  runUiReviewerPanel,
  type UiReviewRun,
  type UiReviewerAdapter,
  type UiReviewTarget,
} from './ui-reviewer'

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`)
  else {
    failures += 1
    console.log(`  ✗ ${name} ${detail}`)
  }
}

const clean: UiReviewRun = {
  reviewerId: 'bad',
  route: 'home',
  findings: [],
  measurements: { a11yViolations: [], contrastAaPassRate: 0.99, contrastAaFailures: 1, contrastTotalChecked: 120 },
  selfReportedScore: 92,
}
// A reviewer SCREAMING success (healthScore 100) while the measured floor is blocking.
const liar: UiReviewRun = {
  reviewerId: 'bad',
  route: 'home',
  findings: [],
  selfReportedScore: 100,
  measurements: {
    a11yViolations: [
      { id: 'color-contrast', impact: 'serious' },
      { id: 'aria-required', impact: 'critical' },
      { id: 'label', impact: 'critical' },
      { id: 'button-name', impact: 'critical' },
      { id: 'link-name', impact: 'serious' },
    ],
    contrastAaPassRate: 0.5,
    contrastAaFailures: 60,
    contrastTotalChecked: 120,
  },
}

console.log('ui-reviewer panel verify:')

const okV = judgeUiFloor([clean])
check('clean floor → resolved=true, high score', okV.resolved === true && okV.score > 0.9, okV.detail)

const liarV = judgeUiFloor([liar])
check('self-reported 100 IGNORED — measured floor blocks → resolved=false', liarV.resolved === false, liarV.detail)
check('blocking score is low', liarV.score < 0.6, liarV.detail)

// fail-loud: a purely-subjective panel (no measurements) cannot attest.
let threw = false
try {
  judgeUiFloor([{ reviewerId: 'ui-auditor', route: 'home', findings: [], selfReportedScore: 80 }])
} catch {
  threw = true
}
check('no measured floor → throws (subjective findings are not attestable)', threw)

// panel dedup + consensus across two reviewers flagging the same issue.
const finding = (reviewerId: string) => ({
  reviewerId,
  lens: 'contrast',
  severity: 'major' as const,
  route: 'home',
  title: 'Low contrast on primary CTA',
  observation: 'x',
  selector: 'button.cta',
})
const revA: UiReviewerAdapter = { id: 'bad', async review() { return [{ ...clean, reviewerId: 'bad', findings: [finding('bad')] }] } }
const revB: UiReviewerAdapter = { id: 'ui-auditor', async review() { return [{ reviewerId: 'ui-auditor', route: 'home', findings: [finding('ui-auditor')] }] } }
const target: UiReviewTarget = { url: 'https://example.com' }
const panel = await runUiReviewerPanel(target, [revA, revB])
check('panel dedups the same issue across reviewers to ONE finding', panel.findings.length === 1, `got ${panel.findings.length}`)
check('deduped finding records BOTH reviewers (consensus)', (panel.findings[0]?.flaggedBy ?? []).length === 2, JSON.stringify(panel.findings[0]?.flaggedBy))
check('panel verdict comes from the measured reviewer (bad), resolved=true', panel.verdict.resolved === true, panel.verdict.detail)
check('perReviewer records both reviewers', Object.keys(panel.perReviewer).length === 2)

if (failures > 0) {
  console.log(`\n❌ ${failures} check(s) failed`)
  process.exit(1)
}
console.log('\n✅ UI-reviewer panel verified — verdict is the measured floor, self-report ignored, findings deduped across reviewers')
