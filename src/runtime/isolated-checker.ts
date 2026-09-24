import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cp, mkdtemp, realpath, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import {
  type AgentCandidateWorkspaceManifestMaterial,
  canonicalCandidateDigest,
  type Sha256Digest,
} from '@tangle-network/agent-interface'
import type {
  CreateSandboxOptions,
  SandboxInstance,
  SandboxResources,
} from '@tangle-network/sandbox'
import { captureMaterializedWorkspace } from '../candidate-execution/artifacts'
import { armDeadlineTimer } from './supervise/deadline'

export interface IsolatedCheckOptions {
  /** Trusted workspace boundary containing the untrusted tree. */
  workspaceRoot: string
  tree: string
  /** Executable and arguments, without host shell interpretation. */
  command: readonly [string, ...string[]]
  timeoutMs?: number
  maxOutputBytes?: number
  signal?: AbortSignal
  /** Run the check in its own Sandbox box instead of Linux Bubblewrap on this host. */
  box?: IsolatedCheckBox
}

/**
 * A fresh Sandbox box for one check, owned by an account the judged run holds no key to.
 *
 * Any key of a Sandbox account can read, write, and execute in every box of that account.
 * A check box on the run's own account is therefore reachable by the run it judges.
 * The check refuses before it creates a box when its account is one of `builderAccounts`.
 */
export interface IsolatedCheckBox {
  /**
   * Client authenticated with the check's own key: a `Sandbox` from SDK 0.46 or later.
   * Written as its two methods because the Runtime peer range admits SDKs without `createIsolated`.
   */
  client: {
    getIdentity(): Promise<{ customerId: string }>
    createIsolated(
      options: Omit<CreateSandboxOptions, 'ownerContext'>,
      requestOptions?: { signal?: AbortSignal },
    ): Promise<SandboxInstance>
  }
  /** `customerId` from `Sandbox.getIdentity()` for every Sandbox key the judged run holds. */
  builderAccounts: readonly [string, ...string[]]
  /** Sandbox environment or image that holds the check's toolchain. */
  environment: string
  resources?: SandboxResources
}

/** The box a check ran in and the exact bytes it received. */
export interface IsolatedCheckBoxEvidence {
  sandboxId: string
  /** `customerId` of the check's key. */
  account: string
  /** Every file the box received; each sha256 is also the digest the box computed on receipt. */
  input: AgentCandidateWorkspaceManifestMaterial
  /** Canonical digest of `input`. */
  inputDigest: Sha256Digest
}

export type IsolatedCheckResult =
  | { succeeded: true; value: { stdout: string; stderr: string }; box?: IsolatedCheckBoxEvidence }
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
      /** Present once a check box received its complete input. */
      box?: IsolatedCheckBoxEvidence
    }

const toolchains = ['/usr', '/bin', '/lib', '/lib64']
const contains = (parent: string, child: string) => {
  const path = relative(parent, child)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !path.startsWith(sep))
}

/**
 * Run an untrusted check in Linux Bubblewrap, or in its own Sandbox box when `box` is set.
 * Never falls back to host execution.
 *
 * Bubblewrap requires /usr/bin/bwrap and permission to create Linux namespaces.
 * Only trusted system toolchains, private proc/dev/tmp, and the writable copy are mounted.
 * The canonical input path remains the working directory; copy writes are discarded.
 * Limits bound command time and captured output, not copy size or memory consumption.
 * Callers must keep the input and trusted toolchains stable while preparing the check.
 *
 * A box check creates one fresh box with no owner secrets and blocked egress, delivers the
 * tree's regular files verified by sha256, runs the command there, and deletes the box.
 */
export async function runIsolatedCheck(
  options: IsolatedCheckOptions,
): Promise<IsolatedCheckResult> {
  if (options.box) return runInBox(options, options.box)
  let scratch: string | undefined
  let result: IsolatedCheckResult
  try {
    if (process.platform !== 'linux') throw new Error('Linux Bubblewrap namespaces are required')
    const { timeoutMs, maxOutputBytes } = checkLimits(options)
    if (options.signal?.aborted)
      return { succeeded: false, reason: 'cancelled', diagnostic: 'Check cancelled' }
    const { workspace, tree } = await protectedTree(options)
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

function checkLimits(options: IsolatedCheckOptions): {
  timeoutMs: number
  maxOutputBytes: number
} {
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
  return { timeoutMs, maxOutputBytes }
}

async function protectedTree(
  options: IsolatedCheckOptions,
): Promise<{ workspace: string; tree: string }> {
  const workspace = await realpath(options.workspaceRoot)
  const tree = await realpath(options.tree)
  if (!contains(workspace, tree) || !(await stat(tree)).isDirectory())
    throw new Error('Tree must be a directory inside the workspace')
  return { workspace, tree }
}

/** Box-workspace-relative directory that receives the tree and is the command's cwd. */
const BOX_TREE = 'tree'
/** Bound on provisioning, delivery, and deletion; the box expires even if this process dies. */
const BOX_SETUP_SECONDS = 900
/** The box's own process timeout is a backstop behind this module's deadline. */
const BOX_PROCESS_BACKSTOP_MS = 30_000
/** Concurrent file deliveries into one check box. */
const BOX_UPLOADS = 4
/** The box's process supervisor prefixes this to stderr when it cannot start the executable. */
const BOX_EXEC_FAILURE = 'process-supervisor: exec failed'

async function runInBox(
  options: IsolatedCheckOptions,
  placement: IsolatedCheckBox,
): Promise<IsolatedCheckResult> {
  let box: SandboxInstance | undefined
  let evidence: IsolatedCheckBoxEvidence | undefined
  let result: IsolatedCheckResult
  try {
    const { timeoutMs, maxOutputBytes } = checkLimits(options)
    if (options.signal?.aborted)
      return { succeeded: false, reason: 'cancelled', diagnostic: 'Check cancelled' }
    const { tree } = await protectedTree(options)
    // Read each file once: the digest recorded is the digest of the bytes sent.
    const captured = await captureMaterializedWorkspace(tree)
    if (placement.builderAccounts.length === 0 || placement.builderAccounts.some((id) => !id))
      throw new Error('builderAccounts must name the account of every key the judged run holds')
    const account = (await placement.client.getIdentity()).customerId
    if (!account) throw new Error('Sandbox returned no account for the check key')
    if (placement.builderAccounts.includes(account))
      throw new Error(
        `Check account ${account} is an account the judged run holds a key to, so the run can reach the check box`,
      )
    options.signal?.throwIfAborted()
    box = await placement.client.createIsolated(
      {
        environment: placement.environment,
        agent: false,
        bare: false,
        ephemeral: true,
        egressPolicy: { mode: 'blocked' },
        ...(placement.resources ? { resources: placement.resources } : {}),
        maxLifetimeSeconds: Math.ceil(timeoutMs / 1_000) + BOX_SETUP_SECONDS,
        // A new identity per call: a replayed create could return a box another caller used.
        idempotencyKey: `agent-runtime-check-${randomUUID()}`,
      },
      options.signal ? { signal: options.signal } : undefined,
    )
    const receipt = box.createReceipt()
    if (
      receipt?.outcome !== 'created' ||
      receipt.ownerContext !== 'isolated' ||
      !Array.isArray(receipt.injectedSecrets) ||
      receipt.injectedSecrets.length !== 0
    )
      throw new Error('Sandbox did not confirm a fresh box with no owner secrets')
    const egress = (await box.egress.get()).policy
    if (egress.mode !== 'blocked')
      throw new Error(`Check box egress is ${egress.mode}, not blocked`)
    await box.fs.mkdir(BOX_TREE, { recursive: true })
    const digests = new Map(captured.manifest.files.map((entry) => [entry.path, entry.sha256]))
    const target = box
    const pending = [...captured.files]
    const deliver = async () => {
      try {
        for (let file = pending.shift(); file; file = pending.shift()) {
          options.signal?.throwIfAborted()
          const received = await target.fs.uploadData(`${BOX_TREE}/${file.path}`, file.bytes, {
            mode: file.mode,
          })
          const receivedDigest = `sha256:${received.hash.replace(/^sha256:/, '').toLowerCase()}`
          if (receivedDigest !== digests.get(file.path) || received.size !== file.bytes.byteLength)
            throw new Error(`Check box received different bytes for ${file.path}`)
        }
      } catch (error) {
        // One failed delivery ends every other one before the box is deleted.
        pending.length = 0
        throw error
      }
    }
    await Promise.all(Array.from({ length: BOX_UPLOADS }, deliver))
    evidence = {
      sandboxId: box.id,
      account,
      input: captured.manifest,
      inputDigest: canonicalCandidateDigest(captured.manifest),
    }
    result = await executeInBox(box, options.command, timeoutMs, maxOutputBytes, options.signal)
  } catch (error) {
    result = {
      succeeded: false,
      reason: options.signal?.aborted ? 'cancelled' : 'refused',
      diagnostic: String(error),
    }
  }
  if (box) {
    try {
      await box.delete()
    } catch (error) {
      const cleanupDiagnostic = `Check box ${box.id} was not deleted: ${String(error)}`
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
  return evidence ? { ...result, box: evidence } : result
}

async function executeInBox(
  box: SandboxInstance,
  command: readonly [string, ...string[]],
  timeoutMs: number,
  limit: number,
  signal?: AbortSignal,
): Promise<IsolatedCheckResult> {
  const [executable, ...args] = command
  const child = await box.process.spawnExact(executable, args, {
    cwd: BOX_TREE,
    env: { PATH: '/usr/bin:/bin', HOME: '/tmp', LANG: 'C' },
    inheritEnv: false,
    timeoutMs: timeoutMs + BOX_PROCESS_BACKSTOP_MS,
  })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let bytes = 0
  let failure: 'timeout' | 'cancelled' | 'output-limit' | undefined
  let stopping: Promise<void> | undefined
  const stop = (reason: typeof failure) => {
    failure ??= reason
    stopping ??= child.kill('SIGKILL', { tree: true }).catch(() => undefined)
  }
  const clearTimer = armDeadlineTimer(timeoutMs, () => stop('timeout'), true)
  const cancel = () => stop('cancelled')
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  const capture = async (stream: AsyncIterable<string>, target: Buffer[]) => {
    for await (const text of stream) {
      const chunk = Buffer.from(text)
      const remaining = Math.max(0, limit - bytes)
      bytes += chunk.length
      if (remaining) target.push(chunk.subarray(0, remaining))
      if (bytes > limit) stop('output-limit')
    }
  }
  let exitCode: number
  let exitSignal: string | undefined
  try {
    await Promise.all([capture(child.stdout(), stdout), capture(child.stderr(), stderr)])
    exitCode = await child.wait()
    exitSignal = (await child.status()).exitSignal
  } finally {
    clearTimer()
    signal?.removeEventListener('abort', cancel)
    await stopping
  }
  const out = Buffer.concat(stdout).toString()
  const err = Buffer.concat(stderr).toString()
  const evidence = { stdout: out, stderr: err, exitCode: exitSignal ? null : exitCode }
  if (failure) return { succeeded: false, reason: failure, diagnostic: err || failure, ...evidence }
  if (exitCode === 127 && err.startsWith(BOX_EXEC_FAILURE))
    return { succeeded: false, reason: 'refused', diagnostic: err, ...evidence }
  if (exitSignal)
    return {
      succeeded: false,
      reason: 'failed',
      diagnostic: err || `Check killed by ${exitSignal}`,
      ...evidence,
    }
  if (exitCode !== 0)
    return {
      succeeded: false,
      reason: 'failed',
      diagnostic: err || out || `Check exited ${exitCode}`,
      ...evidence,
    }
  return { succeeded: true, value: { stdout: out, stderr: err } }
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
    const clearTimer = armDeadlineTimer(timeoutMs, () => stop('timeout'), true)
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
      clearTimer()
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
