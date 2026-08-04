import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it, vi } from 'vitest'
import { worktreeLoopRunner } from '../../src/loop-runner'
import type { GitRunner } from '../../src/mcp/worktree'
import type { Budget } from '../../src/runtime'
import { testAgentProfile } from './test-agent-profile'

/** Per-worktree fake git: each worktree gets a distinct diff keyed by its path so two harness
 *  leaves produce two different patches (and two different diff sizes). */
function fakeGitWith(
  diffByBranch: (path: string) => { patch: string; shortstat: string },
): GitRunner {
  return (args) => {
    if (args[0] === 'rev-parse') return { stdout: 'base\n', stderr: '', exitCode: 0 }
    if (args[0] === 'worktree' && args[1] === 'add') return { stdout: '', stderr: '', exitCode: 0 }
    if (args[0] === 'worktree' && args[1] === 'remove')
      return { stdout: '', stderr: '', exitCode: 0 }
    if (args[0] === 'branch') return { stdout: '', stderr: '', exitCode: 0 }
    // The diff/shortstat commands run inside a worktree cwd; the runner passes cwd via opts but our
    // fake keys off the worktree path embedded in the `git -C <path>` arg list. Use the last token.
    const cwd = args.find((a) => a.includes('/')) ?? ''
    const d = diffByBranch(cwd)
    if (args[0] === 'diff' && args.includes('--shortstat')) {
      return { stdout: d.shortstat, stderr: '', exitCode: 0 }
    }
    if (args[0] === 'diff') return { stdout: d.patch, stderr: '', exitCode: 0 }
    return { stdout: '', stderr: '', exitCode: 0 }
  }
}

const profile = (name: string, harness: AgentProfile['harness']): AgentProfile =>
  testAgentProfile(name, { harness, prompt: { systemPrompt: `You are ${name}.` } })

const budget: Budget = { maxIterations: 50, maxTokens: 500_000 }

const okHarness = vi.fn(async () => ({
  exitCode: 0,
  stdout: 'done',
  stderr: '',
  killedBySignal: null as NodeJS.Signals | null,
  durationMs: 1,
  timedOut: false,
  usage: {
    inputTokens: 10,
    cachedInputTokens: 0,
    outputTokens: 5,
    reasoningOutputTokens: 0,
  },
}))

describe('worktreeLoopRunner — the migrated generic coder path', () => {
  it('runs N authored harnesses as a fanout and returns the winning patch artifact', async () => {
    const patch = 'diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n+const a = 1'
    const runner = worktreeLoopRunner({
      repoRoot: '/repo',
      rootProfile: profile('worktree-coder', 'cli-base'),
      taskPrompt: 'fix the off-by-one',
      budget,
      harnesses: [
        {
          name: 'claude',
          profile: profile('claude', 'claude-code'),
          budgetExempt: false,
        },
        {
          name: 'opencode',
          profile: profile('opencode', 'opencode'),
          budgetExempt: false,
        },
      ],
      testCmd: 'pnpm test',
      typecheckCmd: 'pnpm typecheck',
      require: ['tests', 'typecheck'],
      runGit: fakeGitWith(() => ({
        patch,
        shortstat: ' 1 file changed, 1 insertion(+), 0 deletions(-)\n',
      })),
      runHarness: okHarness,
      runCommand: async () => ({ exitCode: 0, output: 'green' }),
    })
    const out = await runner(new AbortController().signal)
    expect(out.patch).toContain('+const a = 1')
    expect(out.checks?.tests?.passed).toBe(true)
    expect(out.checks?.typecheck?.passed).toBe(true)
  })

  it('throws (fails loud) when no candidate is delivered (every patch fails its tests)', async () => {
    const patch = 'diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n+const a = 1'
    const runner = worktreeLoopRunner({
      repoRoot: '/repo',
      rootProfile: profile('worktree-coder', 'cli-base'),
      taskPrompt: 'fix it',
      budget,
      harnesses: [
        {
          name: 'claude',
          profile: profile('claude', 'claude-code'),
          budgetExempt: false,
        },
      ],
      testCmd: 'pnpm test',
      require: ['tests'],
      runGit: fakeGitWith(() => ({
        patch,
        shortstat: ' 1 file changed, 1 insertion(+), 0 deletions(-)\n',
      })),
      runHarness: okHarness,
      // tests FAIL → coderDeliverable gates valid:false → no winner → fail loud.
      runCommand: async () => ({ exitCode: 1, output: 'boom' }),
    })
    await expect(runner(new AbortController().signal)).rejects.toThrow(/no delivered patch/)
  })

  it('rejects an empty patch via the always-on no-op floor (no winner)', async () => {
    const runner = worktreeLoopRunner({
      repoRoot: '/repo',
      rootProfile: profile('worktree-coder', 'cli-base'),
      taskPrompt: 'do nothing',
      budget,
      harnesses: [
        {
          name: 'claude',
          profile: profile('claude', 'claude-code'),
          budgetExempt: false,
        },
      ],
      runGit: fakeGitWith(() => ({ patch: '', shortstat: ' 0 files changed\n' })),
      runHarness: okHarness,
    })
    await expect(runner(new AbortController().signal)).rejects.toThrow(/no delivered patch/)
  })
})
