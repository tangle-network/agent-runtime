/**
 * @experimental
 *
 * Git worktree helpers for the in-process delegation executor. Each
 * delegation runs in its own worktree so multiple parallel harness
 * subprocesses (claude / codex / opencode in a 3-way fanout) don't clobber
 * each other's edits on the shared workspace.
 *
 * Worktrees live under `<repoRoot>/.agent-worktrees/<runId>/`. After the
 * harness exits + the diff is captured, the worktree is removed.
 *
 * All operations spawn `git` via `child_process.spawn` synchronously
 * (via a `runGit` helper). Stays narrow on purpose: no commits, no rebases.
 * Diff capture stages all changes (`git add -A`) into the ephemeral worktree's
 * index so created (untracked) files appear in the `--cached` diff.
 */

import { spawn } from 'node:child_process'

/** @experimental */
export interface WorktreeHandle {
  /** Absolute path to the worktree directory. */
  path: string
  /** SHA the worktree was created at. */
  baseSha: string
  /** Branch name created for this worktree (typically `delegate/<runId>`). */
  branch: string
}

/** @experimental */
export interface CreateWorktreeOptions {
  /** Absolute path to the main git checkout. */
  repoRoot: string
  /** Unique id for the worktree path + branch. Use the delegation run id. */
  runId: string
  /** Parent directory the worktree lives under. Defaults to `.agent-worktrees`. */
  variantsDir?: string
  /** Override the base ref (default `HEAD`). */
  baseRef?: string
  /** Test seam — inject a custom git runner. */
  runGit?: GitRunner
}

/** @experimental */
export interface DiffOptions {
  /** Worktree to diff. */
  worktree: WorktreeHandle
  /** What to compare against. Default `worktree.baseSha`. */
  baseRef?: string
  /** Test seam. */
  runGit?: GitRunner
}

/** @experimental */
export interface DiffResult {
  patch: string
  stats: {
    filesChanged: number
    insertions: number
    deletions: number
  }
}

/** @experimental */
export interface RemoveWorktreeOptions {
  worktree: WorktreeHandle
  repoRoot: string
  /** Force removal even if dirty (default true; the loser of a fanout has uncommitted changes). */
  force?: boolean
  /** Test seam. */
  runGit?: GitRunner
}

/** Pluggable git runner (sync) — replaceable in tests. */
export type GitRunner = (
  args: ReadonlyArray<string>,
  opts: { cwd: string },
) => { stdout: string; stderr: string; exitCode: number }

async function runGitAsync(
  args: ReadonlyArray<string>,
  cwd: string,
  runner?: GitRunner,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (runner) return runner(args, { cwd })
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd, stdio: 'pipe' })
    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (c) => {
      stdout += String(c)
    })
    proc.stderr?.on('data', (c) => {
      stderr += String(c)
    })
    proc.on('error', reject)
    proc.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }))
  })
}

function ensureGitOk(
  step: string,
  result: { stdout: string; stderr: string; exitCode: number },
): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `worktree: git ${step} failed (exit ${result.exitCode}): ${result.stderr.slice(0, 400)}`,
    )
  }
}

/** @experimental */
export async function createWorktree(options: CreateWorktreeOptions): Promise<WorktreeHandle> {
  const variants = options.variantsDir ?? '.agent-worktrees'
  const baseRef = options.baseRef ?? 'HEAD'
  const branch = `delegate/${options.runId}`
  const path = `${options.repoRoot.replace(/\/+$/, '')}/${variants}/${options.runId}`

  const headSha = await runGitAsync(['rev-parse', baseRef], options.repoRoot, options.runGit)
  ensureGitOk(`rev-parse ${baseRef}`, headSha)

  const add = await runGitAsync(
    ['worktree', 'add', '-b', branch, path, baseRef],
    options.repoRoot,
    options.runGit,
  )
  ensureGitOk(`worktree add ${path}`, add)

  return { path, baseSha: headSha.stdout.trim(), branch }
}

/** @experimental */
export async function captureWorktreeDiff(options: DiffOptions): Promise<DiffResult> {
  const baseRef = options.baseRef ?? options.worktree.baseSha
  // Stage everything (incl. NEW/untracked files) before diffing: a plain `git diff <ref>`
  // omits untracked files, so a worker that delivers by CREATING a file (a fresh dossier,
  // a new module) would produce an empty diff and silently fail to compound. Staging into
  // the index and diffing `--cached` captures created files. The worktree is ephemeral, so
  // mutating its index has no observable side effect.
  await runGitAsync(['add', '-A'], options.worktree.path, options.runGit)
  const patch = await runGitAsync(
    ['diff', '--cached', baseRef],
    options.worktree.path,
    options.runGit,
  )
  // No `ensureGitOk` here — diff returns 0 even when there are no changes.

  // Stats: `git diff --shortstat` produces e.g. " 3 files changed, 42 insertions(+), 10 deletions(-)".
  const shortstat = await runGitAsync(
    ['diff', '--cached', '--shortstat', baseRef],
    options.worktree.path,
    options.runGit,
  )
  const stats = parseShortstat(shortstat.stdout)
  return { patch: patch.stdout, stats }
}

function parseShortstat(text: string): DiffResult['stats'] {
  // `text` is the raw stdout of `git diff --shortstat`. Empty when no
  // changes. Parse defensively — the format is stable but we don't trust
  // it for type-safety.
  const out = { filesChanged: 0, insertions: 0, deletions: 0 }
  const filesMatch = text.match(/(\d+)\s+files?\s+changed/)
  if (filesMatch?.[1]) out.filesChanged = Number(filesMatch[1])
  const insertMatch = text.match(/(\d+)\s+insertions?/)
  if (insertMatch?.[1]) out.insertions = Number(insertMatch[1])
  const deleteMatch = text.match(/(\d+)\s+deletions?/)
  if (deleteMatch?.[1]) out.deletions = Number(deleteMatch[1])
  return out
}

/** @experimental */
export async function removeWorktree(options: RemoveWorktreeOptions): Promise<void> {
  const force = options.force ?? true
  const args = ['worktree', 'remove']
  if (force) args.push('--force')
  args.push(options.worktree.path)
  const result = await runGitAsync(args, options.repoRoot, options.runGit)
  // Don't ensureGitOk — partial-removal scenarios are tolerable; the
  // worktree dir may already be gone (caller deleted it manually).
  if (result.exitCode !== 0 && !/not a working tree/.test(result.stderr)) {
    // Best-effort branch cleanup so the next run can reuse the runId.
    await runGitAsync(
      ['branch', '-D', options.worktree.branch],
      options.repoRoot,
      options.runGit,
    ).catch(() => undefined)
  }
  // Always attempt branch removal — the worktree-remove sometimes leaves
  // the branch behind even when the directory is gone.
  await runGitAsync(
    ['branch', '-D', options.worktree.branch],
    options.repoRoot,
    options.runGit,
  ).catch(() => undefined)
}
