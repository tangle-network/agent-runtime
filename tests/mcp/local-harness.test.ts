import { type ChildProcess, spawn as spawnChild } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HARNESS_NATIVE_MODEL } from '@tangle-network/agent-eval'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it, vi } from 'vitest'
import {
  CodexExecutionDiagnosticError,
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
  neverClose?: boolean
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
    if (opts.neverClose) return
    const fire = () => emitter.emit('close', opts.exitCode ?? 0, opts.signal ?? null)
    if (opts.delayCloseMs && opts.delayCloseMs > 0) setTimeout(fire, opts.delayCloseMs)
    else fire()
  })

  return emitter
}

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(path) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  if (!existsSync(path)) {
    throw new Error(`timed out waiting for child readiness file: ${path}`)
  }
}

function makeStaticElfFixture(directory: string): string {
  const path = join(directory, 'codex-static-fixture')
  const elf = Buffer.alloc(120)
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(elf)
  elf[4] = 2
  elf[5] = 1
  elf.writeUInt16LE(3, 16)
  elf.writeUInt16LE(process.arch === 'arm64' ? 183 : 62, 18)
  elf.writeBigUInt64LE(64n, 32)
  elf.writeUInt16LE(64, 52)
  elf.writeUInt16LE(56, 54)
  elf.writeUInt16LE(1, 56)
  elf.writeUInt32LE(1, 64)
  writeFileSync(path, elf)
  chmodSync(path, 0o700)
  return path
}

async function captureReproducibleCodexFailure(opts: {
  stdoutChunks?: string[]
  stderrChunks?: string[]
  exitCode?: number | null
  signal?: NodeJS.Signals | null
  delayCloseMs?: number
  timeoutMs?: number
  auth?: unknown
  envSecret?: string
}): Promise<CodexExecutionDiagnosticError> {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-runtime-codex-failure-'))
  const authHome = mkdtempSync(join(tmpdir(), 'agent-runtime-codex-auth-'))
  writeFileSync(join(authHome, 'auth.json'), JSON.stringify(opts.auth ?? {}))
  const staticCodex = makeStaticElfFixture(cwd)
  const invocation = harnessInvocation(
    'codex',
    { model: { default: 'gpt-5.4', reasoningEffort: 'xhigh' } },
    'task',
    { codexReproducible: true },
  )
  try {
    await runLocalHarness({
      harness: 'codex',
      cwd,
      taskPrompt: 'task',
      invocation,
      codexReproducible: true,
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      env: {
        CODEX_HOME: authHome,
        ...(opts.envSecret ? { OPENAI_API_KEY: opts.envSecret } : {}),
      },
      resolveCodexExecutable: async () => staticCodex,
      // The injected child is the Codex CLI process boundary; filesystem/config logic stays real.
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
        return makeFakeChild({
          stdoutChunks: opts.stdoutChunks,
          stderrChunks: opts.stderrChunks,
          exitCode: opts.exitCode,
          signal: opts.signal,
          delayCloseMs: opts.delayCloseMs,
        })
      },
    })
  } catch (error) {
    if (error instanceof CodexExecutionDiagnosticError) return error
    throw error
  } finally {
    rmSync(cwd, { recursive: true, force: true })
    rmSync(authHome, { recursive: true, force: true })
  }
  throw new Error('expected reproducible Codex execution to fail')
}

async function runCodexPromptEvidenceFixture(
  requestedPrompt: string,
  renderPrompt: (prompt: string) => string,
) {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-runtime-codex-prompt-'))
  const authHome = mkdtempSync(join(tmpdir(), 'agent-runtime-codex-auth-'))
  writeFileSync(join(authHome, 'auth.json'), '{}')
  const staticCodex = makeStaticElfFixture(cwd)
  const profile: AgentProfile = {
    name: 'reproducible',
    model: { default: 'gpt-5.4', reasoningEffort: 'xhigh' },
  }
  const invocation = harnessInvocation('codex', profile, requestedPrompt, {
    codexReproducible: true,
  })
  try {
    return await runLocalHarness({
      harness: 'codex',
      cwd,
      taskPrompt: requestedPrompt,
      invocation,
      codexReproducible: true,
      env: { CODEX_HOME: authHome },
      resolveCodexExecutable: async () => staticCodex,
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
                { content: [{ text: renderPrompt(String(args.at(-1))) }] },
              ]),
            ],
          })
        }
        return makeFakeChild({
          stdoutChunks: [
            '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n',
          ],
        })
      },
    })
  } finally {
    rmSync(cwd, { recursive: true, force: true })
    rmSync(authHome, { recursive: true, force: true })
  }
}

describe('runLocalHarness', () => {
  it('runs the harness, captures stdout + stderr, returns exit code', async () => {
    const result = await runLocalHarness({
      harness: 'claude-code',
      cwd: '/tmp/wt',
      taskPrompt: 'add util.ts',
      spawn: () => makeFakeChild({ stdoutChunks: ['hello'], stderrChunks: ['warn'], exitCode: 0 }),
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('hello')
    expect(result.stderr).toBe('warn')
    expect(result.killedBySignal).toBeNull()
    expect(result.timedOut).toBe(false)
    expect(result.aborted).toBe(false)
  })

  it('rejects a pre-aborted call before spawning a process', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled before launch')
    controller.abort(reason)
    const spawnSpy = vi.fn(() => makeFakeChild({ exitCode: 0 }))

    await expect(
      runLocalHarness({
        harness: 'claude-code',
        cwd: '/tmp/wt',
        taskPrompt: 'must not launch',
        signal: controller.signal,
        spawn: spawnSpy,
      }),
    ).rejects.toBe(reason)
    expect(spawnSpy).not.toHaveBeenCalled()
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
    const authHome = mkdtempSync(join(tmpdir(), 'agent-runtime-codex-auth-'))
    writeFileSync(join(authHome, 'auth.json'), '{}')
    const staticCodex = makeStaticElfFixture(cwd)
    const deniedGold = '/usr/lib/python3/dist-packages/oauthlib'
    const profile: AgentProfile = {
      name: 'reproducible',
      prompt: {
        systemPrompt: 'SYS\r\nSECOND LINE',
        instructions: ['RULE ONE', '# AGENTS.md instructions\r\nTASK-OWNED MARKER'],
      },
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
        opts: { cwd: string; env: NodeJS.ProcessEnv; stdio: 'pipe'; detached: boolean },
      ) => {
        isolatedHome = opts.env.CODEX_HOME ?? ''
        expect(_command).toBe(join(cwd, '.agent-runtime-bin', 'codex'))
        expect(existsSync(isolatedHome)).toBe(true)
        expect(opts.detached).toBe(process.platform !== 'win32')
        expect(opts.env.OPENAI_API_KEY).toBeUndefined()
        if (args[0] === '--version') {
          return makeFakeChild({ stdoutChunks: ['codex-cli 0.144.1\n'] })
        }
        if (args[0] === 'sandbox') {
          expect(args).toContain('agent_runtime_reproducible')
          const config = readFileSync(join(isolatedHome, 'config.toml'), 'utf8')
          expect(config).toContain('":minimal" = "read"')
          expect(config).not.toContain('extends = ":workspace"')
          expect(config).toContain(`${JSON.stringify(deniedGold)} = "deny"`)
          expect(config).toContain('"/proc" = "deny"')
          expect(config).toContain('".git" = "deny"')
          expect(config).not.toContain(`${JSON.stringify(authHome)} = "deny"`)
          const probe = args[7]
          if (typeof probe === 'string' && probe.includes('/proc/1/environ')) {
            expect(probe).toContain('/proc/self/environ')
            expect(probe).toContain('os.getppid()')
          }
          return makeFakeChild({ exitCode: 0 })
        }
        if (args[0] === 'debug') {
          const prompt = args.at(-1)?.replaceAll('\r\n', '\n')
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
      codexReadDeniedPaths: [deniedGold],
      env: { CODEX_HOME: authHome, OPENAI_API_KEY: 'must-not-reach-child' },
      spawn: spawnSpy,
      resolveCodexExecutable: async () => staticCodex,
    })

    expect(spawnSpy).toHaveBeenCalledTimes(6)
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
    expect(result.evidence?.executableSha256).toMatch(/^[a-f0-9]{64}$/)
    const composedPrompt =
      'SYS\r\nSECOND LINE\n\nRULE ONE\n\n# AGENTS.md instructions\r\nTASK-OWNED MARKER\n\ntask'
    expect(invocation.args[1]).toBe(composedPrompt)
    expect(result.evidence?.requestedPromptSha256).toBe(
      createHash('sha256').update(composedPrompt).digest('hex'),
    )
    expect(result.evidence?.effectivePromptSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.evidence?.effectivePromptSha256).not.toBe(result.evidence?.requestedPromptSha256)
    expect(result.evidence?.nonPromptArgsSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.evidence?.controlledConfigSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.evidence?.readDeniedPathsSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.evidence?.readDeniedPathCount).toBe(1)
    expect(result.evidence?.readDeniedPaths).toEqual([deniedGold])
    expect(result.evidence?.readDeniedPathsSha256).toBe(
      createHash('sha256')
        .update(JSON.stringify([deniedGold]))
        .digest('hex'),
    )
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
      hostHomeReadable: false,
      procEnvironment: 'private-sanitized',
      sensitiveEnvironmentNamesVisible: false,
      parentRepoRead: false,
      gitMetadata: false,
      temporaryDirectory: 'workspace-private',
      stagedExecutable: 'static-elf-read-only',
      callerReadDeniedPaths: 'enforced',
      containerSockets: false,
    })
    expect(existsSync(cwd)).toBe(true)
    expect(readdirSync(cwd).some((name) => name.startsWith('.agent-runtime-'))).toBe(false)
    rmSync(cwd, { recursive: true, force: true })
    rmSync(authHome, { recursive: true, force: true })
  })

  it.each([
    {
      name: 'lone carriage return',
      prompt: 'alpha\rbravo',
      render: (prompt: string) => prompt.replaceAll('\r', '\n'),
    },
    {
      name: 'non-newline whitespace',
      prompt: 'alpha  bravo',
      render: (prompt: string) => prompt.replaceAll('  ', ' '),
    },
  ])('rejects a Codex prompt rewrite of $name', async ({ prompt, render }) => {
    await expect(runCodexPromptEvidenceFixture(prompt, render)).rejects.toThrow(
      /prompt evidence did not contain the exact task prompt/,
    )
  })

  it('rejects a reproducible Codex result without exactly one terminal usage event', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agent-runtime-codex-test-'))
    const authHome = mkdtempSync(join(tmpdir(), 'agent-runtime-codex-auth-'))
    writeFileSync(join(authHome, 'auth.json'), '{}')
    const staticCodex = makeStaticElfFixture(cwd)
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
        env: { CODEX_HOME: authHome },
        resolveCodexExecutable: async () => staticCodex,
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
    rmSync(authHome, { recursive: true, force: true })
  })

  it('preserves auth error JSONL without leaking file or environment credentials', async () => {
    const authSecret = 'sk-auth-proof-1234567890'
    const envSecret = 'sk-env-proof-0987654321'
    const unknownBearer = 'unknown-bearer-proof-123456'
    const encodedAuthSecret = Buffer.from(authSecret, 'utf8').toString('base64')
    const ansiSplitAuthSecret = `${authSecret.slice(0, 8)}\u001b[31m${authSecret.slice(8)}`
    const error = await captureReproducibleCodexFailure({
      auth: { auth_mode: 'chatgpt', tokens: { access_token: authSecret } },
      envSecret,
      exitCode: 1,
      stdoutChunks: [`${JSON.stringify({ type: 'error', message: `401 Bearer ${authSecret}` })}\n`],
      stderrChunks: [
        `OPENAI_API_KEY=${envSecret}\nAuthorization: Bearer ${unknownBearer}\nencoded=${encodedAuthSecret}\nansi=${ansiSplitAuthSecret}\n`,
      ],
    })

    expect(error.code).toBe('CODEX_EXECUTION_DIAGNOSTIC')
    expect(error.reason).toMatch(/exactly one Codex turn\.completed/)
    expect(error.cause).toBeInstanceOf(Error)
    expect((error.cause as Error).stack).toContain('parseCodexTokenUsage')
    expect(error.diagnostic).toMatchObject({
      exitCode: 1,
      killedBySignal: null,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    })
    expect(error.diagnostic.stdout).toContain('"type":"error"')
    expect(error.diagnostic.stderr).toContain('<REDACTED_CREDENTIAL>')
    const serialized = JSON.stringify({
      message: error.message,
      reason: error.reason,
      diagnostic: error.diagnostic,
    })
    for (const secret of [authSecret, envSecret, unknownBearer, encodedAuthSecret]) {
      expect(serialized).not.toContain(secret)
    }
    expect(serialized).not.toContain('\u001b')
  })

  it('preserves configuration stderr and exact exit metadata', async () => {
    const configSecret = 'config-secret-proof-123456'
    const error = await captureReproducibleCodexFailure({
      exitCode: 78,
      stderrChunks: [`Error loading config.toml: api_key="${configSecret}"\n`],
    })

    expect(error.diagnostic.exitCode).toBe(78)
    expect(error.diagnostic.killedBySignal).toBeNull()
    expect(error.diagnostic.timedOut).toBe(false)
    expect(error.diagnostic.durationMs).toBeGreaterThanOrEqual(0)
    expect(error.diagnostic.stderr).toContain('Error loading config.toml')
    expect(error.diagnostic.stderr).toContain('<REDACTED_CREDENTIAL>')
    expect(error.message).not.toContain(configSecret)
  })

  it('bounds error JSONL while retaining both the opening event and terminal error', async () => {
    const padding = 'x'.repeat(12_000)
    const stdout = [
      JSON.stringify({ type: 'thread.started', padding }),
      JSON.stringify({ type: 'error', message: 'provider request failed before turn completion' }),
      '',
    ].join('\n')
    const error = await captureReproducibleCodexFailure({
      exitCode: 1,
      stdoutChunks: [stdout],
    })

    expect(error.diagnostic.stdoutTruncated).toBe(true)
    expect(error.diagnostic.stdout.length).toBeLessThanOrEqual(4096)
    expect(error.diagnostic.stdout).toContain('thread.started')
    expect(error.diagnostic.stdout).toContain('<... OUTPUT TRUNCATED ...>')
    expect(error.diagnostic.stdout).toContain('provider request failed before turn completion')
  })

  it('preserves timeout and termination signal when usage is absent', async () => {
    const error = await captureReproducibleCodexFailure({
      delayCloseMs: 100,
      timeoutMs: 1,
    })

    expect(error.diagnostic.exitCode).toBeNull()
    expect(error.diagnostic.killedBySignal).toBe('SIGTERM')
    expect(error.diagnostic.timedOut).toBe(true)
  })

  it('rejects caller read-denial paths outside reproducible Codex mode', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agent-runtime-codex-test-'))
    const spawnSpy = vi.fn(() => makeFakeChild({ exitCode: 0 }))
    await expect(
      runLocalHarness({
        harness: 'codex',
        cwd,
        taskPrompt: 'task',
        codexReadDeniedPaths: ['/usr/lib/example/gold.py'],
        spawn: spawnSpy,
      }),
    ).rejects.toThrow(/requires codexReproducible/)
    expect(spawnSpy).not.toHaveBeenCalled()
    rmSync(cwd, { recursive: true, force: true })
  })

  it('rejects relative caller read-denial paths before spawning Codex', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agent-runtime-codex-test-'))
    const invocation = harnessInvocation(
      'codex',
      { model: { default: 'gpt-5.4', reasoningEffort: 'xhigh' } },
      'task',
      { codexReproducible: true },
    )
    const spawnSpy = vi.fn(() => makeFakeChild({ exitCode: 0 }))
    await expect(
      runLocalHarness({
        harness: 'codex',
        cwd,
        taskPrompt: 'task',
        invocation,
        codexReproducible: true,
        codexReadDeniedPaths: ['relative/gold.py'],
        resolveCodexExecutable: async () => '/bin/true',
        spawn: spawnSpy,
      }),
    ).rejects.toThrow(/must contain absolute paths/)
    expect(spawnSpy).not.toHaveBeenCalled()
    expect(readdirSync(cwd).some((name) => name.startsWith('.agent-runtime-'))).toBe(false)
    rmSync(cwd, { recursive: true, force: true })
  })

  it('requires file-based Codex auth so credentials never enter the process environment', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agent-runtime-codex-test-'))
    const staticCodex = makeStaticElfFixture(cwd)
    const invocation = harnessInvocation(
      'codex',
      { model: { default: 'gpt-5.4', reasoningEffort: 'xhigh' } },
      'task',
      { codexReproducible: true },
    )
    const spawnSpy = vi.fn(() => makeFakeChild({ exitCode: 0 }))
    await expect(
      runLocalHarness({
        harness: 'codex',
        cwd,
        taskPrompt: 'task',
        invocation,
        codexReproducible: true,
        env: { CODEX_HOME: join(cwd, 'missing-auth'), OPENAI_API_KEY: 'must-not-be-used' },
        resolveCodexExecutable: async () => staticCodex,
        spawn: spawnSpy,
      }),
    ).rejects.toThrow(/requires readable auth\.json/)
    expect(spawnSpy).not.toHaveBeenCalled()
    expect(readdirSync(cwd).some((name) => name.startsWith('.agent-runtime-'))).toBe(false)
    rmSync(cwd, { recursive: true, force: true })
  })

  it('rejects a dynamically linked executable before any Codex probe or model call', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agent-runtime-codex-test-'))
    const invocation = harnessInvocation(
      'codex',
      { model: { default: 'gpt-5.4', reasoningEffort: 'xhigh' } },
      'task',
      { codexReproducible: true },
    )
    const spawnSpy = vi.fn(() => makeFakeChild({ exitCode: 0 }))
    await expect(
      runLocalHarness({
        harness: 'codex',
        cwd,
        taskPrompt: 'task',
        invocation,
        codexReproducible: true,
        resolveCodexExecutable: async () => '/bin/true',
        spawn: spawnSpy,
      }),
    ).rejects.toThrow(/statically linked Linux Codex ELF/)
    expect(spawnSpy).not.toHaveBeenCalled()
    expect(existsSync(join(cwd, '.agent-runtime-bin'))).toBe(false)
    rmSync(cwd, { recursive: true, force: true })
  })

  it('does not overwrite or remove a candidate-owned .agent-runtime-bin directory', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agent-runtime-codex-test-'))
    const staticCodex = makeStaticElfFixture(cwd)
    const stagedDirectory = join(cwd, '.agent-runtime-bin')
    const marker = join(stagedDirectory, 'candidate-owned')
    mkdirSync(stagedDirectory)
    writeFileSync(marker, 'keep')
    const invocation = harnessInvocation(
      'codex',
      { model: { default: 'gpt-5.4', reasoningEffort: 'xhigh' } },
      'task',
      { codexReproducible: true },
    )
    const spawnSpy = vi.fn(() => makeFakeChild({ exitCode: 0 }))
    await expect(
      runLocalHarness({
        harness: 'codex',
        cwd,
        taskPrompt: 'task',
        invocation,
        codexReproducible: true,
        resolveCodexExecutable: async () => staticCodex,
        spawn: spawnSpy,
      }),
    ).rejects.toThrow(/\.agent-runtime-bin must not already exist/)
    expect(spawnSpy).not.toHaveBeenCalled()
    expect(readFileSync(marker, 'utf8')).toBe('keep')
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
      harness: 'claude-code',
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

  it('SIGKILLs the entire process group when it ignores SIGTERM', async () => {
    vi.useFakeTimers()
    const child = makeFakeChild({
      delayCloseMs: 10_000,
      exitCode: 0,
    })
    Object.defineProperty(child, 'pid', { value: 43210 })
    let groupAlive = true
    const processKill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      expect(pid).toBe(-43210)
      if (signal === 'SIGKILL') {
        groupAlive = false
        child.emit('close', null, 'SIGKILL')
      } else if (signal === 0 && !groupAlive) {
        const err = new Error('no such process') as NodeJS.ErrnoException
        err.code = 'ESRCH'
        throw err
      }
      return true
    })
    try {
      const promise = runLocalHarness({
        harness: 'claude-code',
        cwd: '/tmp/wt',
        taskPrompt: 'ignore termination',
        timeoutMs: 20,
        spawn: () => child,
      })
      await vi.advanceTimersByTimeAsync(300)
      const result = await promise
      expect(result.timedOut).toBe(true)
      expect(result.killedBySignal).toBe('SIGKILL')
      expect(processKill).toHaveBeenCalledWith(-43210, 'SIGTERM')
      expect(processKill).toHaveBeenCalledWith(-43210, 'SIGKILL')
      const deliveredSignals = processKill.mock.calls
        .map(([, signal]) => signal)
        .filter((signal) => signal !== 0)
      expect(deliveredSignals).toEqual(['SIGTERM', 'SIGKILL'])
      expect(child.kill).not.toHaveBeenCalled()
    } finally {
      processKill.mockRestore()
      vi.useRealTimers()
    }
  })

  it('lets a TERM-handling grandchild flush before an aborted harness resolves', async () => {
    if (process.platform === 'win32') return
    const cwd = mkdtempSync(join(tmpdir(), 'agent-runtime-process-flush-'))
    const readyFile = join(cwd, 'grandchild.ready')
    const cleanupMarker = join(cwd, 'grandchild.cleaned')
    const grandchildScript = [
      `const fs=require('node:fs')`,
      `process.on('SIGTERM',()=>setTimeout(()=>{fs.writeFileSync(process.argv[2],'clean');process.exit(0)},40))`,
      `fs.writeFileSync(process.argv[1],String(process.pid))`,
      `setInterval(()=>{},1000)`,
    ].join(';')
    const parentScript = [
      `const {spawn}=require('node:child_process')`,
      `process.on('SIGTERM',()=>process.exit(0))`,
      `spawn(process.execPath,['-e',${JSON.stringify(grandchildScript)},process.argv[1],process.argv[2]],{stdio:'ignore'})`,
      `setInterval(()=>{},1000)`,
    ].join(';')
    const ctl = new AbortController()
    const run = runLocalHarness({
      harness: 'claude-code',
      cwd,
      taskPrompt: 'graceful process-tree cancellation smoke',
      invocation: {
        command: process.execPath,
        args: ['-e', parentScript, readyFile, cleanupMarker],
      },
      signal: ctl.signal,
      timeoutMs: 2_000,
    })

    try {
      await waitForFile(readyFile, 2_000)

      ctl.abort()
      const result = await run

      expect(result.timedOut).toBe(false)
      expect(result.killedBySignal).toBeNull()
      expect(result.aborted).toBe(true)
      expect(readFileSync(cleanupMarker, 'utf8')).toBe('clean')
    } finally {
      ctl.abort()
      await run.catch(() => undefined)
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('cleans up same-group descendants after a harness leader exits normally', async () => {
    if (process.platform === 'win32') return
    const cwd = mkdtempSync(join(tmpdir(), 'agent-runtime-process-normal-exit-'))
    const pidFile = join(cwd, 'grandchild.pid')
    const grandchildScript = [
      `const fs=require('node:fs')`,
      `process.on('SIGTERM',()=>{})`,
      `fs.writeFileSync(process.argv[1],String(process.pid))`,
      `setInterval(()=>{},1000)`,
    ].join(';')
    const parentScript = [
      `const {spawn}=require('node:child_process')`,
      `const fs=require('node:fs')`,
      `spawn(process.execPath,['-e',${JSON.stringify(grandchildScript)},process.argv[1]],{stdio:'ignore'})`,
      `const ready=setInterval(()=>{if(fs.existsSync(process.argv[1])){clearInterval(ready);process.exit(0)}},5)`,
    ].join(';')
    let grandchildPid: number | undefined

    try {
      const result = await runLocalHarness({
        harness: 'claude-code',
        cwd,
        taskPrompt: 'normal-exit process-tree cleanup smoke',
        invocation: { command: process.execPath, args: ['-e', parentScript, pidFile] },
        timeoutMs: 2_000,
      })
      grandchildPid = Number(readFileSync(pidFile, 'utf8'))

      expect(result.exitCode).toBe(0)
      expect(result.timedOut).toBe(false)
      expect(result.durationMs).toBeGreaterThanOrEqual(240)
      expect(() => process.kill(grandchildPid!, 0)).toThrow(
        expect.objectContaining({ code: 'ESRCH' }),
      )
    } finally {
      if (grandchildPid !== undefined) {
        try {
          process.kill(grandchildPid, 'SIGKILL')
        } catch {
          // The expected path already reaped it.
        }
      }
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('kills a TERM-ignoring grandchild before a timed-out harness resolves', async () => {
    if (process.platform === 'win32') return
    const cwd = mkdtempSync(join(tmpdir(), 'agent-runtime-process-tree-'))
    const pidFile = join(cwd, 'grandchild.pid')
    const grandchildScript = `process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)`
    const parentScript = [
      `const {spawn}=require('node:child_process')`,
      `const fs=require('node:fs')`,
      `const child=spawn(process.execPath,['-e',${JSON.stringify(grandchildScript)}],{stdio:'ignore'})`,
      `fs.writeFileSync(process.argv[1],String(child.pid))`,
      `process.on('SIGTERM',()=>process.exit(0))`,
      `setInterval(()=>{},1000)`,
    ].join(';')
    let grandchildPid: number | undefined
    let run: ReturnType<typeof runLocalHarness> | undefined
    try {
      run = runLocalHarness({
        harness: 'claude-code',
        cwd,
        taskPrompt: 'process-tree cancellation smoke',
        invocation: { command: process.execPath, args: ['-e', parentScript, pidFile] },
        // This covers real OS process startup; timeout behavior itself is tested above with fake time.
        timeoutMs: 2_000,
      })
      await waitForFile(pidFile, 1_000)
      grandchildPid = Number(readFileSync(pidFile, 'utf8'))
      const result = await run

      expect(result.timedOut).toBe(true)
      expect([null, 'SIGKILL']).toContain(result.killedBySignal)
      expect(() => process.kill(grandchildPid!, 0)).toThrow(
        expect.objectContaining({ code: 'ESRCH' }),
      )
    } finally {
      await run?.catch(() => undefined)
      if (grandchildPid !== undefined) {
        try {
          process.kill(grandchildPid, 'SIGKILL')
        } catch {
          // The expected path already reaped it.
        }
      }
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('retains only the newest configured bytes from noisy output', async () => {
    const result = await runLocalHarness({
      harness: 'claude-code',
      cwd: process.cwd(),
      taskPrompt: 'bounded output smoke',
      invocation: {
        command: process.execPath,
        args: ['-e', `process.stdout.write('x'.repeat(100) + 'TAIL')`],
      },
      maxOutputBytes: 32,
      timeoutMs: 1_000,
    })

    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(32)
    expect(result.stdout.endsWith('TAIL')).toBe(true)
  })

  it('kills subprocess on AbortSignal', async () => {
    const ctl = new AbortController()
    const promise = runLocalHarness({
      harness: 'claude-code',
      cwd: '/tmp/wt',
      taskPrompt: 'slow',
      signal: ctl.signal,
      spawn: () => makeFakeChild({ delayCloseMs: 1000, exitCode: 0 }),
    })
    setTimeout(() => ctl.abort(), 5)
    const result = await promise
    expect(result.killedBySignal).toBe('SIGTERM')
    expect(result.aborted).toBe(true)
  })

  it('awaits Codex probe SIGKILL confirmation before rejecting an abort', async () => {
    if (process.platform === 'win32') return
    const cwd = mkdtempSync(join(tmpdir(), 'agent-runtime-codex-probe-abort-'))
    const authHome = mkdtempSync(join(tmpdir(), 'agent-runtime-codex-auth-'))
    writeFileSync(join(authHome, 'auth.json'), '{}')
    const staticCodex = makeStaticElfFixture(cwd)
    const invocation = harnessInvocation(
      'codex',
      { model: { default: 'gpt-5.4', reasoningEffort: 'xhigh' } },
      'task',
      { codexReproducible: true },
    )
    const ctl = new AbortController()
    const probePid = 45678
    let probeChild: ChildProcess | undefined
    let killSent = false
    let confirmedGone = false
    let confirmationChecks = 0
    const processKill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      expect(pid).toBe(-probePid)
      if (signal === 'SIGKILL') {
        killSent = true
        setImmediate(() => probeChild?.emit('close', null, 'SIGKILL'))
      } else if (signal === 0 && killSent) {
        confirmationChecks += 1
        if (confirmationChecks >= 2) {
          confirmedGone = true
          const err = new Error('no such process') as NodeJS.ErrnoException
          err.code = 'ESRCH'
          throw err
        }
      }
      return true
    })

    try {
      const run = runLocalHarness({
        harness: 'codex',
        cwd,
        taskPrompt: 'task',
        invocation,
        codexReproducible: true,
        signal: ctl.signal,
        env: { CODEX_HOME: authHome },
        resolveCodexExecutable: async () => staticCodex,
        spawn: (_command, args) => {
          expect(args[0]).toBe('--version')
          probeChild = makeFakeChild({ neverClose: true })
          Object.defineProperty(probeChild, 'pid', { value: probePid })
          setImmediate(() => ctl.abort())
          return probeChild
        },
      })

      await expect(run).rejects.toThrow(/Codex evidence probe aborted/)
      expect(processKill).toHaveBeenCalledWith(-probePid, 'SIGTERM')
      expect(processKill).toHaveBeenCalledWith(-probePid, 'SIGKILL')
      expect(confirmationChecks).toBe(2)
      expect(confirmedGone).toBe(true)
    } finally {
      processKill.mockRestore()
      rmSync(cwd, { recursive: true, force: true })
      rmSync(authHome, { recursive: true, force: true })
    }
  })

  it('cleans up same-group descendants after a Codex probe exits normally', async () => {
    if (process.platform === 'win32') return
    const cwd = mkdtempSync(join(tmpdir(), 'agent-runtime-codex-probe-normal-exit-'))
    const authHome = mkdtempSync(join(tmpdir(), 'agent-runtime-codex-auth-'))
    const pidFile = join(cwd, 'probe-grandchild.pid')
    writeFileSync(join(authHome, 'auth.json'), '{}')
    const staticCodex = makeStaticElfFixture(cwd)
    const invocation = harnessInvocation(
      'codex',
      { model: { default: 'gpt-5.4', reasoningEffort: 'xhigh' } },
      'task',
      { codexReproducible: true },
    )
    const grandchildScript = [
      `const fs=require('node:fs')`,
      `process.on('SIGTERM',()=>{})`,
      `fs.writeFileSync(process.argv[1],String(process.pid))`,
      `setInterval(()=>{},1000)`,
    ].join(';')
    const probeScript = [
      `const {spawn}=require('node:child_process')`,
      `const fs=require('node:fs')`,
      `spawn(process.execPath,['-e',${JSON.stringify(grandchildScript)},process.argv[1]],{stdio:'ignore'})`,
      `const ready=setInterval(()=>{if(fs.existsSync(process.argv[1])){clearInterval(ready);console.log('codex-cli 0.144.1');process.exit(0)}},5)`,
    ].join(';')
    let grandchildPid: number | undefined

    try {
      const result = await runLocalHarness({
        harness: 'codex',
        cwd,
        taskPrompt: 'task',
        invocation,
        codexReproducible: true,
        env: { CODEX_HOME: authHome },
        resolveCodexExecutable: async () => staticCodex,
        spawn: (_command, args, opts) => {
          if (args[0] === '--version') {
            return spawnChild(process.execPath, ['-e', probeScript, pidFile], opts)
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
          return makeFakeChild({
            stdoutChunks: [
              '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1,"reasoning_output_tokens":0}}\n',
            ],
          })
        },
      })
      grandchildPid = Number(readFileSync(pidFile, 'utf8'))

      expect(result.exitCode).toBe(0)
      expect(() => process.kill(grandchildPid!, 0)).toThrow(
        expect.objectContaining({ code: 'ESRCH' }),
      )
    } finally {
      if (grandchildPid !== undefined) {
        try {
          process.kill(grandchildPid, 'SIGKILL')
        } catch {
          // The expected path already reaped it.
        }
      }
      rmSync(cwd, { recursive: true, force: true })
      rmSync(authHome, { recursive: true, force: true })
    }
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
    for (const harness of ['claude-code', 'codex', 'opencode'] as const) {
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
      harness: 'claude-code',
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
      harness: 'claude-code',
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
    for (const harness of ['claude-code', 'codex', 'opencode'] as const) {
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
    for (const harness of ['claude-code', 'codex', 'opencode'] as const) {
      const inv = harnessInvocation(harness, profileWith(undefined, 'deepseek/deepseek-v4'), 'go')
      const mIdx = inv.args.indexOf('-m')
      expect(mIdx).toBeGreaterThanOrEqual(0)
      expect(inv.args[mIdx + 1]).toBe('deepseek/deepseek-v4')
    }
  })

  it('omits the model flag when Eval delegates model selection to the harness', () => {
    for (const harness of ['claude-code', 'codex', 'opencode'] as const) {
      const inv = harnessInvocation(harness, profileWith(undefined, HARNESS_NATIVE_MODEL), 'go')
      expect(inv.args).not.toContain('-m')
      expect(inv.args).not.toContain(HARNESS_NATIVE_MODEL)
    }
  })

  it('threads BOTH systemPrompt and model together', () => {
    const inv = harnessInvocation('claude-code', profileWith('SYS', 'kimi-k2.7'), 'task')
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
        'codex',
        { model: { default: HARNESS_NATIVE_MODEL, reasoningEffort: 'high' } },
        'task',
        { codexReproducible: true },
      ),
    ).toThrow(/requires profile\.model\.default/)
    expect(() =>
      harnessInvocation(
        'claude-code',
        { model: { default: 'claude-opus-4-1', reasoningEffort: 'high' } },
        'task',
        { codexReproducible: true },
      ),
    ).toThrow(/requires the Codex harness/)
  })

  it('rejects a reasoning effort the harness cannot express instead of emitting invalid config', () => {
    expect(() =>
      harnessInvocation(
        'codex',
        // @ts-expect-error testing runtime validation
        { model: { reasoningEffort: 'unbounded' } },
        'task',
      ),
    ).toThrow(/codex cannot express reasoning effort unbounded/)
    // claude-code's `--effort` has no thinking-off or `minimal` level, so those canonical levels
    // are refused rather than silently dropped or coerced to a level the author did not ask for.
    for (const reasoningEffort of ['none', 'minimal'] as const) {
      expect(() =>
        harnessInvocation('claude-code', { model: { reasoningEffort } }, 'task'),
      ).toThrow(/claude-code cannot express reasoning effort/)
    }
    expect(() =>
      harnessInvocation('opencode', { model: { reasoningEffort: 'none' } }, 'task'),
    ).toThrow(/opencode cannot express reasoning effort none/)
  })

  it('threads reasoning effort onto every harness that has a native control', () => {
    expect(
      harnessInvocation('claude-code', { model: { reasoningEffort: 'high' } }, 'go').args,
    ).toEqual(['-p', 'go', '--effort', 'high'])
    // Canonical `ultracode` is claude-code's native `max` and opencode's `max` variant.
    expect(
      harnessInvocation('claude-code', { model: { reasoningEffort: 'ultracode' } }, 'go').args,
    ).toEqual(['-p', 'go', '--effort', 'max'])
    expect(
      harnessInvocation('opencode', { model: { reasoningEffort: 'high' } }, 'go').args,
    ).toEqual(['run', 'go', '--variant', 'high'])
    expect(harnessInvocation('codex', { model: { reasoningEffort: 'high' } }, 'go').args).toEqual([
      'exec',
      'go',
      '-c',
      'model_reasoning_effort="high"',
    ])
  })

  it("emits each harness's own permission-bypass argv, and none where there is no gate", () => {
    const bypass = { dangerouslySkipPermissions: true }
    expect(harnessInvocation('claude-code', { name: 'x' }, 'go', bypass).args).toEqual([
      '-p',
      'go',
      '--dangerously-skip-permissions',
    ])
    // Codex keeps its OS sandbox. `--dangerously-bypass-approvals-and-sandbox` would surrender it,
    // and `codex exec` has no approval gate to stall on in the first place, so that flag pays the
    // whole sandbox for nothing. The sandbox is what keeps the blast radius equal to the worktree.
    expect(harnessInvocation('codex', { name: 'x' }, 'go', bypass).args).toEqual([
      'exec',
      'go',
      '--sandbox',
      'workspace-write',
      '-c',
      'approval_policy="never"',
    ])
    expect(harnessInvocation('codex', { name: 'x' }, 'go', bypass).args).not.toContain(
      '--dangerously-bypass-approvals-and-sandbox',
    )
    // `opencode run` is non-interactive and declares no bypass argv, so asking for one is a no-op
    // rather than a silently dropped request for a flag that does not exist.
    expect(harnessInvocation('opencode', { name: 'x' }, 'go', bypass).args).toEqual(['run', 'go'])
  })

  it('an empty/absent profile yields exactly the legacy prompt-only shape (byte-identical)', () => {
    expect(harnessInvocation('claude-code', { name: 'x' }, 'go').args).toEqual(['-p', 'go'])
    expect(harnessInvocation('codex', { name: 'x' }, 'go').args).toEqual(['exec', 'go'])
    expect(harnessInvocation('opencode', { name: 'x' }, 'go').args).toEqual(['run', 'go'])
  })

  it('adds Claude permission bypass only when an isolated worktree explicitly opts in', () => {
    expect(
      harnessInvocation('claude-code', { name: 'x' }, 'go', {
        dangerouslySkipPermissions: true,
      }).args,
    ).toEqual(['-p', 'go', '--dangerously-skip-permissions'])
    expect(harnessInvocation('claude-code', { name: 'x' }, 'go').args).toEqual(['-p', 'go'])
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
        harness: 'claude-code',
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
