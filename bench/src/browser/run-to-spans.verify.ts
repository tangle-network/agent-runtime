/**
 * Deterministic self-check for browserRunToSpans —
 * `tsx src/browser/run-to-spans.verify.ts`.
 *
 * Proves the run-capsule film contract: each BrowserStep becomes a kind:'tool'
 * `browser.<action>` span; a step's screenshotPath is READ and inlined as a
 * base64 `data:` URI on attributes.screenshot (NEVER passed through as a raw
 * path — the regression that renders an empty film); a missing screenshot drops
 * the image but keeps the step's span.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserRun } from './agent-adapter'
import { browserRunToSpans } from './run-to-spans'

let failures = 0
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✓ ${name}`)
  else {
    failures += 1
    console.log(`  ✗ ${name} ${detail}`)
  }
}

const dir = mkdtempSync(join(tmpdir(), 'run-to-spans-'))
// A 1x1 PNG on disk — the magic bytes make imageMime resolve to image/png.
const pngBytes = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f7d0000000049454e44ae426082',
  'hex',
)
const shotPath = join(dir, 'step-1.png')
writeFileSync(shotPath, pngBytes)

const run: BrowserRun = {
  taskId: 'usps-track',
  driverId: 'bad',
  steps: [
    { index: 1, url: 'https://tools.usps.com/', action: 'navigate', target: 'tracking input', screenshotPath: shotPath },
    { index: 2, url: 'https://tools.usps.com/go/TrackConfirmAction', action: 'click', target: 'Track button', actionBounds: { x: 10, y: 20, width: 80, height: 30 } },
  ],
  finalUrl: 'https://tools.usps.com/go/TrackConfirmAction',
  answer: 'Delivered',
  selfReportedSuccess: true,
}

console.log('browserRunToSpans verify:')

const spans = await browserRunToSpans(run, { startTs: 1000 })

check('one tool span per step + a trailing answer span', spans.length === 3, `got ${spans.length}`)
const s1 = spans[0]
const s2 = spans[1]
const answer = spans[2]
check('step 1 is a kind:tool browser.navigate span', s1?.kind === 'tool' && (s1 as { toolName?: string }).toolName === 'browser.navigate')
check('step 1 args carry the url + target', (s1 as { args?: { url?: string; target?: string } }).args?.url === 'https://tools.usps.com/' && (s1 as { args?: { target?: string } }).args?.target === 'tracking input')

const shot = (s1?.attributes?.screenshot ?? '') as string
check('screenshotPath was READ + inlined as a base64 data URI (not a path)', shot.startsWith('data:image/png;base64,') && shot.length > 60, shot.slice(0, 40))
check('the raw on-disk path is NEVER present in the span', !JSON.stringify(s1).includes(shotPath))

check('step 2 has no screenshot (none provided) but still emits a span', s2?.kind === 'tool' && s2?.attributes?.screenshot === undefined)
check('step 2 carries the actionBounds overlay', JSON.stringify(s2?.attributes?.actionBounds) === JSON.stringify({ x: 10, y: 20, width: 80, height: 30 }))

check('the answer span closes the film', answer?.kind === 'custom' && answer?.name === 'final answer' && (answer?.attributes as { answer?: string })?.answer === 'Delivered')
check('timestamps are monotonic from startTs', (s1?.startedAt ?? 0) >= 1000 && (answer?.startedAt ?? 0) > (s1?.startedAt ?? 0))

// A run whose only screenshot path is unreadable: span stays, image drops (fail-soft).
const ghost = await browserRunToSpans({
  taskId: 't', driverId: 'bad', finalUrl: '', steps: [{ index: 1, url: 'about:blank', action: 'navigate', screenshotPath: '/no/such/frame.png' }],
})
check('unreadable screenshot drops the image but keeps the step span', ghost.length === 1 && ghost[0]?.attributes?.screenshot === undefined)

rmSync(dir, { recursive: true, force: true })

if (failures > 0) {
  console.log(`\n❌ ${failures} check(s) failed`)
  process.exit(1)
}
console.log('\n✅ browserRunToSpans verified — steps → tool spans, screenshots inlined as base64, no raw paths')
