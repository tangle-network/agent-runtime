import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AnalystFinding } from '@tangle-network/agent-eval'
import { gitWorktreeAdapter, type ProposeContext } from '@tangle-network/agent-eval/campaign'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agenticGenerator, commandVerifier } from '../src/improvement/agentic-generator'
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

const TRACE_PATH = '/tmp/run/gen-0/candidate-0/task_0/spans.jsonl'
const RAW_TRACE_FINDINGS = [
  {
    schema_version: '1.0.0',
    finding_id: 'rt1',
    analyst_id: 'raw-trace-distiller',
    produced_at: '2026-01-01',
    severity: 'high',
    area: 'raw-trace-context',
    claim: 'candidate failed after reading stale state',
    recommended_action: `grep/cat ${TRACE_PATH} before editing`,
    evidence_refs: [{ kind: 'artifact', uri: TRACE_PATH }],
    confidence: 1,
    subject: 'candidate-hash',
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

describe('agenticGenerator — verify-in-session loop', () => {
  const edits = (cwd: string, body: string) => writeFileSync(join(cwd, 'app.ts'), body)

  it('returns the candidate when a dirtying shot passes verification', async () => {
    const runHarness = vi.fn(async ({ cwd }: { cwd: string }) => {
      edits(cwd, 'export const x = 2\n')
      return HARNESS_OK
    })
    const verify = vi.fn(() => ({ ok: true }))
    const gen = agenticGenerator({ runHarness: runHarness as never, verify })

    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'vok' })
    const out = await gen.generate({
      worktreePath: wt.path,
      report: undefined,
      findings: FINDINGS,
      maxShots: 3,
      signal: new AbortController().signal,
    })

    expect(runHarness).toHaveBeenCalledTimes(1)
    expect(verify).toHaveBeenCalledTimes(1)
    expect(out.applied).toBe(true)
  })

  it('feeds the verifier failure into the next shot, then ships when it passes', async () => {
    let shot = 0
    const prompts: string[] = []
    const runHarness = vi.fn(async ({ cwd, taskPrompt }: { cwd: string; taskPrompt: string }) => {
      prompts.push(taskPrompt)
      shot++
      edits(cwd, `export const x = ${100 + shot}\n`) // always differs from baseline (x=1)
      return HARNESS_OK
    })
    // Fail shot 1, pass shot 2.
    const verify = vi.fn(() =>
      shot === 1 ? { ok: false, feedback: 'TS2322: x must be 2' } : { ok: true },
    )
    const gen = agenticGenerator({ runHarness: runHarness as never, verify })

    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'vresume' })
    const out = await gen.generate({
      worktreePath: wt.path,
      report: undefined,
      findings: FINDINGS,
      maxShots: 4,
      signal: new AbortController().signal,
    })

    expect(runHarness).toHaveBeenCalledTimes(2)
    expect(out.applied).toBe(true)
    // The second shot's prompt carries the verifier's failure (resume-with-error).
    expect(prompts[1]).toContain('verification FAILED')
    expect(prompts[1]).toContain('TS2322: x must be 2')
    // The first shot's prompt is the clean base — no failure note yet.
    expect(prompts[0]).not.toContain('verification FAILED')
  })

  it('discards (applied:false) a candidate that never verifies within maxShots', async () => {
    const runHarness = vi.fn(async ({ cwd }: { cwd: string }) => {
      edits(cwd, 'export const x = 9\n') // dirties every shot
      return HARNESS_OK
    })
    const verify = vi.fn(() => ({ ok: false, feedback: 'still broken' }))
    const gen = agenticGenerator({ runHarness: runHarness as never, verify })

    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'vfail' })
    const out = await gen.generate({
      worktreePath: wt.path,
      report: undefined,
      findings: FINDINGS,
      maxShots: 3,
      signal: new AbortController().signal,
    })

    expect(runHarness).toHaveBeenCalledTimes(3)
    expect(verify).toHaveBeenCalledTimes(3)
    expect(out.applied).toBe(false) // an unverified tree is not a candidate
  })

  it('commandVerifier: exit 0 ⇒ ok, non-zero ⇒ feedback carries output', async () => {
    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'cmdv' })
    const pass = commandVerifier('true')
    expect(await pass(wt.path)).toEqual({ ok: true })

    const fail = commandVerifier('sh', ['-c', 'echo boom >&2; exit 1'])
    const res = await fail(wt.path)
    expect(res.ok).toBe(false)
    expect(res.feedback).toContain('boom')
  })

  it('commandVerifier: a missing binary throws (setup bug, not a failed candidate)', async () => {
    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'cmdmiss' })
    const v = commandVerifier('definitely-not-a-real-binary-xyz')
    expect(() => v(wt.path)).toThrow(/not found in PATH/)
  })
})

describe('agenticGenerator — raw-trace evidence discipline', () => {
  const writeDiagnosis = (cwd: string, body: string) => {
    mkdirSync(join(cwd, '.improve'), { recursive: true })
    writeFileSync(join(cwd, '.improve/raw-trace-diagnosis.md'), body)
  }

  it('retries and discards a raw-trace candidate that edits code without citing inspected traces', async () => {
    const prompts: string[] = []
    const runHarness = vi.fn(async ({ cwd, taskPrompt }: { cwd: string; taskPrompt: string }) => {
      prompts.push(taskPrompt)
      writeFileSync(join(cwd, 'app.ts'), 'export const x = 2\n')
      return HARNESS_OK
    })
    const gen = agenticGenerator({ runHarness: runHarness as never })

    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'rt-miss' })
    const out = await gen.generate({
      worktreePath: wt.path,
      report: undefined,
      findings: RAW_TRACE_FINDINGS,
      maxShots: 2,
      signal: new AbortController().signal,
    })

    expect(out.applied).toBe(false)
    expect(runHarness).toHaveBeenCalledTimes(2)
    expect(prompts[0]).toContain('Raw trace evidence requirement')
    expect(prompts[0]).toContain('.improve/raw-trace-diagnosis.md')
    expect(prompts[1]).toContain('raw-trace mode requires .improve/raw-trace-diagnosis.md')
  })

  it('rejects a raw-trace candidate that only writes the diagnosis artifact', async () => {
    const runHarness = vi.fn(async ({ cwd }: { cwd: string }) => {
      writeDiagnosis(cwd, `inspected: ${TRACE_PATH}\nmechanism: stale state\nchange: none yet\n`)
      return HARNESS_OK
    })
    const gen = agenticGenerator({ runHarness: runHarness as never })

    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'rt-only' })
    const out = await gen.generate({
      worktreePath: wt.path,
      report: undefined,
      findings: RAW_TRACE_FINDINGS,
      maxShots: 1,
      signal: new AbortController().signal,
    })

    expect(out.applied).toBe(false)
    expect(runHarness).toHaveBeenCalledTimes(1)
  })

  it('accepts a raw-trace candidate with a substantive edit and diagnosis citing a real trace path', async () => {
    const runHarness = vi.fn(async ({ cwd }: { cwd: string }) => {
      writeFileSync(join(cwd, 'app.ts'), 'export const x = 2\n')
      writeDiagnosis(
        cwd,
        [
          `inspected: ${TRACE_PATH}`,
          'mechanism: stale state was reused after a failed candidate',
          'change: reset the state before reuse',
          '',
        ].join('\n'),
      )
      return HARNESS_OK
    })
    const gen = agenticGenerator({ runHarness: runHarness as never })

    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'rt-ok' })
    const out = await gen.generate({
      worktreePath: wt.path,
      report: undefined,
      findings: RAW_TRACE_FINDINGS,
      maxShots: 1,
      signal: new AbortController().signal,
    })

    expect(out.applied).toBe(true)
    expect(runHarness).toHaveBeenCalledTimes(1)
  })
})
