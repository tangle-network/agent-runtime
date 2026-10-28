import { createHash } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  lockHolderVerdict,
  lockIdentity,
  parseLockHolderRecord,
  readLockHolderIdentity,
} from '@tangle-network/agent-eval/lock-holder'
import type {
  AgentInteractiveSessionControlClaim,
  AgentInteractiveTerminalSession,
} from '@tangle-network/agent-interface'
import {
  AgentInteractiveSessionControlClaimSchema,
  agentInteractiveSessionControlClaimMatchesRef,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import { withJsonlFileLock } from '../durable/jsonl-file'
import type { RetainedInteractiveRunHandle } from './retained-interactive-types'
import { assertNoSymlinkDescendant, writeAtomicDurableFile } from './supervise/durable-file'

const MAX_GRANT_BYTES = 4 * 1024 * 1024
const scopes = new WeakMap<RetainedInteractiveRunHandle, string>()
const offered = new WeakSet<RetainedInteractiveRunHandle>()
const participants = new WeakMap<
  RetainedInteractiveRunHandle,
  AgentInteractiveSessionControlClaim
>()

/** Observation access alone never grants control. Only the explicit offer helper publishes here. */
export function bindInteractiveDelegation(
  handle: RetainedInteractiveRunHandle,
  journalRoot: string,
): void {
  scopes.set(handle, resolve(journalRoot))
}

function privateDirectory(path: string, root: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  assertNoSymlinkDescendant(root, path, 'interactive control directory')
  const stat = lstatSync(path)
  if (
    !stat.isDirectory() ||
    (stat.mode & 0o777) !== 0o700 ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new Error('interactive control directory must be private to the current OS principal')
}

function scopeDirectory(handle: RetainedInteractiveRunHandle): string {
  const journal = scopes.get(handle)
  if (!journal) throw new Error('interactive delegation requires a Runtime journal scope')
  const root = realpathSync(journal)
  const key = createHash('sha256')
    .update(root)
    .update(canonicalCandidateDigest(handle.ref))
    .digest('hex')
  const privateRoot = join(dirname(root), '.agent-runtime-control')
  const dir = join(privateRoot, key)
  privateDirectory(privateRoot, dirname(root))
  privateDirectory(dir, privateRoot)
  return dir
}

/** Both reader and writer use the same bounded private-file boundary. */
function privateFile<T>(path: string, flags: number, operation: (fd: number) => T): T {
  const fd = openSync(path, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600)
  try {
    const stat = fstatSync(fd)
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size > MAX_GRANT_BYTES ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw new Error('interactive control state must be a bounded private regular file')
    return operation(fd)
  } finally {
    closeSync(fd)
  }
}

async function withPublicationLock<T>(
  handle: RetainedInteractiveRunHandle,
  operation: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = scopeDirectory(handle)
  const path = join(dir, 'publication.jsonl')
  privateFile(path, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT, () => undefined)
  return withJsonlFileLock(path, async () => operation(dir))
}

/** Validate the actual writer before provider CAS; later I/O failures remain explicitly recoverable. */
export async function prepareInteractiveDelegation(
  handle: RetainedInteractiveRunHandle,
): Promise<void> {
  await withPublicationLock(handle, async (dir) => {
    readDelegation(handle, dir)
  })
}

function readDelegation(handle: RetainedInteractiveRunHandle, dir: string) {
  try {
    return privateFile(join(dir, 'delegation.json'), constants.O_RDONLY, (fd) => {
      const value = JSON.parse(readFileSync(fd, 'utf8')) as { control: unknown; owner: unknown }
      const control = AgentInteractiveSessionControlClaimSchema.parse(value.control)
      if (!agentInteractiveSessionControlClaimMatchesRef(handle.ref, control))
        throw new Error('interactive delegation names another process')
      return {
        control,
        owner: parseLockHolderRecord(value.owner),
        identity: lockIdentity(fstatSync(fd, { bigint: true })),
      }
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    if (error instanceof SyntaxError) throw new Error('invalid interactive delegation encoding')
    throw error
  }
}

/** Publish only provider-verified authority. Its generation already uniquely identifies the lease. */
export async function offerInteractiveControl(
  handle: RetainedInteractiveRunHandle,
  control: AgentInteractiveSessionControlClaim,
): Promise<void> {
  try {
    await withPublicationLock(handle, async (dir) => {
      const prior = readDelegation(handle, dir)
      if (prior && prior.control.generation > control.generation) return
      offered.add(handle)
      participants.set(handle, control)
      writeAtomicDurableFile(
        join(dir, 'delegation.json'),
        (file) =>
          JSON.stringify({
            control,
            owner: { ...readLockHolderIdentity(), lock: lockIdentity(file) },
          }),
        { mode: 0o600 },
      )
    })
  } catch {
    throw new Error(
      'provider control was acquired but local delegation publication failed; correct storage and reacquire with the same holderId before dispatching commands',
    )
  }
}

/** A leftover lease never delegates after its offering process dies. */
export async function acceptedInteractiveControl(
  handle: RetainedInteractiveRunHandle,
): Promise<AgentInteractiveSessionControlClaim | undefined> {
  return withPublicationLock(handle, async (dir) => {
    const value = readDelegation(handle, dir)
    if (!value || Date.parse(value.control.expiresAt) <= Date.now()) return undefined
    if (lockHolderVerdict(value.owner, value.identity).liveness !== 'alive') return undefined
    participants.set(handle, value.control)
    return value.control
  })
}

/** Provider generations fence both stale terminal cleanup and local owner cleanup. */
export async function revokeInteractiveControl(
  handle: RetainedInteractiveRunHandle,
  control = participants.get(handle),
): Promise<void> {
  if (!control || !participants.has(handle)) return
  await withPublicationLock(handle, async (dir) => {
    if (readDelegation(handle, dir)?.control.generation === control.generation)
      unlinkSync(join(dir, 'delegation.json'))
    if (participants.get(handle)?.generation === control.generation) {
      offered.delete(handle)
      participants.delete(handle)
    }
  })
}

export function delegatedTerminal(
  handle: RetainedInteractiveRunHandle,
  terminal: AgentInteractiveTerminalSession,
): AgentInteractiveTerminalSession {
  if (!offered.has(handle)) return terminal
  const end = async (action: () => ReturnType<AgentInteractiveTerminalSession['close']>) => {
    const result = await action()
    await revokeInteractiveControl(handle, terminal.control)
    return result
  }
  return {
    get control() {
      return terminal.control
    },
    input: (input, options) => terminal.input(input, options),
    resize: (size, options) => terminal.resize(size, options),
    events: (options) => terminal.events(options),
    get ref() {
      return terminal.ref
    },
    get cursors() {
      return terminal.cursors
    },
    detach: (options) => end(() => terminal.detach(options)),
    close: (options) => end(() => terminal.close(options)),
  }
}

/** Claim replacement updates only an already explicitly delegated owner scope. */
export async function refreshInteractiveDelegation(
  handle: RetainedInteractiveRunHandle,
  control: AgentInteractiveSessionControlClaim,
): Promise<void> {
  if (offered.has(handle)) await offerInteractiveControl(handle, control)
}
