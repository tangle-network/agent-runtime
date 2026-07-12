import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { AgentProfile } from '@tangle-network/sandbox'
import { describe, expect, it, vi } from 'vitest'
import { harnessInvocation, runLocalHarness } from '../../src/mcp/local-harness'

function makeFakeChild(opts: {
  stdoutChunks?: string[]
  stderrChunks?: string[]
  exitCode?: number | null
  signal?: NodeJS.Signals | null
  emitErrorBeforeClose?: Error
  delayCloseMs?: number
}): ChildProcess {
  const emitter = new EventEmitter() as ChildProcess
  const stdout = new EventEmitter() as ChildProcess['stdout']
  const stderr = new EventEmitter() as ChildProcess['stderr']
  ;(emitter as unknown as { stdout: typeof stdout }).stdout = stdout
  ;(emitter as unknown as { stderr: typeof stderr }).stderr = stderr
  ;(emitter as unknown as { kill: (sig: NodeJS.Signals) => boolean }).kill = vi.fn((sig) => {
    setImmediate(() => emitter.emit('close', null, sig))
    return true
  })
  ;(emitter as unknown as { killed: boolean }).killed = false

  setImmediate(() => {
    for (const chunk of opts.stdoutChunks ?? []) stdout?.emit('data', chunk)
    for (const chunk of opts.stderrChunks ?? []) stderr?.emit('data', chunk)
    if (opts.emitErrorBeforeClose) {
      emitter.emit('error', opts.emitErrorBeforeClose)
      return
    }
    const fire = () => emitter.emit('close', opts.exitCode ?? 0, opts.signal ?? null)
    if (opts.delayCloseMs && opts.delayCloseMs > 0) setTimeout(fire, opts.delayCloseMs)
    else fire()
  })

  return emitter
}

describe('runLocalHarness', () => {
  it('runs the harness, captures stdout + stderr, returns exit code', async () => {
    const result = await runLocalHarness({
      harness: 'claude',
      cwd: '/tmp/wt',
      taskPrompt: 'add util.ts',
      spawn: () => makeFakeChild({ stdoutChunks: ['hello'], stderrChunks: ['warn'], exitCode: 0 }),
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('hello')
    expect(result.stderr).toBe('warn')
    expect(result.killedBySignal).toBeNull()
    expect(result.timedOut).toBe(false)
  })

  it('captures non-zero exit code without throwing', async () => {
    const result = await runLocalHarness({
      harness: 'codex',
      cwd: '/tmp/wt',
      taskPrompt: 'bad task',
      spawn: () => makeFakeChild({ stdoutChunks: [], stderrChunks: ['error: oops'], exitCode: 2 }),
    })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('error')
  })

  it('throws on spawn error (binary not found)', async () => {
    await expect(
      runLocalHarness({
        harness: 'opencode',
        cwd: '/tmp/wt',
        taskPrompt: 'x',
        spawn: () =>
          makeFakeChild({ emitErrorBeforeClose: new Error('ENOENT: opencode not on PATH') }),
      }),
    ).rejects.toThrow(/ENOENT/)
  })

  it('kills subprocess + flags timedOut when timeoutMs elapses', async () => {
    vi.useFakeTimers()
    const promise = runLocalHarness({
      harness: 'claude',
      cwd: '/tmp/wt',
      taskPrompt: 'slow',
      timeoutMs: 100,
      spawn: () => makeFakeChild({ delayCloseMs: 10_000, exitCode: 0 }),
    })
    await vi.advanceTimersByTimeAsync(150)
    vi.useRealTimers()
    const result = await promise
    expect(result.timedOut).toBe(true)
    expect(result.killedBySignal).toBe('SIGTERM')
  })

  it('kills subprocess on AbortSignal', async () => {
    const ctl = new AbortController()
    const promise = runLocalHarness({
      harness: 'claude',
      cwd: '/tmp/wt',
      taskPrompt: 'slow',
      signal: ctl.signal,
      spawn: () => makeFakeChild({ delayCloseMs: 1000, exitCode: 0 }),
    })
    setTimeout(() => ctl.abort(), 5)
    const result = await promise
    expect(result.killedBySignal).toBe('SIGTERM')
  })

  it('rejects unknown harness name', async () => {
    await expect(
      runLocalHarness({
        // @ts-expect-error testing runtime validation
        harness: 'gemini-cli',
        cwd: '/tmp/wt',
        taskPrompt: 'x',
        spawn: () => makeFakeChild({ exitCode: 0 }),
      }),
    ).rejects.toThrow(/unknown harness/)
  })

  it('builds CLI-correct args for each known harness', async () => {
    const spawnSpy = vi.fn((_cmd: string, _args: ReadonlyArray<string>) =>
      makeFakeChild({ exitCode: 0 }),
    )
    for (const harness of ['claude', 'codex', 'opencode'] as const) {
      await runLocalHarness({ harness, cwd: '/tmp/wt', taskPrompt: 'go', spawn: spawnSpy })
    }
    const calls = spawnSpy.mock.calls
    expect(calls[0][0]).toBe('claude')
    expect(calls[0][1]).toEqual(['-p', 'go'])
    expect(calls[1][0]).toBe('codex')
    expect(calls[1][1]).toEqual(['exec', 'go'])
    expect(calls[2][0]).toBe('opencode')
    expect(calls[2][1]).toEqual(['run', 'go'])
  })

  it('adds Claude permission bypass only when the caller explicitly opts in', async () => {
    const spawnSpy = vi.fn((_cmd: string, _args: ReadonlyArray<string>) =>
      makeFakeChild({ exitCode: 0 }),
    )
    await runLocalHarness({
      harness: 'claude',
      cwd: '/tmp/isolated-worktree',
      taskPrompt: 'go',
      dangerouslySkipPermissions: true,
      spawn: spawnSpy,
    })
    expect(spawnSpy.mock.calls[0][1]).toEqual(['-p', 'go', '--dangerously-skip-permissions'])
  })

  it('honors a pre-built invocation override (profile-aware args) without rebuilding from the prompt', async () => {
    const spawnSpy = vi.fn((_cmd: string, _args: ReadonlyArray<string>) =>
      makeFakeChild({ exitCode: 0 }),
    )
    await runLocalHarness({
      harness: 'claude',
      cwd: '/tmp/wt',
      // The prompt-only fallback path would emit ['-p','go'] — the override wins exactly.
      taskPrompt: 'go',
      invocation: { command: 'claude', args: ['-p', 'sys\n\ngo', '-m', 'deepseek'] },
      spawn: spawnSpy,
    })
    expect(spawnSpy.mock.calls[0][0]).toBe('claude')
    expect(spawnSpy.mock.calls[0][1]).toEqual(['-p', 'sys\n\ngo', '-m', 'deepseek'])
  })
})

describe('harnessInvocation (the §1.5 profile-aware mapper)', () => {
  const profileWith = (systemPrompt?: string, model?: string): AgentProfile => ({
    name: 'authored',
    ...(systemPrompt ? { prompt: { systemPrompt } } : {}),
    ...(model ? { model: { default: model } } : {}),
  })

  it('threads the authored systemPrompt into the prompt channel for every harness', () => {
    for (const harness of ['claude', 'codex', 'opencode'] as const) {
      const inv = harnessInvocation(
        harness,
        profileWith('You are a careful refactorer.'),
        'fix foo',
      )
      // The system prompt is prepended above the task prompt (portable harness-agnostic default).
      const promptArg = inv.args.find((a) => a.includes('fix foo'))
      expect(promptArg).toBe('You are a careful refactorer.\n\nfix foo')
    }
  })

  it('maps the authored model to the harness -m selector', () => {
    for (const harness of ['claude', 'codex', 'opencode'] as const) {
      const inv = harnessInvocation(harness, profileWith(undefined, 'deepseek/deepseek-v4'), 'go')
      const mIdx = inv.args.indexOf('-m')
      expect(mIdx).toBeGreaterThanOrEqual(0)
      expect(inv.args[mIdx + 1]).toBe('deepseek/deepseek-v4')
    }
  })

  it('threads BOTH systemPrompt and model together', () => {
    const inv = harnessInvocation('claude', profileWith('SYS', 'kimi-k2.7'), 'task')
    expect(inv.command).toBe('claude')
    expect(inv.args).toEqual(['-p', 'SYS\n\ntask', '-m', 'kimi-k2.7'])
  })

  it('maps the complete Codex profile onto the noninteractive exec command', () => {
    const inv = harnessInvocation('codex', profileWith('SYS', 'gpt-5.4'), 'task')
    expect(inv.command).toBe('codex')
    expect(inv.args).toEqual(['exec', 'SYS\n\ntask', '-m', 'gpt-5.4'])
  })

  it('an empty/absent profile yields exactly the legacy prompt-only shape (byte-identical)', () => {
    expect(harnessInvocation('claude', { name: 'x' }, 'go').args).toEqual(['-p', 'go'])
    expect(harnessInvocation('codex', { name: 'x' }, 'go').args).toEqual(['exec', 'go'])
    expect(harnessInvocation('opencode', { name: 'x' }, 'go').args).toEqual(['run', 'go'])
  })

  it('adds Claude permission bypass only when an isolated worktree explicitly opts in', () => {
    expect(
      harnessInvocation('claude', { name: 'x' }, 'go', {
        dangerouslySkipPermissions: true,
      }).args,
    ).toEqual(['-p', 'go', '--dangerously-skip-permissions'])
    expect(harnessInvocation('claude', { name: 'x' }, 'go').args).toEqual(['-p', 'go'])
  })

  it('throws on an unknown harness', () => {
    expect(() =>
      // @ts-expect-error testing runtime validation
      harnessInvocation('gemini-cli', { name: 'x' }, 'go'),
    ).toThrow(/unknown harness/)
  })
})

describe('runLocalHarness trace-context inheritance (in-process placement)', () => {
  it('spawned harness CLIs inherit TRACE_ID / PARENT_SPAN_ID from the MCP process env', async () => {
    const prevTrace = process.env.TRACE_ID
    const prevParent = process.env.PARENT_SPAN_ID
    process.env.TRACE_ID = 'trace-inherit-1'
    process.env.PARENT_SPAN_ID = 'span-inherit-1'
    try {
      const seenEnvs: NodeJS.ProcessEnv[] = []
      const spawnSpy = vi.fn(
        (
          _cmd: string,
          _args: ReadonlyArray<string>,
          opts: { cwd: string; env: NodeJS.ProcessEnv; stdio: 'pipe' },
        ) => {
          seenEnvs.push(opts.env)
          return makeFakeChild({ exitCode: 0 })
        },
      )
      await runLocalHarness({
        harness: 'claude',
        cwd: '/tmp/wt',
        taskPrompt: 'go',
        spawn: spawnSpy,
      })
      expect(seenEnvs[0]?.TRACE_ID).toBe('trace-inherit-1')
      expect(seenEnvs[0]?.PARENT_SPAN_ID).toBe('span-inherit-1')
    } finally {
      if (prevTrace === undefined) delete process.env.TRACE_ID
      else process.env.TRACE_ID = prevTrace
      if (prevParent === undefined) delete process.env.PARENT_SPAN_ID
      else process.env.PARENT_SPAN_ID = prevParent
    }
  })
})
