import type { AgentEnvironmentEvent, AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it, vi } from 'vitest'
import { createInProcessExecutor } from '../../src/mcp/in-process-executor'
import type { GitRunner } from '../../src/mcp/worktree'

interface FakeGitState {
  worktreesCreated: string[]
  worktreesRemoved: string[]
  diffPatch: string
  diffShortstat: string
  baseSha: string
}

function makeFakeGit(state: FakeGitState): GitRunner {
  return async (args, _opts) => {
    if (args[0] === 'rev-parse') return { stdout: `${state.baseSha}\n`, stderr: '', exitCode: 0 }
    if (args[0] === 'worktree' && args[1] === 'add') {
      const path = args[args.length - 2] as string
      state.worktreesCreated.push(path)
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    if (args[0] === 'worktree' && args[1] === 'remove') {
      const path = args[args.length - 1] as string
      state.worktreesRemoved.push(path)
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    if (args[0] === 'diff' && args.includes('--shortstat')) {
      return { stdout: state.diffShortstat, stderr: '', exitCode: 0 }
    }
    if (args[0] === 'diff') return { stdout: state.diffPatch, stderr: '', exitCode: 0 }
    if (args[0] === 'branch') return { stdout: '', stderr: '', exitCode: 0 }
    return { stdout: '', stderr: '', exitCode: 0 }
  }
}

async function runWorker(
  executor: ReturnType<typeof createInProcessExecutor>,
  prompt: string,
  profile: AgentProfile = { name: 'worker' },
): Promise<{
  events: AgentEnvironmentEvent[]
  environment: Awaited<ReturnType<typeof executor.provider.create>>
}> {
  const environment = await executor.provider.create({ profile })
  const events: AgentEnvironmentEvent[] = []
  for await (const event of environment.stream({ prompt })) events.push(event)
  return { events, environment }
}

describe('createInProcessExecutor', () => {
  it('streamPrompt emits started → ended → result events with the raw patch artifact', async () => {
    const state: FakeGitState = {
      worktreesCreated: [],
      worktreesRemoved: [],
      diffPatch:
        'diff --git a/util.ts b/util.ts\n+++ b/util.ts\n@@ +1 @@\n+export const add = (a,b)=>a+b\n',
      diffShortstat: ' 1 file changed, 1 insertion(+), 0 deletions(-)\n',
      baseSha: 'abc1234',
    }
    const exec = createInProcessExecutor({
      repoRoot: '/workspace',
      harnesses: ['claude-code'],
      runGit: makeFakeGit(state),
      runHarness: vi.fn(async () => ({
        exitCode: 0,
        stdout: 'wrote util.ts',
        stderr: '',
        killedBySignal: null,
        durationMs: 100,
        timedOut: false,
      })),
    })

    const { events } = await runWorker(exec, 'add util.ts exporting add(a,b)')

    expect(events.map((e) => e.type)).toEqual([
      'worktree.worker.started',
      'worktree.worker.completed',
      'result',
    ])
    const result = events[2]!.data.result as {
      branch: string
      patch: string
      stats: { filesChanged: number; insertions: number; deletions: number }
      checks?: { tests?: { passed: boolean }; typecheck?: { passed: boolean } }
    }
    expect(result.patch).toContain('util.ts')
    expect(result.stats).toEqual({ filesChanged: 1, insertions: 1, deletions: 0 })
    // No test/typecheck command was configured → no derived checks (the gate treats absent as
    // passing; the executor reports the raw artifact without fabricating a signal).
    expect(result.checks?.tests).toBeUndefined()
    expect(result.checks?.typecheck).toBeUndefined()
    expect(state.worktreesCreated.length).toBe(1)
    expect(state.worktreesRemoved.length).toBe(1)
  })

  it('rotates harnesses round-robin across create() calls', async () => {
    const state: FakeGitState = {
      worktreesCreated: [],
      worktreesRemoved: [],
      diffPatch: '',
      diffShortstat: '',
      baseSha: 'sha',
    }
    const runHarness = vi.fn(async () => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      killedBySignal: null,
      durationMs: 1,
      timedOut: false,
    }))
    const exec = createInProcessExecutor({
      repoRoot: '/w',
      harnesses: ['claude-code', 'codex', 'opencode'],
      runGit: makeFakeGit(state),
      runHarness,
    })

    for (let i = 0; i < 6; i++) {
      await runWorker(exec, `task ${i}`)
    }
    const harnesses = runHarness.mock.calls.map((c) => (c[0] as { harness: string }).harness)
    expect(harnesses).toEqual([
      'claude-code',
      'codex',
      'opencode',
      'claude-code',
      'codex',
      'opencode',
    ])
  })

  it('runs testCmd + typecheckCmd against the worktree and folds results into the artifact checks', async () => {
    const state: FakeGitState = {
      worktreesCreated: [],
      worktreesRemoved: [],
      diffPatch: '',
      diffShortstat: '',
      baseSha: 'sha',
    }
    const runPostCheck = vi.fn(async (cmd: string) => ({
      exitCode: cmd === 'pnpm test' ? 0 : 1,
      stdout: '',
      stderr: cmd === 'pnpm test' ? 'tests pass' : 'type error in foo.ts:42',
    }))
    const exec = createInProcessExecutor({
      repoRoot: '/w',
      harnesses: ['claude-code'],
      testCmd: 'pnpm test',
      typecheckCmd: 'pnpm typecheck',
      runGit: makeFakeGit(state),
      runHarness: vi.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
        killedBySignal: null,
        durationMs: 1,
        timedOut: false,
      })),
      runPostCheck,
    })

    const { events } = await runWorker(exec, 'go')
    const result = events.find((e) => e.type === 'result')!.data.result as {
      checks?: {
        tests?: { passed: boolean }
        typecheck?: { passed: boolean; output: string }
      }
    }
    expect(result.checks?.tests?.passed).toBe(true)
    expect(result.checks?.typecheck?.passed).toBe(false)
    expect(result.checks?.typecheck?.output).toContain('type error')
    expect(runPostCheck).toHaveBeenCalledTimes(2)
  })

  it('surfaces the harness exit code on the artifact when the harness exits non-zero', async () => {
    const state: FakeGitState = {
      worktreesCreated: [],
      worktreesRemoved: [],
      diffPatch: '',
      diffShortstat: '',
      baseSha: 'sha',
    }
    const exec = createInProcessExecutor({
      repoRoot: '/w',
      runGit: makeFakeGit(state),
      runHarness: vi.fn(async () => ({
        exitCode: 2,
        stdout: '',
        stderr: 'fail',
        killedBySignal: null,
        durationMs: 1,
        timedOut: false,
      })),
    })
    const { events } = await runWorker(exec, 'x')
    const result = events.find((e) => e.type === 'result')!.data.result as {
      harness: { name: string; exitCode: number | null }
    }
    expect(result.harness.name).toBe('claude-code')
    expect(result.harness.exitCode).toBe(2)
  })

  it('cleans up worktree even when streamPrompt is aborted mid-flight', async () => {
    const state: FakeGitState = {
      worktreesCreated: [],
      worktreesRemoved: [],
      diffPatch: '',
      diffShortstat: '',
      baseSha: 'sha',
    }
    const exec = createInProcessExecutor({
      repoRoot: '/w',
      runGit: makeFakeGit(state),
      runHarness: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    await expect(runWorker(exec, 'x')).rejects.toThrow(/boom/)
    expect(state.worktreesCreated.length).toBe(1)
    expect(state.worktreesRemoved.length).toBe(1)
  })

  it('describePlacement carries harness + worktreePath after streamPrompt runs', async () => {
    const state: FakeGitState = {
      worktreesCreated: [],
      worktreesRemoved: [],
      diffPatch: '',
      diffShortstat: '',
      baseSha: 'sha',
    }
    const exec = createInProcessExecutor({
      repoRoot: '/w',
      harnesses: ['codex'],
      runGit: makeFakeGit(state),
      runHarness: vi.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
        killedBySignal: null,
        durationMs: 1,
        timedOut: false,
      })),
    })
    const { environment } = await runWorker(exec, 'x')
    const placement = await environment.placement?.()
    expect(placement?.kind).toBe('local')
    expect(placement?.providerMetadata?.worker).toBe('codex')
    expect(placement?.providerMetadata?.worktreePath).toMatch(/\.agent-worktrees/)
  })

  it('§1.5: threads the authored profile systemPrompt + model into the harness invocation', async () => {
    const state: FakeGitState = {
      worktreesCreated: [],
      worktreesRemoved: [],
      diffPatch: '',
      diffShortstat: '',
      baseSha: 'sha',
    }
    const runHarness = vi.fn(async () => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      killedBySignal: null,
      durationMs: 1,
      timedOut: false,
    }))
    const exec = createInProcessExecutor({
      repoRoot: '/w',
      harnesses: ['claude-code'],
      runGit: makeFakeGit(state),
      runHarness,
    })
    await runWorker(exec, 'add util(a,b)', {
      name: 'w',
      prompt: { systemPrompt: 'BE RIGOROUS' },
      model: { default: 'deepseek-v4-flash' },
    })
    // The harness was invoked with a composed `invocation` (NOT the prompt-only path that dropped
    // the profile): the authored systemPrompt + model reach the harness argv.
    const call = runHarness.mock.calls[0]![0] as { invocation?: { args: string[] } }
    const args = JSON.stringify(call.invocation?.args ?? [])
    expect(args).toContain('BE RIGOROUS')
    expect(args).toContain('add util(a,b)')
    expect(args).toContain('deepseek-v4-flash')
  })
})
