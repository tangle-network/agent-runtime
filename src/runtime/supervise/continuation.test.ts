import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../errors'
import {
  admitContinuationPolicy,
  admitFinding,
  type CheckRead,
  CheckUnavailableError,
  type CheckVerdict,
  type ContinuationPolicy,
  type ContinuationProfile,
  checkVerdictOf,
  composeContinuationNote,
  createContinuationKeeper,
  distillFindings,
  expandQuestions,
  failedItems,
  type PanelFinding,
  verdictFromJudgeScore,
} from './continuation'
import type { DriverProgressMark } from './driver-retry'

const testContinuationProfile: ContinuationProfile = {
  id: 'test-profile',
  opening: 'The outside check failed: {failed} of {total} items fail. Check reads: {reads}.',
  plan: 'For each failing item: the change, the command that proves it, and its result. Then submit_result.',
  rules: 'report_blocked is the exit when a tool keeps failing.',
  headings: {
    failures: 'Failures',
    protected: 'Passing now; keep them passing',
    changed: 'Changed since the last note',
    findings: 'Findings',
    bar: 'The bar',
    plan: 'Before the next submit',
    rules: 'Rules',
  },
}

function testContinuation(over: Partial<ContinuationPolicy> = {}): ContinuationPolicy {
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

const progress: DriverProgressMark = {
  poolTokensSpent: 0,
  settledCount: 2,
  submitted: false,
  deliveredCount: 1,
  contract: 'unmet',
}

const failing: CheckVerdict = {
  pass: false,
  items: { parses: 1, 'prime-count': 0, 'sorted-order': 0.5 },
  composite: 0.5,
  threshold: 1,
  failures: [
    'FAIL prime-count primes.txt:1: 19 primes, expected 20',
    'FAIL sorted-order primes.txt:7: 23 before 19',
  ],
  review: 'The file parses but is incomplete.',
}

function finding(over: Partial<PanelFinding> = {}): PanelFinding {
  return {
    question: 'q',
    claim: 'The director claimed 20 primes without running the counter.',
    citations: [
      { uri: 'trace://root/span-1', resolved: true },
      { uri: 'trace://root/span-2', resolved: true },
    ],
    verified: true,
    items: ['prime-count'],
    ...over,
  }
}

describe('the check verdict', () => {
  it('reads a JudgeScore: dimensions are items, FAIL lines are failures, the rest is the review', () => {
    const verdict = verdictFromJudgeScore(
      {
        dimensions: { parses: 1, 'prime-count': 0 },
        composite: 0.5,
        notes: 'FAIL prime-count primes.txt:1: 19 primes\nFull log: /tmp/check.log',
      },
      1,
    )
    expect(verdict).toEqual({
      pass: false,
      items: { parses: 1, 'prime-count': 0 },
      composite: 0.5,
      threshold: 1,
      failures: ['FAIL prime-count primes.txt:1: 19 primes'],
      review: 'Full log: /tmp/check.log',
    })
    expect(failedItems(verdict)).toEqual(['prime-count'])
  })

  it('reads a failed JudgeScore as a check that could not run, never as a zero', () => {
    expect(() =>
      verdictFromJudgeScore(
        { dimensions: {}, composite: 0, notes: 'judge provider refused', failed: true },
        1,
      ),
    ).toThrow(CheckUnavailableError)
  })

  it('fails closed on anything but true or a passing verdict', () => {
    expect(checkVerdictOf(true)).toEqual({ pass: true })
    expect(checkVerdictOf(false)).toEqual({ pass: false })
    expect(checkVerdictOf('yes')).toEqual({ pass: false })
    expect(checkVerdictOf({ pass: 'true' })).toEqual({ pass: false })
    expect(checkVerdictOf({ pass: true, composite: Number.NaN })).toEqual({ pass: true })
  })
})

describe('the continuation note', () => {
  it('writes the verdict, the located failures, the protected items and the plan, in that order', () => {
    const note = composeContinuationNote({
      profile: testContinuationProfile,
      continuation: 1,
      verdict: failing,
      reads: 3,
      failures: 'verbatim',
      progress,
      canReadMore: true,
    })
    expect(note).toBe(
      [
        'The outside check failed: 2 of 3 items fail. Check reads: 3.',
        [
          '## Failures',
          'FAIL prime-count primes.txt:1: 19 primes, expected 20',
          'FAIL sorted-order primes.txt:7: 23 before 19',
        ].join('\n'),
        '## Passing now; keep them passing\nparses',
        '## Before the next submit\nFor each failing item: the change, the command that proves it, and its result. Then submit_result.',
        '## Rules\nreport_blocked is the exit when a tool keeps failing.',
      ].join('\n\n'),
    )
  })

  it('keeps the FAIL lines out when the switch is off', () => {
    const note = composeContinuationNote({
      profile: testContinuationProfile,
      continuation: 1,
      verdict: failing,
      reads: 1,
      failures: 'off',
      progress,
      canReadMore: false,
    })
    expect(note).not.toContain('FAIL')
    expect(note).toContain('2 of 3 items fail')
  })

  it('says what changed since the last note, including a broken protected item', () => {
    const previous: CheckVerdict = {
      pass: false,
      items: { parses: 0, 'prime-count': 0, 'sorted-order': 1 },
      composite: 0.3,
    }
    const note = composeContinuationNote({
      profile: testContinuationProfile,
      continuation: 2,
      verdict: failing,
      previous,
      reads: 2,
      failures: 'verbatim',
      progress,
      canReadMore: false,
    })
    expect(note).toContain(
      '## Changed since the last note\nNow passing: parses.\nNewly failing: sorted-order.\nComposite: 0.3 then 0.5.',
    )
  })

  it('caps the failure lines and points to read_continuation for the rest', () => {
    const many: CheckVerdict = {
      pass: false,
      failures: Array.from({ length: 45 }, (_, index) => `FAIL item-${index} here: wrong`),
    }
    const note = composeContinuationNote({
      profile: testContinuationProfile,
      continuation: 4,
      verdict: many,
      reads: 1,
      failures: 'verbatim',
      progress,
      canReadMore: true,
    })
    expect(note).toContain('FAIL item-39 here: wrong')
    expect(note).not.toContain('FAIL item-40 here: wrong')
    expect(note).toContain('5 more failure lines: call read_continuation with continuation 4.')
  })

  it('states the facts when no result reached the check, or the state already passes', () => {
    const none = composeContinuationNote({
      profile: testContinuationProfile,
      continuation: 1,
      reads: 0,
      failures: 'verbatim',
      progress,
      canReadMore: false,
    })
    expect(none.split('\n')[0]).toBe(
      'No result has reached the check yet. The run ends only when a result passes it through submit_result.',
    )
    const passing = composeContinuationNote({
      profile: testContinuationProfile,
      continuation: 1,
      verdict: { pass: true },
      reads: 1,
      failures: 'verbatim',
      progress,
      canReadMore: false,
    })
    expect(passing).toContain('The check passes on the current state')
  })

  it('writes the bar item by item against the best version, with the reference and the review', () => {
    const note = composeContinuationNote({
      profile: { ...testContinuationProfile, barRule: 'Answer each item with a fix or evidence.' },
      continuation: 1,
      verdict: failing,
      reads: 1,
      failures: 'off',
      bar: {
        best: {
          label: 'v2',
          verdict: {
            pass: false,
            items: { parses: 1, 'prime-count': 1, 'sorted-order': 0 },
            composite: 0.66,
          },
        },
        reference: 'The first 20 primes, sorted, one per line.',
      },
      progress,
      canReadMore: false,
    })
    expect(note).toContain(
      [
        '## The bar',
        'Answer each item with a fix or evidence.',
        '- parses: passes / v2: passes',
        '- prime-count: fails (0) / v2: passes',
        '- sorted-order: fails (0.5) / v2: fails (0)',
        'Best version v2: composite 0.66.',
        'Reference result: The first 20 primes, sorted, one per line.',
        "The check's review: The file parses but is incomplete.",
      ].join('\n'),
    )
  })

  it('labels every finding a hypothesis and lists its evidence; appended sections come last', () => {
    const note = composeContinuationNote({
      profile: testContinuationProfile,
      continuation: 1,
      verdict: failing,
      reads: 1,
      failures: 'off',
      findings: [{ ...finding(), admittedAt: 1 }],
      appended: [{ heading: 'Reflector', text: 'Try the sieve.' }],
      progress,
      canReadMore: false,
    })
    expect(note).toContain(
      '## Findings\n- [hypothesis] The director claimed 20 primes without running the counter. (items: prime-count) Evidence: trace://root/span-1, trace://root/span-2',
    )
    expect(note.endsWith('## Reflector\nTry the sieve.')).toBe(true)
  })
})

describe('the question panel', () => {
  it('admits a finding only when every citation resolves, two spans are cited, and the verifier agreed', () => {
    expect(admitFinding(finding())).toBe(true)
    expect(admitFinding(finding({ verified: false }))).toBe(false)
    expect(
      admitFinding(
        finding({
          citations: [
            { uri: 'trace://root/span-1', resolved: true },
            { uri: 'trace://root/span-9', resolved: false },
          ],
        }),
      ),
    ).toBe(false)
    expect(
      admitFinding(
        finding({
          citations: [
            { uri: 'trace://root/span-1', resolved: true },
            { uri: 'trace://root/span-1', resolved: true },
          ],
        }),
      ),
    ).toBe(false)
  })

  it('adds new findings ranked by failed items, drops repeats, and marks resolved ones', () => {
    const first = distillFindings(
      [],
      [
        finding({ claim: 'Unlinked.', items: [] }),
        finding({ claim: 'Linked to the count.', items: ['prime-count'] }),
      ],
      new Set(['prime-count']),
      1,
    )
    expect(first.map((f) => f.claim)).toEqual(['Linked to the count.', 'Unlinked.'])
    const second = distillFindings(
      first,
      [finding({ claim: '  linked to the COUNT. ', items: ['prime-count'] })],
      new Set(['sorted-order']),
      2,
    )
    // The repeat is dropped; the count item passes now, so its finding is resolved in place.
    expect(second).toHaveLength(2)
    expect(second[0]).toMatchObject({ claim: 'Linked to the count.', resolvedAt: 2, admittedAt: 1 })
  })

  it('expands templates over failed items and settled workers', () => {
    expect(
      expandQuestions(
        [
          'What did the director claim?',
          'Which spans produced {item}?',
          'Did {worker} contradict the director?',
        ],
        ['a', 'b'],
        [{ id: 'w1', label: 'prover' }],
      ),
    ).toEqual([
      'What did the director claim?',
      'Which spans produced a?',
      'Which spans produced b?',
      'Did w1 (prover) contradict the director?',
    ])
  })
})

describe('the continuation policy', () => {
  it('refuses a profile template naming a fact Runtime does not supply', () => {
    expect(() =>
      admitContinuationPolicy(
        testContinuation({
          profile: { ...testContinuationProfile, opening: 'You scored {grade}.' },
        }),
        'test',
      ),
    ).toThrow(/names \{grade\}, which is not a fact Runtime supplies/u)
  })

  it('refuses a panel without dollar caps', () => {
    expect(() =>
      admitContinuationPolicy(
        testContinuation({ panel: 'on', runPanel: async () => ({ findings: [], usd: 0 }) }),
        'test',
      ),
    ).toThrow(ValidationError)
  })
})

describe('one manager continuation keeper', () => {
  function reads(verdicts: ReadonlyArray<CheckVerdict>): CheckRead[] {
    return verdicts.map((verdict, index) => ({
      read: index + 1,
      attempt: index + 1,
      at: index,
      source: 'submit',
      verdict,
    }))
  }

  it('runs the panel under its caps, records every note, and writes the files the director reads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'continuation-keeper-'))
    try {
      const log: CheckRead[] = reads([failing])
      const asked: string[][] = []
      const keeper = createContinuationKeeper({
        policy: testContinuation({
          panel: 'on',
          bar: 'off',
          panelUsd: { perContinuation: 0.5, perRun: 0.8 },
          profile: { ...testContinuationProfile, questions: ['Which spans produced {item}?'] },
          runPanel: async (input) => {
            asked.push([...input.questions])
            expect(input.usdCap).toBeCloseTo(asked.length === 1 ? 0.5 : 0.3)
            return {
              findings: [
                finding({ claim: `Finding ${asked.length}.` }),
                finding({ verified: false, claim: 'Unverified.' }),
              ],
              usd: 0.5,
            }
          },
        }),
        task: 'write primes.txt',
        reads: () => log,
        workers: () => [],
        dir,
        canReadMore: true,
      })
      const context = {
        attempt: 1,
        continuations: 0,
        progress,
        budget: {} as never,
        barrenReentries: 0,
        signal: new AbortController().signal,
      }
      const note1 = await keeper.compose(context)
      expect(asked[0]).toEqual([
        'Which spans produced prime-count?',
        'Which spans produced sorted-order?',
      ])
      expect(note1).toContain('[hypothesis] Finding 1.')
      expect(note1).not.toContain('Unverified.')
      log.push(
        ...reads([
          { ...failing, composite: 0.75, items: { ...failing.items, 'sorted-order': 1 } },
        ]).map((r) => ({ ...r, read: 2 })),
      )
      await keeper.compose({ ...context, attempt: 2, continuations: 1 })
      // The run's panel dollars are spent after two calls; a third note runs no panel.
      await keeper.compose({ ...context, attempt: 3, continuations: 2 })
      expect(asked).toHaveLength(2)
      const entries = keeper.entries()
      expect(
        entries.map((e) => [e.continuation, e.before?.composite, e.after?.composite ?? null]),
      ).toEqual([
        [1, 0.5, 0.75],
        [2, 0.75, null],
        [3, 0.75, null],
      ])
      expect(entries.map((e) => e.panel)).toEqual([
        { asked: 2, proposed: 2, admitted: 1, usd: 0.5 },
        { asked: 1, proposed: 2, admitted: 1, usd: 0.5 },
        { asked: 0, proposed: 0, admitted: 0, usd: 0 },
      ])
      expect(await readFile(join(dir, '1', 'note.md'), 'utf8')).toBe(`${note1}\n`)
      expect(JSON.parse(await readFile(join(dir, '1', 'verdict.json'), 'utf8'))).toEqual(failing)
      expect(await readFile(join(dir, '1', 'panel.jsonl'), 'utf8')).toContain('"admitted":false')
      expect(keeper.read(1)).toMatchObject({ found: true, continuation: 1, note: note1 })
      expect(keeper.read(9)).toMatchObject({ found: false })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps the FAIL lines out of the note and of read_continuation under pass-only feedback', async () => {
    const keeper = createContinuationKeeper({
      policy: testContinuation(),
      task: 'hidden tests',
      feedback: 'pass-only',
      reads: () => reads([failing]),
      workers: () => [],
      canReadMore: true,
    })
    const note = await keeper.compose({
      attempt: 1,
      continuations: 0,
      progress,
      budget: {} as never,
      barrenReentries: 0,
      signal: new AbortController().signal,
    })
    expect(note).not.toContain('FAIL')
    expect(JSON.stringify(keeper.read(undefined))).not.toContain('FAIL')
    expect(keeper.entries()[0]?.switches.failures).toBe('off')
  })
})
