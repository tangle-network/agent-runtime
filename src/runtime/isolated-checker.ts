import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  opendir,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
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
import {
  captureMaterializedWorkspace,
  scanMaterializedWorkspaceManifest,
  WorkspaceScanLimitError,
} from '../candidate-execution/artifacts'
import {
  boxCheckOutputReader,
  type IsolatedCheckOutputEvidence,
  type IsolatedCheckOutputOptions,
  localCheckOutputReader,
  prepareIsolatedCheckOutputs,
  retainIsolatedCheckOutputs,
  stopCheckBoxForRecovery,
  stopCheckProcess,
} from './isolated-checker-outputs'
import { runAbortable } from './supervise/abortable'
import { armDeadlineTimer } from './supervise/deadline'

export {
  type IsolatedCheckOutputDeclaration,
  type IsolatedCheckOutputEvidence,
  type IsolatedCheckOutputFailure,
  type IsolatedCheckOutputOptions,
  validateIsolatedCheckOutputs,
} from './isolated-checker-outputs'

export interface IsolatedCheckOptions {
  /** Trusted workspace boundary containing the untrusted tree. */
  workspaceRoot: string
  tree: string
  /** Executable and arguments, without host shell interpretation. */
  command: readonly [string, ...string[]]
  timeoutMs?: number
  maxOutputBytes?: number
  /** Maximum regular-file bytes copied or captured from the input tree when set. */
  maxInputBytes?: number
  /** Maximum entries in the input tree when set. */
  maxInputEntries?: number
  signal?: AbortSignal
  /** Run the check in its own Sandbox box instead of Linux Bubblewrap on this host. */
  box?: IsolatedCheckBox
  /** Environment the command receives beside PATH, HOME and LANG: a declared check's named
   *  secrets and its own settings. Nothing else of this process's environment reaches it. */
  env?: Readonly<Record<string, string>>
  /** Retain explicitly approved output files, on command success or failure, before cleanup. */
  outputs?: IsolatedCheckOutputOptions
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
  /** The check is the run's own step in its owner's account (a graph check node), not a judge:
   *  `builderAccounts` is not consulted, and the box keeps a durable home. */
  ownerStep?: true
  /** Sandbox environment or image that holds the check's toolchain. */
  environment: string
  /** Set `memoryMB` to require the API to report a finite granted limit before upload. */
  resources?: SandboxResources
  /** Domains the check may reach, such as a knowledge store or a git host. Empty or absent: the
   *  box's egress is blocked. Otherwise strict: these domains only, with no implicit list. */
  egress?: readonly string[]
  /**
   * The check runs containers. Sandbox starts a box's rootless container daemon only with its
   * managed agent runtime, so this box is created with `agent: true`; it still receives no owner
   * secret, which its create receipt must confirm. It is not `ephemeral`, so its home is a disk
   * sized by `resources.diskGB` instead of a small in-memory home that image layers overflow.
   */
  containers?: boolean
}

/** The box a check ran in and the exact bytes it received. */
export interface IsolatedCheckBoxEvidence {
  sandboxId: string
  /** `customerId` of the check's key. */
  account: string
  /** API-reported granted memory limit in MiB, when explicitly requested. */
  memoryMB?: number
  /** Every file the box received; each sha256 is also the digest the box computed on receipt. */
  input: AgentCandidateWorkspaceManifestMaterial
  /** Canonical digest of `input`. */
  inputDigest: Sha256Digest
}

export type IsolatedCheckResult =
  | {
      succeeded: true
      value: { stdout: string; stderr: string }
      box?: IsolatedCheckBoxEvidence
      outputs?: IsolatedCheckOutputEvidence
    }
  | {
      succeeded: false
      reason:
        | 'refused'
        | 'failed'
        | 'timeout'
        | 'cancelled'
        | 'output-limit'
        | 'input-limit'
        | 'cleanup-failed'
      diagnostic: string
      /** Bounded command evidence, when a process was launched. */
      stdout?: string
      stderr?: string
      exitCode?: number | null
      /** Cleanup failures never replace the primary command failure. */
      cleanupDiagnostic?: string
      /** Present once a check box received its complete input. */
      box?: IsolatedCheckBoxEvidence
      outputs?: IsolatedCheckOutputEvidence
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
 * The canonical input path remains the working directory. Requested output files are retained
 * before cleanup; otherwise copy writes are discarded.
 * Time and output are bounded; input copy bytes and entries are bounded when requested.
 * The command's memory and generated files require a resource-limited placement.
 * Callers must keep the input and trusted toolchains stable while preparing the check.
 *
 * A box check creates one fresh box with no owner secrets and blocked egress (or strict egress to
 * the placement's named domains), delivers the tree's regular files verified by sha256, runs the
 * command there with only the environment `env` names, and deletes the box after successful
 * requested retention. Incomplete retention returns private recovery custody only after the
 * native owner confirms the box stopped. Box file capture requires /usr/bin/python3. Local recovery scratch is the
 * caller's responsibility; the resource-limited placement requirement still applies.
 */
export async function runIsolatedCheck(
  options: IsolatedCheckOptions,
): Promise<IsolatedCheckResult> {
  if (options.box) return runInBox(options, options.box)
  let scratch: string | undefined
  let outputs: IsolatedCheckOutputEvidence | undefined
  let result: IsolatedCheckResult
  try {
    const retention = prepareIsolatedCheckOutputs(options.outputs)
    if (process.platform !== 'linux') throw new Error('Linux Bubblewrap namespaces are required')
    const { timeoutMs, maxOutputBytes, maxInputBytes, maxInputEntries } = checkLimits(options)
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
    await copyBoundedTree(tree, copy, maxInputBytes, maxInputEntries)
    const input = retention ? await scanMaterializedWorkspaceManifest(copy) : undefined
    if (retention && input) assertOutputPathsUnoccupied(retention.paths, input)
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
      ...Object.entries(options.env ?? {}).flatMap(([name, value]) => ['--setenv', name, value]),
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
    if (retention && input && (result.succeeded || result.reason !== 'refused')) {
      outputs = await retainIsolatedCheckOutputs(
        retention,
        canonicalCandidateDigest(input),
        localCheckOutputReader(copy),
      )
      if (outputs.status === 'incomplete')
        outputs = { ...outputs, source: { kind: 'local', path: scratch } }
      result = withRetainedOutputs(result, outputs)
    }
  } catch (error) {
    result = {
      succeeded: false,
      reason: error instanceof InputLimitError ? 'input-limit' : 'refused',
      diagnostic: String(error),
    }
  }
  if (scratch && outputs?.status !== 'incomplete') {
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
  return outputs ? { ...result, outputs } : result
}

/** A preexisting input file must never masquerade as newly produced evaluator evidence. */
function assertOutputPathsUnoccupied(
  paths: readonly string[],
  input: AgentCandidateWorkspaceManifestMaterial,
): void {
  for (const path of paths)
    if (
      input.files.some(
        (file) =>
          file.path === path ||
          file.path.startsWith(`${path}/`) ||
          path.startsWith(`${file.path}/`),
      )
    )
      throw new Error('Declared check output path overlaps an input file')
}

function withRetainedOutputs(
  result: IsolatedCheckResult,
  outputs: IsolatedCheckOutputEvidence,
): IsolatedCheckResult {
  if (!result.succeeded || outputs.status === 'retained') return { ...result, outputs }
  return {
    succeeded: false,
    reason: 'failed',
    diagnostic: 'Check outputs were not completely retained',
    stdout: result.value.stdout,
    stderr: result.value.stderr,
    exitCode: 0,
    outputs,
  }
}

function checkLimits(options: IsolatedCheckOptions): {
  timeoutMs: number
  maxOutputBytes: number
  maxInputBytes?: number
  maxInputEntries?: number
} {
  const timeoutMs = options.timeoutMs ?? 30_000
  const maxOutputBytes = options.maxOutputBytes ?? 1_048_576
  const maxInputBytes = options.maxInputBytes
  const maxInputEntries = options.maxInputEntries
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 2_147_483_647 ||
    !Number.isSafeInteger(maxOutputBytes) ||
    maxOutputBytes < 1 ||
    (maxInputBytes !== undefined && (!Number.isSafeInteger(maxInputBytes) || maxInputBytes < 1)) ||
    (maxInputEntries !== undefined &&
      (!Number.isSafeInteger(maxInputEntries) || maxInputEntries < 1))
  )
    throw new Error('Invalid execution limits')
  if (!options.command.length || !options.command[0]) throw new Error('A command is required')
  return { timeoutMs, maxOutputBytes, maxInputBytes, maxInputEntries }
}

class InputLimitError extends Error {}

/** Copy in bounded chunks, preserving symlink text without reading its target. */
async function copyBoundedTree(
  source: string,
  destination: string,
  maxBytes: number | undefined,
  maxEntries: number | undefined,
): Promise<void> {
  let bytes = 0
  let entries = 0
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  const visit = async (from: string, to: string, isRoot = false): Promise<void> => {
    if (!isRoot && ++entries > (maxEntries ?? Number.MAX_SAFE_INTEGER))
      throw new InputLimitError('Input tree exceeds maxInputEntries')
    const info = await lstat(from)
    if (info.isSymbolicLink()) {
      await symlink(await readlink(from), to)
    } else if (info.isDirectory()) {
      await mkdir(to, { mode: 0o700 })
      for await (const entry of await opendir(from))
        await visit(join(from, entry.name), join(to, entry.name))
      await chmod(to, info.mode & 0o777)
    } else if (info.isFile()) {
      if (maxBytes !== undefined && info.size > maxBytes - bytes)
        throw new InputLimitError('Input tree exceeds maxInputBytes')
      const input = await open(from, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
      try {
        const output = await open(to, 'wx', info.mode & 0o777)
        try {
          while (true) {
            const { bytesRead } = await input.read(
              buffer,
              0,
              maxBytes === undefined
                ? buffer.length
                : Math.min(buffer.length, maxBytes - bytes + 1),
              null,
            )
            if (bytesRead === 0) break
            bytes += bytesRead
            if (maxBytes !== undefined && bytes > maxBytes)
              throw new InputLimitError('Input tree exceeds maxInputBytes')
            let written = 0
            while (written < bytesRead) {
              const result = await output.write(buffer, written, bytesRead - written)
              if (result.bytesWritten === 0) throw new Error('Input copy made no write progress')
              written += result.bytesWritten
            }
          }
        } finally {
          await output.close()
        }
        await chmod(to, info.mode & 0o777)
      } finally {
        await input.close()
      }
    } else {
      throw new Error(`Input tree contains an unsupported entry: ${from}`)
    }
  }
  await visit(source, destination, true)
}

async function checkInputEntries(root: string, maxEntries: number): Promise<void> {
  let count = 0
  const visit = async (path: string, isRoot = false): Promise<void> => {
    if (!isRoot && ++count > maxEntries)
      throw new InputLimitError('Input tree exceeds maxInputEntries')
    if (!(await lstat(path)).isDirectory()) return
    for await (const entry of await opendir(path)) await visit(join(path, entry.name))
  }
  await visit(root, true)
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
/** Setup headroom in the requested native lifetime policy; this is not a deletion guarantee. */
const BOX_SETUP_SECONDS = 900
/** The box's own process timeout is a backstop behind this module's deadline. */
const BOX_PROCESS_BACKSTOP_MS = 30_000
/** The box's process supervisor prefixes this to stderr when it cannot start the executable. */
const BOX_EXEC_FAILURE = 'process-supervisor: exec failed'

async function runInBox(
  options: IsolatedCheckOptions,
  placement: IsolatedCheckBox,
): Promise<IsolatedCheckResult> {
  let box: SandboxInstance | undefined
  let evidence: IsolatedCheckBoxEvidence | undefined
  let outputs: IsolatedCheckOutputEvidence | undefined
  let retention: IsolatedCheckOutputOptions | undefined
  let maxLifetimeSeconds: number | undefined
  let commandAttempted = false
  let commandSettled = false
  let result: IsolatedCheckResult
  try {
    retention = prepareIsolatedCheckOutputs(options.outputs)
    const { timeoutMs, maxOutputBytes, maxInputBytes, maxInputEntries } = checkLimits(options)
    maxLifetimeSeconds = Math.ceil(timeoutMs / 1_000) + BOX_SETUP_SECONDS
    if (options.signal?.aborted)
      return { succeeded: false, reason: 'cancelled', diagnostic: 'Check cancelled' }
    const { tree } = await protectedTree(options)
    if (maxInputEntries !== undefined) await checkInputEntries(tree, maxInputEntries)
    // Read each file once: the digest recorded is the digest of the bytes sent.
    const captured = await captureMaterializedWorkspace(tree, {
      limits: {
        maxFiles: maxInputEntries ?? Number.MAX_SAFE_INTEGER,
        maxFileBytes: maxInputBytes ?? Number.MAX_SAFE_INTEGER,
        maxTotalFileBytes: maxInputBytes ?? Number.MAX_SAFE_INTEGER,
      },
    })
    if (retention) assertOutputPathsUnoccupied(retention.paths, captured.manifest)
    const judge = placement.ownerStep !== true
    if (
      judge &&
      (placement.builderAccounts.length === 0 || placement.builderAccounts.some((id) => !id))
    )
      throw new Error('builderAccounts must name the account of every key the judged run holds')
    const memoryMB = placement.resources?.memoryMB
    if (
      memoryMB !== undefined &&
      (!Number.isSafeInteger(memoryMB) ||
        memoryMB < 1 ||
        placement.resources?.advisory === true ||
        placement.resources?.advisoryFields?.includes('memoryMB'))
    )
      throw new Error('Check box requires an explicit finite resources.memoryMB limit')
    const account = (await placement.client.getIdentity()).customerId
    if (!account) throw new Error('Sandbox returned no account for the check key')
    if (judge && placement.builderAccounts.includes(account))
      throw new Error(
        `Check account ${account} is an account the judged run holds a key to, so the run can reach the check box`,
      )
    options.signal?.throwIfAborted()
    box = await placement.client.createIsolated(
      {
        environment: placement.environment,
        agent: placement.containers === true,
        bare: false,
        ephemeral: placement.containers !== true && judge,
        egressPolicy: egressFor(placement),
        ...(placement.resources ? { resources: placement.resources } : {}),
        maxLifetimeSeconds,
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
    const grantedMemoryMB = box.resources?.memoryMB
    if (
      memoryMB !== undefined &&
      (typeof grantedMemoryMB !== 'number' ||
        !Number.isSafeInteger(grantedMemoryMB) ||
        grantedMemoryMB < 1 ||
        grantedMemoryMB > memoryMB)
    )
      throw new Error('Sandbox did not confirm the requested finite memory cgroup limit')
    const egress = (await box.egress.get()).policy
    const wanted = egressFor(placement)
    if (
      egress.mode !== wanted.mode ||
      (wanted.mode === 'strict' &&
        (egress.includeImplicitDomains === true ||
          [...(egress.allowDomains ?? [])].sort().join(',') !==
            [...(wanted.allowDomains ?? [])].sort().join(',')))
    )
      throw new Error(
        `Check box egress is ${egress.mode} ${JSON.stringify(egress.allowDomains ?? [])}, not ${wanted.mode} ${JSON.stringify(wanted.allowDomains ?? [])}`,
      )
    // One archive, not a request per file: a box's sidecar admits a few hundred file requests a
    // minute. It is staged from the captured bytes, so the box receives what the manifest names.
    const staging = await mkdtemp(join(tmpdir(), 'runtime-check-box-'))
    try {
      for (const file of captured.files) {
        const path = join(staging, file.path)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, file.bytes, { mode: file.mode })
      }
      options.signal?.throwIfAborted()
      await box.fs.uploadDir(staging, BOX_TREE)
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
    await verifyBoxTree(box, captured.manifest.files)
    evidence = {
      sandboxId: box.id,
      account,
      ...(memoryMB === undefined ? {} : { memoryMB: grantedMemoryMB }),
      input: captured.manifest,
      inputDigest: canonicalCandidateDigest(captured.manifest),
    }
    commandAttempted = true
    const execution = await executeInBox(
      box,
      options.command,
      timeoutMs,
      maxOutputBytes,
      options.env ?? {},
      options.signal,
    )
    result = execution.result
    commandSettled = execution.commandSettled
  } catch (error) {
    result = {
      succeeded: false,
      reason: options.signal?.aborted
        ? 'cancelled'
        : error instanceof InputLimitError || error instanceof WorkspaceScanLimitError
          ? 'input-limit'
          : 'refused',
      diagnostic: String(error),
    }
  }
  // A transport failure leaves command state unknown. Preserve that box only after its native
  // lifecycle owner confirms a whole-box stop; never keep live or unconfirmed recovery custody.
  if (
    box &&
    evidence &&
    retention &&
    maxLifetimeSeconds !== undefined &&
    commandAttempted &&
    (!commandSettled || result.succeeded || result.reason !== 'refused')
  ) {
    outputs = commandSettled
      ? await retainIsolatedCheckOutputs(
          retention,
          evidence.inputDigest,
          boxCheckOutputReader(box, BOX_TREE, retention.timeoutMs ?? 30_000),
        )
      : {
          executionId: retention.executionId,
          inputDigest: evidence.inputDigest,
          status: 'incomplete',
          files: [],
          missing: retention.paths.map((path) => ({ path, reason: 'capture-failed' as const })),
        }
    result = withRetainedOutputs(result, outputs)
    if (outputs.status === 'incomplete') {
      if (await stopCheckBoxForRecovery(box))
        outputs = {
          ...outputs,
          source: { kind: 'sandbox', sandboxId: box.id, state: 'stopped' },
        }
      else if (!result.succeeded)
        result = {
          ...result,
          cleanupDiagnostic: 'Recovery source stop was not confirmed; box deletion was requested',
        }
    }
  }
  if (box && outputs?.source?.kind !== 'sandbox') {
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
        : {
            ...result,
            cleanupDiagnostic: [result.cleanupDiagnostic, cleanupDiagnostic]
              .filter(Boolean)
              .join('; '),
          }
    }
  }
  return { ...result, ...(evidence ? { box: evidence } : {}), ...(outputs ? { outputs } : {}) }
}

/** Refuse unless the box reads each file with its manifest digest. `find` names the files: a box
 * process takes 256 arguments at most. A name holding a newline or backslash, which coreutils
 * escapes, does not compare. */
async function verifyBoxTree(
  box: SandboxInstance,
  files: readonly { path: string; sha256: string }[],
) {
  const hash = ['.', '-type', 'f', '-exec', 'sha256sum', '{}', '+']
  const child = await box.process.spawnExact('find', hash, {
    cwd: BOX_TREE,
    env: { PATH: '/usr/bin:/bin', LANG: 'C' },
    inheritEnv: false,
    timeoutMs: BOX_SETUP_SECONDS * 1_000,
  })
  let listing = ''
  for await (const text of child.stdout()) listing += text
  if ((await child.wait()) !== 0) throw new Error('Check box could not hash the tree it received')
  // Each line is `<hex>  ./<path>`.
  const read = new Set(
    listing.split('\n').map((line) => `sha256:${line.slice(0, 64)} ${line.slice(68)}`),
  )
  for (const file of files)
    if (!read.has(`${file.sha256} ${file.path}`))
      throw new Error(`Check box received different bytes for ${file.path}`)
}

/** Blocked unless the placement names domains; then strict, with no implicit domain list. */
function egressFor(placement: IsolatedCheckBox): {
  mode: 'blocked' | 'strict'
  allowDomains?: string[]
  includeImplicitDomains?: false
} {
  const domains = [...new Set(placement.egress ?? [])].filter((domain) => domain.trim() !== '')
  return domains.length === 0
    ? { mode: 'blocked' }
    : { mode: 'strict', allowDomains: domains, includeImplicitDomains: false }
}

async function executeInBox(
  box: SandboxInstance,
  command: readonly [string, ...string[]],
  timeoutMs: number,
  limit: number,
  env: Readonly<Record<string, string>>,
  signal?: AbortSignal,
): Promise<{ result: IsolatedCheckResult; commandSettled: boolean }> {
  const [executable, ...args] = command
  let child: Awaited<ReturnType<SandboxInstance['process']['spawnExact']>> | undefined
  const deadline = new AbortController()
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let bytes = 0
  let failure: 'timeout' | 'cancelled' | 'output-limit' | undefined
  let stopping: Promise<boolean> | undefined
  let stopped = false
  const stop = (reason: typeof failure) => {
    failure ??= reason
    deadline.abort()
    if (child) stopping ??= stopCheckProcess(child)
  }
  const clearTimer = armDeadlineTimer(timeoutMs, () => stop('timeout'), true)
  const cancel = () => stop('cancelled')
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  const capture = async (stream: AsyncIterable<string>, target: Buffer[]) => {
    for await (const text of stream) {
      if (deadline.signal.aborted) break
      const chunk = Buffer.from(text)
      const remaining = Math.max(0, limit - bytes)
      bytes += chunk.length
      if (remaining) target.push(chunk.subarray(0, remaining))
      if (bytes > limit) stop('output-limit')
    }
  }
  let completion: { exitCode: number; exitSignal?: string } | undefined
  try {
    child = await runAbortable(
      () => {
        const launching = box.process.spawnExact(executable, args, {
          cwd: BOX_TREE,
          env: { PATH: '/usr/bin:/bin', HOME: '/tmp', LANG: 'C', ...env },
          inheritEnv: false,
          timeoutMs: timeoutMs + BOX_PROCESS_BACKSTOP_MS,
        })
        // A late response must not leave a newly observed process running after the caller stopped.
        void launching.then(
          (late) => {
            if (deadline.signal.aborted) void stopCheckProcess(late)
          },
          () => undefined,
        )
        return launching
      },
      deadline.signal,
      'Check interrupted',
    )
    const running = child
    completion = await runAbortable(
      async () => {
        await Promise.all([capture(running.stdout(), stdout), capture(running.stderr(), stderr)])
        const exitCode = await running.wait()
        const exitSignal = (await running.status()).exitSignal
        return { exitCode, exitSignal }
      },
      deadline.signal,
      'Check interrupted',
    )
  } catch (error) {
    if (child) stopping ??= stopCheckProcess(child)
    if (!failure) throw error
  } finally {
    clearTimer()
    signal?.removeEventListener('abort', cancel)
    stopped = (await stopping) === true
  }
  const out = Buffer.concat(stdout).toString()
  const err = Buffer.concat(stderr).toString()
  const exitCode = completion?.exitCode ?? null
  const exitSignal = completion?.exitSignal
  const evidence = { stdout: out, stderr: err, exitCode: exitSignal ? null : exitCode }
  const finish = (result: IsolatedCheckResult) => ({
    result,
    commandSettled: completion !== undefined || stopped,
  })
  if (failure)
    return finish({ succeeded: false, reason: failure, diagnostic: err || failure, ...evidence })
  if (exitCode === 127 && err.startsWith(BOX_EXEC_FAILURE))
    return finish({ succeeded: false, reason: 'refused', diagnostic: err, ...evidence })
  if (exitSignal)
    return finish({
      succeeded: false,
      reason: 'failed',
      diagnostic: err || `Check killed by ${exitSignal}`,
      ...evidence,
    })
  if (exitCode !== 0)
    return finish({
      succeeded: false,
      reason: 'failed',
      diagnostic: err || out || `Check exited ${exitCode}`,
      ...evidence,
    })
  return finish({ succeeded: true, value: { stdout: out, stderr: err } })
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
