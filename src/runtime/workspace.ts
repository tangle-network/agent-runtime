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

function tail(s: string): string {
  return s.slice(-400)
}
