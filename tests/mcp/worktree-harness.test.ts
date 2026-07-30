import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it, vi } from 'vitest'
import type { RunLocalHarnessOptions } from '../../src/mcp/local-harness'
import { captureWorktreeDiff, type GitRunner } from '../../src/mcp/worktree'
import {
  defaultRunCommand,
  runWorktreeChecks,
  runWorktreeHarness,
  type WorktreeCheckRunner,
} from '../../src/mcp/worktree-harness'
import { createWorktreeCliExecutor } from '../../src/runtime/supervise/worktree-cli-executor'

function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
}

function initializeRepository(files: Record<string, string>): string {
  const repoRoot = mkdtempSync(join(tmpdir(), 'agent-runtime-profile-worktree-'))
  git(repoRoot, ['init', '-q', '--initial-branch=main'])
  git(repoRoot, ['config', 'core.hooksPath', '/dev/null'])
  git(repoRoot, ['config', 'user.email', 'runtime-test@example.invalid'])
  git(repoRoot, ['config', 'user.name', 'Runtime Test'])
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(repoRoot, path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, content)
  }
  git(repoRoot, ['add', '-A'])
  git(repoRoot, ['commit', '-q', '-m', 'fixture'])
  return repoRoot
}

function successfulHarnessResult() {
  return {
    exitCode: 0,
    stdout: 'done',
    stderr: '',
    killedBySignal: null,
    durationMs: 1,
    timedOut: false,
    usage: {
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1,
      reasoningOutputTokens: 0,
    },
  } as const
}

function count(text: string, value: string): number {
  return text.split(value).length - 1
}

async function waitForPath(path: string, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`)
    await delay(10)
  }
}

describe('worktree check cancellation', () => {
  it('rejects a pre-aborted command before spawning it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'worktree-check-pre-abort-'))
    const marker = join(dir, 'spawned')
    const controller = new AbortController()
    controller.abort(new Error('pre-aborted check'))
    try {
      await expect(
        defaultRunCommand({
          command: `touch ${JSON.stringify(marker)}`,
          cwd: dir,
          timeoutMs: 1_000,
          signal: controller.signal,
        }),
      ).rejects.toThrow(/pre-aborted check/)
      expect(existsSync(marker)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('settles a TERM-ignoring descendant before rejecting cancellation', async () => {
    if (process.platform === 'win32') return
    const dir = mkdtempSync(join(tmpdir(), 'worktree-check-tree-abort-'))
    const pidPath = join(dir, 'descendant.pid')
    const lateWrite = join(dir, 'late-write')
    const controller = new AbortController()
    const childScript = [
      "const fs=require('node:fs')",
      'fs.writeFileSync(process.argv[1],String(process.pid))',
      "process.on('SIGTERM',()=>{})",
      "setTimeout(()=>fs.writeFileSync(process.argv[2],'late'),700)",
      'setInterval(()=>{},1000)',
    ].join(';')
    const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(childScript)} ${JSON.stringify(pidPath)} ${JSON.stringify(lateWrite)} & wait`
    try {
      const running = defaultRunCommand({
        command,
        cwd: dir,
        timeoutMs: 5_000,
        signal: controller.signal,
      })
      await waitForPath(pidPath)
      const descendantPid = Number(readFileSync(pidPath, 'utf8'))
      controller.abort(new Error('cancel the process tree'))

      await expect(running).rejects.toThrow(/cancel the process tree/)
      await delay(500)
      expect(existsSync(lateWrite)).toBe(false)
      expect(existsSync(`/proc/${descendantPid}`)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not start typecheck after cancellation settles the test command', async () => {
    const controller = new AbortController()
    const commands: string[] = []
    const runCommand: WorktreeCheckRunner = vi.fn(async ({ command }) => {
      commands.push(command)
      controller.abort(new Error('cancel between checks'))
      return { exitCode: 0, output: 'partial success' }
    })

    await expect(
      runWorktreeChecks({
        worktreePath: '/unused',
        testCmd: 'test-command',
        typecheckCmd: 'typecheck-command',
        timeoutMs: 1_000,
        cap: 1_000,
        runCommand,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancel between checks/)
    expect(commands).toEqual(['test-command'])
  })
})

describe('runWorktreeHarness profile materialization', () => {
  it('fails instead of fabricating an empty patch when Git diff fails', async () => {
    const repoRoot = initializeRepository({ 'src/value.ts': 'export const value = 1\n' })
    try {
      await expect(
        captureWorktreeDiff({
          worktree: {
            path: repoRoot,
            baseSha: git(repoRoot, ['rev-parse', 'HEAD']),
            branch: 'unused',
          },
          baseRef: 'missing-base-ref',
        }),
      ).rejects.toThrow(/git diff --cached missing-base-ref failed/u)
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('delivers mounted inputs, captures the worker edit, and excludes profile inputs', async () => {
    const runId = 'profile-real-path'
    const newInputPath = '.agent-profile/[literal]*:context.txt'
    const newInputMarker = 'PROFILE_NEW_INPUT_8f08e9f8'
    const systemMarker = 'SYSTEM_PROMPT_2ef237df'
    const promptInstructionMarker = 'PROMPT_INSTRUCTION_6dcc8c4e'
    const resourceInstructionMarker = 'RESOURCE_INSTRUCTION_75b98d68'
    const taskMarker = 'TASK_PROMPT_d5ade1ac'
    const repoRoot = initializeRepository({
      'src/value.ts': 'export const value = 1\n',
    })
    const profile: AgentProfile = {
      model: { default: 'gpt-5.4', reasoningEffort: 'xhigh' },
      prompt: {
        systemPrompt: systemMarker,
        instructions: [promptInstructionMarker],
      },
      resources: {
        files: [
          {
            path: newInputPath,
            resource: { kind: 'inline', name: 'new-context', content: newInputMarker },
          },
        ],
        instructions: {
          kind: 'inline',
          name: 'resource-instructions',
          content: resourceInstructionMarker,
        },
        failOnError: true,
      },
    }

    try {
      const executor = createWorktreeCliExecutor({
        repoRoot,
        profile,
        harness: 'codex',
        taskPrompt: taskMarker,
        runId,
        codexReproducible: true,
        runHarness: async (options: RunLocalHarnessOptions) => {
          expect(readFileSync(join(options.cwd, newInputPath), 'utf8')).toBe(newInputMarker)
          const prompt = options.invocation?.args[1] ?? ''
          expect(options.codexReproducible).toBe(true)
          expect(options.invocation?.args).toContain('project_doc_max_bytes=0')
          for (const marker of [
            systemMarker,
            promptInstructionMarker,
            resourceInstructionMarker,
            taskMarker,
          ]) {
            expect(count(prompt, marker)).toBe(1)
          }

          writeFileSync(join(options.cwd, 'src/value.ts'), 'export const value = 2\n')
          writeFileSync(join(options.cwd, newInputPath), 'worker changed new profile input\n')
          return successfulHarnessResult()
        },
      })
      const execution = await executor.execute(undefined, new AbortController().signal)

      try {
        expect(execution.out.patch).toContain('diff --git a/src/value.ts b/src/value.ts')
        expect(execution.out.patch).toContain('+export const value = 2')
        expect(execution.out.patch).not.toContain(newInputPath)
        expect(execution.out.patch).not.toContain(newInputMarker)
        expect(execution.out.stats).toEqual({ filesChanged: 1, insertions: 1, deletions: 1 })
        expect(execution.out.profileMaterialization).toMatchObject({
          workspacePlanDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
          writtenPaths: [newInputPath],
          unsupported: [],
          environmentNames: [],
          flags: [],
          resourceInstructions: {
            delivery: 'invocation-prompt',
            sha256: `sha256:${createHash('sha256')
              .update(resourceInstructionMarker)
              .digest('hex')}`,
            byteLength: Buffer.byteLength(resourceInstructionMarker),
          },
        })
      } finally {
        await executor.teardown(0)
      }

      expect(existsSync(join(repoRoot, '.agent-worktrees', runId))).toBe(false)
      expect(git(repoRoot, ['branch', '--list', `delegate/${runId}`])).toBe('')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('rejects caller cancellation before diff capture or verification', async () => {
    const repoRoot = initializeRepository({ 'src/value.ts': 'export const value = 1\n' })
    const runId = 'cancelled-before-scoring'
    const gitCommands: string[][] = []
    const runGit: GitRunner = (args, { cwd }) => {
      gitCommands.push([...args])
      const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' })
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.status ?? -1,
      }
    }
    const runCommand = vi.fn()
    try {
      await expect(
        runWorktreeHarness({
          repoRoot,
          profile: {},
          harness: 'claude',
          taskPrompt: 'task',
          runId,
          testCmd: 'must-not-run',
          runGit,
          runCommand,
          // Process boundary only; local-harness.test.ts covers TERM-aware cancellation with a real tree.
          runHarness: async ({ cwd }) => {
            writeFileSync(join(cwd, 'src/value.ts'), 'export const partial = true\n')
            return { ...successfulHarnessResult(), aborted: true }
          },
        }),
      ).rejects.toThrow(/cancelled by the caller/)

      expect(gitCommands.some(([command]) => command === 'add')).toBe(false)
      expect(runCommand).not.toHaveBeenCalled()
      expect(existsSync(join(repoRoot, '.agent-worktrees', runId))).toBe(false)
      expect(git(repoRoot, ['branch', '--list', `delegate/${runId}`])).toBe('')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('rejects profile inputs that shadow repository files', async () => {
    const repoRoot = initializeRepository({
      'profile-tracked.txt': 'repository version\n',
      'src/value.ts': 'export const value = 1\n',
    })
    const runId = 'profile-existing-file'
    const runHarness = vi.fn()
    chmodSync(join(repoRoot, 'profile-tracked.txt'), 0o755)
    git(repoRoot, ['add', 'profile-tracked.txt'])
    git(repoRoot, ['commit', '-q', '-m', 'make profile fixture executable'])
    const previousUmask = process.umask(0o022)
    try {
      await expect(
        runWorktreeHarness({
          repoRoot,
          profile: {
            resources: {
              files: [
                {
                  path: 'profile-tracked.txt',
                  executable: true,
                  resource: {
                    kind: 'inline',
                    name: 'tracked-context',
                    content: 'repository version\n',
                  },
                },
              ],
            },
          },
          harness: 'codex',
          taskPrompt: 'task',
          runId,
          runHarness,
        }),
      ).rejects.toThrow(/Refusing to replace existing workspace file: profile-tracked\.txt/u)
      expect(runHarness).not.toHaveBeenCalled()
      expect(existsSync(join(repoRoot, '.agent-worktrees', runId))).toBe(false)
      expect(git(repoRoot, ['branch', '--list', `delegate/${runId}`])).toBe('')
    } finally {
      process.umask(previousUmask)
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('materializes every Claude-supported structural axis and delivers instructions once', async () => {
    const repoRoot = initializeRepository({ 'src/value.ts': 'export const value = 1\n' })
    const runId = 'supported-structural-axes'
    const resourceInstructionMarker = 'DIRECT_RESOURCE_INSTRUCTION_343641ac'
    const paths = {
      file: 'profile-context.txt',
      skill: '.claude/skills/reviewer/SKILL.md',
      nativeAgent: '.claude/agents/native-reviewer.md',
      command: '.claude/commands/audit.md',
      subagent: '.claude/agents/helper.md',
      mcp: '.tangle/claude-mcp.json',
      settings: '.tangle/claude-settings.json',
    } as const
    try {
      const run = await runWorktreeHarness({
        repoRoot,
        profile: {
          harness: 'codex',
          model: {
            default: 'claude-model',
            small: 'small-routing-hint',
            provider: 'anthropic',
            metadata: { tier: 'research' },
          },
          prompt: { systemPrompt: 'DIRECT_SYSTEM_a3563f03' },
          resources: {
            files: [
              {
                path: paths.file,
                resource: { kind: 'inline', name: 'context', content: 'FILE_MARKER_5570e069' },
              },
            ],
            skills: [
              {
                kind: 'inline',
                name: 'reviewer',
                content: '# Reviewer\n\nSKILL_MARKER_edc681e1',
              },
            ],
            agents: [
              {
                kind: 'inline',
                name: 'native-reviewer.md',
                content: 'NATIVE_AGENT_MARKER_b1b342a1',
              },
            ],
            commands: [
              {
                kind: 'inline',
                name: 'audit',
                content: 'COMMAND_MARKER_b53220fa',
              },
            ],
            instructions: resourceInstructionMarker,
          },
          mcp: { local: { command: 'node', args: ['server.mjs'] } },
          hooks: { PreToolUse: [{ command: 'node hook.mjs', matcher: 'Bash' }] },
          subagents: { helper: { description: 'Helper', prompt: 'SUBAGENT_MARKER_37bb713b' } },
        },
        harness: 'claude',
        taskPrompt: 'DIRECT_TASK_72c5c757',
        runId,
        runHarness: async (options) => {
          expect(options.harness).toBe('claude')
          expect(options.invocation?.command).toBe('claude')
          expect(options.invocation?.args).toContain('claude-model')
          expect(options.invocation?.args).not.toContain('small-routing-hint')
          expect(options.invocation?.args).not.toContain('anthropic')
          expect(options.invocation?.args).not.toContain('research')
          expect(readFileSync(join(options.cwd, paths.file), 'utf8')).toContain(
            'FILE_MARKER_5570e069',
          )
          expect(readFileSync(join(options.cwd, paths.skill), 'utf8')).toContain(
            'SKILL_MARKER_edc681e1',
          )
          expect(readFileSync(join(options.cwd, paths.nativeAgent), 'utf8')).toContain(
            'NATIVE_AGENT_MARKER_b1b342a1',
          )
          expect(readFileSync(join(options.cwd, paths.command), 'utf8')).toContain(
            'COMMAND_MARKER_b53220fa',
          )
          expect(readFileSync(join(options.cwd, paths.subagent), 'utf8')).toContain(
            'SUBAGENT_MARKER_37bb713b',
          )
          expect(readFileSync(join(options.cwd, paths.mcp), 'utf8')).toContain('server.mjs')
          const settings = JSON.parse(
            readFileSync(join(options.cwd, paths.settings), 'utf8'),
          ) as Record<string, unknown>
          expect(settings).toHaveProperty('hooks')
          expect(options.invocation?.args).toEqual(
            expect.arrayContaining([
              '--mcp-config',
              paths.mcp,
              '--strict-mcp-config',
              '--settings',
              paths.settings,
            ]),
          )
          const prompt = options.invocation?.args[1] ?? ''
          expect(count(prompt, resourceInstructionMarker)).toBe(1)
          expect(count(prompt, 'DIRECT_SYSTEM_a3563f03')).toBe(1)
          expect(count(prompt, 'DIRECT_TASK_72c5c757')).toBe(1)
          return successfulHarnessResult()
        },
      })

      try {
        expect(run.result.patch).toBe('')
        expect(run.result.stats).toEqual({ filesChanged: 0, insertions: 0, deletions: 0 })
        expect(run.result.profileMaterialization?.writtenPaths).toEqual(
          Object.values(paths).sort((left, right) => left.localeCompare(right)),
        )
        expect(run.result.profileMaterialization?.unsupported).toEqual([])
      } finally {
        await run.cleanup()
        await run.cleanup()
      }
      expect(existsSync(join(repoRoot, '.agent-worktrees', runId))).toBe(false)
      expect(git(repoRoot, ['branch', '--list', `delegate/${runId}`])).toBe('')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('resolves and mounts a pinned Traces skill without changing the source profile or patch', async () => {
    const repoRoot = initializeRepository({ 'src/value.ts': 'export const value = 1\n' })
    const runId = 'traces-skill'
    const skillPath = '.codex/skills/inspect-agent-traces/SKILL.md'
    const skillContent = [
      '---',
      'name: inspect-agent-traces',
      'description: Inspect an agent workflow with the Traces CLI.',
      '---',
      '',
      '# Inspect Agent Traces',
      '',
      'Run `traces analyze` and cite the exact sessions behind each finding.',
    ].join('\n')
    const profile: AgentProfile = {
      resources: {
        failOnError: true,
        skills: [
          {
            kind: 'github',
            repository: 'tangle-network/traces',
            path: 'skills/inspect-agent-traces/SKILL.md',
            ref: '0123456789abcdef0123456789abcdef01234567',
            name: 'inspect-agent-traces',
          },
        ],
      },
    }
    const fetchResource = vi.fn(
      async () =>
        new Response(skillContent, {
          status: 200,
          headers: { 'content-length': String(Buffer.byteLength(skillContent)) },
        }),
    ) as unknown as typeof fetch
    try {
      const run = await runWorktreeHarness({
        repoRoot,
        profile,
        harness: 'codex',
        taskPrompt: 'task',
        runId,
        resourceResolution: { fetch: fetchResource },
        runHarness: async (options) => {
          expect(readFileSync(join(options.cwd, skillPath), 'utf8')).toContain(
            'Run `traces analyze`',
          )
          writeFileSync(join(options.cwd, 'src/value.ts'), 'export const value = 2\n')
          writeFileSync(join(options.cwd, skillPath), 'worker changed mounted skill\n')
          return successfulHarnessResult()
        },
      })

      try {
        expect(fetchResource).toHaveBeenCalledWith(
          'https://raw.githubusercontent.com/tangle-network/traces/0123456789abcdef0123456789abcdef01234567/skills/inspect-agent-traces/SKILL.md',
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        )
        expect(profile.resources?.skills?.[0]).toEqual({
          kind: 'github',
          repository: 'tangle-network/traces',
          path: 'skills/inspect-agent-traces/SKILL.md',
          ref: '0123456789abcdef0123456789abcdef01234567',
          name: 'inspect-agent-traces',
        })
        expect(run.result.profileMaterialization).toMatchObject({
          workspacePlanDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
          writtenPaths: [skillPath],
          unsupported: [],
        })
        expect(run.result.patch).toContain('+export const value = 2')
        expect(run.result.patch).not.toContain(skillPath)
        expect(run.result.patch).not.toContain('worker changed mounted skill')
      } finally {
        await run.cleanup()
      }
      expect(existsSync(join(repoRoot, '.agent-worktrees', runId))).toBe(false)
      expect(git(repoRoot, ['branch', '--list', `delegate/${runId}`])).toBe('')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('fails before worker launch and removes the real worktree when resource resolution fails', async () => {
    const repoRoot = initializeRepository({ 'src/value.ts': 'export const value = 1\n' })
    const runId = 'failed-resource-resolution'
    const runHarness = vi.fn()
    try {
      await expect(
        runWorktreeHarness({
          repoRoot,
          profile: {
            resources: {
              instructions: {
                kind: 'github',
                repository: 'owner/repo',
                path: 'INSTRUCTIONS.md',
              },
            },
          },
          harness: 'codex',
          taskPrompt: 'task',
          runId,
          runHarness,
          resourceResolution: {
            fetch: (async () =>
              new Response('missing', {
                status: 404,
                statusText: 'Not Found',
              })) as unknown as typeof fetch,
          },
        }),
      ).rejects.toThrow(
        /Failed to fetch GitHub profile resource owner\/repo\/INSTRUCTIONS\.md@main: 404 Not Found/u,
      )
      expect(runHarness).not.toHaveBeenCalled()
      expect(existsSync(join(repoRoot, '.agent-worktrees', runId))).toBe(false)
      expect(git(repoRoot, ['branch', '--list', `delegate/${runId}`])).toBe('')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('cancels resource resolution before worker launch and removes the real worktree', async () => {
    const repoRoot = initializeRepository({ 'src/value.ts': 'export const value = 1\n' })
    const runId = 'cancelled-resource-resolution'
    const controller = new AbortController()
    const runHarness = vi.fn()
    let markFetchStarted!: () => void
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve
    })
    const fetchResource = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          markFetchStarted()
          const signal = init?.signal
          if (!signal) {
            reject(new Error('resource fetch did not receive an abort signal'))
            return
          }
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    ) as unknown as typeof fetch

    try {
      const running = runWorktreeHarness({
        repoRoot,
        profile: {
          resources: {
            skills: [
              {
                kind: 'github',
                repository: 'tangle-network/traces',
                path: 'skills/inspect-agent-traces/SKILL.md',
                ref: '0123456789abcdef0123456789abcdef01234567',
              },
            ],
          },
        },
        harness: 'codex',
        taskPrompt: 'task',
        runId,
        runHarness,
        signal: controller.signal,
        resourceResolution: { fetch: fetchResource },
      })

      await fetchStarted
      controller.abort(new Error('cancel remote skill resolution'))

      await expect(running).rejects.toThrow(/cancel remote skill resolution/u)
      expect(runHarness).not.toHaveBeenCalled()
      expect(existsSync(join(repoRoot, '.agent-worktrees', runId))).toBe(false)
      expect(git(repoRoot, ['branch', '--list', `delegate/${runId}`])).toBe('')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('rejects unsupported behavior axes before worker launch and removes the worktree', async () => {
    const repoRoot = initializeRepository({ 'src/value.ts': 'export const value = 1\n' })
    const runId = 'unsupported-behavior-axes'
    const runHarness = vi.fn()
    try {
      await expect(
        runWorktreeHarness({
          repoRoot,
          profile: {
            tools: { shell: false },
            permissions: { shell: 'deny' },
            connections: [{ connectionId: 'connection-1', capabilities: ['read'] }],
            confidential: { tee: 'any' },
            modes: { review: { prompt: 'Review only.' } },
            extensions: { codex: { feature: true } },
          },
          harness: 'codex',
          taskPrompt: 'task',
          runId,
          runHarness,
        }),
      ).rejects.toThrow(
        /unsupported worktree behavior: tools, permissions, connections, confidential, modes, extensions/u,
      )
      expect(runHarness).not.toHaveBeenCalled()
      expect(existsSync(join(repoRoot, '.agent-worktrees', runId))).toBe(false)
      expect(git(repoRoot, ['branch', '--list', `delegate/${runId}`])).toBe('')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('preserves the run error when Git cleanup also fails', async () => {
    const repoRoot = initializeRepository({ 'src/value.ts': 'export const value = 1\n' })
    const runId = 'run-and-cleanup-failures'
    const worktreePath = join(repoRoot, '.agent-worktrees', runId)
    const runHarness = vi.fn()
    let interceptedRemoval = false
    const runGit: GitRunner = (args, { cwd }) => {
      if (args[0] === 'worktree' && args[1] === 'remove' && !interceptedRemoval) {
        interceptedRemoval = true
        return { stdout: '', stderr: 'simulated cleanup failure', exitCode: 128 }
      }
      const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' })
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.status ?? -1,
      }
    }

    try {
      let error: unknown
      try {
        await runWorktreeHarness({
          repoRoot,
          profile: { tools: { shell: false } },
          harness: 'codex',
          taskPrompt: 'task',
          runId,
          runHarness,
          runGit,
        })
      } catch (caught) {
        error = caught
      }

      expect(error).toBeInstanceOf(AggregateError)
      const errors = (error as AggregateError).errors as Error[]
      expect(errors[0]?.message).toContain('unsupported worktree behavior: tools')
      expect(errors[1]).toBeInstanceOf(AggregateError)
      const cleanupErrors = (errors[1] as AggregateError).errors as Error[]
      expect(cleanupErrors[0]?.message).toContain('worktree remove')
      expect(cleanupErrors[1]?.message).toContain('branch -D')
      expect(runHarness).not.toHaveBeenCalled()
      expect(interceptedRemoval).toBe(true)
      expect(existsSync(worktreePath)).toBe(true)
    } finally {
      spawnSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot })
      spawnSync('git', ['branch', '-D', `delegate/${runId}`], { cwd: repoRoot })
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('rejects nested controls the pinned materializer would silently drop', async () => {
    const repoRoot = initializeRepository({ 'src/value.ts': 'export const value = 1\n' })
    const runHarness = vi.fn()
    const cases: Array<{
      runId: string
      harness: 'claude' | 'codex' | 'opencode'
      profile: AgentProfile
      dropped: string[]
    }> = [
      {
        runId: 'codex-nested-controls',
        harness: 'codex',
        profile: {
          mcp: {
            disabled: {
              command: 'node',
              enabled: false,
              headers: { Authorization: 'redacted' },
            },
          },
          subagents: {
            helper: {
              prompt: 'Help.',
              tools: { shell: false },
              permissions: { shell: 'deny' },
              maxSteps: 1,
            },
          },
        },
        dropped: [
          'mcp["disabled"].enabled',
          'mcp["disabled"].headers',
          'subagents["helper"].permissions',
          'subagents["helper"].maxSteps',
          'subagents["helper"].tools',
        ],
      },
      {
        runId: 'claude-nested-controls',
        harness: 'claude',
        profile: {
          model: { reasoningEffort: 'high' },
          hooks: {
            PreToolUse: [{ command: 'node hook.mjs', env: { MODE: 'strict' }, blocking: false }],
          },
        },
        dropped: [
          'model.reasoningEffort',
          'hooks["PreToolUse"][0].env',
          'hooks["PreToolUse"][0].blocking',
        ],
      },
      {
        runId: 'opencode-nested-controls',
        harness: 'opencode',
        profile: { mcp: { local: { command: 'node', cwd: 'required-directory' } } },
        dropped: ['mcp["local"].cwd'],
      },
    ]

    try {
      for (const testCase of cases) {
        let error: unknown
        try {
          await runWorktreeHarness({
            repoRoot,
            profile: testCase.profile,
            harness: testCase.harness,
            taskPrompt: 'task',
            runId: testCase.runId,
            runHarness,
          })
        } catch (caught) {
          error = caught
        }
        expect(error).toBeInstanceOf(Error)
        for (const path of testCase.dropped) {
          expect((error as Error).message).toContain(path)
        }
        expect(existsSync(join(repoRoot, '.agent-worktrees', testCase.runId))).toBe(false)
        expect(git(repoRoot, ['branch', '--list', `delegate/${testCase.runId}`])).toBe('')
      }
      expect(runHarness).not.toHaveBeenCalled()
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('rejects profile files targeting Git metadata before worker launch', async () => {
    const repoRoot = initializeRepository({ 'src/value.ts': 'export const value = 1\n' })
    const runHarness = vi.fn()
    try {
      for (const [index, path] of [
        '.git',
        'nested/.git/config',
        '.GIT.',
        '.git:stream',
      ].entries()) {
        const runId = `reserved-git-metadata-${index}`
        await expect(
          runWorktreeHarness({
            repoRoot,
            profile: {
              resources: {
                files: [
                  {
                    path,
                    resource: {
                      kind: 'inline',
                      name: 'poison',
                      content: 'gitdir: attacker\n',
                    },
                  },
                ],
              },
            },
            harness: 'codex',
            taskPrompt: 'task',
            runId,
            runHarness,
          }),
        ).rejects.toThrow(/profile file cannot target reserved Git metadata/u)
        expect(existsSync(join(repoRoot, '.agent-worktrees', runId))).toBe(false)
        expect(git(repoRoot, ['branch', '--list', `delegate/${runId}`])).toBe('')
      }
      expect(runHarness).not.toHaveBeenCalled()
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('removes the real worktree when applying a profile file fails', async () => {
    const repoRoot = initializeRepository({ 'src/value.ts': 'export const value = 1\n' })
    symlinkSync('src', join(repoRoot, 'profile-link'))
    git(repoRoot, ['add', 'profile-link'])
    git(repoRoot, ['commit', '-q', '-m', 'add profile symlink'])
    const runId = 'profile-apply-failure'
    const runHarness = vi.fn()
    try {
      await expect(
        runWorktreeHarness({
          repoRoot,
          profile: {
            resources: {
              files: [
                {
                  path: 'profile-link/input.txt',
                  resource: { kind: 'inline', name: 'input', content: 'marker' },
                },
              ],
            },
          },
          harness: 'codex',
          taskPrompt: 'task',
          runId,
          runHarness,
        }),
      ).rejects.toThrow(/symlink path/u)
      expect(runHarness).not.toHaveBeenCalled()
      expect(existsSync(join(repoRoot, '.agent-worktrees', runId))).toBe(false)
      expect(git(repoRoot, ['branch', '--list', `delegate/${runId}`])).toBe('')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })
})
