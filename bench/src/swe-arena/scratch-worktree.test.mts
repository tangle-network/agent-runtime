import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runOk } from './proc.ts'
import {
  createDetachedWorktree,
  pruneDetachedWorktrees,
  removeDetachedWorktree,
} from './scratch-worktree.ts'

describe('scratch worktrees', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('creates and removes a parallel batch without pruning live metadata', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'scratch-worktree-repo-'))
    const output = await mkdtemp(join(tmpdir(), 'scratch-worktree-out-'))
    roots.push(repository, output)
    await runOk('git', ['init', '-q', '-b', 'main', repository])
    await runOk('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await runOk('git', ['-C', repository, 'config', 'user.name', 'Test'])
    await writeFile(join(repository, 'seed.txt'), 'seed\n')
    await runOk('git', ['-C', repository, 'add', 'seed.txt'])
    await runOk('git', ['-C', repository, 'commit', '-q', '-m', 'seed'])
    const commit = (
      await runOk('git', ['-C', repository, 'rev-parse', 'HEAD'])
    ).stdout.trim()
    for (let batch = 0; batch < 5; batch += 1) {
      const worktrees = Array.from(
        { length: 8 },
        (_, index) => join(output, `batch-${batch}-candidate-${index}`),
      )
      await pruneDetachedWorktrees(repository)
      await Promise.all(
        worktrees.map((worktree) => createDetachedWorktree(repository, commit, worktree)),
      )
      expect(
        await Promise.all(
          worktrees.map((worktree) => readFile(join(worktree, 'seed.txt'), 'utf8')),
        ),
      ).toEqual(Array.from({ length: 8 }, () => 'seed\n'))
      await Promise.all(
        worktrees.map((worktree) => removeDetachedWorktree(repository, worktree)),
      )
    }
    const listed = (
      await runOk('git', ['-C', repository, 'worktree', 'list', '--porcelain'])
    ).stdout
    expect(listed.match(/^worktree /gmu)).toHaveLength(1)
  })
})
