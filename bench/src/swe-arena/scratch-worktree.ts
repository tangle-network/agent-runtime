import { rm } from 'node:fs/promises'
import { run, runOk } from './proc'

export async function createDetachedWorktree(
  repository: string,
  commit: string,
  destination: string,
): Promise<void> {
  await run('git', ['-C', repository, 'worktree', 'remove', '--force', '--', destination])
  await rm(destination, { recursive: true, force: true })
  await runOk('git', ['-C', repository, 'worktree', 'add', '--detach', destination, commit])
}

export async function pruneDetachedWorktrees(repository: string): Promise<void> {
  await runOk('git', ['-C', repository, 'worktree', 'prune'])
}

export async function removeDetachedWorktree(
  repository: string,
  destination: string,
): Promise<void> {
  const result = await run('git', [
    '-C',
    repository,
    'worktree',
    'remove',
    '--force',
    '--',
    destination,
  ])
  if (result.code !== 0) {
    await rm(destination, { recursive: true, force: true })
  }
}
