/**
 * Unit tests for the round-4 outer loop's pure protocol logic: the declared
 * change-space enforcement, porcelain path parsing, the keep-if-better verdict
 * (protocol_v2), the staircase row schema, and the frozen-arm assertion.
 * Pure — no arms, no docker, no tokens.
 */

import { describe, expect, it } from 'vitest'
import {
  FROZEN_ARM,
  LOOPS_CHANGE_SPACE,
  RAW_TRACE_DIAGNOSIS_PATH,
  STAIRCASE_SCHEMA,
  assertFrozenArm,
  changeSpaceInstruction,
  changeSpaceViolations,
  decideVerdict,
  defaultRound4Config,
  normalizeRepoPath,
  parseStaircaseRow,
  porcelainChangedPaths,
  round4BuildPrompt,
  type StaircaseRow,
} from './outer-loop.mts'

describe('changeSpaceViolations', () => {
  it('accepts the declared change-space, including nested extension paths', () => {
    expect(
      changeSpaceViolations([
        'extensions/pi/loops.ts',
        'extensions/pi/prompts/worker-coding-system.md',
        'extensions/pi/deep/new-module.ts',
        'src/worker-evidence.ts',
        'src/best-effort.ts',
        'src/worker-clone.ts',
        RAW_TRACE_DIAGNOSIS_PATH,
        './src/worker-clone.ts',
      ]),
    ).toEqual([])
  })

  it('rejects everything outside the declared space', () => {
    expect(
      changeSpaceViolations([
        'src/runner.ts',
        'src/strategy-loop.ts',
        'package.json',
        'extensions/other/loops.ts',
        'tests/top-model.test.ts',
        'src/worker-evidence.ts.bak',
      ]),
    ).toEqual([
      'src/runner.ts',
      'src/strategy-loop.ts',
      'package.json',
      'extensions/other/loops.ts',
      'tests/top-model.test.ts',
      'src/worker-evidence.ts.bak',
    ])
  })

  it('is not fooled by prefix-sharing directories (extensions/pi2 is out)', () => {
    expect(changeSpaceViolations(['extensions/pi2/loops.ts'])).toEqual(['extensions/pi2/loops.ts'])
  })

  it('fails closed on traversal, absolute, and empty paths', () => {
    expect(changeSpaceViolations(['extensions/pi/../../package.json'])).toEqual([
      'extensions/pi/../../package.json',
    ])
    expect(changeSpaceViolations(['/etc/passwd'])).toEqual(['/etc/passwd'])
    expect(changeSpaceViolations([''])).toEqual([''])
  })

  it('normalizes quoted and backslashed paths before matching', () => {
    expect(normalizeRepoPath('"extensions/pi/a b.ts"')).toBe('extensions/pi/a b.ts')
    expect(normalizeRepoPath('extensions\\pi\\loops.ts')).toBe('extensions/pi/loops.ts')
    expect(normalizeRepoPath('../outside.ts')).toBeNull()
    expect(changeSpaceViolations(['"extensions/pi/a b.ts"'])).toEqual([])
  })
})

describe('porcelainChangedPaths', () => {
  it('parses modified, untracked, and rename entries (both rename sides)', () => {
    const stdout = [
      ' M extensions/pi/loops.ts',
      '?? .improve/raw-trace-diagnosis.md',
      'R  src/worker-clone.ts -> src/worker-clone-2.ts',
      'A  src/best-effort.ts',
      '',
    ].join('\n')
    expect(porcelainChangedPaths(stdout)).toEqual([
      'extensions/pi/loops.ts',
      '.improve/raw-trace-diagnosis.md',
      'src/worker-clone.ts',
      'src/worker-clone-2.ts',
      'src/best-effort.ts',
    ])
  })

  it('a rename OUT of the change-space is caught end-to-end', () => {
    const paths = porcelainChangedPaths('R  src/worker-clone.ts -> src/worker-clone-moved.ts\n')
    expect(changeSpaceViolations(paths)).toEqual(['src/worker-clone-moved.ts'])
  })
})

describe('decideVerdict (protocol_v2 keep-if-better)', () => {
  const base = {
    violations: [] as string[],
    coverageComplete: true,
    resolvedCount: 2,
    parentResolvedCount: 1,
    costRatio: 1.0,
    costGuardRatio: 1.2,
  }
  it('accepts a gaining, in-space, in-budget candidate', () => {
    expect(decideVerdict(base)).toBe('accepted')
  })
  it('rejects out-of-space before anything else', () => {
    expect(decideVerdict({ ...base, violations: ['package.json'] })).toBe('rejected-out-of-space')
  })
  it('rejects incomplete coverage (an errored cell can never promote)', () => {
    expect(decideVerdict({ ...base, coverageComplete: false })).toBe('rejected-incomplete')
  })
  it('requires a STRICT improvement-set gain (tie = reject)', () => {
    expect(decideVerdict({ ...base, resolvedCount: 1 })).toBe('rejected-no-gain')
    expect(decideVerdict({ ...base, resolvedCount: 0 })).toBe('rejected-no-gain')
  })
  it('rejects on the +20% cost guard and on unprovable cost', () => {
    expect(decideVerdict({ ...base, costRatio: 1.21 })).toBe('rejected-cost')
    expect(decideVerdict({ ...base, costRatio: null })).toBe('rejected-cost')
    expect(decideVerdict({ ...base, costRatio: 1.2 })).toBe('accepted')
  })
})

describe('staircase row schema', () => {
  const row: StaircaseRow = {
    schema: STAIRCASE_SCHEMA,
    round: 4,
    generation: 0,
    runId: 'r4-abc123',
    at: '2026-07-15T00:00:00.000Z',
    candidate: 'sha256:cand',
    candidateCommit: 'deadbeef00',
    parent: 'sha256:parent',
    parentResolvedCount: 1,
    label: 'placement-aware settle',
    rationale: 'diagnosis: fix placement mismatch (3/3 analysts)',
    changedFiles: ['extensions/pi/loops.ts'],
    changeSpaceViolations: [],
    perInstance: [
      {
        iid: 'django__django-11532',
        resolved: true,
        verify_pass: true,
        patch_lines: 47,
        wall_s: 900,
        spentTokens: 54623,
        recoveredTokens: 61000,
        judgeAttempts: 1,
      },
    ],
    resolvedCount: 2,
    coverageComplete: true,
    wallS: 2700,
    baselineWallS: 2500,
    costRatio: 1.08,
    costGuardRatio: 1.2,
    internallyPromoted: true,
    verdict: 'accepted',
    holdout: 'operator-approval-required',
    armProvenance: { repo: '/tmp/eval-wt', commit: 'deadbeef00' },
    diffPath: '/tmp/out/candidates/deadbeef00.patch',
    diffSha256: 'sha256:aaaa',
  }

  it('round-trips through JSONL', () => {
    const parsed = parseStaircaseRow(JSON.stringify(row))
    expect(parsed).toEqual(row)
  })

  it('rejects schema drift, bad verdicts, and missing fields', () => {
    expect(() => parseStaircaseRow(JSON.stringify({ ...row, schema: 'v0' }))).toThrow(/unknown schema/)
    expect(() => parseStaircaseRow(JSON.stringify({ ...row, verdict: 'kept' }))).toThrow(/unknown verdict/)
    expect(() => parseStaircaseRow(JSON.stringify({ ...row, resolvedCount: '2' }))).toThrow(/must be a number/)
    expect(() => parseStaircaseRow(JSON.stringify({ ...row, runId: '' }))).toThrow(/runId/)
    expect(() => parseStaircaseRow(JSON.stringify({ ...row, perInstance: 'x' }))).toThrow(/perInstance/)
    expect(() => parseStaircaseRow(JSON.stringify({ ...row, costRatio: 'high' }))).toThrow(/costRatio/)
    expect(() => parseStaircaseRow(JSON.stringify({ ...row, internallyPromoted: 'yes' }))).toThrow(/booleans/)
  })

  it('accepts a null-cost rejected dot (telemetry gap is data, not a zero)', () => {
    const dot = { ...row, costRatio: null, verdict: 'rejected-cost' as const, internallyPromoted: false }
    expect(parseStaircaseRow(JSON.stringify(dot)).costRatio).toBeNull()
  })
})

describe('frozen arm + default config', () => {
  it('passes on the round-3 frozen arm and the default config', () => {
    expect(() => assertFrozenArm(FROZEN_ARM)).not.toThrow()
    expect(() => assertFrozenArm(defaultRound4Config().arm)).not.toThrow()
  })
  it('throws on any immutable-arm drift (protocol_v2)', () => {
    expect(() => assertFrozenArm({ ...FROZEN_ARM, workerModel: 'gpt-5.5' })).toThrow(/immutable/)
    expect(() => assertFrozenArm({ ...FROZEN_ARM, maxUsd: 16 })).toThrow(/maxUsd/)
    expect(() => assertFrozenArm({ ...FROZEN_ARM, budget: 80 })).toThrow(/budget/)
  })
  it('default config: improvement set and holdout are the pre-registered, disjoint sets', () => {
    const config = defaultRound4Config()
    expect(config.instances).toEqual([
      'astropy__astropy-13033',
      'django__django-11532',
      'matplotlib__matplotlib-20826',
    ])
    expect(config.holdoutInstances).toHaveLength(6)
    expect(config.instances.filter((i) => config.holdoutInstances.includes(i))).toEqual([])
    expect(config.roundsDir).toBe('/home/drew/code/supervisor-lab/.evolve/rounds')
    expect(config.analystModels.every((m) => m === 'glm-5.2')).toBe(true)
  })
})

describe('round4BuildPrompt', () => {
  it('declares the change-space and renders findings', () => {
    const prompt = round4BuildPrompt({
      report: undefined,
      findings: [
        { severity: 'high', claim: 'fix placement mismatch', recommended_action: 'settle where maintainers expect' },
      ],
    })
    expect(prompt).toContain('DECLARED CHANGE-SPACE')
    expect(prompt).toContain('extensions/pi/**')
    expect(prompt).toContain('src/worker-evidence.ts')
    expect(prompt).toContain('fix placement mismatch')
    expect(prompt).toContain('→ settle where maintainers expect')
    // No raw-trace findings ⇒ no evidence-file requirement block (the
    // change-space instruction still NAMES the artifact path as allowed).
    expect(prompt).not.toContain('Raw trace evidence requirement')
  })

  it('adds the raw-trace evidence contract when raw-trace findings are present', () => {
    const prompt = round4BuildPrompt({
      report: undefined,
      findings: [{ severity: 'high', area: 'raw-trace-context', claim: 'traces at /run/gen-0' }],
    })
    expect(prompt).toContain('Raw trace evidence requirement')
    expect(prompt).toContain(RAW_TRACE_DIAGNOSIS_PATH)
  })

  it('changeSpaceInstruction names every allowed root exactly once', () => {
    const text = changeSpaceInstruction(LOOPS_CHANGE_SPACE)
    for (const f of LOOPS_CHANGE_SPACE.files) expect(text).toContain(f)
    for (const p of LOOPS_CHANGE_SPACE.prefixes) expect(text).toContain(`${p}**`)
  })
})
