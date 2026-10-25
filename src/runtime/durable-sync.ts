import { constants } from 'node:fs'
import { type FileHandle, open } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'

/**
 * Threads that run fsync for the private CAS. Node runs every fs call on libuv's pool of four
 * threads, and an fsync on a busy disk holds its thread until the filesystem journal commits. On
 * drew-gtr-pro's USB disk all four sat in jbd2_log_wait_commit and rq_qos_wait while
 * a tree capture had 16 files in flight: four fsyncs shared each journal commit, and every open,
 * read, lstat and link of the capture queued behind them, at about one file per second. On
 * threads of their own, every fsync in flight waits on the same commit and the pool stays free
 * for the rest.
 */
const SYNC_THREADS = 16
// Each thread is a V8 isolate of about 12 MB (measured on Node 24), so one idle this long exits:
// a burst of puts holds its threads, a process between bursts holds none.
const IDLE_THREAD_MS = 30_000

// Each message is a file descriptor this process holds open; the reply is null or the failure.
const SYNCER = `
const { parentPort } = require('node:worker_threads')
const { fsyncSync } = require('node:fs')
parentPort.on('message', (fd) => {
  try {
    fsyncSync(fd)
    parentPort.postMessage(null)
  } catch (error) {
    parentPort.postMessage({ message: String(error && error.message), code: error && error.code })
  }
})
`

interface SyncJob {
  readonly handle: FileHandle
  readonly settle: (error?: unknown) => void
}

const jobs: SyncJob[] = []
const idle: Worker[] = []
const idleSince = new Map<Worker, ReturnType<typeof setTimeout>>()
let threads = 0
// Set when a thread cannot start or dies: every later fsync runs on libuv's pool, as before.
let threadsUnavailable = false

// Take an idle thread out of service; true when it was idle.
function retire(worker: Worker): boolean {
  const at = idle.indexOf(worker)
  if (at === -1) return false
  idle.splice(at, 1)
  clearTimeout(idleSince.get(worker))
  idleSince.delete(worker)
  threads--
  return true
}

function spawn(): Worker | undefined {
  try {
    const worker = new Worker(SYNCER, { eval: true })
    worker.unref()
    threads++
    // A thread that fails while it holds a job is handled by run(); one that fails idle leaves.
    worker.on('error', () => undefined)
    worker.on('exit', () => retire(worker))
    return worker
  } catch {
    threadsUnavailable = true
    return undefined
  }
}

// fsync is idempotent, so a job whose thread failed is synced again on libuv's pool.
function onPool(job: SyncJob): void {
  job.handle.sync().then(
    () => job.settle(),
    (error: unknown) => job.settle(error),
  )
}

function rest(worker: Worker): void {
  worker.unref()
  idle.push(worker)
  const timer = setTimeout(() => {
    if (retire(worker)) void worker.terminate().catch(() => undefined)
  }, IDLE_THREAD_MS)
  timer.unref()
  idleSince.set(worker, timer)
}

function run(worker: Worker, job: SyncJob): void {
  clearTimeout(idleSince.get(worker))
  idleSince.delete(worker)
  worker.ref()
  const detach = () => {
    worker.off('message', replied)
    worker.off('error', failed)
    worker.off('exit', failed)
  }
  const replied = (failure: { message: string; code?: string } | null) => {
    detach()
    rest(worker)
    if (failure === null) job.settle()
    else job.settle(Object.assign(new Error(failure.message), { code: failure.code }))
    dispatch()
  }
  const failed = () => {
    detach()
    threads--
    threadsUnavailable = true
    void worker.terminate().catch(() => undefined)
    onPool(job)
    dispatch()
  }
  worker.on('message', replied)
  worker.on('error', failed)
  worker.on('exit', failed)
  worker.postMessage(job.handle.fd)
}

function dispatch(): void {
  while (jobs.length > 0) {
    if (threadsUnavailable) {
      onPool(jobs.shift()!)
      continue
    }
    const worker = idle.pop() ?? (threads < SYNC_THREADS ? spawn() : undefined)
    if (worker === undefined) {
      if (threadsUnavailable) continue
      return
    }
    run(worker, jobs.shift()!)
  }
}

let syncs = 0
/** fsyncs this process has asked for so far: a caller measures its own by the difference. */
export function durableSyncCount(): number {
  return syncs
}

/** fsync an open file or directory on a sync thread; keep the handle open until this settles. */
export function syncHandle(handle: FileHandle): Promise<void> {
  syncs += 1
  if (threadsUnavailable) return handle.sync()
  return new Promise<void>((resolve, reject) => {
    jobs.push({ handle, settle: (error) => (error === undefined ? resolve() : reject(error)) })
    dispatch()
  })
}

/** Make durable every entry change made in `directory` before this call. */
export async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  )
  try {
    await syncHandle(handle)
  } finally {
    await handle.close()
  }
}
