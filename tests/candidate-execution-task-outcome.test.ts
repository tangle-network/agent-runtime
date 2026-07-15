import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { verifyTaskOutcomePatch } from '../src/candidate-execution/git-materialize'
import {
  cleanupCandidateFixtures,
  createCandidateExecutionFixture,
} from './helpers/candidate-execution-fixture'

const temporaryDirectories: string[] = []

afterEach(() => {
  cleanupCandidateFixtures()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function git(root: string, args: string[], input?: Uint8Array, env: Record<string, string> = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    input,
    env: { ...process.env, ...env },
  }).trim()
}

function changedOutcome(root: string, baseTree: string) {
  const patch = Buffer.from(
    [
      'diff --git a/source.ts b/source.ts',
      '--- a/source.ts',
      '+++ b/source.ts',
      '@@ -1 +1 @@',
      '-export const value = 1',
      '+export const value = 2',
      '',
    ].join('\n'),
  )
  const temporary = mkdtempSync(join(tmpdir(), 'candidate-outcome-test-'))
  temporaryDirectories.push(temporary)
  const environment = { GIT_INDEX_FILE: join(temporary, 'index') }
  git(root, ['read-tree', baseTree], undefined, environment)
  git(root, ['apply', '--cached', '--binary', '--whitespace=nowarn', '-'], patch, environment)
  const resultTree = git(root, ['write-tree'], undefined, environment)
  const resultBytes = Buffer.from('export const value = 2\n')
  const afterState = {
    schemaVersion: 2 as const,
    kind: 'agent-candidate-workspace-manifest' as const,
    files: [
      {
        path: 'source.ts',
        mode: 0o644 as const,
        sha256: `sha256:${createHash('sha256').update(resultBytes).digest('hex')}` as const,
        byteLength: resultBytes.byteLength,
      },
    ],
  }
  return { patch, resultTree, afterState }
}

describe('candidate task outcome verification', () => {
  it('proves a captured binary patch and after-state against the signed base tree', async () => {
    const fixture = createCandidateExecutionFixture()
    const outcome = changedOutcome(
      fixture.task.stagingRoots.taskRoot,
      fixture.task.repository.baseTree,
    )
    await expect(
      verifyTaskOutcomePatch({
        repositoryRoot: fixture.task.stagingRoots.taskRoot,
        baseCommit: fixture.task.repository.baseCommit,
        baseTree: fixture.task.repository.baseTree,
        ...outcome,
      }),
    ).resolves.toMatchObject({
      resultTree: outcome.resultTree,
      resultCommit: expect.stringMatching(/^[a-f0-9]{40}$/),
    })
  })

  it('rejects a claimed result tree or after-state that does not match the patch', async () => {
    const fixture = createCandidateExecutionFixture()
    const outcome = changedOutcome(
      fixture.task.stagingRoots.taskRoot,
      fixture.task.repository.baseTree,
    )
    await expect(
      verifyTaskOutcomePatch({
        repositoryRoot: fixture.task.stagingRoots.taskRoot,
        baseCommit: fixture.task.repository.baseCommit,
        baseTree: fixture.task.repository.baseTree,
        ...outcome,
        resultTree: '0'.repeat(fixture.task.repository.baseTree.length),
      }),
    ).rejects.toThrow(/materialized tree/)
    await expect(
      verifyTaskOutcomePatch({
        repositoryRoot: fixture.task.stagingRoots.taskRoot,
        baseCommit: fixture.task.repository.baseCommit,
        baseTree: fixture.task.repository.baseTree,
        ...outcome,
        afterState: {
          ...outcome.afterState,
          files: [{ ...outcome.afterState.files[0]!, byteLength: 999 }],
        },
      }),
    ).rejects.toThrow(/after-state/)
  })
})
