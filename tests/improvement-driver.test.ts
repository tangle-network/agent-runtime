import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AnalystFinding } from '@tangle-network/agent-eval'
import { gitWorktreeAdapter, type ProposeContext } from '@tangle-network/agent-eval/campaign'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SurfaceImprovementEdit } from '../src/agent/improvement-adapter'
import type { ImprovementAdapter, ImprovementEditBatch } from '../src/analyst-loop/types'
import { improvementDriver, reflectiveGenerator } from '../src/improvement'

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

let repoRoot: string
beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'analyst-repo-'))
  git(['init', '-q', '-b', 'main'], repoRoot)
  git(['config', 'user.email', 'test@test.dev'], repoRoot)
  git(['config', 'user.name', 'Test'], repoRoot)
  const emptyHooks = join(repoRoot, '.empty-hooks')
  mkdirSync(emptyHooks)
  git(['config', 'core.hooksPath', emptyHooks], repoRoot)
  writeFileSync(join(repoRoot, 'prompt.md'), 'lax rubric\n')
  git(['add', '-A'], repoRoot)
  git(['commit', '-q', '-m', 'init'], repoRoot)
})
afterEach(() => rmSync(repoRoot, { recursive: true, force: true }))

const FINDINGS = [
  { finding_id: 'f1', subject: 'system-prompt:rubric', severity: 'medium', confidence: 0.8 },
] as unknown as AnalystFinding[]

function ctxWith(findings: AnalystFinding[], report?: unknown): ProposeContext<AnalystFinding> {
  return {
    currentSurface: '',
    history: [],
    findings,
    populationSize: 1,
    generation: 0,
    signal: new AbortController().signal,
    report,
  }
}

/** A SurfaceImprovementEdit carrying a real -p0 unified diff against prompt.md. */
function editFixture(patch: string): SurfaceImprovementEdit {
  return {
    id: 'e1',
    sourceFindingId: 'f1',
    target: { repoRelativePath: 'prompt.md' },
    patch,
    summary: 'tighten the rubric',
    rationale: 'the rubric was too lax',
  } as unknown as SurfaceImprovementEdit
}

const GOOD_PATCH = '--- prompt.md\n+++ prompt.md\n@@ -1 +1 @@\n-lax rubric\n+strict rubric\n'

function stubAdapter(
  batch: ImprovementEditBatch<SurfaceImprovementEdit>,
): ImprovementAdapter<SurfaceImprovementEdit> {
  return { proposeFromFindings: () => batch }
}

/** The reflective setting of the ONE improvement driver. */
function reflectiveDriver(adapter: ImprovementAdapter<SurfaceImprovementEdit>) {
  return improvementDriver({
    generator: reflectiveGenerator({ improvementAdapter: adapter }),
    worktree: gitWorktreeAdapter({ repoRoot }),
    baseRef: 'main',
  })
}

describe('improvementDriver — reflective generator', () => {
  it('applies drafted edits into one worktree and returns a CodeSurface', async () => {
    const adapter = stubAdapter({ edits: [editFixture(GOOD_PATCH)], skipped: 0, errors: [] })
    const driver = reflectiveDriver(adapter)

    const surfaces = await driver.propose(ctxWith(FINDINGS))

    expect(surfaces).toHaveLength(1)
    const surface = surfaces[0]!
    expect(typeof surface).toBe('object')
    if (typeof surface === 'string') throw new Error('expected CodeSurface')
    expect(surface.kind).toBe('code')
    expect(surface.baseRef).toBe('main')
    // The patch is applied + committed in the worktree.
    expect(readFileSync(join(surface.worktreeRef, 'prompt.md'), 'utf8')).toBe('strict rubric\n')
    expect(git(['log', '--oneline', 'main..HEAD'], surface.worktreeRef)).toContain(
      'tighten the rubric',
    )
    // baseRef main is untouched.
    expect(git(['show', 'main:prompt.md'], repoRoot)).toBe('lax rubric')
  })

  it('prefers the Phase-2 report findings over ctx.findings', async () => {
    const seen: AnalystFinding[][] = []
    const adapter: ImprovementAdapter<SurfaceImprovementEdit> = {
      proposeFromFindings: (f) => {
        seen.push([...f])
        return { edits: [editFixture(GOOD_PATCH)], skipped: 0, errors: [] }
      },
    }
    const driver = reflectiveDriver(adapter)

    const reportFindings = [
      {
        finding_id: 'from-report',
        subject: 'system-prompt:rubric',
        severity: 'high',
        confidence: 0.9,
      },
    ] as unknown as AnalystFinding[]
    await driver.propose(ctxWith(FINDINGS, { findings: reportFindings, diff: {} }))

    expect(seen).toHaveLength(1)
    expect(seen[0]![0]!.finding_id).toBe('from-report')
  })

  it('proposes nothing when there are no findings', async () => {
    const adapter = stubAdapter({ edits: [editFixture(GOOD_PATCH)], skipped: 0, errors: [] })
    expect(await reflectiveDriver(adapter).propose(ctxWith([]))).toEqual([])
  })

  it('proposes nothing when the adapter drafts no edits', async () => {
    const adapter = stubAdapter({ edits: [], skipped: 3, errors: [] })
    expect(await reflectiveDriver(adapter).propose(ctxWith(FINDINGS))).toEqual([])
  })

  it('discards the worktree and proposes nothing when no patch applies', async () => {
    // A patch against content that does not match → git apply fails.
    const badPatch = '--- prompt.md\n+++ prompt.md\n@@ -1 +1 @@\n-NONEXISTENT line\n+whatever\n'
    const adapter = stubAdapter({ edits: [editFixture(badPatch)], skipped: 0, errors: [] })

    expect(await reflectiveDriver(adapter).propose(ctxWith(FINDINGS))).toEqual([])
    // No orphaned worktree left behind.
    expect(git(['worktree', 'list'], repoRoot).split('\n').length).toBe(1)
  })
})
