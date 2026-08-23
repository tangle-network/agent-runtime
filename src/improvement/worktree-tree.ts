/**
 * The exact content of a candidate worktree, as a Git tree object.
 *
 * A multi-shot candidate edits ONE directory in place, so the tree a shot
 * produced is gone as soon as the next shot writes over it. Writing that
 * content into the object store is what makes an earlier tree recoverable:
 * `agenticGenerator` snapshots a tree that verified, and puts it back when a
 * later shot ends the budget on a worse one.
 *
 * The snapshot stages into a PRIVATE index file, so the index the driver later
 * commits from is untouched.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Write the worktree's current content into the object store and return its tree id. */
export function snapshotWorktreeTree(worktreePath: string): string {
  const scratch = mkdtempSync(join(tmpdir(), 'agentic-generator-tree-'))
  const indexFile = join(scratch, 'index')
  try {
    // HEAD first: a tracked file that `.gitignore` also matches stays in the
    // tree. Against an EMPTY index `git add -A` reads that file as untracked
    // and drops it, and restoring such a tree would delete a tracked file.
    git(worktreePath, ['read-tree', 'HEAD'], indexFile)
    git(worktreePath, ['add', '--all'], indexFile)
    return git(worktreePath, ['write-tree'], indexFile)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/**
 * Put a snapshotted tree back into the worktree, then prove the directory
 * holds exactly that tree.
 *
 * The proof is not ceremony: a restore that lands the wrong bytes ships the
 * wrong candidate, and every artifact downstream still reads as though the
 * best tree shipped.
 */
export function restoreWorktreeTree(worktreePath: string, tree: string): void {
  git(worktreePath, ['read-tree', '-u', '--reset', tree])
  // `read-tree` removes what the index tracked. A file a later shot added is
  // untracked, so it survives that and would ship beside the restored tree.
  // Ignored files are left alone, exactly as a commit leaves them.
  git(worktreePath, ['clean', '--force', '-d', '--quiet'])
  const restored = snapshotWorktreeTree(worktreePath)
  if (restored !== tree) {
    throw new Error(
      `agenticGenerator: restoring tree ${tree} into ${worktreePath} produced ${restored}`,
    )
  }
}

function git(cwd: string, args: string[], indexFile?: string): string {
  const env = { ...process.env }
  if (indexFile) env.GIT_INDEX_FILE = indexFile
  else delete env.GIT_INDEX_FILE
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8', env })
  if (result.error) {
    throw new Error(
      `agenticGenerator: git ${args[0]} failed to spawn in ${cwd}: ${result.error.message}`,
    )
  }
  if (result.status !== 0) {
    throw new Error(
      `agenticGenerator: git ${args[0]} exited ${result.status} in ${cwd}: ${result.stderr.trim()}`,
    )
  }
  return result.stdout.trim()
}
