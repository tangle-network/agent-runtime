/**
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
 *
 * @experimental
 */

import { spawn } from 'node:child_process'
import { isAbsolute, win32 } from 'node:path'

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
  /**
   * Repository-relative input paths to omit from the captured worker patch.
   * Paths are passed to Git with literal exclusion magic, so profile-provided
   * `*`, `?`, `[` and `:` characters can never expand into broader pathspecs.
   */
  excludePaths?: ReadonlyArray<string>
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
    throw gitFailure(step, result)
  }
}

function gitFailure(
  step: string,
  result: { stdout: string; stderr: string; exitCode: number },
): Error {
  return new Error(
    `worktree: git ${step} failed (exit ${result.exitCode}): ${result.stderr.slice(0, 400)}`,
  )
}

/** Checkout a fresh git worktree for a delegation run on a new branch under `variantsDir`. @experimental */
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

/** Stage worker changes and return the diff + shortstat, excluding declared input paths. @experimental */
export async function captureWorktreeDiff(options: DiffOptions): Promise<DiffResult> {
  const baseRef = options.baseRef ?? options.worktree.baseSha
  const pathspecs = worktreeDiffPathspecs(options.excludePaths ?? [])
  // Stage everything (incl. NEW/untracked files) before diffing: a plain `git diff <ref>`
  // omits untracked files, so a worker that delivers by CREATING a file (a fresh dossier,
  // a new module) would produce an empty diff and silently fail to compound. Staging into
  // the index and diffing `--cached` captures created files. The worktree is ephemeral, so
  // mutating its index has no observable side effect.
  const staged = await runGitAsync(
    ['add', '-A', ...(pathspecs.length > 0 ? ['--', '.', ...pathspecs] : [])],
    options.worktree.path,
    options.runGit,
  )
  ensureGitOk('add -A', staged)
  const patch = await runGitAsync(
    ['diff', '--cached', baseRef, ...(pathspecs.length > 0 ? ['--', '.', ...pathspecs] : [])],
    options.worktree.path,
    options.runGit,
  )
  ensureGitOk(`diff --cached ${baseRef}`, patch)

  // Stats: `git diff --shortstat` produces e.g. " 3 files changed, 42 insertions(+), 10 deletions(-)".
  const shortstat = await runGitAsync(
    [
      'diff',
      '--cached',
      '--shortstat',
      baseRef,
      ...(pathspecs.length > 0 ? ['--', '.', ...pathspecs] : []),
    ],
    options.worktree.path,
    options.runGit,
  )
  ensureGitOk(`diff --cached --shortstat ${baseRef}`, shortstat)
  const stats = parseShortstat(shortstat.stdout)
  return { patch: patch.stdout, stats }
}

function worktreeDiffPathspecs(paths: ReadonlyArray<string>): string[] {
  const normalized = new Set<string>()
  for (const path of paths) {
    if (
      typeof path !== 'string' ||
      path.length === 0 ||
      path.includes('\\') ||
      hasControlCharacter(path) ||
      isAbsolute(path) ||
      win32.isAbsolute(path)
    ) {
      throw new Error(
        `worktree: excluded path must be a canonical repository-relative path: ${path}`,
      )
    }
    const segments = path.split('/')
    if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
      throw new Error(
        `worktree: excluded path must be a canonical repository-relative path: ${path}`,
      )
    }
    normalized.add(path)
  }
  return [...normalized]
    .sort((left, right) => left.localeCompare(right))
    .map((path) => `:(top,exclude,literal)${path}`)
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
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

/**
 * Remove a git worktree and delete its branch. Already-removed paths are harmless; every other
 * Git failure rejects so callers cannot report a worktree as destroyed when cleanup failed.
 * @experimental
 */
export async function removeWorktree(options: RemoveWorktreeOptions): Promise<void> {
  const force = options.force ?? true
  const args = ['worktree', 'remove']
  if (force) args.push('--force')
  args.push(options.worktree.path)
  const removal = await runGitAsync(args, options.repoRoot, options.runGit)
  const removalError =
    removal.exitCode !== 0 && !/not a working tree/iu.test(removal.stderr)
      ? gitFailure(`worktree remove ${options.worktree.path}`, removal)
      : undefined

  // Worktree removal leaves its branch behind by design. Missing branches are repeat cleanup.
  const branchRemoval = await runGitAsync(
    ['branch', '-D', options.worktree.branch],
    options.repoRoot,
    options.runGit,
  )
  const branchError =
    branchRemoval.exitCode !== 0 && !/branch .+ not found/iu.test(branchRemoval.stderr)
      ? gitFailure(`branch -D ${options.worktree.branch}`, branchRemoval)
      : undefined

  if (removalError && branchError) {
    throw new AggregateError(
      [removalError, branchError],
      'worktree: failed to remove worktree and branch',
    )
  }
  if (removalError) throw removalError
  if (branchError) throw branchError
}
