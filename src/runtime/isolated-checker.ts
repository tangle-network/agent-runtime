import { spawn } from 'node:child_process'
import { chmod, cp, lstat, mkdtemp, readdir, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'

export interface IsolatedCheckOptions {
  /** Trusted workspace boundary containing the untrusted tree. */
  workspaceRoot: string
  tree: string
  /** Executable and arguments, without host shell interpretation. */
  command: readonly [string, ...string[]]
  timeoutMs?: number
  maxOutputBytes?: number
  signal?: AbortSignal
}

export type IsolatedCheckResult =
  | { succeeded: true; value: { stdout: string; stderr: string } }
  | {
      succeeded: false
      reason: 'refused' | 'failed' | 'timeout' | 'cancelled' | 'output-limit'
      diagnostic: string
    }

const toolchains = ['/usr', '/bin', '/lib', '/lib64']
const contains = (parent: string, child: string) => {
  const path = relative(parent, child)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !path.startsWith(sep))
}

/**
 * Run untrusted checks inside Linux Bubblewrap. Never falls back to host execution.
 * Requires /usr/bin/bwrap and permission to create Linux namespaces.
 * Only trusted system toolchains, private proc/dev/tmp, and the writable copy are mounted.
 * The canonical input path remains the working directory; copy writes are discarded.
 * Limits bound command time and captured output, not copy size or memory consumption.
 * Callers must keep the input and trusted toolchains stable while preparing the check.
 */
export async function runIsolatedCheck(
  options: IsolatedCheckOptions,
): Promise<IsolatedCheckResult> {
  let scratch: string | undefined
  try {
    if (process.platform !== 'linux') throw new Error('Linux Bubblewrap namespaces are required')
    const timeoutMs = options.timeoutMs ?? 30_000
    const maxOutputBytes = options.maxOutputBytes ?? 1_048_576
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 2_147_483_647 ||
      !Number.isSafeInteger(maxOutputBytes) ||
      maxOutputBytes < 1
    )
      throw new Error('Invalid execution limits')
    if (!options.command.length || !options.command[0]) throw new Error('A command is required')
    if (options.signal?.aborted)
      return { succeeded: false, reason: 'cancelled', diagnostic: 'Check cancelled' }
    const workspace = await realpath(options.workspaceRoot)
    const tree = await realpath(options.tree)
    if (!contains(workspace, tree) || !(await stat(tree)).isDirectory())
      throw new Error('Tree must be a directory inside the workspace')
    const binds: string[] = []
    for (const path of toolchains) {
      let actual: string
      try {
        actual = await realpath(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      for (const mount of [path, actual]) {
        if (
          contains(mount, workspace) ||
          contains(workspace, mount) ||
          contains(mount, tree) ||
          contains(tree, mount)
        ) {
          throw new Error(`Toolchain overlaps protected workspace: ${path}`)
        }
      }
      binds.push('--ro-bind', actual, path)
    }
    // Fixed mount destinations must not cover or be covered by the evidence tree.
    if (['/proc', '/dev'].some((path) => contains(path, tree) || contains(tree, path))) {
      throw new Error('Tree overlaps a reserved namespace mount')
    }
    scratch = await mkdtemp(join(tmpdir(), 'runtime-check-'))
    if (contains(tree, scratch)) throw new Error('Temporary storage must be outside the input tree')
    const copy = join(scratch, 'tree')
    // Preserve link text. Following links here would copy host data into the jail.
    await cp(tree, copy, { recursive: true, dereference: false, verbatimSymlinks: true })
    const args = [
      '--unshare-all',
      '--die-with-parent',
      '--new-session',
      '--cap-drop',
      'ALL',
      '--clearenv',
      '--setenv',
      'PATH',
      '/usr/bin:/bin',
      '--setenv',
      'HOME',
      '/tmp',
      '--setenv',
      'LANG',
      'C',
      ...binds,
      '--proc',
      '/proc',
      '--dev',
      '/dev',
      '--tmpfs',
      '/tmp',
      '--bind',
      copy,
      tree,
      '--chdir',
      tree,
      '--',
      ...options.command,
    ]
    return await execute(args, timeoutMs, maxOutputBytes, options.signal)
  } catch (error) {
    return { succeeded: false, reason: 'refused', diagnostic: String(error) }
  } finally {
    if (scratch) {
      await restoreDirectoryAccess(scratch)
      await rm(scratch, { recursive: true, force: true })
    }
  }
}

function execute(
  args: string[],
  timeoutMs: number,
  limit: number,
  signal?: AbortSignal,
): Promise<IsolatedCheckResult> {
  return new Promise((done) => {
    const child = spawn('/usr/bin/bwrap', args, {
      env: {},
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let bytes = 0
    let failure: 'timeout' | 'cancelled' | 'output-limit' | undefined
    const stop = (reason: typeof failure) => {
      failure ??= reason
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill('SIGKILL')
        }
      }
    }
    const timer = setTimeout(() => stop('timeout'), timeoutMs)
    const cancel = () => stop('cancelled')
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
    const capture = (target: Buffer[]) => (chunk: Buffer) => {
      const remaining = Math.max(0, limit - bytes)
      bytes += chunk.length
      if (remaining) target.push(chunk.subarray(0, remaining))
      if (bytes > limit) stop('output-limit')
    }
    child.stdout.on('data', capture(stdout))
    child.stderr.on('data', capture(stderr))
    let spawnError: Error | undefined
    child.on('error', (error) => {
      spawnError = error
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      const out = Buffer.concat(stdout).toString()
      const err = Buffer.concat(stderr).toString()
      if (failure) done({ succeeded: false, reason: failure, diagnostic: err || failure })
      else if (spawnError)
        done({ succeeded: false, reason: 'refused', diagnostic: String(spawnError) })
      else if (code !== 0)
        done({
          succeeded: false,
          reason: err.startsWith('bwrap:') ? 'refused' : 'failed',
          diagnostic: err || `Check exited ${code}`,
        })
      else done({ succeeded: true, value: { stdout: out, stderr: err } })
    })
  })
}

// The child may remove directory permissions. Never follow its links during cleanup.
async function restoreDirectoryAccess(path: string): Promise<void> {
  if (!(await lstat(path)).isDirectory()) return
  await chmod(path, 0o700)
  for (const entry of await readdir(path)) await restoreDirectoryAccess(join(path, entry))
}
