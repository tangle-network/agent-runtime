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
import {
  acquireRunDirectoryLock,
  type RunDirectoryLock,
  readRunDirectoryLock,
} from '../durable/run-lock'
import type { RetainedInteractiveRunHandle } from './retained-interactive-types'
import { assertNoSymlinkDescendant, writeAtomicDurableFile } from './supervise/durable-file'

const MAX_GRANT_BYTES = 4 * 1024 * 1024
const scopes = new WeakMap<RetainedInteractiveRunHandle, string>()
const offered = new WeakSet<RetainedInteractiveRunHandle>()
const participants = new WeakMap<
  RetainedInteractiveRunHandle,
  AgentInteractiveSessionControlClaim
>()
const owners = new Map<string, { lock: RunDirectoryLock; digest: string }>()

/** Observation access alone never grants control. Only the explicit offer helper publishes here. */
export function bindInteractiveDelegation(
  handle: RetainedInteractiveRunHandle,
  journalRoot: string,
): void {
  scopes.set(handle, resolve(journalRoot))
}

export function scopeDirectory(handle: RetainedInteractiveRunHandle): string {
  const journal = scopes.get(handle)
  if (!journal) throw new Error('interactive delegation requires a Runtime journal scope')
  const root = realpathSync(journal)
  const key = createHash('sha256')
    .update(root)
    .update(canonicalCandidateDigest(handle.ref))
    .digest('hex')
  const privateRoot = join(dirname(root), '.agent-runtime-control')
  for (const path of [privateRoot, join(privateRoot, key)]) {
    mkdirSync(path, { recursive: true, mode: 0o700 })
    assertNoSymlinkDescendant(dirname(root), path, 'interactive control directory')
    const stat = lstatSync(path)
    if (
      !stat.isDirectory() ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw new Error('interactive control directory must be private to the current OS principal')
  }
  return join(privateRoot, key)
}

function protectedJson(path: string): unknown {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(fd)
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size > MAX_GRANT_BYTES ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw new Error('interactive control grant must be a bounded private regular file')
    return JSON.parse(readFileSync(fd, 'utf8'))
  } finally {
    closeSync(fd)
  }
}

/** Publish only authority already verified by the provider handle; never mint or advance it. */
export async function offerInteractiveControl(
  handle: RetainedInteractiveRunHandle,
  control: AgentInteractiveSessionControlClaim,
): Promise<void> {
  const dir = scopeDirectory(handle)
  const file = join(dir, 'delegation.json')
  await withJsonlFileLock(join(dir, 'publication.jsonl'), async () => {
    try {
      const prior = protectedJson(file) as { control?: AgentInteractiveSessionControlClaim }
      if (
        AgentInteractiveSessionControlClaimSchema.parse(prior.control).generation >
        control.generation
      )
        return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const ownerDir = join(dir, String(control.generation))
    mkdirSync(ownerDir, { mode: 0o700, recursive: true })
    assertNoSymlinkDescendant(dir, ownerDir, 'interactive control owner directory')
    const ownerStat = lstatSync(ownerDir)
    if (
      !ownerStat.isDirectory() ||
      (ownerStat.mode & 0o077) !== 0 ||
      (process.getuid && ownerStat.uid !== process.getuid())
    )
      throw new Error('interactive control owner directory must be private')
    let owner = owners.get(ownerDir)
    if (!owner) {
      owner = {
        lock: await acquireRunDirectoryLock(ownerDir, handle.ref.run.sessionId),
        digest: '',
      }
      owners.set(ownerDir, owner)
    }
    const digest = canonicalCandidateDigest(control)
    offered.add(handle)
    participants.set(handle, control)
    if (owner.digest === digest) return
    owner.lock.run(() =>
      writeAtomicDurableFile(
        file,
        JSON.stringify({
          version: 1,
          refDigest: canonicalCandidateDigest(handle.ref),
          control,
          generation: owner.lock.generation,
          owner: { pid: owner.lock.pid, startedAt: owner.lock.startedAt },
        }),
        { mode: 0o600 },
      ),
    )
    owner.digest = digest
  })
}

/** No live, positively identified owner means no delegation, even if its old lease has time left. */
export async function acceptedInteractiveControl(
  handle: RetainedInteractiveRunHandle,
): Promise<AgentInteractiveSessionControlClaim | undefined> {
  const dir = scopeDirectory(handle)
  return withJsonlFileLock(join(dir, 'publication.jsonl'), async () => {
    let grant: unknown
    try {
      grant = protectedJson(join(dir, 'delegation.json'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    if (!grant || typeof grant !== 'object') throw new Error('invalid interactive delegation')
    const value = grant as {
      version?: number
      refDigest?: string
      control?: unknown
      generation?: number
      owner?: { pid?: number; startedAt?: string }
    }
    if (value.version !== 1 || value.refDigest !== canonicalCandidateDigest(handle.ref))
      throw new Error('interactive delegation names another process')
    const control = AgentInteractiveSessionControlClaimSchema.parse(value.control)
    if (!agentInteractiveSessionControlClaimMatchesRef(handle.ref, control))
      throw new Error('interactive delegation authority names another process')
    if (Date.parse(control.expiresAt) <= Date.now()) return undefined
    const ownerDir = join(dir, String(control.generation))
    const holder = await readRunDirectoryLock(ownerDir)
    if (
      !holder ||
      holder.generation !== value.generation ||
      holder.pid !== value.owner?.pid ||
      holder.startedAt !== value.owner?.startedAt
    )
      return undefined
    const fd = openSync(join(ownerDir, 'supervise.lock'), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = fstatSync(fd, { bigint: true })
      if (lockHolderVerdict(parseLockHolderRecord(holder), lockIdentity(stat)).liveness !== 'alive')
        return undefined
    } finally {
      closeSync(fd)
    }
    participants.set(handle, control)
    return control
  })
}

/** A stale terminal close cannot revoke a newer provider claim or a successor's grant. */
export async function revokeInteractiveControl(
  handle: RetainedInteractiveRunHandle,
  control?: AgentInteractiveSessionControlClaim,
): Promise<void> {
  const participant = participants.get(handle)
  if (!participant) return
  const dir = scopeDirectory(handle)
  await withJsonlFileLock(join(dir, 'publication.jsonl'), async () => {
    let grant: { control?: AgentInteractiveSessionControlClaim }
    try {
      grant = protectedJson(join(dir, 'delegation.json')) as typeof grant
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    const current = AgentInteractiveSessionControlClaimSchema.parse(grant.control)
    const expected = control ?? participant
    const digest = canonicalCandidateDigest(expected)
    if (canonicalCandidateDigest(current) === digest) unlinkSync(join(dir, 'delegation.json'))
    const ownerDir = join(dir, String(expected.generation))
    const owner = owners.get(ownerDir)
    if (owner?.digest === digest) {
      owners.delete(ownerDir)
      await owner.lock.release()
    }
    const latest = participants.get(handle)
    if (latest && canonicalCandidateDigest(latest) === digest) {
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
    get ref() {
      return terminal.ref
    },
    control: terminal.control,
    get cursors() {
      return terminal.cursors
    },
    input: (input, options) => terminal.input(input, options),
    resize: (resize, options) => terminal.resize(resize, options),
    events: (options) => terminal.events(options),
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
