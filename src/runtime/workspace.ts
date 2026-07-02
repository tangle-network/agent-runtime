/** Command runner seam. Host code can use `localShell`; sandbox code can wrap `box.exec`. */
export type Shell = (
  args: ReadonlyArray<string>,
  cwd?: string,
) => Promise<{ stdout: string; stderr: string; code: number }>

export type WorkspaceCommit =
  | { readonly ok: true; readonly rev: string }
  | { readonly ok: false; readonly conflict: string }

export interface Workspace {
  readonly ref: string
  materialize(dir: string): Promise<void>
  commit(dir: string, message: string): Promise<WorkspaceCommit>
  head(): Promise<string>
}

/** Host-process `Shell`: run a command via `execFile`, resolving `{ stdout, stderr, code }` (never throws on non-zero exit). */
export function localShell(): Shell {
  return async (args, cwd) => {
    const { execFile } = await import('node:child_process')
    const [bin, ...rest] = args
    return new Promise((resolve) => {
      execFile(
        bin ?? '',
        rest,
        { cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
        (err: Error | null, stdout: string, stderr: string) => {
          resolve({
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            code: err ? ((err as { code?: number }).code ?? 1) : 0,
          })
        },
      )
    })
  }
}

export interface GitWorkspaceOptions {
  readonly ref: string
  readonly shell?: Shell
  readonly branch?: string
  readonly noHooks?: boolean
}

/** A `Workspace` over a git checkout: materialize an isolated worktree at `ref`, commit produced changes (conflict-aware), and read `head` — hooks disabled, identity pinned. */
export function gitWorkspace(opts: GitWorkspaceOptions): Workspace {
  const shell = opts.shell ?? localShell()
  const branch = opts.branch ?? 'main'
  const cfg = opts.noHooks === false ? [] : ['-c', 'core.hooksPath=/dev/null']
  const ident = ['-c', 'user.email=workspace@tangle.local', '-c', 'user.name=workspace']

  const run = async (args: string[], cwd?: string): Promise<string> => {
    const res = await shell(['git', ...cfg, ...ident, ...args], cwd)
    if (res.code !== 0) {
      throw new Error(
        `git ${args.join(' ')} failed (${res.code}): ${tail(res.stderr || res.stdout)}`,
      )
    }
    return res.stdout
  }

  return {
    ref: opts.ref,
    materialize: (dir) => run(['clone', '--branch', branch, opts.ref, dir]).then(() => {}),
    async commit(dir, message) {
      await run(['add', '-A'], dir)
      const status = await run(['status', '--porcelain'], dir)
      if (!status.trim()) return { ok: true, rev: (await run(['rev-parse', 'HEAD'], dir)).trim() }
      await run(['commit', '-m', message], dir)
      const pull = await shell(['git', ...cfg, ...ident, 'pull', '--rebase', 'origin', branch], dir)
      if (pull.code !== 0) {
        await shell(['git', ...cfg, 'rebase', '--abort'], dir).catch(() => {})
        return { ok: false, conflict: tail(pull.stderr || pull.stdout) }
      }
      const push = await shell(['git', ...cfg, ...ident, 'push', 'origin', branch], dir)
      if (push.code !== 0) return { ok: false, conflict: tail(push.stderr || push.stdout) }
      return { ok: true, rev: (await run(['rev-parse', 'HEAD'], dir)).trim() }
    },
    async head() {
      const out = await run(['ls-remote', opts.ref, `refs/heads/${branch}`])
      return out.split(/\s+/)[0] ?? ''
    },
  }
}

/** A jj-backed `Workspace` (Jujutsu, colocated with git for the durable remote).
 *  Same port, same `Shell` — a drop-in for `gitWorkspace`. jj suits agent loops:
 *  no staging area, and a first-class operation log (native resume/undo). Live use
 *  requires `jj` on the `Shell`'s host. */
export function jjWorkspace(opts: GitWorkspaceOptions): Workspace {
  const shell = opts.shell ?? localShell()
  const branch = opts.branch ?? 'main'
  // jj reads its author identity from config, not per-call flags like git's `-c
  // user.*`; inject it via --config-toml so a throwaway clone is self-contained
  // (parallels gitWorkspace's `ident`). Global flags must precede the subcommand.
  const ident = [
    '--config-toml',
    'user.name="workspace"',
    '--config-toml',
    'user.email="workspace@tangle.local"',
  ]

  const jj = async (args: string[], cwd?: string): Promise<string> => {
    const res = await shell(['jj', ...ident, ...args], cwd)
    if (res.code !== 0) {
      throw new Error(
        `jj ${args.join(' ')} failed (${res.code}): ${tail(res.stderr || res.stdout)}`,
      )
    }
    return res.stdout
  }

  return {
    ref: opts.ref,
    // Colocated clone: jj manages history, git holds the durable remote.
    materialize: (dir) => jj(['git', 'clone', '--colocate', opts.ref, dir]).then(() => {}),
    async commit(dir, message) {
      // jj auto-snapshots the working copy; describe the change, then open a fresh
      // empty change so the next commit doesn't amend this one. A rejected push is
      // surfaced as a typed blocker (conflicts are first-class in jj, not aborted).
      await jj(['describe', '-m', message], dir)
      await jj(['new'], dir)
      const push = await shell(['jj', ...ident, 'git', 'push', '--branch', branch], dir)
      if (push.code !== 0) return { ok: false, conflict: tail(push.stderr || push.stdout) }
      const rev = (await jj(['log', '--no-graph', '-r', '@-', '-T', 'commit_id'], dir)).trim()
      return { ok: true, rev }
    },
    async head() {
      const out = await shell(['git', 'ls-remote', opts.ref, `refs/heads/${branch}`])
      return out.stdout.split(/\s+/)[0] ?? ''
    },
  }
}

export interface WorkspaceRun<T> {
  readonly valid: boolean
  readonly value: T
  /** Present when a commit was attempted (valid, or `commitOnInvalid`). */
  readonly commit?: WorkspaceCommit
}

/**
 * Run a worker `body` inside a FRESH clone of a shared `Workspace`, then commit its work back
 * so the next worker (or the supervisor) builds on it. This is the seam that turns isolated
 * per-worker cwds into one compounding artifact — `body` gets a real materialized dir, its
 * delivery is committed to the shared ref iff it's valid (a conflict is returned, never thrown).
 * The clone is removed after; durable state lives only in the ref.
 */
export async function runInWorkspace<T>(
  ws: Workspace,
  body: (cwd: string) => Promise<{ valid: boolean; value: T; message?: string }>,
  opts: { tmpPrefix?: string; commitOnInvalid?: boolean } = {},
): Promise<WorkspaceRun<T>> {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), opts.tmpPrefix ?? 'ws-run-'))
  try {
    await ws.materialize(dir)
    const r = await body(dir)
    if (r.valid || opts.commitOnInvalid) {
      const message = r.message ?? (r.valid ? 'worker: delivered' : 'worker: wip')
      const commit = await ws.commit(dir, message)
      return { valid: r.valid, value: r.value, commit }
    }
    return { valid: r.valid, value: r.value }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function tail(s: string): string {
  return s.slice(-400)
}
