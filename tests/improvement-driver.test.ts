import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AnalystFinding } from '@tangle-network/agent-eval'
import {
  gitWorktreeAdapter,
  type ProposeContext,
  verifyCodeSurface,
  type Worktree,
  type WorktreeAdapter,
} from '@tangle-network/agent-eval/campaign'
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

  it('still proposes populationSize candidates on EMPTY findings when the generator opts in (proposesWithoutFindings)', async () => {
    // The meta-harness contract: an agentic coder draws its signal from the repo
    // + raw traces on disk, so it must run even when the distiller yielded no
    // findings and there is no report (the first-generation case — its seed
    // findings are empty and rawTraceDistiller has not run yet). Regression for
    // the "surface:'code' generates ZERO candidates" bug.
    let generateCalls = 0
    const seedDriver = improvementDriver({
      generator: {
        kind: 'agentic-stub',
        proposesWithoutFindings: true,
        async generate({ worktreePath }) {
          generateCalls++
          // Dirty the worktree so the driver finalizes it into a CodeSurface.
          writeFileSync(join(worktreePath, 'prompt.md'), 'edited from raw traces\n')
          return { applied: true, summary: 'from-seed edit' }
        },
      },
      worktree: gitWorktreeAdapter({ repoRoot }),
      baseRef: 'main',
    })

    const surfaces = await seedDriver.propose({ ...ctxWith([]), populationSize: 2 })

    expect(generateCalls).toBe(2)
    expect(surfaces).toHaveLength(2)
    for (const surface of surfaces) {
      if (typeof surface === 'string') throw new Error('expected CodeSurface')
      expect(surface.kind).toBe('code')
      expect(readFileSync(join(surface.worktreeRef, 'prompt.md'), 'utf8')).toBe(
        'edited from raw traces\n',
      )
    }
  })

  it('forks isolated generation-two candidates from the promoted generation-one surface', async () => {
    const worktree = gitWorktreeAdapter({ repoRoot })
    const baselineWorktree = await worktree.create({ baseRef: 'main', label: 'baseline' })
    const baseline = await worktree.finalize(baselineWorktree, 'baseline')
    let call = 0
    const driver = improvementDriver({
      generator: {
        kind: 'cumulative-stub',
        proposesWithoutFindings: true,
        async generate({ worktreePath }) {
          expect(git(['status', '--porcelain'], worktreePath)).toBe('')
          const current = readFileSync(join(worktreePath, 'prompt.md'), 'utf8')
          if (call === 0) {
            expect(current).toBe('lax rubric\n')
            writeFileSync(join(worktreePath, 'prompt.md'), 'lax rubric\ngeneration one\n')
          } else {
            expect(current).toBe('lax rubric\ngeneration one\n')
            writeFileSync(
              join(worktreePath, 'prompt.md'),
              `lax rubric\ngeneration one\ngeneration two candidate ${call}\n`,
            )
          }
          call++
          return { applied: true, summary: `generation ${call}` }
        },
      },
      worktree,
      baseRef: 'main',
    })

    const [generationOne] = await driver.propose({
      ...ctxWith([]),
      currentSurface: baseline,
      generation: 0,
    })
    if (!generationOne || typeof generationOne === 'string') {
      throw new Error('expected generation-one CodeSurface')
    }

    const generationTwo = await driver.propose({
      ...ctxWith([]),
      currentSurface: generationOne,
      generation: 1,
      populationSize: 2,
    })
    expect(generationTwo).toHaveLength(2)
    const codeSurfaces = generationTwo.map((surface) => {
      if (typeof surface === 'string') throw new Error('expected generation-two CodeSurface')
      return surface
    })

    for (const [index, surface] of codeSurfaces.entries()) {
      const expected = `lax rubric\ngeneration one\ngeneration two candidate ${index + 1}\n`
      expect(readFileSync(join(surface.worktreeRef, 'prompt.md'), 'utf8')).toBe(expected)
      expect(surface.baseCommit).toBe(baseline.baseCommit)
      expect(surface.baseTree).toBe(baseline.baseTree)
      expect(
        git(['merge-base', generationOne.candidateCommit, surface.candidateCommit], repoRoot),
      ).toBe(generationOne.candidateCommit)

      const verified = verifyCodeSurface(surface)
      const applyWorktree = await worktree.create({
        baseRef: surface.baseCommit,
        label: `apply-check-${index}`,
      })
      try {
        execFileSync('git', ['apply', '--check', '--binary', '-'], {
          cwd: applyWorktree.path,
          input: Buffer.from(verified.patchBytes),
        })
        execFileSync('git', ['apply', '--binary', '-'], {
          cwd: applyWorktree.path,
          input: Buffer.from(verified.patchBytes),
        })
        expect(readFileSync(join(applyWorktree.path, 'prompt.md'), 'utf8')).toBe(expected)
      } finally {
        await worktree.discard(applyWorktree)
      }
    }

    expect(readFileSync(join(generationOne.worktreeRef, 'prompt.md'), 'utf8')).toBe(
      'lax rubric\ngeneration one\n',
    )
    expect(git(['show', 'main:prompt.md'], repoRoot)).toBe('lax rubric')

    const [winner, loser] = codeSurfaces
    if (!winner || !loser) throw new Error('expected two generation-two candidates')
    await driver.cleanup([winner.worktreeRef])
    expect(existsSync(generationOne.worktreeRef)).toBe(false)
    expect(existsSync(loser.worktreeRef)).toBe(false)
    expect(existsSync(winner.worktreeRef)).toBe(true)
    expect(verifyCodeSurface(winner).contentHash).toMatch(/^sha256:/)
    expect(git(['show', 'main:prompt.md'], repoRoot)).toBe('lax rubric')
  })

  it('rethrows and leaves NO orphaned worktree when the generator throws', async () => {
    // A generator whose generate() throws mid-candidate must not leak the
    // already-created worktree (the try/finally cleanup in propose()).
    const boom = new Error('generator exploded')
    const throwingDriver = improvementDriver({
      generator: {
        kind: 'throws',
        async generate() {
          throw boom
        },
      },
      worktree: gitWorktreeAdapter({ repoRoot }),
      baseRef: 'main',
    })

    await expect(throwingDriver.propose(ctxWith(FINDINGS))).rejects.toThrow('generator exploded')
    // The worktree created before the throw was discarded — only the main
    // worktree remains.
    expect(git(['worktree', 'list'], repoRoot).split('\n').length).toBe(1)
  })

  it('retries candidate cleanup when generation and the first discard both fail', async () => {
    const realWorktree = gitWorktreeAdapter({ repoRoot })
    let discardAttempts = 0
    const flakyWorktree: WorktreeAdapter = {
      ...realWorktree,
      async discard(worktree: Worktree) {
        discardAttempts += 1
        if (discardAttempts === 1) throw new Error('transient discard failure')
        await realWorktree.discard(worktree)
      },
    }
    const driver = improvementDriver({
      generator: {
        kind: 'throws-with-flaky-cleanup',
        async generate() {
          throw new Error('generation failed')
        },
      },
      worktree: flakyWorktree,
      baseRef: 'main',
    })

    await expect(driver.propose(ctxWith(FINDINGS))).rejects.toThrow('generation failed')
    expect(discardAttempts).toBe(2)
    expect(git(['worktree', 'list'], repoRoot).split('\n')).toHaveLength(1)
  })

  it('attempts every candidate cleanup even when one discard fails', async () => {
    let created = 0
    const discardAttempts: string[] = []
    const driver = improvementDriver({
      generator: {
        kind: 'cleanup-stub',
        proposesWithoutFindings: true,
        async generate() {
          return { applied: true, summary: 'candidate' }
        },
      },
      worktree: {
        async create({ baseRef }) {
          const id = String(created++)
          return { path: `/tmp/candidate-${id}`, branch: `candidate-${id}`, baseRef }
        },
        async finalize(worktree) {
          return { kind: 'code', worktreeRef: worktree.path, baseRef: worktree.baseRef }
        },
        async discard(worktree) {
          discardAttempts.push(worktree.path)
          if (worktree.path.endsWith('-0')) throw new Error('first discard failed')
        },
      },
      baseRef: 'main',
    })

    await driver.propose({ ...ctxWith([]), populationSize: 2 })
    await expect(driver.cleanup()).rejects.toThrow(/failed to discard candidate worktrees/)
    expect(discardAttempts).toEqual(['/tmp/candidate-0', '/tmp/candidate-1'])
  })
})
