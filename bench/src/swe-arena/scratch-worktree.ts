import { rm } from 'node:fs/promises'
import { run, runOk } from './proc'

// Git worktree subcommands mutate shared metadata under .git/worktrees and are
// not safe to overlap, even when each command targets a different destination.
const repositoryMutationQueues = new Map<string, Promise<void>>()

async function mutateWorktrees<T>(
  repository: string,
  operation: () => Promise<T>,
): Promise<T> {
  const predecessor = repositoryMutationQueues.get(repository) ?? Promise.resolve()
  const result = predecessor.then(operation, operation)
  const settled = result.then(
    () => undefined,
    () => undefined,
  )
  repositoryMutationQueues.set(repository, settled)
  try {
    return await result
  } finally {
    if (repositoryMutationQueues.get(repository) === settled) {
      repositoryMutationQueues.delete(repository)
    }
  }
}

export async function createDetachedWorktree(
  repository: string,
  commit: string,
  destination: string,
): Promise<void> {
  await mutateWorktrees(repository, async () => {
    await run('git', ['-C', repository, 'worktree', 'remove', '--force', '--', destination])
    await rm(destination, { recursive: true, force: true })
    await runOk('git', ['-C', repository, 'worktree', 'add', '--detach', destination, commit])
  })
}

export async function pruneDetachedWorktrees(repository: string): Promise<void> {
  await mutateWorktrees(repository, async () => {
    await runOk('git', ['-C', repository, 'worktree', 'prune'])
  })
}

export async function removeDetachedWorktree(
  repository: string,
  destination: string,
): Promise<void> {
  await mutateWorktrees(repository, async () => {
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
  })
}
