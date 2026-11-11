import { type BigIntStats, constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentCandidateArtifactRef, Sha256Digest } from '@tangle-network/agent-interface'
import type { SandboxInstance } from '@tangle-network/sandbox'
import { sha256Bytes } from '../candidate-execution/digest'
import { persistCandidateOutputArtifact } from '../candidate-execution/output-artifacts'
import type { AgentCandidateOutputArtifactPort } from '../candidate-execution/types'
import { ValidationError } from '../errors'
import { runAbortable } from './supervise/abortable'
import { armDeadlineTimer } from './supervise/deadline'

const MAX_FILES = 16
const MAX_BYTES = 64 * 1024 * 1024
const MAX_TIMEOUT_MS = 120_000

/** Explicit files the caller approves for retention. Never include secrets or hidden judge inputs. */
export interface IsolatedCheckOutputDeclaration {
  /** Exact, portable, tree-relative regular files; no directories, globs, or links. At most 16. */
  readonly paths: readonly string[]
  readonly maxFileBytes: number
  /** Maximum captured file bytes across the declaration, at most 64 MiB. */
  readonly maxTotalBytes: number
  /** Capture and verified persistence deadline, independent of command cancellation. Default 30 s; at most 120 s. */
  readonly timeoutMs?: number
}

/** Evidence uses the caller's existing artifact store; Runtime does not choose its durability policy. */
export interface IsolatedCheckOutputOptions extends IsolatedCheckOutputDeclaration {
  readonly executionId: string
  readonly artifacts: AgentCandidateOutputArtifactPort
  /** Trusted host redaction, applied before hashing or persistence; never authored by the check. */
  readonly redact?: (bytes: Uint8Array) => Uint8Array
}

/** Bounded codes, never exception text, command output, or secret-bearing provider diagnostics. */
export type IsolatedCheckOutputFailure =
  | 'missing'
  | 'unsafe-path'
  | 'size-limit'
  | 'capture-failed'
  | 'store-failed'
  | 'timeout'

export interface IsolatedCheckOutputEvidence {
  readonly executionId: string
  /** Digest of the exact input copy before the command starts, using the workspace-manifest format. */
  readonly inputDigest: Sha256Digest
  readonly status: 'retained' | 'incomplete'
  readonly files: ReadonlyArray<{
    readonly path: string
    readonly artifact: AgentCandidateArtifactRef
  }>
  readonly missing: ReadonlyArray<{
    readonly path: string
    readonly reason: IsolatedCheckOutputFailure
  }>
  /** Private recovery custody, only on incomplete retention. Do not publish filesystem coordinates. */
  readonly source?:
    | { readonly kind: 'local'; readonly path: string }
    | { readonly kind: 'sandbox'; readonly sandboxId: string; readonly state: 'stopped' }
}

/** Validate authored declarations before starting a check. The returned paths are detached and frozen. */
export function validateIsolatedCheckOutputs(value: unknown): IsolatedCheckOutputDeclaration {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new ValidationError('check outputs must be a declaration object')
  const item = value as Record<string, unknown>
  if (
    Object.keys(item).some(
      (key) => !['paths', 'maxFileBytes', 'maxTotalBytes', 'timeoutMs'].includes(key),
    )
  )
    throw new ValidationError('check outputs has an unknown field')
  if (!Array.isArray(item.paths) || item.paths.length < 1 || item.paths.length > MAX_FILES)
    throw new ValidationError('check outputs must name between 1 and 16 files')
  const paths: string[] = []
  for (const path of item.paths) {
    if (
      typeof path !== 'string' ||
      path.length > 512 ||
      !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u.test(path) ||
      path
        .split('/')
        .some((part) => part === '.' || part === '..' || part === '.git' || part === '.sidecar') ||
      paths.some(
        (prior) => prior === path || prior.startsWith(`${path}/`) || path.startsWith(`${prior}/`),
      )
    )
      throw new ValidationError('check outputs paths must be distinct portable relative files')
    paths.push(path)
  }
  for (const key of ['maxFileBytes', 'maxTotalBytes'] as const) {
    if (
      typeof item[key] !== 'number' ||
      !Number.isSafeInteger(item[key]) ||
      item[key] < 1 ||
      item[key] > MAX_BYTES
    )
      throw new ValidationError('check output byte limits must be positive integers at most 64 MiB')
  }
  const maxFileBytes = item.maxFileBytes as number
  const maxTotalBytes = item.maxTotalBytes as number
  if (maxFileBytes > maxTotalBytes)
    throw new ValidationError('check outputs maxFileBytes must not exceed maxTotalBytes')
  if (
    item.timeoutMs !== undefined &&
    (typeof item.timeoutMs !== 'number' ||
      !Number.isSafeInteger(item.timeoutMs) ||
      item.timeoutMs < 1 ||
      item.timeoutMs > MAX_TIMEOUT_MS)
  )
    throw new ValidationError('check outputs timeoutMs must be a positive integer at most 120000')
  return Object.freeze({
    paths: Object.freeze(paths),
    maxFileBytes,
    maxTotalBytes,
    ...(item.timeoutMs === undefined ? {} : { timeoutMs: item.timeoutMs as number }),
  })
}

/** Resolve and validate trusted ports before any isolated work starts. */
export function prepareIsolatedCheckOutputs(
  options: IsolatedCheckOutputOptions | undefined,
): IsolatedCheckOutputOptions | undefined {
  if (options === undefined) return undefined
  const { executionId, artifacts, redact, ...declaration } = options
  const validated = validateIsolatedCheckOutputs(declaration)
  if (
    typeof executionId !== 'string' ||
    executionId.trim() === '' ||
    executionId.length > 200 ||
    /\p{Cc}/u.test(executionId)
  )
    throw new ValidationError('check outputs executionId must be a nonempty bounded identifier')
  if (typeof artifacts?.put !== 'function' || typeof artifacts?.read !== 'function')
    throw new ValidationError('check outputs requires a readable output artifact port')
  if (redact !== undefined && typeof redact !== 'function')
    throw new ValidationError('check outputs redact must be a function')
  return Object.freeze({ ...validated, executionId, artifacts, ...(redact && { redact }) })
}

class OutputCaptureError extends Error {
  constructor(readonly reason: IsolatedCheckOutputFailure) {
    super(reason)
  }
}

type ReadOutput = (path: string, maxBytes: number, signal: AbortSignal) => Promise<Uint8Array>

/** Capture runs after command settlement, even on command failure or cancellation. There are no retries. */
export async function retainIsolatedCheckOutputs(
  options: IsolatedCheckOutputOptions,
  inputDigest: Sha256Digest,
  read: ReadOutput,
): Promise<IsolatedCheckOutputEvidence> {
  const controller = new AbortController()
  const clearTimer = armDeadlineTimer(options.timeoutMs ?? 30_000, () => controller.abort(), true)
  const files: Array<{ path: string; artifact: AgentCandidateArtifactRef }> = []
  const missing: Array<{ path: string; reason: IsolatedCheckOutputFailure }> = []
  let totalBytes = 0
  try {
    for (const path of options.paths) {
      let phase: 'capture-failed' | 'store-failed' = 'capture-failed'
      try {
        const captured = await runAbortable(
          () =>
            read(
              path,
              Math.min(options.maxFileBytes, options.maxTotalBytes - totalBytes),
              controller.signal,
            ),
          controller.signal,
          'output capture deadline exceeded',
        )
        const bytes = options.redact ? options.redact(captured) : captured
        if (
          !(bytes instanceof Uint8Array) ||
          bytes.byteLength > options.maxFileBytes ||
          Math.max(captured.byteLength, bytes.byteLength) > options.maxTotalBytes - totalBytes
        )
          throw new OutputCaptureError('size-limit')
        totalBytes += Math.max(captured.byteLength, bytes.byteLength)
        phase = 'store-failed'
        const artifact = await runAbortable(
          () =>
            persistCandidateOutputArtifact(options.artifacts, {
              executionId: options.executionId,
              purpose: 'grader-evidence',
              bytes,
              signal: controller.signal,
            }),
          controller.signal,
          'output persistence deadline exceeded',
        )
        files.push({ path, artifact })
      } catch (error) {
        missing.push({
          path,
          reason: controller.signal.aborted
            ? 'timeout'
            : error instanceof OutputCaptureError
              ? error.reason
              : phase,
        })
      }
    }
  } finally {
    clearTimer()
  }
  return Object.freeze({
    executionId: options.executionId,
    inputDigest,
    status: missing.length === 0 ? 'retained' : 'incomplete',
    files: Object.freeze(files.map((file) => Object.freeze(file))),
    missing: Object.freeze(missing.map((file) => Object.freeze(file))),
  })
}

/** The local namespace has exited; the trusted host must keep its private copy stable. */
export function localCheckOutputReader(root: string): ReadOutput {
  return async (path, maxBytes, signal) => {
    try {
      const rootInfo = await lstat(root)
      if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
        throw new OutputCaptureError('unsafe-path')
      let current = root
      const parts = path.split('/')
      let expected: BigIntStats | undefined
      for (let index = 0; index < parts.length; index++) {
        current = join(current, parts[index]!)
        const info = await lstat(current, { bigint: true })
        if (
          info.isSymbolicLink() ||
          (index < parts.length - 1 ? !info.isDirectory() : !info.isFile() || info.nlink !== 1n)
        )
          throw new OutputCaptureError('unsafe-path')
        expected = info
      }
      signal.throwIfAborted()
      const file = await open(
        current,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      )
      try {
        const before = await file.stat({ bigint: true })
        if (
          !before.isFile() ||
          before.nlink !== 1n ||
          before.dev !== expected?.dev ||
          before.ino !== expected?.ino
        )
          throw new OutputCaptureError('unsafe-path')
        if (before.size > BigInt(maxBytes)) throw new OutputCaptureError('size-limit')
        const chunks: Buffer[] = []
        let total = 0
        const buffer = Buffer.allocUnsafe(Math.min(65_536, maxBytes + 1))
        while (true) {
          signal.throwIfAborted()
          const { bytesRead } = await file.read(
            buffer,
            0,
            Math.min(buffer.length, maxBytes - total + 1),
            null,
          )
          if (bytesRead === 0) break
          total += bytesRead
          if (total > maxBytes) throw new OutputCaptureError('size-limit')
          chunks.push(Buffer.from(buffer.subarray(0, bytesRead)))
        }
        const after = await file.stat({ bigint: true })
        if (
          before.size !== BigInt(total) ||
          before.size !== after.size ||
          before.mtimeNs !== after.mtimeNs ||
          before.ctimeNs !== after.ctimeNs ||
          after.nlink !== 1n
        )
          throw new OutputCaptureError('capture-failed')
        return Buffer.concat(chunks, total)
      } finally {
        await file.close()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT')
        throw new OutputCaptureError('missing')
      if (['ELOOP', 'ENOTDIR'].includes((error as NodeJS.ErrnoException)?.code ?? ''))
        throw new OutputCaptureError('unsafe-path')
      throw error
    }
  }
}

/** Preserve a whole box only after its native lifecycle owner confirms stopped state. */
export async function stopCheckBoxForRecovery(box: SandboxInstance): Promise<boolean> {
  const controller = new AbortController()
  const clearTimer = armDeadlineTimer(30_000, () => controller.abort(), true)
  try {
    await runAbortable(
      () => box.stop({ wait: true, signal: controller.signal }),
      controller.signal,
      'check recovery stop deadline exceeded',
    )
    return true
  } catch {
    return false
  } finally {
    clearTimer()
  }
}

/** Whether kill and process exit were confirmed; recovery custody still needs a whole-box stop. */
export async function stopCheckProcess(
  child: Awaited<ReturnType<SandboxInstance['process']['spawnExact']>>,
): Promise<boolean> {
  const controller = new AbortController()
  const clearTimer = armDeadlineTimer(5_000, () => controller.abort(), true)
  try {
    await runAbortable(
      async () => {
        await child.kill('SIGKILL', { tree: true })
        await child.wait()
      },
      controller.signal,
      'check process stop deadline exceeded',
    )
    return true
  } catch {
    // The caller stops or deletes the entire box before releasing its custody.
    return false
  } finally {
    clearTimer()
  }
}

// Fixed code, argv-only inputs, no shell. Directory descriptors prevent a swapped ancestor symlink
// from redirecting a read. The regular file descriptor is bounded and checked again after reading.
export const isolatedCheckOutputCaptureProgram = `import base64, errno, hashlib, json, os, stat, sys
fds=[]
def fail(reason):
 print(json.dumps({'error':reason})); sys.exit(0)
try:
 root,path,limit=sys.argv[1],sys.argv[2],int(sys.argv[3])
 directory=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW); fds.append(directory)
 parts=path.split('/')
 for part in parts[:-1]:
  directory=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=directory); fds.append(directory)
 before=os.stat(parts[-1],dir_fd=directory,follow_symlinks=False)
 if not stat.S_ISREG(before.st_mode) or before.st_nlink!=1: fail('unsafe-path')
 fd=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=directory); fds.append(fd)
 opened=os.fstat(fd)
 if not stat.S_ISREG(opened.st_mode) or opened.st_nlink!=1 or (before.st_dev,before.st_ino)!=(opened.st_dev,opened.st_ino): fail('unsafe-path')
 if opened.st_size>limit: fail('size-limit')
 chunks=[]; total=0
 while True:
  chunk=os.read(fd,min(1048576,limit-total+1))
  if not chunk: break
  total+=len(chunk)
  if total>limit: fail('size-limit')
  chunks.append(chunk)
 after=os.fstat(fd)
 if (opened.st_size,opened.st_mtime_ns,opened.st_ctime_ns,opened.st_nlink)!=(after.st_size,after.st_mtime_ns,after.st_ctime_ns,after.st_nlink) or total!=opened.st_size: fail('capture-failed')
 data=b''.join(chunks)
 print(json.dumps({'content':base64.b64encode(data).decode('ascii'),'sha256':'sha256:'+hashlib.sha256(data).hexdigest()}))
except OSError as error:
 fail('missing' if error.errno==errno.ENOENT else 'unsafe-path' if error.errno in (errno.ELOOP,errno.ENOTDIR) else 'capture-failed')
finally:
 for fd in reversed(fds): os.close(fd)
`

/** A box with declared outputs needs python3; missing capture tooling fails closed and keeps custody. */
export function boxCheckOutputReader(
  box: SandboxInstance,
  root: string,
  timeoutMs: number,
): ReadOutput {
  return async (path, maxBytes, signal) => {
    const child = await box.process.spawnExact(
      '/usr/bin/python3',
      ['-I', '-S', '-c', isolatedCheckOutputCaptureProgram, root, path, String(maxBytes)],
      {
        env: { PATH: '/usr/bin:/bin', LANG: 'C' },
        inheritEnv: false,
        timeoutMs,
      },
    )
    let stopping: Promise<boolean> | undefined
    const stop = () => {
      stopping ??= stopCheckProcess(child)
    }
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()
    const chunks: string[] = []
    const limit = Math.ceil(maxBytes / 3) * 4 + 2_048
    let length = 0
    let overflow = false
    const collect = async (stream: AsyncIterable<string>, keep: boolean) => {
      for await (const text of stream) {
        length += Buffer.byteLength(text)
        if (length > limit) {
          overflow = true
          stop()
        } else if (keep) chunks.push(text)
      }
    }
    try {
      await Promise.all([collect(child.stdout(), true), collect(child.stderr(), false)])
      if (overflow || (await child.wait()) !== 0) throw new OutputCaptureError('capture-failed')
      signal.throwIfAborted()
      const value = JSON.parse(chunks.join('')) as Record<string, unknown>
      if (
        value.error === 'missing' ||
        value.error === 'unsafe-path' ||
        value.error === 'size-limit' ||
        value.error === 'capture-failed'
      )
        throw new OutputCaptureError(value.error)
      if (typeof value.content !== 'string' || typeof value.sha256 !== 'string')
        throw new OutputCaptureError('capture-failed')
      const bytes = Buffer.from(value.content, 'base64')
      if (bytes.byteLength > maxBytes) throw new OutputCaptureError('size-limit')
      if (sha256Bytes(bytes) !== value.sha256) throw new OutputCaptureError('capture-failed')
      return bytes
    } catch (error) {
      stop()
      throw error
    } finally {
      signal.removeEventListener('abort', stop)
      await stopping
    }
  }
}
