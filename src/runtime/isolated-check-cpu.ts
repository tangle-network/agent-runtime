import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rmdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export interface IsolatedCheckCpuCounters {
  usageUsec: number
  userUsec: number
  systemUsec: number
  /** Ancillary kernel observations; null fields are unavailable, never zero. */
  resources?: IsolatedCheckCpuResources
}

export interface IsolatedCheckCpuResources {
  /** Cgroup PSI some.total: time with at least one runnable task waiting, not summed task wait. */
  runnableWaitSomeUsec: number | null
  ancestorsComplete: boolean
  ancestors: {
    cgroupPath: string
    inode: number | null
    cpuMax: string | null
    throttledUsec: number | null
  }[]
}

const cgroupRoot = '/sys/fs/cgroup'
export const isolatedCheckCpuAncestorLimit = 32

async function optionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

function optionalCounter(match: RegExpExecArray | null): number | null {
  const value = match ? Number(match[1]) : NaN
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

async function resources(path: string): Promise<IsolatedCheckCpuResources> {
  const pressure = await optionalFile(join(path, 'cpu.pressure'))
  const ancestors: IsolatedCheckCpuResources['ancestors'] = []
  let current = dirname(path)
  let complete = false
  for (let depth = 0; depth < isolatedCheckCpuAncestorLimit; depth++) {
    const [identity, quota, text] = await Promise.all([
      stat(current).catch(() => null),
      optionalFile(join(current, 'cpu.max')),
      optionalFile(join(current, 'cpu.stat')),
    ])
    ancestors.push({
      cgroupPath: current,
      inode: identity?.ino ?? null,
      cpuMax: quota && /^(max|[0-9]+) [1-9][0-9]*$/.test(quota.trim()) ? quota.trim() : null,
      throttledUsec: optionalCounter(/^throttled_usec ([0-9]+)$/m.exec(text ?? '')),
    })
    if (current === cgroupRoot) {
      complete = true
      break
    }
    current = dirname(current)
    if (!current.startsWith(`${cgroupRoot}/`) && current !== cgroupRoot) break
  }
  return {
    runnableWaitSomeUsec: optionalCounter(/^some [^\n]*total=([0-9]+)\s*$/m.exec(pressure ?? '')),
    ancestors,
    ancestorsComplete: complete,
  }
}

export interface IsolatedCheckCpuIdentity {
  source: 'cgroup-v2'
  boundary: 'after-membership-through-tree-exit'
  sessionId: string
  cgroupPath: string
  inode: number
}

/** Only the blocked workload tree enters this cgroup; the caller stays outside it. */
export type IsolatedCheckCpuEvidence = IsolatedCheckCpuIdentity &
  (
    | { available: true; before: IsolatedCheckCpuCounters; after: IsolatedCheckCpuCounters }
    | { available: false; diagnostic: string }
  )

/** Reusable sequential CPU accounting inside an already delegated Linux cgroup.
 * Opening does not change limits or delegation. close refuses an occupied or active group.
 */
export interface IsolatedCheckCpuSession {
  readonly id: string
  readonly cgroupPath: string
  close(): Promise<void>
}

export type IsolatedCheckCpuSessionResult =
  | { succeeded: true; value: IsolatedCheckCpuSession }
  | { succeeded: false; reason: 'unavailable'; diagnostic: string; recoveryCgroupPath?: string }

interface CpuState {
  identity: IsolatedCheckCpuIdentity
  busy: boolean
  closed: boolean
  closing?: Promise<void>
}
const sessions = new WeakMap<IsolatedCheckCpuSession, CpuState>()

async function counters(path: string): Promise<IsolatedCheckCpuCounters> {
  const text = await readFile(join(path, 'cpu.stat'), 'utf8')
  const counter = (key: string) => {
    const match = new RegExp(`^${key} ([0-9]+)$`, 'm').exec(text)
    const value = match ? Number(match[1]) : NaN
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid CPU counter ${key}`)
    return value
  }
  return {
    usageUsec: counter('usage_usec'),
    userUsec: counter('user_usec'),
    systemUsec: counter('system_usec'),
    resources: await resources(path),
  }
}

async function emptyGroup(state: CpuState): Promise<void> {
  const path = state.identity.cgroupPath
  if ((await stat(path)).ino !== state.identity.inode)
    throw new Error('CPU cgroup identity changed')
  if (!/^populated 0$/m.test(await readFile(join(path, 'cgroup.events'), 'utf8')))
    throw new Error('CPU cgroup still contains processes')
}

/** Requires delegation from the execution placement; never creates a host-wide scope or fallback. */
export async function createIsolatedCheckCpuSession(): Promise<IsolatedCheckCpuSessionResult> {
  let path: string | undefined
  let identity: IsolatedCheckCpuIdentity | undefined
  try {
    if (process.platform !== 'linux')
      throw new Error('CPU accounting requires delegated Linux cgroup v2')
    const own = /^0::(\/[^\n]*)$/m.exec(await readFile('/proc/self/cgroup', 'utf8'))?.[1]
    if (!own || own.split('/').includes('..'))
      throw new Error('Current cgroup v2 identity unavailable')
    const id = randomUUID()
    const target = join(cgroupRoot, own.slice(1), `runtime-check-${id}`)
    await mkdir(target)
    path = target
    identity = {
      source: 'cgroup-v2',
      boundary: 'after-membership-through-tree-exit',
      sessionId: id,
      cgroupPath: path,
      inode: (await stat(path)).ino,
    }
    await counters(path)
    await writeFile(join(path, 'cgroup.kill'), '1')
    const state: CpuState = { identity, busy: false, closed: false }
    const session: IsolatedCheckCpuSession = Object.freeze({
      id,
      cgroupPath: path,
      async close() {
        if (state.closed) return
        if (state.busy) throw new Error('CPU session has an active check')
        return (state.closing ??= (async () => {
          try {
            await emptyGroup(state)
            await rmdir(target)
            state.closed = true
          } finally {
            state.closing = undefined
          }
        })())
      },
    })
    sessions.set(session, state)
    return { succeeded: true, value: session }
  } catch (error) {
    let recoveryCgroupPath = path
    if (path && identity) {
      try {
        if ((await stat(path)).ino === identity.inode) {
          await rmdir(path)
          recoveryCgroupPath = undefined
        }
      } catch {
        /* Keep the exact owned recovery identity when removal cannot be confirmed. */
      }
    }
    return {
      succeeded: false,
      reason: 'unavailable',
      diagnostic: String(error),
      ...(recoveryCgroupPath ? { recoveryCgroupPath } : {}),
    }
  }
}

/** Package-internal lease: the caller cannot manufacture a resource identity. */
export async function acquireIsolatedCheckCpu(session: IsolatedCheckCpuSession) {
  const state = sessions.get(session)
  if (!state || state.closed || state.closing || state.busy)
    throw new Error('CPU session is unavailable or busy')
  state.busy = true
  let before: IsolatedCheckCpuCounters | undefined
  try {
    await emptyGroup(state)
  } catch (error) {
    state.busy = false
    throw error
  }
  return {
    async start(pids: readonly number[]) {
      if (before) throw new Error('CPU workload already started')
      if ((await stat(state.identity.cgroupPath)).ino !== state.identity.inode)
        throw new Error('CPU cgroup identity changed')
      for (const pid of new Set(pids)) {
        if (!Number.isSafeInteger(pid) || pid < 1)
          throw new Error('Invalid protected process identity')
        await writeFile(join(state.identity.cgroupPath, 'cgroup.procs'), String(pid))
      }
      before = await counters(state.identity.cgroupPath)
    },
    async kill() {
      if ((await stat(state.identity.cgroupPath)).ino !== state.identity.inode)
        throw new Error('CPU cgroup identity changed')
      await writeFile(join(state.identity.cgroupPath, 'cgroup.kill'), '1')
    },
    async finish(remainingMs: number): Promise<IsolatedCheckCpuEvidence> {
      try {
        if (!before) throw new Error('Workload was not released under CPU accounting')
        const deadline = performance.now() + Math.max(0, remainingMs)
        while (true) {
          if ((await stat(state.identity.cgroupPath)).ino !== state.identity.inode)
            throw new Error('CPU cgroup identity changed')
          if (
            /^populated 0$/m.test(
              await readFile(join(state.identity.cgroupPath, 'cgroup.events'), 'utf8'),
            )
          )
            break
          if (performance.now() >= deadline)
            throw new Error('CPU cgroup still contains processes at the check deadline')
          await delay(Math.min(10, Math.max(1, deadline - performance.now())))
        }
        const after = await counters(state.identity.cgroupPath)
        if (
          (['usageUsec', 'userUsec', 'systemUsec'] as const).some(
            (key) => after[key] < before![key],
          )
        )
          throw new Error('CPU counters moved backwards')
        return { ...state.identity, available: true, before, after }
      } catch (error) {
        return { ...state.identity, available: false, diagnostic: String(error) }
      }
    },
    release() {
      state.busy = false
    },
  }
}
