/**
 * The in-place CLI placement: a local coding harness on a workspace the CALLER supplies.
 *
 * The property every gate here circles is the one `cli-worktree` cannot have: the harness edits
 * THAT directory, and the edits are still in it when the call returns, so the next call resumes on
 * top of them.
 */
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import type { LocalHarnessResult, RunLocalHarnessOptions } from '../../src/mcp/local-harness'
import { createInPlaceCliExecutor } from '../../src/runtime/supervise/in-place-cli-executor'
import {
  runtimeOwnedExecutorExecutionBinding,
  runtimeOwnedExecutorMaterialization,
} from '../../src/runtime/supervise/materialization'
import { createExecutor } from '../../src/runtime/supervise/runtime'

const authorProfile: AgentProfile = {
  name: 'in-place-author',
  harness: 'claude-code',
  model: { provider: 'anthropic', default: 'test/author-model' },
  prompt: { systemPrompt: 'AUTHOR_SYSTEM_9f21' },
}

function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
}

/** A throwaway git checkout with one committed file, standing in for the candidate worktree a
 *  driver hands the author. `realpathSync` because macOS reports `/var/...` for a directory git
 *  reports as `/private/var/...`, and a raw comparison of the two names is a false mismatch. */
function scaffoldWorkspace(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-runtime-in-place-')))
  git(root, ['init', '-q', '--initial-branch=main'])
  git(root, ['config', 'core.hooksPath', '/dev/null'])
  git(root, ['config', 'user.email', 'runtime-test@example.invalid'])
  git(root, ['config', 'user.name', 'Runtime Test'])
  writeFileSync(join(root, 'README.md'), '# candidate\n')
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'fixture'])
  return root
}

function harnessOk(): LocalHarnessResult {
  return {
    exitCode: 0,
    stdout: 'done',
    stderr: '',
    killedBySignal: null,
    durationMs: 1,
    timedOut: false,
  } as LocalHarnessResult
}

/** A stub harness that appends one line to `program.mjs` in whatever directory it is placed in. */
function appendingHarness(line: string, seen: RunLocalHarnessOptions[] = []) {
  return async (options: RunLocalHarnessOptions): Promise<LocalHarnessResult> => {
    seen.push(options)
    const target = join(options.cwd, 'program.mjs')
    const existing = existsSync(target) ? readFileSync(target, 'utf8') : ''
    writeFileSync(target, `${existing}${line}\n`)
    return harnessOk()
  }
}

describe('createInPlaceCliExecutor', () => {
  it('runs the harness in the supplied directory and leaves its edits there', async () => {
    const workspacePath = scaffoldWorkspace()
    const seen: RunLocalHarnessOptions[] = []
    const executor = createInPlaceCliExecutor({
      workspacePath,
      profile: authorProfile,
      taskPrompt: 'write the program',
      runHarness: appendingHarness('export const version = 1', seen),
    })

    const result = await executor.execute(undefined, AbortSignal.timeout(30_000))

    expect(realpathSync(seen[0]?.cwd ?? '')).toBe(workspacePath)
    expect(seen[0]?.invocation?.command).toBe('claude')
    expect(seen[0]?.invocation?.args).toContain('test/author-model')
    expect(readFileSync(join(workspacePath, 'program.mjs'), 'utf8')).toBe(
      'export const version = 1\n',
    )
    expect(result.out.workspacePath).toBe(workspacePath)
    expect(result.out.harness.name).toBe('claude-code')
    expect(result.out.harness.exitCode).toBe(0)
    // The author's file is the ONLY change; nothing Runtime wrote is left behind, so a dirty check
    // over this directory answers "did the author change anything".
    expect(git(workspacePath, ['status', '--porcelain', '--untracked-files=all'])).toBe(
      '?? program.mjs',
    )

    // Teardown stops this leaf, never the caller's directory.
    await executor.teardown('brutalKill')
    expect(existsSync(join(workspacePath, 'program.mjs'))).toBe(true)
  })

  it("a second placement on the same workspace sees the first one's edits", async () => {
    const workspacePath = scaffoldWorkspace()

    await createInPlaceCliExecutor({
      workspacePath,
      profile: authorProfile,
      taskPrompt: 'first shot',
      runHarness: appendingHarness('first'),
    }).execute(undefined, AbortSignal.timeout(30_000))

    let observedBeforeSecondShot = ''
    await createInPlaceCliExecutor({
      workspacePath,
      profile: authorProfile,
      taskPrompt: 'second shot',
      runHarness: async (options) => {
        observedBeforeSecondShot = readFileSync(join(options.cwd, 'program.mjs'), 'utf8')
        writeFileSync(join(options.cwd, 'program.mjs'), `${observedBeforeSecondShot}second\n`)
        return harnessOk()
      },
    }).execute(undefined, AbortSignal.timeout(30_000))

    expect(observedBeforeSecondShot).toBe('first\n')
    expect(readFileSync(join(workspacePath, 'program.mjs'), 'utf8')).toBe('first\nsecond\n')
  })

  it('materializes the profile for the harness and removes those inputs before it returns', async () => {
    const workspacePath = scaffoldWorkspace()
    const profile: AgentProfile = {
      ...authorProfile,
      resources: {
        files: [
          {
            path: 'context/brief.md',
            resource: { kind: 'inline', name: 'brief', content: 'FILE_MARKER_5c31' },
          },
        ],
        skills: [{ kind: 'inline', name: 'reviewer', content: '# Reviewer\n\nSKILL_MARKER_7a04' }],
      },
    }
    let sawFile = ''
    let sawSkill = ''
    const executor = createInPlaceCliExecutor({
      workspacePath,
      profile,
      taskPrompt: 'write the program',
      runHarness: async (options) => {
        sawFile = readFileSync(join(options.cwd, 'context/brief.md'), 'utf8')
        sawSkill = readFileSync(join(options.cwd, '.claude/skills/reviewer/SKILL.md'), 'utf8')
        writeFileSync(join(options.cwd, 'program.mjs'), 'export const version = 1\n')
        return harnessOk()
      },
    })

    const result = await executor.execute(undefined, AbortSignal.timeout(30_000))

    expect(sawFile).toContain('FILE_MARKER_5c31')
    expect(sawSkill).toContain('SKILL_MARKER_7a04')
    expect(result.out.profileMaterialization.writtenPaths).toContain('context/brief.md')
    expect(result.out.profileMaterialization.unsupported).toEqual([])
    // Gone again, along with the directories only they occupied.
    expect(existsSync(join(workspacePath, 'context/brief.md'))).toBe(false)
    expect(existsSync(join(workspacePath, 'context'))).toBe(false)
    expect(existsSync(join(workspacePath, '.claude'))).toBe(false)
    expect(git(workspacePath, ['status', '--porcelain', '--untracked-files=all'])).toBe(
      '?? program.mjs',
    )
  })

  it('keeps a directory the harness put its own work in', async () => {
    const workspacePath = scaffoldWorkspace()
    const profile: AgentProfile = {
      ...authorProfile,
      resources: {
        files: [
          {
            path: 'context/brief.md',
            resource: { kind: 'inline', name: 'brief', content: 'FILE_MARKER_5c31' },
          },
        ],
      },
    }

    await createInPlaceCliExecutor({
      workspacePath,
      profile,
      taskPrompt: 'write the program',
      runHarness: async (options) => {
        writeFileSync(join(options.cwd, 'context/authored.md'), 'AUTHOR_WORK\n')
        return harnessOk()
      },
    }).execute(undefined, AbortSignal.timeout(30_000))

    expect(existsSync(join(workspacePath, 'context/brief.md'))).toBe(false)
    expect(readFileSync(join(workspacePath, 'context/authored.md'), 'utf8')).toBe('AUTHOR_WORK\n')
  })

  it('removes the materialized inputs when the harness fails', async () => {
    const workspacePath = scaffoldWorkspace()
    const profile: AgentProfile = {
      ...authorProfile,
      resources: {
        files: [
          {
            path: 'context/brief.md',
            resource: { kind: 'inline', name: 'brief', content: 'FILE_MARKER_5c31' },
          },
        ],
      },
    }

    await expect(
      createInPlaceCliExecutor({
        workspacePath,
        profile,
        taskPrompt: 'write the program',
        runHarness: async () => {
          throw new Error('harness exploded')
        },
      }).execute(undefined, AbortSignal.timeout(30_000)),
    ).rejects.toThrow(/harness exploded/u)

    expect(existsSync(join(workspacePath, 'context/brief.md'))).toBe(false)
    expect(git(workspacePath, ['status', '--porcelain', '--untracked-files=all'])).toBe('')
  })

  it('refuses to overwrite a workspace file a profile input would occupy', async () => {
    const workspacePath = scaffoldWorkspace()
    mkdirSync(join(workspacePath, 'context'))
    writeFileSync(join(workspacePath, 'context/brief.md'), 'THE CALLERS OWN FILE\n')
    let harnessRan = false

    await expect(
      createInPlaceCliExecutor({
        workspacePath,
        profile: {
          ...authorProfile,
          resources: {
            files: [
              {
                path: 'context/brief.md',
                resource: { kind: 'inline', name: 'brief', content: 'FILE_MARKER_5c31' },
              },
            ],
          },
        },
        taskPrompt: 'write the program',
        runHarness: async () => {
          harnessRan = true
          return harnessOk()
        },
      }).execute(undefined, AbortSignal.timeout(30_000)),
    ).rejects.toThrow()

    expect(harnessRan).toBe(false)
    expect(readFileSync(join(workspacePath, 'context/brief.md'), 'utf8')).toBe(
      'THE CALLERS OWN FILE\n',
    )
  })

  it('declares a known model identity and binds the kernel attempt', async () => {
    const workspacePath = scaffoldWorkspace()
    const executor = createInPlaceCliExecutor({
      workspacePath,
      profile: authorProfile,
      taskPrompt: 'write the program',
      executionAttemptId: 'attempt-8811',
      runHarness: appendingHarness('export const version = 1'),
    })

    const declaration = runtimeOwnedExecutorMaterialization(executor)
    expect(declaration?.model).toEqual({ status: 'known', id: 'test/author-model' })
    expect(declaration?.backend).toBe('cli-in-place:claude-code')
    expect(declaration?.materializer).toBe('agent-profile-worktree-plan')
    expect(runtimeOwnedExecutorExecutionBinding(executor)?.attemptId).toBe('attempt-8811')
  })

  it('reports an unmetered run as a floor, never as a measured zero', async () => {
    const workspacePath = scaffoldWorkspace()
    const executor = createInPlaceCliExecutor({
      workspacePath,
      profile: authorProfile,
      taskPrompt: 'write the program',
      runHarness: appendingHarness('export const version = 1'),
    })

    const result = await executor.execute(undefined, AbortSignal.timeout(30_000))

    expect(executor.budgetExempt).toBe(true)
    expect(result.spent.tokens).toEqual({ input: 0, output: 0 })
    expect(result.spent.tokensKnown).toBe(false)
  })

  it('fails loud on a missing workspace, a non-local harness, and a read before execute', async () => {
    const workspacePath = scaffoldWorkspace()
    expect(() => createInPlaceCliExecutor({ workspacePath: '', profile: authorProfile })).toThrow(
      /workspacePath required/u,
    )
    expect(() =>
      createInPlaceCliExecutor({
        workspacePath,
        profile: { ...authorProfile, harness: 'cli-base' },
      }),
    ).toThrow(/AgentProfile.harness must select/u)
    const executor = createInPlaceCliExecutor({ workspacePath, profile: authorProfile })
    expect(() => executor.resultArtifact()).toThrow(/read before execute/u)
    await expect(executor.execute(undefined, AbortSignal.timeout(30_000))).rejects.toThrow(
      /execute task required/u,
    )
    await expect(
      createInPlaceCliExecutor({
        workspacePath: join(workspacePath, 'no-such-directory'),
        profile: authorProfile,
        taskPrompt: 'write the program',
      }).execute(undefined, AbortSignal.timeout(30_000)),
    ).rejects.toThrow(/not an existing directory/u)
  })
})

describe('createExecutor({ backend: "cli-in-place" })', () => {
  it('routes to the leaf and carries the task prompt as text', async () => {
    const workspacePath = scaffoldWorkspace()
    const seen: RunLocalHarnessOptions[] = []
    const factory = createExecutor({
      backend: 'cli-in-place',
      workspacePath,
      runHarness: appendingHarness('export const version = 1', seen),
    })
    const executor = factory(
      { profile: authorProfile, harness: null },
      { signal: AbortSignal.timeout(30_000), seams: {} },
    )

    await executor.execute({ prompt: 'TASK_PROMPT_4d10' }, AbortSignal.timeout(30_000))

    // `streamAgentTurn` hands a leaf `{ prompt }`, not a bare string. The prompt reaches the
    // harness as text rather than as a JSON blob wrapping it.
    const argv = (seen[0]?.invocation?.args ?? []).join('\n')
    expect(seen[0]?.taskPrompt).toBe('TASK_PROMPT_4d10')
    expect(argv).toContain('TASK_PROMPT_4d10')
    expect(argv).not.toContain('{"prompt"')
    expect(readFileSync(join(workspacePath, 'program.mjs'), 'utf8')).toBe(
      'export const version = 1\n',
    )
    expect(runtimeOwnedExecutorMaterialization(executor)?.model).toEqual({
      status: 'known',
      id: 'test/author-model',
    })
  })

  it('refuses an unknown seam field rather than ignoring it', () => {
    expect(() =>
      createExecutor({
        backend: 'cli-in-place',
        workspacePath: '/tmp/whatever',
        repoRoot: '/tmp/whatever',
      } as never),
    ).toThrow(/unknown fields repoRoot/u)
  })
})
