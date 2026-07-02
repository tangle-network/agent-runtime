import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough, type Readable } from 'node:stream'
import type { AgentProfile } from '@tangle-network/sandbox'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The bridge transport (`streamBridgeSession`) POSTs over the `node:http` core client,
// not global `fetch`, so a slow local bridge isn't killed by undici's headers timeout.
// Tests drive it by setting `bridgeHttpHandler` — the fake `request` reads the POST body,
// hands the test the parsed payload, and streams back an SSE `IncomingMessage`.
let bridgeHttpHandler: ((payload: Record<string, unknown>) => Readable) | null = null

vi.mock('node:http', async () => {
  const actual = await vi.importActual<typeof import('node:http')>('node:http')
  return {
    ...actual,
    request: (
      _url: unknown,
      _opts: unknown,
      cb: (res: Readable) => void,
    ): { write: (b: string) => void; end: () => void; on: () => void; destroy: () => void } => {
      let body = ''
      return {
        write: (chunk: string) => {
          body += chunk
        },
        end: () => {
          const payload = JSON.parse(body || '{}') as Record<string, unknown>
          if (!bridgeHttpHandler) throw new Error('bridgeHttpHandler not set')
          const res = bridgeHttpHandler(payload) as Readable & { statusCode?: number }
          res.statusCode = res.statusCode ?? 200
          cb(res)
        },
        on: () => {},
        destroy: () => {},
      }
    },
  }
})

import { type RunLocalHarnessOptions, runLocalHarness } from '../../src/mcp/local-harness'
import type { GitRunner } from '../../src/mcp/worktree'
import { type AgentSpec, createExecutor } from '../../src/runtime'
import {
  createWorktreeCliExecutor,
  type WorktreePatchArtifact,
} from '../../src/runtime/supervise/worktree-cli-executor'

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

function bridgeSseResponse(content: string): Readable {
  const payload = [
    `data: ${JSON.stringify({
      choices: [{ delta: { content } }],
      usage: { prompt_tokens: 3, completion_tokens: 5, cost: 0.02 },
    })}`,
    '',
    'data: [DONE]',
    '',
  ].join('\n')
  const stream = new PassThrough()
  stream.end(payload)
  return stream
}

async function drain(iterable: AsyncIterable<unknown>): Promise<void> {
  for await (const event of iterable) {
    void event
  }
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
  afterEach(() => {
    vi.unstubAllGlobals()
    bridgeHttpHandler = null
  })

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

  it('is budgetExempt by default (a harness CLI cannot account tokens)', () => {
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

  it('budgetExempt: false opts the leaf into metering (explicit, not a buried hardcode)', () => {
    const exec = createWorktreeCliExecutor({
      repoRoot: '/workspace',
      profile: authoredProfile,
      harness: 'claude',
      taskPrompt: 'x',
      budgetExempt: false,
      runGit: makeFakeGit(freshGitState()),
      runHarness: vi.fn(),
    })
    expect(exec.budgetExempt).toBe(false)
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

  it('runs cli-worktree over the live bridge transport without losing isolation or steering', async () => {
    const state = freshGitState({
      diffPatch:
        'diff --git a/live.ts b/live.ts\n+++ b/live.ts\n@@ +1 @@\n+export const live = true\n',
      diffShortstat: ' 1 file changed, 1 insertion(+), 0 deletions(-)\n',
    })
    const requests: Array<{
      cwd?: string
      session_id?: string
      messages?: Array<{ role: string; content: string }>
    }> = []
    const checks: Array<{ command: string; cwd: string }> = []
    bridgeHttpHandler = (payload) => {
      requests.push(payload as (typeof requests)[number])
      return bridgeSseResponse('done from bridge')
    }

    const factory = createExecutor({
      backend: 'cli-worktree',
      repoRoot: '/workspace',
      taskPrompt: 'implement the feature',
      runId: 'run-live',
      bridge: {
        bridgeUrl: 'http://bridge.test',
        bridgeBearer: 'secret',
        model: 'codex/live',
        sessionId: 'session-live',
      },
      testCmd: 'pnpm test',
      runGit: makeFakeGit(state),
      runCommand: async ({ command, cwd }) => {
        checks.push({ command, cwd })
        return { exitCode: 0, output: 'tests passed' }
      },
    })
    const spec: AgentSpec = { profile: authoredProfile, harness: null }
    const exec = factory(spec, { signal: new AbortController().signal, seams: {} })

    exec.deliver?.({ steer: 'also update docs' })
    const run = exec.execute(undefined, new AbortController().signal)
    await drain(run as AsyncIterable<unknown>)

    const worktreePath = state.worktreesCreated[0]
    expect(worktreePath).toBe('/workspace/.agent-worktrees/run-live')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.cwd).toBe(worktreePath)
    expect(requests[0]?.session_id).toBe('session-live')
    expect(requests[0]?.messages?.some((m) => m.content.includes('implement the feature'))).toBe(
      true,
    )
    expect(requests[0]?.messages?.some((m) => m.content.includes('also update docs'))).toBe(true)
    expect(checks).toEqual([{ command: 'pnpm test', cwd: worktreePath }])

    const artifact = exec.resultArtifact()
    const out = artifact.out as WorktreePatchArtifact
    expect(out.patch).toContain('+export const live = true')
    expect(out.stats).toEqual({ filesChanged: 1, insertions: 1, deletions: 0 })
    expect(out.harness.name).toBe('bridge')
    expect(out.harness.stdout).toBe('done from bridge')
    expect(out.checks?.tests?.passed).toBe(true)
    expect(artifact.spent.tokens).toEqual({ input: 3, output: 5 })
    expect(artifact.spent.usd).toBe(0.02)

    const teardown = await exec.teardown(0)
    expect(teardown.destroyed).toBe(true)
    expect(state.worktreesRemoved).toEqual(state.worktreesCreated)
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
