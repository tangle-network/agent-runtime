/**
 * Deterministic self-check for the driver-agnostic browser harness — run with
 * `tsx src/browser/verify.ts` (bench convention: a verify script, not a live run).
 *
 * The regression it defends: the verdict is ATTESTABLE — derived from the run's
 * final observable state, NEVER the driver's self-reported success. A driver can
 * claim success=true; if the deterministic criteria fail, resolved MUST be false.
 */

import { judgeBrowserRun, type BrowserTask } from './agent-adapter'
import { badReportToRun } from './adapters/bad'

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failures += 1
    console.log(`  ✗ ${name} ${detail}`)
  }
}

// A bad report.json shaped exactly like the real one, with the OpenSCAD page reached.
const successReport = {
  results: [
    {
      testCase: { id: 'wiki-openscad' },
      agentResult: {
        success: true,
        result: "The 'OpenSCAD' article is open on Wikipedia.",
        turns: [
          { turn: 1, state: { url: 'https://en.wikipedia.org/wiki/Main_Page', snapshot: 'search box' }, action: { action: 'type', text: 'OpenSCAD' } },
          { turn: 2, state: { url: 'https://en.wikipedia.org/wiki/Main_Page' }, action: { action: 'click', selector: '@result' } },
          { turn: 3, state: { url: 'https://en.wikipedia.org/wiki/OpenSCAD', snapshot: 'OpenSCAD - Wikipedia. Constructive Solid Geometry modeller.' }, action: { action: 'complete' } },
        ],
      },
    },
  ],
}

// The SAME driver claiming success, but the browser never left Main_Page.
const liarReport = {
  results: [
    {
      testCase: { id: 'wiki-openscad' },
      agentResult: {
        success: true, // self-reported — must be IGNORED
        result: 'Done!',
        turns: [{ turn: 1, state: { url: 'https://en.wikipedia.org/wiki/Main_Page', snapshot: 'main page' }, action: { action: 'complete' } }],
      },
    },
  ],
}

const task: BrowserTask = {
  id: 'wiki-openscad',
  goal: 'Open the OpenSCAD article',
  startUrl: 'https://en.wikipedia.org',
  success: [{ type: 'url-contains', value: 'OpenSCAD' }],
}

console.log('browser harness verify:')

const okRun = badReportToRun(successReport, 'wiki-openscad')
check('mapper extracts final url from last turn', okRun.finalUrl === 'https://en.wikipedia.org/wiki/OpenSCAD', okRun.finalUrl)
check('mapper records all steps', okRun.steps.length === 3)
check('mapper carries selfReportedSuccess', okRun.selfReportedSuccess === true)
const okV = judgeBrowserRun(task, okRun)
check('genuine success attests resolved=true score=1', okV.resolved === true && okV.score === 1, okV.detail)

const liarRun = badReportToRun(liarReport, 'wiki-openscad')
const liarV = judgeBrowserRun(task, liarRun)
check('SELF-REPORTED success is IGNORED — failed criteria → resolved=false', liarV.resolved === false && liarV.score === 0, liarV.detail)

// Partial credit + dom check: 2 criteria, only url passes (snapshot lacks the phrase).
const twoCrit: BrowserTask = {
  ...task,
  success: [{ type: 'url-contains', value: 'OpenSCAD' }, { type: 'dom-contains', value: 'Marching Cubes' }],
}
const partialV = judgeBrowserRun(twoCrit, okRun)
check('partial credit: 1 of 2 criteria → score=0.5 resolved=false', partialV.score === 0.5 && partialV.resolved === false, partialV.detail)

// Fail loud: no criteria is a harness error, not a silent pass.
let threw = false
try {
  judgeBrowserRun({ ...task, success: [] }, okRun)
} catch {
  threw = true
}
check('empty success spec throws (fail-loud, never silent-attest)', threw)

if (failures > 0) {
  console.log(`\n❌ ${failures} check(s) failed`)
  process.exit(1)
}
console.log('\n✅ browser harness verified — verdict is attestable, self-report ignored')
