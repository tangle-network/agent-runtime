import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  constants as fsConstants,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Workspace } from '../workspace'

/**
 * Worker-clone preparation: make each worker's fresh clone a FAITHFUL copy of the
 * shared workspace's working tree, not just of its git history.
 *
 * `runInWorkspace` materializes a worker dir via `git clone`, which carries only
 * COMMITTED files. Real workspaces (SWE-bench instance images: astropy,
 * matplotlib) hold compiled extension modules (.so/.pyd) as UNTRACKED build
 * artifacts — inside a bare clone `import astropy` dies with "cannot import name
 * '_compiler'" before the worker's first edit, so its verify gate is physically
 * unpassable regardless of patch quality (observed: 7/7 astropy and 6/6
 * matplotlib workers failed exactly this way while the shared workspace verified
 * fine). The fix copies the source tree's untracked files — including git-ignored
 * build outputs — into the clone right after materialize and before the worker
 * starts.
 *
 * Isolation is preserved: artifacts are COPIED (copy-on-write via FICLONE where
 * the filesystem supports it — never hardlinked, a worker rebuild opening an
 * artifact with O_TRUNC on a shared inode would corrupt the source workspace for
 * every sibling), and an absolute symlink pointing inside the source tree is
 * rewritten to the clone-local path so no worker holds a live handle back into
 * shared mutable state.
 *
 * Fidelity stops at git history: every copied path is appended to the clone's
 * `.git/info/exclude`, so the clone-side `git add -A` (both the local delegate's
 * diff capture and `gitWorkspace.commit`) can never stage pre-existing build
 * artifacts into the shared ref — in the source they are untracked, and a
 * delivery must not silently start tracking them.
 *
 * Promoted verbatim from `loops/src/worker-clone.ts` (see agent-dev-container#4519): any harness
 * that materializes workers via `git clone` needs the working tree, not just the history.
 *
 * @experimental
 */

/** Agent-infra dirs living inside a workspace; orchestration state, never build inputs. `.loops` is the pre-rename location of `.agent` supervisor state. */
const SKIPPED_TOP_LEVEL = new Set(['.agent', '.loops', '.evolve', '.agent-worktrees', '.claude'])

/** Warn (and copy anyway) past this untracked payload size. */
const DEFAULT_WARN_BYTES = 2 * 1024 * 1024 * 1024

export interface UntrackedCopyStats {
  /** Files + symlinks that landed in the clone. */
  copied: number
  /** Total regular-file bytes enumerated (pre-copy, so the size warning fires first). */
  bytes: number
}

export interface CopyOptions {
  warnBytes?: number
  log?: (message: string) => void
}

interface PlannedEntry {
  rel: string
  kind: 'file' | 'symlink'
  size: number
  mode: number
}

/**
 * Copy every untracked file of `sourceDir`'s working tree — including git-ignored
 * build outputs (`git ls-files --others` with NO exclude flags lists both) — into
 * `cloneDir`, then shield the copied paths from the clone's `git add -A` via
 * `.git/info/exclude`. Nested git repos (listed as bare `dir/` entries), any path
 * containing a `.git` segment, and loop-infra dirs are skipped.
 */
export function copyUntrackedIntoClone(
  sourceDir: string,
  cloneDir: string,
  opts: CopyOptions = {},
): UntrackedCopyStats {
  const warnBytes = opts.warnBytes ?? DEFAULT_WARN_BYTES
  const log = opts.log ?? ((message: string) => console.warn(message))
  const src = resolve(sourceDir)
  const dst = resolve(cloneDir)

  const ls = spawnSync('git', ['-C', src, 'ls-files', '--others', '-z'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  if (ls.status !== 0) {
    throw new Error(
      `git ls-files --others failed in ${src}: ${(ls.stderr ?? '').trim() || `exit ${ls.status}`}`,
    )
  }

  // Enumerate + stat BEFORE copying so the payload-size warning precedes the work.
  const plan: PlannedEntry[] = []
  for (const rel of (ls.stdout ?? '').split('\0')) {
    if (!rel || rel.endsWith('/')) continue // '' from split; 'dir/' = nested git repo, skip
    const segments = rel.split('/')
    if (segments.includes('.git')) continue
    if (SKIPPED_TOP_LEVEL.has(segments[0] ?? '')) continue
    let stat: ReturnType<typeof lstatSync>
    try {
      stat = lstatSync(join(src, rel))
    } catch {
      continue // vanished between enumerate and stat — a live workspace is allowed to move
    }
    if (stat.isSymbolicLink()) plan.push({ rel, kind: 'symlink', size: 0, mode: stat.mode })
    else if (stat.isFile()) plan.push({ rel, kind: 'file', size: stat.size, mode: stat.mode })
    // sockets/FIFOs/devices are not copyable artifacts — skip silently
  }

  const bytes = plan.reduce((sum, entry) => sum + entry.size, 0)
  if (bytes > warnBytes) {
    log(
      `worker clone: untracked payload in ${src} is ${(bytes / 1024 / 1024).toFixed(0)}MB ` +
        `(> ${(warnBytes / 1024 / 1024).toFixed(0)}MB) — copying anyway so the clone stays runnable`,
    )
  }

  let copied = 0
  const excludeLines: string[] = []
  for (const entry of plan) {
    const from = join(src, entry.rel)
    const to = join(dst, entry.rel)
    try {
      mkdirSync(dirname(to), { recursive: true })
      if (entry.kind === 'symlink') {
        let target = readlinkSync(from)
        if (isAbsolute(target)) {
          // Never let a clone hold a live path back into the shared source tree.
          const resolved = resolve(target)
          if (resolved === src || resolved.startsWith(src + sep))
            target = join(dst, relative(src, resolved))
        }
        rmSync(to, { force: true })
        symlinkSync(target, to)
      } else {
        // FICLONE = copy-on-write clone when the fs supports it, plain copy otherwise.
        copyFileSync(from, to, fsConstants.COPYFILE_FICLONE)
        chmodSync(to, entry.mode & 0o7777)
      }
      copied += 1
      excludeLines.push(toExcludePattern(entry.rel))
    } catch (err) {
      // One uncopyable artifact must not kill the worker before it starts; for that
      // file alone the clone degrades to the pre-fix (history-only) state.
      log(
        `worker clone: failed to copy untracked ${entry.rel}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  if (excludeLines.length > 0) {
    const infoDir = join(dst, '.git', 'info')
    mkdirSync(infoDir, { recursive: true })
    appendFileSync(
      join(infoDir, 'exclude'),
      `# untracked artifacts copied from the shared workspace — never commit them back\n${excludeLines.join('\n')}\n`,
      'utf8',
    )
  }

  return { copied, bytes }
}

/** Root-anchored literal exclude pattern: glob metachars and trailing spaces escaped. */
function toExcludePattern(rel: string): string {
  const escaped = rel
    .replace(/([\\*?[\]])/g, '\\$1')
    .replace(/ +$/, (spaces) => '\\ '.repeat(spaces.length))
  return `/${escaped}`
}

/**
 * Wrap a `Workspace` so every `materialize` (the per-worker `git clone` inside
 * `runInWorkspace`) is followed by the untracked-artifact copy above — the clone
 * the worker starts in matches the source WORKING TREE, not just its history.
 * `commit`/`head` pass through untouched, so delivery semantics are unchanged.
 */
export function withUntrackedArtifacts(
  ws: Workspace,
  sourceDir: string,
  log?: (message: string) => void,
): Workspace {
  return {
    ref: ws.ref,
    materialize: async (dir: string) => {
      await ws.materialize(dir)
      copyUntrackedIntoClone(sourceDir, dir, log ? { log } : {})
    },
    commit: (dir: string, message: string) => ws.commit(dir, message),
    head: () => ws.head(),
  }
}
