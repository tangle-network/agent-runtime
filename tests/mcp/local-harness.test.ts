import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/sandbox'
import { describe, expect, it, vi } from 'vitest'
import {
  harnessInvocation,
  parseCodexTokenUsage,
  runLocalHarness,
} from '../../src/mcp/local-harness'

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

  it('isolates Codex, proves the effective prompt, and captures terminal JSONL usage', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agent-runtime-codex-test-'))
    const profile: AgentProfile = {
      name: 'reproducible',
      prompt: { systemPrompt: 'SYS', instructions: ['RULE ONE', 'RULE TWO'] },
      model: { default: 'gpt-5.4', reasoningEffort: 'xhigh' },
    }
    const invocation = harnessInvocation('codex', profile, 'task', {
      codexReproducible: true,
    })
    let isolatedHome = ''
    const spawnSpy = vi.fn(
      (
        _command: string,
        args: ReadonlyArray<string>,
        opts: { cwd: string; env: NodeJS.ProcessEnv; stdio: 'pipe' },
      ) => {
        isolatedHome = opts.env.CODEX_HOME ?? ''
        expect(existsSync(isolatedHome)).toBe(true)
        if (args[0] === '--version') {
          return makeFakeChild({ stdoutChunks: ['codex-cli 0.144.1\n'] })
        }
        if (args[0] === 'sandbox') {
          expect(args).toContain('agent_runtime_reproducible')
          return makeFakeChild({ exitCode: 0 })
        }
        if (args[0] === 'debug') {
          const prompt = args.at(-1)
          return makeFakeChild({
            stdoutChunks: [
              JSON.stringify([
                {
                  role: 'developer',
                  content: [
                    {
                      type: 'input_text',
                      text: '<permissions instructions>fixed</permissions instructions>\n<environment_context>fixed</environment_context>',
                    },
                  ],
                },
                { role: 'user', content: [{ type: 'input_text', text: prompt }] },
              ]),
            ],
          })
        }
        return makeFakeChild({
          stdoutChunks: [
            '{"type":"thread.started","thread_id":"t1"}\n',
            '{"type":"turn.completed","usage":{"input_tokens":41935,"cached_input_tokens":19200,"output_tokens":273,"reasoning_output_tokens":191}}\n',
          ],
          stderrChunks: [`warning: ${opts.env.CODEX_HOME}/auth.json\n`],
        })
      },
    )

    const result = await runLocalHarness({
      harness: 'codex',
      cwd,
      taskPrompt: 'task',
      invocation,
      codexReproducible: true,
      env: { CODEX_HOME: '/definitely/missing', OPENAI_API_KEY: 'test-only' },
      spawn: spawnSpy,
    })

    expect(spawnSpy).toHaveBeenCalledTimes(5)
    expect(isolatedHome).toMatch(/agent-runtime-codex-/)
    expect(existsSync(isolatedHome)).toBe(false)
    expect(result.stderr).toContain('<ISOLATED_CODEX_HOME>/auth.json')
    expect(result.stderr).not.toContain(isolatedHome)
    expect(result.usage).toEqual({
      inputTokens: 41935,
      cachedInputTokens: 19200,
      outputTokens: 273,
      reasoningOutputTokens: 191,
    })
    expect(result.evidence?.cliVersion).toBe('codex-cli 0.144.1')
    expect(result.evidence?.effectivePromptSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.evidence?.nonPromptArgsSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.evidence?.controlledConfigSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.evidence?.policy).toEqual({
      sessionPersistence: 'ephemeral',
      userConfig: false,
      rules: false,
      projectInstructions: false,
      skillInstructions: false,
      appInstructions: false,
      toolSuggestions: false,
      multiAgentInstructions: false,
      sandbox: 'workspace-write',
      permissionProfile: 'agent_runtime_reproducible',
      approvalPolicy: 'never',
      shellNetwork: false,
      webSearch: false,
      serviceTier: 'default',
      shellEnvironment: 'core-filtered',
      loginShell: false,
      credentialsReadable: false,
      parentRepoRead: false,
      gitMetadata: false,
      temporaryDirectory: 'workspace-private',
      containerSockets: false,
    })
    expect(existsSync(cwd)).toBe(true)
    expect(readdirSync(cwd).some((name) => name.startsWith('.agent-runtime-'))).toBe(false)
    rmSync(cwd, { recursive: true, force: true })
  })

  it('rejects a reproducible Codex result without exactly one terminal usage event', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agent-runtime-codex-test-'))
    const profile: AgentProfile = {
      name: 'reproducible',
      model: { default: 'gpt-5.4', reasoningEffort: 'xhigh' },
    }
    const invocation = harnessInvocation('codex', profile, 'task', {
      codexReproducible: true,
    })
    await expect(
      runLocalHarness({
        harness: 'codex',
        cwd,
        taskPrompt: 'task',
        invocation,
        codexReproducible: true,
        env: { CODEX_HOME: '/definitely/missing', OPENAI_API_KEY: 'test-only' },
        spawn: (_command, args) => {
          if (args[0] === '--version') {
            return makeFakeChild({ stdoutChunks: ['codex-cli 0.144.1\n'] })
          }
          if (args[0] === 'sandbox') return makeFakeChild({ exitCode: 0 })
          if (args[0] === 'debug') {
            return makeFakeChild({
              stdoutChunks: [
                JSON.stringify([
                  {
                    content: [
                      {
                        text: '<permissions instructions>x</permissions instructions><environment_context>x</environment_context>',
                      },
                    ],
                  },
                  { content: [{ text: args.at(-1) }] },
                ]),
              ],
            })
          }
          return makeFakeChild({ stdoutChunks: ['{"type":"turn.started"}\n'] })
        },
      }),
    ).rejects.toThrow(/exactly one Codex turn\.completed usage event/)
    rmSync(cwd, { recursive: true, force: true })
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

  it('composes systemPrompt, every authored instruction, then the task in order', () => {
    const inv = harnessInvocation(
      'codex',
      {
        name: 'authored',
        prompt: { systemPrompt: 'SYS', instructions: ['FIRST', 'SECOND'] },
      },
      'task',
    )
    expect(inv.args).toEqual(['exec', 'SYS\n\nFIRST\n\nSECOND\n\ntask'])
  })

  it('maps the complete Codex profile onto the noninteractive exec command', () => {
    const inv = harnessInvocation(
      'codex',
      {
        name: 'authored',
        prompt: { systemPrompt: 'SYS' },
        model: { default: 'gpt-5.4', reasoningEffort: 'xhigh' },
      },
      'task',
    )
    expect(inv.command).toBe('codex')
    expect(inv.args).toEqual([
      'exec',
      'SYS\n\ntask',
      '-m',
      'gpt-5.4',
      '-c',
      'model_reasoning_effort="xhigh"',
    ])
  })

  it('clamps the portable ultracode effort to Codex xhigh', () => {
    const inv = harnessInvocation('codex', { model: { reasoningEffort: 'ultracode' } }, 'task')
    expect(inv.args).toEqual(['exec', 'task', '-c', 'model_reasoning_effort="xhigh"'])
  })

  it('builds the exact reproducible Codex isolation argv', () => {
    const inv = harnessInvocation(
      'codex',
      {
        name: 'authored',
        prompt: { systemPrompt: 'SYS', instructions: ['INSTRUCTION'] },
        model: { default: 'gpt-5.4', reasoningEffort: 'xhigh' },
      },
      'task',
      { codexReproducible: true },
    )
    expect(inv.args).toEqual([
      'exec',
      'SYS\n\nINSTRUCTION\n\ntask',
      '--ephemeral',
      '--ignore-rules',
      '--json',
      '-c',
      'approval_policy="never"',
      '-c',
      'web_search="disabled"',
      '-c',
      'project_doc_max_bytes=0',
      '-c',
      'skills.include_instructions=false',
      '-c',
      'include_apps_instructions=false',
      '--disable',
      'tool_suggest',
      '-c',
      'features.multi_agent_v2.root_agent_usage_hint_text=""',
      '-c',
      'features.multi_agent_v2.subagent_usage_hint_text=""',
      '-c',
      'features.multi_agent_v2.multi_agent_mode_hint_text=""',
      '--strict-config',
      '-m',
      'gpt-5.4',
      '-c',
      'model_reasoning_effort="xhigh"',
    ])
  })

  it('rejects a custom invocation that weakens reproducible Codex isolation', async () => {
    const spawnSpy = vi.fn(() => makeFakeChild({ exitCode: 0 }))
    await expect(
      runLocalHarness({
        harness: 'codex',
        cwd: '/tmp/wt',
        taskPrompt: 'task',
        invocation: {
          command: 'codex',
          args: [
            'exec',
            'task',
            '--ephemeral',
            '--ignore-user-config',
            '--ignore-rules',
            '--json',
            '-s',
            'workspace-write',
            '-c',
            'web_search="cached"',
            '-m',
            'gpt-5.4',
            '-c',
            'model_reasoning_effort="xhigh"',
          ],
        },
        codexReproducible: true,
        env: { CODEX_HOME: '/definitely/missing', OPENAI_API_KEY: 'test-only' },
        spawn: spawnSpy,
      }),
    ).rejects.toThrow(/does not match the required isolated argv/)
    expect(spawnSpy).not.toHaveBeenCalled()
  })

  it('requires an explicit model and reasoning effort for reproducible Codex', () => {
    expect(() =>
      harnessInvocation('codex', { name: 'missing-model' }, 'task', {
        codexReproducible: true,
      }),
    ).toThrow(/requires profile\.model\.default/)
    expect(() =>
      harnessInvocation('codex', { model: { default: 'gpt-5.4' } }, 'task', {
        codexReproducible: true,
      }),
    ).toThrow(/requires profile\.model\.reasoningEffort/)
    expect(() =>
      harnessInvocation(
        'claude',
        { model: { default: 'claude-opus-4-1', reasoningEffort: 'high' } },
        'task',
        { codexReproducible: true },
      ),
    ).toThrow(/requires the Codex harness/)
  })

  it('rejects an unknown Codex reasoning effort instead of emitting invalid config', () => {
    expect(() =>
      harnessInvocation(
        'codex',
        // @ts-expect-error testing runtime validation
        { model: { reasoningEffort: 'unbounded' } },
        'task',
      ),
    ).toThrow(/unsupported Codex reasoning effort unbounded/)
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

describe('parseCodexTokenUsage', () => {
  it('rejects malformed or internally inconsistent usage', () => {
    expect(() => parseCodexTokenUsage('not json')).toThrow(/not valid JSON/)
    expect(() =>
      parseCodexTokenUsage(
        '{"type":"turn.completed","usage":{"input_tokens":2,"cached_input_tokens":3,"output_tokens":1,"reasoning_output_tokens":0}}',
      ),
    ).toThrow(/cached_input_tokens exceeds input_tokens/)
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
