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
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as scheduleTimeout } from 'node:timers'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it, vi } from 'vitest'
import { CodexExecutionDiagnosticError } from '../../src/mcp/codex-diagnostics'
import {
  harnessInvocation,
  harnessMaterializesProfileMcp,
  harnessSupportsReasoningEffort,
} from '../../src/mcp/local-harness-invocation'
import { runLocalHarness } from '../../src/mcp/local-harness-process'

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

/**
 * A file the vendor check accepts on THIS host.
 *
 * Reproducible mode verifies the binary's own header, so the fixture must be the format the
 * host vendors: a static musl ELF on linux, a Mach-O executable on darwin. A fixture pinned to
 * one format is why these cases could only ever run on Linux.
 */
function makeVendoredCodexFixture(directory: string): string {
  const path = join(directory, 'codex-static-fixture')
  writeFileSync(path, process.platform === 'darwin' ? machO64Fixture() : staticElfFixture())
  chmodSync(path, 0o700)
  return path
}

/** 64-bit Mach-O header for this architecture; the loader never runs it, the check only reads it. */
function machO64Fixture(): Buffer {
  const macho = Buffer.alloc(120)
  macho.writeUInt32LE(0xfeedfacf, 0)
  macho.writeUInt32LE(process.arch === 'x64' ? 0x01000007 : 0x0100000c, 4)
  macho.writeUInt32LE(2, 12)
  return macho
}

/** Static ELF: PT_LOAD only, no PT_INTERP, so the dynamic-link rejection stays exercised. */
function staticElfFixture(): Buffer {
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
  return elf
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
  const staticCodex = makeVendoredCodexFixture(cwd)
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
  const staticCodex = makeVendoredCodexFixture(cwd)
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
  it('isolates Codex, proves the effective prompt, and captures terminal JSONL usage', async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'agent-runtime-codex-test-')))
    const authHome = mkdtempSync(join(tmpdir(), 'agent-runtime-codex-auth-'))
    writeFileSync(join(authHome, 'auth.json'), '{}')
    const staticCodex = makeVendoredCodexFixture(cwd)
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
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'agent-runtime-codex-test-')))
    const authHome = mkdtempSync(join(tmpdir(), 'agent-runtime-codex-auth-'))
    writeFileSync(join(authHome, 'auth.json'), '{}')
    const staticCodex = makeVendoredCodexFixture(cwd)
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

  it('requires file-based Codex auth so credentials never enter the process environment', async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'agent-runtime-codex-test-')))
    const staticCodex = makeVendoredCodexFixture(cwd)
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
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'agent-runtime-codex-test-')))
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
    ).rejects.toThrow(/requires the vendored native Codex build/)
    expect(spawnSpy).not.toHaveBeenCalled()
    expect(existsSync(join(cwd, '.agent-runtime-bin'))).toBe(false)
    rmSync(cwd, { recursive: true, force: true })
  })

  it('does not overwrite or remove a candidate-owned .agent-runtime-bin directory', async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'agent-runtime-codex-test-')))
    const staticCodex = makeVendoredCodexFixture(cwd)
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
    const grandchildScript = [
      `const fs=require('node:fs')`,
      // Readiness deliberately exceeds the old one-second startup window.
      `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1200)`,
      `process.on('SIGTERM',()=>{})`,
      `fs.writeFileSync(process.argv[1],String(process.pid))`,
      `setInterval(()=>{},1000)`,
    ].join(';')
    const parentScript = [
      `const {spawn}=require('node:child_process')`,
      `process.on('SIGTERM',()=>process.exit(0))`,
      `spawn(process.execPath,['-e',${JSON.stringify(grandchildScript)},process.argv[1]],{stdio:'ignore'})`,
      `setInterval(()=>{},1000)`,
    ].join(';')
    const ctl = new AbortController()
    let grandchildPid: number | undefined
    let run: ReturnType<typeof runLocalHarness> | undefined
    let fireDeadline: (() => void) | undefined
    // Hold only the harness deadline. Real OS startup and termination polling keep real time.
    const deadline = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((callback, ms, ...args) => {
        if (ms === 2_000) {
          fireDeadline = () => callback(...args)
          return scheduleTimeout(() => {}, 60_000)
        }
        return scheduleTimeout(callback, ms, ...args)
      })
    try {
      run = runLocalHarness({
        harness: 'claude-code',
        cwd,
        taskPrompt: 'process-tree cancellation smoke',
        invocation: { command: process.execPath, args: ['-e', parentScript, pidFile] },
        timeoutMs: 2_000,
        signal: ctl.signal,
      })
      deadline.mockRestore()
      expect(fireDeadline).toBeTypeOf('function')
      await waitForFile(pidFile, 10_000)
      grandchildPid = Number(readFileSync(pidFile, 'utf8'))
      fireDeadline!()
      const result = await run

      expect(result.timedOut).toBe(true)
      expect([null, 'SIGKILL']).toContain(result.killedBySignal)
      expect(() => process.kill(grandchildPid!, 0)).toThrow(
        expect.objectContaining({ code: 'ESRCH' }),
      )
    } finally {
      deadline.mockRestore()
      ctl.abort()
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
  }, 15_000)

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

  it('cleans up same-group descendants after a Codex probe exits normally', async () => {
    if (process.platform === 'win32') return
    const cwd = mkdtempSync(join(tmpdir(), 'agent-runtime-codex-probe-normal-exit-'))
    const authHome = mkdtempSync(join(tmpdir(), 'agent-runtime-codex-auth-'))
    const pidFile = join(cwd, 'probe-grandchild.pid')
    writeFileSync(join(authHome, 'auth.json'), '{}')
    const staticCodex = makeVendoredCodexFixture(cwd)
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
})

describe('kimi-code harness invocation', () => {
  it('pins the headless prompt-only argv shape', () => {
    const invocation = harnessInvocation('kimi-code', {}, 'do the task')
    expect(invocation.command).toBe('kimi')
    expect(invocation.args).toEqual(['-p', 'do the task'])
  })

  it('threads the composed prompt and the model alias through whole', () => {
    const profile: AgentProfile = {
      prompt: { systemPrompt: 'SYS', instructions: ['RULE ONE'] },
      // kimi's `-m` resolves an alias from the user's own kimi config, so a provider other
      // than a fixed native one is NOT a refusal and a qualified id is not rewritten.
      model: { provider: 'moonshot', default: 'kimi-code/k3' },
    }
    const invocation = harnessInvocation('kimi-code', profile, 'task')
    expect(invocation.command).toBe('kimi')
    expect(invocation.args).toEqual(['-p', 'SYS\n\nRULE ONE\n\ntask', '-m', 'kimi-code/k3'])
    expect(invocation.prompt).toBe('SYS\n\nRULE ONE\n\ntask')
  })

  it('requests no permission-bypass argv: headless -p has no approval gate to bypass', () => {
    for (const options of [
      { dangerouslySkipPermissions: true },
      { dangerouslySkipPermissions: true, fullAccess: true },
    ] as const) {
      const invocation = harnessInvocation('kimi-code', {}, 'task', options)
      expect(invocation.args).toEqual(['-p', 'task'])
    }
  })

  it('refuses a reasoning effort kimi-code 2.x cannot express', () => {
    expect(harnessSupportsReasoningEffort('kimi-code', 'low')).toBe(false)
    expect(() =>
      harnessInvocation('kimi-code', { model: { reasoningEffort: 'low' } }, 'task'),
    ).toThrow(/kimi-code cannot express reasoning effort/)
  })

  it('declares MCP materialization capability on every row whose CLI reads the materialized surface', () => {
    for (const harness of ['claude-code', 'codex', 'kimi-code', 'opencode', 'pi'] as const) {
      expect(harnessMaterializesProfileMcp(harness)).toBe(true)
    }
  })
})
