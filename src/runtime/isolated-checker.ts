import { execFile, spawn } from 'node:child_process'
import { cp, mkdtemp, realpath, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { promisify } from 'node:util'

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
      reason: 'refused' | 'failed' | 'timeout' | 'cancelled' | 'output-limit' | 'cleanup-failed'
      diagnostic: string
      /** Bounded command evidence, when a process was launched. */
      stdout?: string
      stderr?: string
      exitCode?: number | null
      /** Cleanup failures never replace the primary command failure. */
      cleanupDiagnostic?: string
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
  let result: IsolatedCheckResult
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
    result = await execute(args, timeoutMs, maxOutputBytes, options.signal)
  } catch (error) {
    result = { succeeded: false, reason: 'refused', diagnostic: String(error) }
  }
  if (scratch) {
    try {
      await removeScratch(scratch)
    } catch (error) {
      const cleanupDiagnostic = String(error)
      result = result.succeeded
        ? {
            succeeded: false,
            reason: 'cleanup-failed',
            diagnostic: cleanupDiagnostic,
            stdout: result.value.stdout,
            stderr: result.value.stderr,
            exitCode: 0,
          }
        : { ...result, cleanupDiagnostic }
    }
  }
  return result
}

function execute(
  args: string[],
  timeoutMs: number,
  limit: number,
  signal?: AbortSignal,
): Promise<IsolatedCheckResult> {
  return new Promise((done) => {
    const child = spawn('/usr/bin/bwrap', ['--json-status-fd', '3', ...args], {
      env: {},
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
      detached: true,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let bytes = 0
    let status = ''
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
    child.stdio[3]?.on('data', (chunk: Buffer) => {
      if (status.length + chunk.length > 16_384) {
        stop('output-limit')
        return
      }
      status += chunk.toString()
    })
    child.stdout!.on('data', capture(stdout))
    child.stderr!.on('data', capture(stderr))
    let spawnError: Error | undefined
    child.on('error', (error) => {
      spawnError = error
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      const out = Buffer.concat(stdout).toString()
      const err = Buffer.concat(stderr).toString()
      const evidence = { stdout: out, stderr: err, exitCode: code }
      // Only Bubblewrap writes this private pipe; command stderr cannot forge setup status.
      const executed = status.split('\n').some((line) => {
        try {
          const record: unknown = JSON.parse(line)
          return (
            record !== null &&
            typeof record === 'object' &&
            'exit-code' in record &&
            typeof record['exit-code'] === 'number' &&
            record['exit-code'] === code
          )
        } catch {
          return false
        }
      })
      if (failure)
        done({ succeeded: false, reason: failure, diagnostic: err || failure, ...evidence })
      else if (spawnError)
        done({ succeeded: false, reason: 'refused', diagnostic: String(spawnError), ...evidence })
      else if (!executed)
        done({
          succeeded: false,
          reason: 'refused',
          diagnostic: err || 'Bubblewrap did not confirm command execution',
          ...evidence,
        })
      else if (code !== 0)
        done({
          succeeded: false,
          reason: 'failed',
          diagnostic: err || out || `Check exited ${code}`,
          ...evidence,
        })
      else done({ succeeded: true, value: { stdout: out, stderr: err } })
    })
  })
}

const executeFile = promisify(execFile)

/** GNU tools traverse relative to open directories, including trees deeper than PATH_MAX.
 * Recursive chmod ignores encountered symlinks; rm never follows their targets. */
async function removeScratch(path: string): Promise<void> {
  const options = { env: {}, timeout: 10_000, maxBuffer: 16_384 }
  let permissionError: unknown
  try {
    await executeFile(
      '/bin/chmod',
      ['--recursive', '--preserve-root', 'u+rwX', '--', path],
      options,
    )
  } catch (error) {
    permissionError = error
  }
  try {
    await executeFile(
      '/bin/rm',
      ['--recursive', '--force', '--one-file-system', '--', path],
      options,
    )
  } catch (error) {
    throw new Error(
      [permissionError, error]
        .filter((value) => value !== undefined)
        .map(String)
        .join('; '),
    )
  }
}
