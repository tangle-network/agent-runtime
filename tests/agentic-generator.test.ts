import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AnalystFinding } from '@tangle-network/agent-eval'
import { gitWorktreeAdapter, type ProposeContext } from '@tangle-network/agent-eval/campaign'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agenticGenerator } from '../src/improvement/agentic-generator'
import { improvementDriver } from '../src/improvement/improvement-driver'
import type { LocalHarnessResult } from '../src/mcp/local-harness'

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

let repoRoot: string
beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'agentic-repo-'))
  git(['init', '-q', '-b', 'main'], repoRoot)
  git(['config', 'user.email', 'test@test.dev'], repoRoot)
  git(['config', 'user.name', 'Test'], repoRoot)
  const emptyHooks = join(repoRoot, '.empty-hooks')
  mkdirSync(emptyHooks)
  git(['config', 'core.hooksPath', emptyHooks], repoRoot)
  writeFileSync(join(repoRoot, 'app.ts'), 'export const x = 1\n')
  git(['add', '-A'], repoRoot)
  git(['commit', '-q', '-m', 'init'], repoRoot)
})
afterEach(() => rmSync(repoRoot, { recursive: true, force: true }))

const FINDINGS = [
  {
    schema_version: '1.0.0',
    finding_id: 'f1',
    analyst_id: 'a1',
    produced_at: '2026-01-01',
    severity: 'high',
    area: 'correctness',
    claim: 'x should be 2',
    recommended_action: 'set x to 2',
    evidence_refs: [],
    confidence: 0.9,
    subject: 'app.ts',
  },
] as unknown as AnalystFinding[]

const HARNESS_OK: LocalHarnessResult = {
  exitCode: 0,
  stdout: 'done',
  stderr: '',
  killedBySignal: null,
  durationMs: 10,
  timedOut: false,
}

function ctx(findings: AnalystFinding[], maxShots = 1): ProposeContext<AnalystFinding> {
  return {
    currentSurface: '',
    history: [],
    findings,
    populationSize: 1,
    generation: 0,
    signal: new AbortController().signal,
    maxImprovementShots: maxShots,
  }
}

describe('agenticGenerator — runs a harness in the worktree', () => {
  it('returns applied when the harness changes the worktree', async () => {
    // The harness "edits" by writing into its cwd (the worktree). We stub the
    // subprocess (the only process boundary) but use a REAL git dirty check.
    const runHarness = vi.fn(async ({ cwd, taskPrompt }: { cwd: string; taskPrompt: string }) => {
      expect(taskPrompt).toContain('x should be 2')
      expect(taskPrompt).toContain('set x to 2')
      writeFileSync(join(cwd, 'app.ts'), 'export const x = 2\n')
      return HARNESS_OK
    })
    const gen = agenticGenerator({ runHarness: runHarness as never })

    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'cand' })
    const out = await gen.generate({
      worktreePath: wt.path,
      report: undefined,
      findings: FINDINGS,
      maxShots: 1,
      signal: new AbortController().signal,
    })

    expect(runHarness).toHaveBeenCalledTimes(1)
    expect(out.applied).toBe(true)
    expect(out.summary).toContain('x should be 2')
  })

  it('retries up to maxShots when the harness produces no change, then gives up', async () => {
    const runHarness = vi.fn(async () => HARNESS_OK) // never edits the worktree
    const gen = agenticGenerator({ runHarness: runHarness as never })

    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'noop' })
    const out = await gen.generate({
      worktreePath: wt.path,
      report: undefined,
      findings: FINDINGS,
      maxShots: 3,
      signal: new AbortController().signal,
    })

    expect(runHarness).toHaveBeenCalledTimes(3)
    expect(out.applied).toBe(false)
  })

  it('stops retrying as soon as a shot produces a change', async () => {
    let calls = 0
    const runHarness = vi.fn(async ({ cwd }: { cwd: string }) => {
      calls++
      if (calls === 2) writeFileSync(join(cwd, 'app.ts'), 'export const x = 2\n')
      return HARNESS_OK
    })
    const gen = agenticGenerator({ runHarness: runHarness as never })

    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'second' })
    const out = await gen.generate({
      worktreePath: wt.path,
      report: undefined,
      findings: FINDINGS,
      maxShots: 5,
      signal: new AbortController().signal,
    })

    expect(calls).toBe(2) // stopped on the shot that changed the tree
    expect(out.applied).toBe(true)
  })

  it('end-to-end through improvementDriver: harness edit → committed CodeSurface', async () => {
    const runHarness = vi.fn(async ({ cwd }: { cwd: string }) => {
      writeFileSync(join(cwd, 'app.ts'), 'export const x = 2\n')
      return HARNESS_OK
    })
    const driver = improvementDriver({
      generator: agenticGenerator({ runHarness: runHarness as never }),
      worktree: gitWorktreeAdapter({ repoRoot }),
      baseRef: 'main',
    })

    const surfaces = await driver.propose(ctx(FINDINGS))

    expect(surfaces).toHaveLength(1)
    const surface = surfaces[0]!
    if (typeof surface === 'string') throw new Error('expected CodeSurface')
    expect(surface.kind).toBe('code')
    // The harness's edit is committed on the candidate branch.
    expect(git(['show', 'HEAD:app.ts'], surface.worktreeRef)).toBe('export const x = 2')
    // main is untouched.
    expect(git(['show', 'main:app.ts'], repoRoot)).toBe('export const x = 1')
  })

  it('discards the worktree when the agentic generator produces nothing', async () => {
    const runHarness = vi.fn(async () => HARNESS_OK)
    const driver = improvementDriver({
      generator: agenticGenerator({ runHarness: runHarness as never }),
      worktree: gitWorktreeAdapter({ repoRoot }),
      baseRef: 'main',
    })

    const surfaces = await driver.propose(ctx(FINDINGS, 2))
    expect(surfaces).toEqual([])
    expect(git(['worktree', 'list'], repoRoot).split('\n').length).toBe(1)
  })
})
