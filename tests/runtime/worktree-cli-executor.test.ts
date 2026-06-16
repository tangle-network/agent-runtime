import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { AgentProfile } from '@tangle-network/sandbox'
import { describe, expect, it, vi } from 'vitest'
import { type RunLocalHarnessOptions, runLocalHarness } from '../../src/mcp/local-harness'
import type { GitRunner } from '../../src/mcp/worktree'
import { createWorktreeCliExecutor } from '../../src/runtime/supervise/worktree-cli-executor'

interface FakeGitState {
  worktreesCreated: string[]
  worktreesRemoved: string[]
  diffPatch: string
  diffShortstat: string
  baseSha: string
}

function makeFakeGit(state: FakeGitState): GitRunner {
  return (args, _opts) => {
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

function freshGitState(overrides?: Partial<FakeGitState>): FakeGitState {
  return {
    worktreesCreated: [],
    worktreesRemoved: [],
    diffPatch: 'diff --git a/foo.ts b/foo.ts\n+++ b/foo.ts\n@@ +1 @@\n+export const x = 1\n',
    diffShortstat: ' 1 file changed, 1 insertion(+), 0 deletions(-)\n',
    baseSha: 'deadbeef',
    ...overrides,
  }
}

const authoredProfile: AgentProfile = {
  name: 'careful-refactorer',
  prompt: { systemPrompt: 'You are a careful refactorer. Keep diffs minimal.' },
  model: { default: 'deepseek/deepseek-v4-flash' },
}

/** A fake child process that emits a clean exit (mirrors local-harness.test's helper). */
function makeFakeChild(opts: { stdout?: string; exitCode?: number }): ChildProcess {
  const emitter = new EventEmitter() as ChildProcess
  const stdout = new EventEmitter() as ChildProcess['stdout']
  const stderr = new EventEmitter() as ChildProcess['stderr']
  ;(emitter as unknown as { stdout: typeof stdout }).stdout = stdout
  ;(emitter as unknown as { stderr: typeof stderr }).stderr = stderr
  ;(emitter as unknown as { kill: () => boolean }).kill = vi.fn(() => true)
  ;(emitter as unknown as { killed: boolean }).killed = false
  setImmediate(() => {
    if (opts.stdout) stdout?.emit('data', opts.stdout)
    emitter.emit('close', opts.exitCode ?? 0, null)
  })
  return emitter
}

describe('createWorktreeCliExecutor', () => {
  it('threads the authored systemPrompt + model into the harness invocation', async () => {
    const state = freshGitState()
    let seen: RunLocalHarnessOptions | undefined
    const runHarness = vi.fn(async (o: RunLocalHarnessOptions) => {
      seen = o
      return {
        exitCode: 0,
        stdout: 'done',
        stderr: '',
        killedBySignal: null,
        durationMs: 42,
        timedOut: false,
      }
    })

    const exec = createWorktreeCliExecutor({
      repoRoot: '/workspace',
      profile: authoredProfile,
      harness: 'claude',
      taskPrompt: 'fix the off-by-one',
      runGit: makeFakeGit(state),
      runHarness,
    })

    await exec.execute(undefined, new AbortController().signal)

    expect(seen).toBeDefined()
    expect(seen?.harness).toBe('claude')
    // The §1.5 fix: the authored systemPrompt reaches the harness PROMPT channel ...
    const promptArg = seen?.invocation?.args.find((a) => a.includes('fix the off-by-one'))
    expect(promptArg).toBe(
      'You are a careful refactorer. Keep diffs minimal.\n\nfix the off-by-one',
    )
    // ... and the authored model reaches the harness `-m` selector.
    const args = seen?.invocation?.args ?? []
    const mIdx = args.indexOf('-m')
    expect(mIdx).toBeGreaterThanOrEqual(0)
    expect(args[mIdx + 1]).toBe('deepseek/deepseek-v4-flash')
  })

  it('the worktree diff becomes the patch artifact', async () => {
    const state = freshGitState({
      diffPatch: 'diff --git a/a.ts b/a.ts\n+++ b/a.ts\n@@ +1 @@\n+const a = 2\n',
      diffShortstat: ' 2 files changed, 5 insertions(+), 1 deletion(-)\n',
    })
    const exec = createWorktreeCliExecutor({
      repoRoot: '/workspace',
      profile: authoredProfile,
      harness: 'codex',
      taskPrompt: 'add a.ts',
      runGit: makeFakeGit(state),
      runHarness: vi.fn(async () => ({
        exitCode: 0,
        stdout: 'wrote a.ts',
        stderr: '',
        killedBySignal: null,
        durationMs: 10,
        timedOut: false,
      })),
    })

    const result = await exec.execute(undefined, new AbortController().signal)
    expect(result.out.patch).toContain('+const a = 2')
    expect(result.out.stats).toEqual({ filesChanged: 2, insertions: 5, deletions: 1 })
    expect(result.out.harness.name).toBe('codex')
    expect(result.out.harness.exitCode).toBe(0)
    expect(result.out.branch).toMatch(/^delegate\//)
    // resultArtifact() returns the same settled artifact (the replay source).
    expect(exec.resultArtifact().out.patch).toBe(result.out.patch)
    expect(result.outRef.length).toBeGreaterThan(0)
  })

  it('removes the worktree on teardown', async () => {
    const state = freshGitState()
    const exec = createWorktreeCliExecutor({
      repoRoot: '/workspace',
      profile: authoredProfile,
      harness: 'opencode',
      taskPrompt: 'noop',
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

    await exec.execute(undefined, new AbortController().signal)
    expect(state.worktreesCreated.length).toBe(1)
    expect(state.worktreesRemoved.length).toBe(0)

    const td = await exec.teardown(0)
    expect(td.destroyed).toBe(true)
    expect(state.worktreesRemoved).toEqual(state.worktreesCreated)
  })

  it('is budgetExempt (a harness CLI cannot account tokens)', () => {
    const exec = createWorktreeCliExecutor({
      repoRoot: '/workspace',
      profile: authoredProfile,
      harness: 'claude',
      taskPrompt: 'x',
      runGit: makeFakeGit(freshGitState()),
      runHarness: vi.fn(),
    })
    expect(exec.runtime).toBe('cli')
    expect(exec.budgetExempt).toBe(true)
  })

  it('resultArtifact() before execute() resolves throws (fail loud, no fabricated artifact)', () => {
    const exec = createWorktreeCliExecutor({
      repoRoot: '/workspace',
      profile: authoredProfile,
      harness: 'claude',
      taskPrompt: 'x',
      runGit: makeFakeGit(freshGitState()),
      runHarness: vi.fn(),
    })
    expect(() => exec.resultArtifact()).toThrow(/resultArtifact\(\) read before execute/)
  })

  it('closes the harness subprocess stdin (the #308 fix) through the real runLocalHarness spawn', async () => {
    const state = freshGitState()
    const endSpy = vi.fn()
    // Drive the REAL runLocalHarness with a mocked spawn so the stdin-closed shape is exercised.
    const spawnImpl = vi.fn((_cmd: string, _args: ReadonlyArray<string>) => {
      const child = makeFakeChild({ stdout: 'ok', exitCode: 0 })
      ;(child as unknown as { stdin: { end: () => void } }).stdin = { end: endSpy }
      return child
    })
    const realRunHarness: typeof runLocalHarness = (o) =>
      runLocalHarness({ ...o, spawn: spawnImpl })

    const exec = createWorktreeCliExecutor({
      repoRoot: '/workspace',
      profile: authoredProfile,
      harness: 'opencode',
      taskPrompt: 'do it',
      runGit: makeFakeGit(state),
      runHarness: realRunHarness,
    })

    await exec.execute(undefined, new AbortController().signal)
    // stdin.end() — the #308 fix that stops a non-TTY harness blocking on input forever.
    expect(endSpy).toHaveBeenCalledTimes(1)
    // The profile-aware invocation flowed through the real runner (model -> -m).
    const spawnedArgs = spawnImpl.mock.calls[0][1]
    expect(spawnedArgs).toContain('-m')
    expect(spawnedArgs).toContain('deepseek/deepseek-v4-flash')
  })

  it('derives test/typecheck PASS signals in the live worktree (the re-homed coder signals)', async () => {
    const state = freshGitState()
    const ranIn: { command: string; cwd: string }[] = []
    const exec = createWorktreeCliExecutor({
      repoRoot: '/workspace',
      profile: authoredProfile,
      harness: 'opencode',
      taskPrompt: 'do it',
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
      runCommand: async ({ command, cwd }) => {
        ranIn.push({ command, cwd })
        // tests pass (exit 0), typecheck fails (exit 1) — both signals captured.
        return command === 'pnpm test'
          ? { exitCode: 0, output: 'all green' }
          : { exitCode: 1, output: 'type error' }
      },
    })

    const result = await exec.execute(undefined, new AbortController().signal)
    // Commands ran in the cut worktree, not the repo root.
    expect(ranIn.map((r) => r.command)).toEqual(['pnpm test', 'pnpm typecheck'])
    expect(ranIn.every((r) => r.cwd === state.worktreesCreated[0])).toBe(true)
    expect(result.out.checks?.tests?.passed).toBe(true)
    expect(result.out.checks?.typecheck?.passed).toBe(false)
    expect(result.out.checks?.typecheck?.exitCode).toBe(1)
  })

  it('omits `checks` entirely when no verification command is configured', async () => {
    const exec = createWorktreeCliExecutor({
      repoRoot: '/workspace',
      profile: authoredProfile,
      harness: 'claude',
      taskPrompt: 'x',
      runGit: makeFakeGit(freshGitState()),
      runHarness: vi.fn(async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
        killedBySignal: null,
        durationMs: 1,
        timedOut: false,
      })),
    })
    const result = await exec.execute(undefined, new AbortController().signal)
    expect(result.out.checks).toBeUndefined()
  })

  it('fails loud on a missing repoRoot / harness / taskPrompt', () => {
    expect(() =>
      createWorktreeCliExecutor({
        repoRoot: '',
        profile: authoredProfile,
        harness: 'claude',
        taskPrompt: 'x',
      }),
    ).toThrow(/repoRoot required/)
    expect(() =>
      createWorktreeCliExecutor({
        repoRoot: '/workspace',
        profile: authoredProfile,
        harness: 'claude',
        taskPrompt: '',
      }),
    ).toThrow(/taskPrompt required/)
  })
})
