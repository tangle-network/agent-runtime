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
      harnesses: ['claude'],
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

    const box = await exec.client.create()
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    for await (const event of (
      box as unknown as {
        streamPrompt: (m: string) => AsyncGenerator<{ type: string; data: Record<string, unknown> }>
      }
    ).streamPrompt('add util.ts exporting add(a,b)')) {
      events.push(event)
    }

    expect(events.map((e) => e.type)).toEqual([
      'in_process.harness.started',
      'in_process.harness.ended',
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
      harnesses: ['claude', 'codex', 'opencode'],
      runGit: makeFakeGit(state),
      runHarness,
    })

    for (let i = 0; i < 6; i++) {
      const box = await exec.client.create()
      for await (const _ of (
        box as unknown as { streamPrompt: (m: string) => AsyncGenerator<unknown> }
      ).streamPrompt(`task ${i}`)) {
        // drain
      }
    }
    const harnesses = runHarness.mock.calls.map((c) => (c[0] as { harness: string }).harness)
    expect(harnesses).toEqual(['claude', 'codex', 'opencode', 'claude', 'codex', 'opencode'])
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
      harnesses: ['claude'],
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

    const box = await exec.client.create()
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    for await (const event of (
      box as unknown as {
        streamPrompt: (m: string) => AsyncGenerator<{ type: string; data: Record<string, unknown> }>
      }
    ).streamPrompt('go')) {
      events.push(event)
    }
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
    const box = await exec.client.create()
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    for await (const event of (
      box as unknown as {
        streamPrompt: (m: string) => AsyncGenerator<{ type: string; data: Record<string, unknown> }>
      }
    ).streamPrompt('x')) {
      events.push(event)
    }
    const result = events.find((e) => e.type === 'result')!.data.result as {
      harness: { name: string; exitCode: number | null }
    }
    expect(result.harness.name).toBe('claude')
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
    const box = await exec.client.create()
    await expect(
      (async () => {
        for await (const _ of (
          box as unknown as { streamPrompt: (m: string) => AsyncGenerator<unknown> }
        ).streamPrompt('x')) {
          // drain
        }
      })(),
    ).rejects.toThrow(/boom/)
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
    const box = await exec.client.create()
    for await (const _ of (
      box as unknown as { streamPrompt: (m: string) => AsyncGenerator<unknown> }
    ).streamPrompt('x')) {
      // drain so streamPrompt populates the worktree handle
    }
    const placement = exec.client.describePlacement?.(box) as {
      harness?: string
      worktreePath?: string
      sandboxId?: string
    }
    expect(placement?.harness).toBe('codex')
    expect(placement?.worktreePath).toMatch(/\.agent-worktrees/)
    expect(placement?.sandboxId).toMatch(/^in-process-/)
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
      harnesses: ['claude'],
      runGit: makeFakeGit(state),
      runHarness,
    })
    // The authored worker profile rides in `backend.profile` (where `buildBackendOptions` puts it).
    const box = await exec.client.create({
      backend: {
        type: 'claude',
        profile: {
          name: 'w',
          prompt: { systemPrompt: 'BE RIGOROUS' },
          model: { default: 'deepseek-v4-flash' },
        },
      },
    } as unknown as Parameters<typeof exec.client.create>[0])
    for await (const _ of (
      box as unknown as { streamPrompt: (m: string) => AsyncGenerator<unknown> }
    ).streamPrompt('add util(a,b)')) {
      // drain
    }
    // The harness was invoked with a composed `invocation` (NOT the prompt-only path that dropped
    // the profile): the authored systemPrompt + model reach the harness argv.
    const call = runHarness.mock.calls[0]![0] as { invocation?: { args: string[] } }
    const args = JSON.stringify(call.invocation?.args ?? [])
    expect(args).toContain('BE RIGOROUS')
    expect(args).toContain('add util(a,b)')
    expect(args).toContain('deepseek-v4-flash')
  })
})
