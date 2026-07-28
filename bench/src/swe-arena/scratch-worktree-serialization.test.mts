import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const gitCalls = vi.hoisted(() => ({
  activeByRepository: new Map<string, number>(),
  maximumByRepository: new Map<string, number>(),
  active: 0,
  maximum: 0,
}))

vi.mock('./proc', () => {
  const recordGitCall = async (_binary: string, arguments_: string[]) => {
    const repository = arguments_[1] ?? ''
    const activeForRepository = (gitCalls.activeByRepository.get(repository) ?? 0) + 1
    gitCalls.activeByRepository.set(repository, activeForRepository)
    gitCalls.maximumByRepository.set(
      repository,
      Math.max(gitCalls.maximumByRepository.get(repository) ?? 0, activeForRepository),
    )
    gitCalls.active += 1
    gitCalls.maximum = Math.max(gitCalls.maximum, gitCalls.active)
    await new Promise((resolve) => setTimeout(resolve, 5))
    gitCalls.active -= 1
    gitCalls.activeByRepository.set(repository, activeForRepository - 1)
    return { code: 0, stdout: '', stderr: '' }
  }
  return {
    run: vi.fn(recordGitCall),
    runOk: vi.fn(recordGitCall),
  }
})

import {
  createDetachedWorktree,
  pruneDetachedWorktrees,
  removeDetachedWorktree,
} from './scratch-worktree.ts'

describe('scratch worktree mutation serialization', () => {
  const roots: string[] = []

  afterEach(async () => {
    gitCalls.activeByRepository.clear()
    gitCalls.maximumByRepository.clear()
    gitCalls.active = 0
    gitCalls.maximum = 0
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('serializes metadata changes per repository without blocking separate repositories', async () => {
    const output = await mkdtemp(join(tmpdir(), 'scratch-worktree-serialization-'))
    roots.push(output)
    const operations = ['repository-a', 'repository-b'].flatMap((repository) =>
      Array.from({ length: 4 }, (_, index) => {
        const destination = join(output, `${repository}-candidate-${index}`)
        return [
          createDetachedWorktree(repository, 'commit', destination),
          removeDetachedWorktree(repository, destination),
          pruneDetachedWorktrees(repository),
        ]
      }),
    )

    await Promise.all(operations.flat())

    expect(gitCalls.maximumByRepository.get('repository-a')).toBe(1)
    expect(gitCalls.maximumByRepository.get('repository-b')).toBe(1)
    expect(gitCalls.maximum).toBe(2)
  })
})
