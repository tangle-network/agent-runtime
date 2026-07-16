/**
 * Unit tests for the round-4 outer loop's pure protocol logic: the declared
 * change-space enforcement, porcelain path parsing, the keep-if-better verdict
 * (protocol_v2), the staircase row schema, and the frozen-arm assertion.
 * Pure — no arms, no docker, no tokens.
 */

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runOk } from './proc.ts'
import {
  addEvalWorktree,
  DEFAULT_GATE_WAIT_CEILING_MS,
  FIXTURES_VERIFY_DIR,
  FROZEN_ARM,
  LOOPS_CHANGE_SPACE,
  RAW_TRACE_DIAGNOSIS_PATH,
  STAIRCASE_SCHEMA,
  SUPERVISOR_GATE_COUNT,
  assertFrozenArm,
  campaignDispatchCeilingMs,
  changeSpaceInstruction,
  changeSpaceViolations,
  decideVerdict,
  defaultRound4Config,
  instanceRunKey,
  normalizeRepoPath,
  parseStaircaseRow,
  porcelainChangedPaths,
  purgeIgnoredArtifacts,
  removeEvalWorktree,
  replicateCoverageComplete,
  resolvedInstanceCount,
  round4BuildPrompt,
  runWithPostGateClock,
  type ReplicateRun,
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
        rep: 0,
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
  it('default config: verify scripts come from the COMMITTED fixtures dir and reps=2', () => {
    const config = defaultRound4Config()
    // The scratchpad copy died with a host reboot; the committed dir is the durable home.
    expect(config.verifyDir).toBe(FIXTURES_VERIFY_DIR)
    expect(config.verifyDir).toContain('fixtures/verify')
    // Single-rep scoring flips instance outcomes run-to-run — round 4 runs 2.
    expect(config.repsPerInstance).toBe(2)
  })
})

describe('dispatch clocks (gate holds are never billed to the cell)', () => {
  it('campaignDispatchCeilingMs = work budget + worst-case sequential gate holds', () => {
    expect(campaignDispatchCeilingMs({ dispatchTimeoutMs: 7_200_000 })).toBe(
      7_200_000 + SUPERVISOR_GATE_COUNT * DEFAULT_GATE_WAIT_CEILING_MS,
    )
    expect(campaignDispatchCeilingMs({ dispatchTimeoutMs: 1_000, gateWaitCeilingMs: 500 })).toBe(1_000 + 2 * 500)
    expect(campaignDispatchCeilingMs({ dispatchTimeoutMs: 1_000, gateWaitCeilingMs: 500 }, 1)).toBe(1_500)
  })

  it('a gate hold LONGER than the work clock does not abort the cell (the pre-crash bug)', async () => {
    // Pre-crash failure shape: 58-min capacity hold billed to the 7200s clock.
    // Here: gate hold 120ms > work clock 60ms; the work itself takes 10ms.
    const result = await runWithPostGateClock({
      awaitGates: () => new Promise<void>((r) => setTimeout(r, 120)),
      work: () => new Promise<string>((r) => setTimeout(() => r('done'), 10)),
      timeoutMs: 60,
    })
    expect(result).toBe('done')
  })

  it('work exceeding the post-gate clock still fails loud', async () => {
    await expect(
      runWithPostGateClock({
        awaitGates: () => Promise.resolve(),
        work: () => new Promise<string>((r) => setTimeout(() => r('late'), 200)),
        timeoutMs: 30,
        label: 'R4 deadbeef00 astropy__astropy-13033 r0',
      }),
    ).rejects.toThrow(/post-gate dispatch exceeded 30ms .*astropy__astropy-13033/)
  })

  it('a gate failure rejects before the work clock ever starts', async () => {
    let workStarted = false
    await expect(
      runWithPostGateClock({
        awaitGates: () => Promise.reject(new Error('no capacity on router within ceiling')),
        work: async () => {
          workStarted = true
          return 'x'
        },
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow(/no capacity/)
    expect(workStarted).toBe(false)
  })
})

describe('replicate semantics (repsPerInstance)', () => {
  const iids = ['a', 'b', 'c']
  const run = (iid: string, resolved: boolean | null): ReplicateRun => ({ iid, resolved })

  it('an instance resolves only when ALL replicates resolve (AND, fail-closed)', () => {
    const runs = [
      run('a', true), run('a', true),   // both reps resolved → counts
      run('b', true), run('b', false),  // flaky split → does NOT count
      run('c', false), run('c', false),
    ]
    expect(resolvedInstanceCount(runs, iids, 2)).toBe(1)
  })

  it('missing replicates never count as resolved', () => {
    expect(resolvedInstanceCount([run('a', true)], iids, 2)).toBe(0)
    expect(resolvedInstanceCount([run('a', true)], iids, 1)).toBe(1)
  })

  it('coverage requires every replicate of every instance with a conclusive verdict', () => {
    const full = iids.flatMap((iid) => [run(iid, true), run(iid, false)])
    expect(replicateCoverageComplete(full, iids, 2)).toBe(true)
    expect(replicateCoverageComplete(full.slice(1), iids, 2)).toBe(false)
    const inconclusive = [...full.slice(0, 5), run('c', null)]
    expect(replicateCoverageComplete(inconclusive, iids, 2)).toBe(false)
  })

  it('instanceRunKey separates replicate cells of the same instance', () => {
    expect(instanceRunKey('django__django-11532', 0)).not.toBe(instanceRunKey('django__django-11532', 1))
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

describe('candidate worktree hygiene (finalize precondition + eval isolation)', () => {
  const git = (dir: string, ...argv: string[]) =>
    runOk('git', ['-C', dir, '-c', 'user.email=t@test', '-c', 'user.name=t', '-c', 'core.hooksPath=/dev/null', ...argv])

  /** Base repo + candidate worktree with proposer-style state: a tracked edit,
   *  an untracked non-ignored deliverable, and gitignored install dirt (the
   *  exact mix round-4 gen-0 cand-1 died on). */
  async function makeRepoWithDirtyCandidate(): Promise<{ base: string; wt: string; root: string }> {
    const root = await mkdtemp(join(tmpdir(), 'r4-wt-hygiene-'))
    const base = join(root, 'base')
    await mkdir(join(base, 'src'), { recursive: true })
    await writeFile(join(base, '.gitignore'), 'node_modules/\n*.log\n')
    await writeFile(join(base, 'src', 'a.ts'), 'export const a = 1\n')
    await runOk('git', ['-C', base, 'init', '-q'])
    await git(base, 'add', '-A')
    await git(base, 'commit', '-q', '-m', 'base')
    const wt = join(root, 'wt')
    await git(base, 'worktree', 'add', '-q', '-b', 'improve/test-cand', wt, 'HEAD')
    // Proposer session: intentional edit + evidence artifact + install dirt.
    await writeFile(join(wt, 'src', 'a.ts'), 'export const a = 2\n')
    await mkdir(join(wt, '.improve'), { recursive: true })
    await writeFile(join(wt, '.improve', 'raw-trace-diagnosis.md'), '# diagnosis\n')
    await mkdir(join(wt, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(wt, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1\n')
    await writeFile(join(wt, 'node_modules', '.modules.yaml'), 'store: real-install\n')
    await writeFile(join(wt, 'debug.log'), 'stray ignored file\n')
    return { base, wt, root }
  }

  it('purgeIgnoredArtifacts removes ignored dirt but keeps tracked edits and untracked deliverables', async () => {
    const { wt, root } = await makeRepoWithDirtyCandidate()
    try {
      await purgeIgnoredArtifacts(wt)
      expect(existsSync(join(wt, 'node_modules'))).toBe(false)
      expect(existsSync(join(wt, 'debug.log'))).toBe(false)
      expect(existsSync(join(wt, '.improve', 'raw-trace-diagnosis.md'))).toBe(true)
      expect(await readFile(join(wt, 'src', 'a.ts'), 'utf8')).toBe('export const a = 2\n')
      // The exact finalize precondition the substrate enforces: zero ignored extras.
      const ignored = await git(wt, 'ls-files', '--others', '--ignored', '--exclude-standard')
      expect(ignored.stdout.trim()).toBe('')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('a finalized candidate worktree tree-hash is identical before and after a mocked evaluation', async () => {
    const { base, wt, root } = await makeRepoWithDirtyCandidate()
    try {
      await purgeIgnoredArtifacts(wt)
      // Finalize the candidate: everything intentional is committed.
      await git(wt, 'add', '-A')
      await git(wt, 'commit', '-q', '-m', 'agentic: candidate finalized')
      const commit = (await git(wt, 'rev-parse', 'HEAD')).stdout.trim()
      const treeBefore = (await git(wt, 'rev-parse', 'HEAD^{tree}')).stdout.trim()

      // Mocked evaluation: a detached eval worktree at the candidate commit
      // takes ALL the runtime dirt; the CodeSurface worktree is never touched.
      const evalWt = join(root, 'eval-wt')
      await addEvalWorktree(base, commit, evalWt)
      await mkdir(join(evalWt, '.loops'), { recursive: true })
      await writeFile(join(evalWt, '.loops', 'state.json'), '{"run":"mock"}\n')
      await writeFile(join(evalWt, 'run.log'), 'arm eval output\n')
      await removeEvalWorktree(base, evalWt)

      expect(existsSync(evalWt)).toBe(false)
      expect((await git(wt, 'rev-parse', 'HEAD^{tree}')).stdout.trim()).toBe(treeBefore)
      expect((await git(wt, 'status', '--porcelain=v1', '--untracked-files=all')).stdout.trim()).toBe('')
      const ignored = await git(wt, 'ls-files', '--others', '--ignored', '--exclude-standard')
      expect(ignored.stdout.trim()).toBe('')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
