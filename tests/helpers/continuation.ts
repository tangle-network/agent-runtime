import type {
  ContinuationPolicy,
  ContinuationProfile,
} from '../../src/runtime/supervise/continuation'

/** A plain profile: the verdict first, then what to do, with every heading present. */
export const testContinuationProfile: ContinuationProfile = Object.freeze({
  id: 'test-profile',
  opening: 'The outside check failed: {failed} of {total} items fail. Check reads: {reads}.',
  plan: 'For each failing item: the change, the command that proves it, and its result. Then submit_result.',
  rules: 'report_blocked is the exit when a tool keeps failing.',
  headings: Object.freeze({
    failures: 'Failures',
    protected: 'Passing now; keep them passing',
    changed: 'Changed since the last note',
    findings: 'Findings',
    bar: 'The bar',
    plan: 'Before the next submit',
    rules: 'Rules',
  }),
})

/** A continuation policy with room in every bound: the deadline is far away and the note plain. */
export function testContinuation(over: Partial<ContinuationPolicy> = {}): ContinuationPolicy {
  return {
    deadline: Date.now() + 3_600_000,
    maxBarren: 2,
    profile: testContinuationProfile,
    failures: 'verbatim',
    panel: 'off',
    bar: 'off',
    ...over,
  }
}
