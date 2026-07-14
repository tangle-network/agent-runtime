import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
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
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it, vi } from 'vitest'
import type { RunLocalHarnessOptions } from '../../src/mcp/local-harness'
import { runWorktreeHarness } from '../../src/mcp/worktree-harness'
import { createWorktreeCliExecutor } from '../../src/runtime/supervise/worktree-cli-executor'

function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
}

function initializeRepository(files: Record<string, string>): string {
  const repoRoot = mkdtempSync(join(tmpdir(), 'agent-runtime-profile-worktree-'))
  git(repoRoot, ['init', '-q', '--initial-branch=main'])
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

describe('runWorktreeHarness profile materialization', () => {
  it('delivers mounted inputs, captures the worker edit, and excludes tracked and untracked inputs', async () => {
    const repoRoot = initializeRepository({
      'src/value.ts': 'export const value = 1\n',
      'profile-tracked.txt': 'repository version\n',
    })
    const runId = 'profile-real-path'
    const newInputPath = '.agent-profile/[literal]*:context.txt'
    const trackedInputPath = 'profile-tracked.txt'
    const newInputMarker = 'PROFILE_NEW_INPUT_8f08e9f8'
    const trackedInputMarker = 'PROFILE_TRACKED_INPUT_c521cd4d'
    const systemMarker = 'SYSTEM_PROMPT_2ef237df'
    const promptInstructionMarker = 'PROMPT_INSTRUCTION_6dcc8c4e'
    const resourceInstructionMarker = 'RESOURCE_INSTRUCTION_75b98d68'
    const taskMarker = 'TASK_PROMPT_d5ade1ac'
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
          {
            path: trackedInputPath,
            resource: {
              kind: 'inline',
              name: 'tracked-context',
              content: trackedInputMarker,
            },
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
          expect(readFileSync(join(options.cwd, trackedInputPath), 'utf8')).toBe(trackedInputMarker)
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
          writeFileSync(
            join(options.cwd, trackedInputPath),
            'worker changed tracked profile input\n',
          )
          return successfulHarnessResult()
        },
      })
      const execution = await executor.execute(undefined, new AbortController().signal)

      try {
        expect(execution.out.patch).toContain('diff --git a/src/value.ts b/src/value.ts')
        expect(execution.out.patch).toContain('+export const value = 2')
        expect(execution.out.patch).not.toContain(newInputPath)
        expect(execution.out.patch).not.toContain(trackedInputPath)
        expect(execution.out.patch).not.toContain(newInputMarker)
        expect(execution.out.patch).not.toContain(trackedInputMarker)
        expect(execution.out.stats).toEqual({ filesChanged: 1, insertions: 1, deletions: 1 })
        expect(execution.out.profileMaterialization).toMatchObject({
          workspacePlanDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
          writtenPaths: [newInputPath, trackedInputPath],
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

  it('fails before worker launch and removes the real worktree for unsupported resources', async () => {
    const repoRoot = initializeRepository({ 'src/value.ts': 'export const value = 1\n' })
    const runId = 'unsupported-profile'
    const runHarness = vi.fn()
    try {
      await expect(
        runWorktreeHarness({
          repoRoot,
          profile: {
            resources: {
              files: [
                {
                  path: '.agent-profile/remote.txt',
                  resource: { kind: 'github', repository: 'owner/repo', path: 'remote.txt' },
                },
              ],
            },
          },
          harness: 'codex',
          taskPrompt: 'task',
          runId,
          runHarness,
        }),
      ).rejects.toThrow(/profile cannot be materialized.*files/u)
      expect(runHarness).not.toHaveBeenCalled()
      expect(existsSync(join(repoRoot, '.agent-worktrees', runId))).toBe(false)
      expect(git(repoRoot, ['branch', '--list', `delegate/${runId}`])).toBe('')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('rejects unresolved resource instructions and removes the real worktree', async () => {
    const repoRoot = initializeRepository({ 'src/value.ts': 'export const value = 1\n' })
    const runId = 'unresolved-resource-instructions'
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
        }),
      ).rejects.toThrow(/resources\.instructions.*pre-resolution/u)
      expect(runHarness).not.toHaveBeenCalled()
      expect(existsSync(join(repoRoot, '.agent-worktrees', runId))).toBe(false)
      expect(git(repoRoot, ['branch', '--list', `delegate/${runId}`])).toBe('')
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
