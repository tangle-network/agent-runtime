import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeProposalFinding } from '@tangle-network/agent-eval'
import {
  gitWorktreeAdapter,
  type Worktree,
  type WorktreeAdapter,
} from '@tangle-network/agent-eval/campaign'
import type {
  DispatchContext,
  JudgeConfig,
  MutableSurface,
  Scenario,
} from '@tangle-network/agent-eval/contract'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { improve } from './improve'

interface TestScenario extends Scenario {
  kind: 'fixture'
}

interface TextArtifact {
  text: string
}

const trainScenarios: TestScenario[] = [{ id: 'train', kind: 'fixture' }]
const selectionScenarios: TestScenario[] = [{ id: 'selection', kind: 'fixture' }]
const testScenarios: TestScenario[] = [
  { id: 'test-a', kind: 'fixture' },
  { id: 'test-b', kind: 'fixture' },
  { id: 'test-c', kind: 'fixture' },
  { id: 'test-d', kind: 'fixture' },
  { id: 'test-e', kind: 'fixture' },
  { id: 'test-f', kind: 'fixture' },
]
const allScenarios = [...trainScenarios, ...selectionScenarios, ...testScenarios]

const improvementJudge: JudgeConfig<TextArtifact, TestScenario> = {
  name: 'improvement',
  dimensions: [{ key: 'quality', description: 'candidate contains the improvement marker' }],
  score: ({ artifact }) => {
    const quality = artifact.text.includes('improved') ? 1 : 0
    return { dimensions: { quality }, composite: quality, notes: '' }
  },
}

async function paidArtifact(
  text: string,
  _scenario: TestScenario,
  ctx: DispatchContext,
): Promise<TextArtifact> {
  const paid = await ctx.cost.runPaidCall({
    channel: 'agent',
    actor: 'test-agent',
    model: 'deterministic-test@2026-07-01',
    maximumCharge: { externallyEnforcedMaximumUsd: 0.0001 },
    execute: async () => ({ text }),
    receipt: () => ({
      model: 'deterministic-test@2026-07-01',
      inputTokens: 1,
      outputTokens: 1,
      actualCostUsd: 0.0001,
    }),
  })
  if (!paid.succeeded) throw paid.error
  return paid.value
}

const codeAuthorProfile = (): AgentProfile => ({
  name: 'code-author',
  harness: 'cli-base',
  model: { provider: 'offline', default: 'deterministic-code-author' },
  prompt: { systemPrompt: 'Edit the candidate worktree.' },
})

function createRepo(prefix: string): {
  repoRoot: string
  git(args: string[]): string
  cleanup(): void
} {
  // Git prints a RESOLVED worktree path, so a repository whose path prefix is a symbolic
  // link — every macOS temp root, where /var links to /private/var — never matches the root
  // the Eval worktree adapter was handed. Name the repository by its real path once, here.
  const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  git(['init', '-q', '-b', 'main'])
  git(['config', 'core.hooksPath', '/dev/null'])
  git(['config', 'user.email', 'improve@test.local'])
  git(['config', 'user.name', 'improve-test'])
  writeFileSync(join(repoRoot, 'module.txt'), 'baseline contents\n')
  git(['add', 'module.txt'])
  git(['commit', '-qm', 'baseline'])
  return {
    repoRoot,
    git,
    cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
  }
}

function worktreeCount(git: (args: string[]) => string): number {
  return git(['worktree', 'list', '--porcelain']).match(/^worktree /gm)?.length ?? 0
}

async function paidCodeText(
  surface: MutableSurface,
  _scenario: TestScenario,
  ctx: DispatchContext,
): Promise<TextArtifact> {
  if (typeof surface !== 'object' || surface === null || !('worktreeRef' in surface)) {
    throw new Error('expected a code surface')
  }
  return paidArtifact(
    readFileSync(join(String(surface.worktreeRef), 'module.txt'), 'utf8'),
    _scenario,
    ctx,
  )
}

describe('improve code execution', () => {
  it('rejects malformed findings before preparing a repository', async () => {
    await expect(
      improve({
        surface: 'code',
        findings: [{ proposal_origin: 'production' }],
      } as never),
    ).rejects.toThrow(/improve\(\) code findings/)
  })

  it('runs candidate generation in isolated worktrees and retains only the winner', async () => {
    const repo = createRepo('improve-code-')
    try {
      let generatorCalls = 0
      const result = await improve({
        surface: 'code',
        findings: [
          makeProposalFinding({
            analyst_id: 'test',
            proposal_origin: 'production',
            severity: 'medium',
            area: 'code',
            claim: 'module.txt is stale',
            confidence: 1,
            evidence_refs: [],
          }),
        ],
        scenarios: allScenarios,
        judge: improvementJudge,
        agent: paidCodeText,
        code: {
          repoRoot: repo.repoRoot,
          profile: codeAuthorProfile(),
          generator: {
            kind: 'test-generator',
            async generate({ worktreePath }: { worktreePath: string }) {
              generatorCalls += 1
              writeFileSync(join(worktreePath, 'module.txt'), 'improved contents\n')
              return { applied: true, summary: 'updated module' }
            },
          },
        },
        promotionGate: {
          name: 'retain-test-winner',
          decide: async () => ({
            decision: 'hold' as const,
            reasons: ['exercise detached candidate retention'],
            contributingGates: [],
          }),
        },
        budget: { generations: 1, populationSize: 1, holdoutFraction: 0.25 },
      })

      expect(generatorCalls).toBe(1)
      expect(result.mode).toBe('code')
      expect(result.candidate.profile).toBeUndefined()
      expect(typeof result.candidate.value).toBe('object')
      if (typeof result.candidate.value === 'string' || result.candidate.value.kind !== 'code') {
        throw new Error('expected code surface')
      }
      expect(readFileSync(join(result.candidate.value.worktreeRef, 'module.txt'), 'utf8')).toBe(
        'improved contents\n',
      )
      expect(worktreeCount(repo.git)).toBe(2)
      await result.dispose()
      await result.dispose()
      expect(worktreeCount(repo.git)).toBe(1)
    } finally {
      repo.cleanup()
    }
  }, 120_000)

  it('retains and disposes the incumbent for a baseline-only code run', async () => {
    const repo = createRepo('improve-code-baseline-')
    try {
      const result = await improve({
        surface: 'code',
        gate: 'none',
        scenarios: allScenarios,
        judge: improvementJudge,
        agent: paidCodeText,
        code: {
          repoRoot: repo.repoRoot,
          profile: codeAuthorProfile(),
          generator: {
            kind: 'must-not-run',
            async generate() {
              throw new Error('baseline-only run must not generate')
            },
          },
        },
      })

      expect(result.decision).toBe('hold')
      if (typeof result.candidate.value === 'string' || result.candidate.value.kind !== 'code') {
        throw new Error('expected code surface')
      }
      expect(readFileSync(join(result.candidate.value.worktreeRef, 'module.txt'), 'utf8')).toBe(
        'baseline contents\n',
      )
      expect(worktreeCount(repo.git)).toBe(2)
      await result.dispose()
      expect(worktreeCount(repo.git)).toBe(1)
    } finally {
      repo.cleanup()
    }
  })

  it('cleans every worktree when candidate generation fails', async () => {
    const repo = createRepo('improve-code-reject-')
    try {
      await expect(
        improve({
          surface: 'code',
          scenarios: allScenarios,
          judge: improvementJudge,
          agent: paidCodeText,
          code: {
            repoRoot: repo.repoRoot,
            profile: codeAuthorProfile(),
            generator: {
              kind: 'rejecting-generator',
              async generate() {
                throw new Error('candidate generation failed')
              },
            },
          },
          budget: { generations: 1, populationSize: 1, holdoutFraction: 0.25 },
        }),
      ).rejects.toThrow(/candidate generation failed/)
      expect(worktreeCount(repo.git)).toBe(1)
    } finally {
      repo.cleanup()
    }
  }, 120_000)

  it('cleans the incumbent when baseline finalization fails', async () => {
    const repo = createRepo('improve-code-finalize-')
    try {
      const realWorktree = gitWorktreeAdapter({ repoRoot: repo.repoRoot })
      let discarded = 0
      const rejectingWorktree: WorktreeAdapter = {
        ...realWorktree,
        async finalize() {
          throw new Error('baseline finalization failed')
        },
        async discard(worktree: Worktree) {
          discarded += 1
          await realWorktree.discard(worktree)
        },
      }

      await expect(
        improve({
          surface: 'code',
          scenarios: allScenarios,
          judge: improvementJudge,
          agent: paidCodeText,
          code: {
            repoRoot: repo.repoRoot,
            worktree: rejectingWorktree,
            profile: codeAuthorProfile(),
            generator: {
              kind: 'unused',
              async generate() {
                throw new Error('must not generate')
              },
            },
          },
        }),
      ).rejects.toThrow(/baseline finalization failed/)
      expect(discarded).toBe(1)
      expect(worktreeCount(repo.git)).toBe(1)
    } finally {
      repo.cleanup()
    }
  })
})
