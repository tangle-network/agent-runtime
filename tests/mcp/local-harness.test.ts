import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { runLocalHarness } from '../../src/mcp/local-harness'

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
    expect(calls[0][1]).toEqual(['--headless', '-p', 'go'])
    expect(calls[1][0]).toBe('codex')
    expect(calls[1][1]).toEqual(['run', 'go'])
    expect(calls[2][0]).toBe('opencode')
    expect(calls[2][1]).toEqual(['run', 'go'])
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
      await runLocalHarness({ harness: 'claude', cwd: '/tmp/wt', taskPrompt: 'go', spawn: spawnSpy })
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
