import { describe, expect, it } from 'vitest'
import {
  closingWorkerNote,
  composeWorkerEvidence,
  EVIDENCE_MAX_CHARS,
  NOTE_MAX_CHARS,
  settledWorkerOut,
  VERIFY_TAIL_CHARS,
} from '../src/runtime/supervise/worker-evidence'

const failingAssertion =
  'AssertionError: expected calculate(2, 2) to equal 5 — got 4 (tests/calc.test.ts:12)'

function fakePatch(lines: number): string {
  const body = Array.from(
    { length: lines },
    (_, i) => `+  const line${i} = ${i} // PATCH_LINE_${i}`,
  )
  return [
    'diff --git a/src/calc.ts b/src/calc.ts',
    '--- a/src/calc.ts',
    '+++ b/src/calc.ts',
    '@@ -1,1 +1,100 @@',
    ...body,
  ].join('\n')
}

describe('composeWorkerEvidence', () => {
  it('is bounded and keeps the failing verify tail (the assertion at the END of the log)', () => {
    const evidence = composeWorkerEvidence({
      passed: false,
      testPassed: false,
      typecheckPassed: true,
      testOutput: `${'noise '.repeat(1000)}\n${failingAssertion}`,
      typecheckOutput: '',
      patch: fakePatch(100),
    })
    expect(evidence.length).toBeLessThanOrEqual(EVIDENCE_MAX_CHARS)
    expect(evidence).toContain('verify FAILED (tests failed)')
    // The assertion lives at the end of the log; the tail must preserve it.
    expect(evidence).toContain(failingAssertion)
    expect(evidence).toContain('diff --git a/src/calc.ts')
    expect(evidence).toContain('1 file(s) changed')
    // First 40 patch lines only — the 90th body line must be truncated away.
    expect(evidence).not.toContain('PATCH_LINE_90')
  })

  it('stays under the cap even when every input is oversized', () => {
    const evidence = composeWorkerEvidence({
      passed: false,
      testPassed: false,
      typecheckPassed: false,
      testOutput: 'v'.repeat(20_000),
      typecheckOutput: 't'.repeat(20_000),
      patch: Array.from({ length: 300 }, () => 'x'.repeat(500)).join('\n'),
      reviewerNotes: 'n'.repeat(20_000),
    })
    expect(evidence.length).toBeLessThanOrEqual(EVIDENCE_MAX_CHARS)
    // Verify tail is capped, and the highest-priority section survives the cap.
    expect(evidence).toContain('verify FAILED (tests failed, typecheck failed)')
    expect(evidence).toContain('v'.repeat(VERIFY_TAIL_CHARS))
  })

  it('labels an empty patch and surfaces the worker note', () => {
    const evidence = composeWorkerEvidence({
      passed: false,
      testPassed: false,
      typecheckPassed: true,
      testOutput: failingAssertion,
      typecheckOutput: '',
      patch: '   \n',
      reviewerNotes: 'I could not reproduce the failure locally.',
    })
    expect(evidence).toContain('diff: EMPTY')
    expect(evidence).toContain('--- worker note ---')
    expect(evidence).toContain('I could not reproduce the failure locally.')
  })

  it('reports a passing verify without inventing a failure section', () => {
    const evidence = composeWorkerEvidence({
      passed: true,
      testPassed: true,
      typecheckPassed: true,
      testOutput: 'all 12 tests passed',
      typecheckOutput: '',
      patch: fakePatch(3),
    })
    expect(evidence).toContain('verify PASSED')
    expect(evidence).not.toContain('verify FAILED')
  })
})

describe('settledWorkerOut', () => {
  const review =
    'verify PASSED\n--- diff: EMPTY (the worker produced no edits) ---\n--- worker note ---\nREVIEW: placement correct'

  it('a passing worker with edits exposes its patch (the deliverable)', () => {
    expect(settledWorkerOut({ passed: true, patch: fakePatch(3), evidence: 'verify PASSED' })).toBe(
      fakePatch(3),
    )
  })

  it('a failing worker exposes its evidence block, never the raw patch', () => {
    expect(
      settledWorkerOut({ passed: false, patch: fakePatch(3), evidence: 'verify FAILED' }),
    ).toBe('verify FAILED')
  })

  it('a passing NO-EDIT worker (post-delivery reviewer) exposes its evidence, not an empty patch', () => {
    expect(settledWorkerOut({ passed: true, patch: '   \n', evidence: review })).toBe(review)
  })

  it('falls back to the patch when there is no evidence at all', () => {
    expect(settledWorkerOut({ passed: true, patch: '', evidence: '' })).toBe('')
    expect(settledWorkerOut({ passed: false, patch: fakePatch(1), evidence: '' })).toBe(
      fakePatch(1),
    )
  })
})

describe('closingWorkerNote', () => {
  it('keeps the TAIL of stdout so a closing verdict line survives', () => {
    const note = closingWorkerNote(
      `${'noise '.repeat(200)}\nREVIEW: misplaced — utils.idna_encode belongs in utils/encoding.py`,
      '',
    )
    expect(note).toBeDefined()
    expect(note).toContain('REVIEW: misplaced')
    expect(note!.length).toBeLessThanOrEqual(NOTE_MAX_CHARS)
  })

  it('falls back to stderr when stdout is blank, and to undefined when both are', () => {
    expect(closingWorkerNote('  \n', 'harness crashed: exit 2')).toBe('harness crashed: exit 2')
    expect(closingWorkerNote('', '   ')).toBeUndefined()
  })
})
