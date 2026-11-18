import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, stat, statfs } from 'node:fs/promises'
import { freemem, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

// The assertions are memory bounds. The time limit only catches a hang: hashing and restoring
// more than 3 GiB took 144 s on an idle Beelink and passed 240 s under shared load.
const HANG_GUARD_MS = 900_000
const PREFIX = 'workspace-streaming-memory-'
// A run writes about 9 GiB of real files and holds at most 6 GiB at once. Disk speed is not under
// test, so the tree goes to /dev/shm when it has room (timings: measurement m-20261118-764dce77).
const SCRATCH_BYTES = 8 * 1024 ** 3

// Field 22 of /proc/<pid>/stat, the start tick: with the pid it names one process across pid reuse.
async function startTick(pid: number | string): Promise<string | undefined> {
  const line = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '')
  return line.slice(line.lastIndexOf(')') + 2).split(' ')[19]
}

// A runner killed before `finally` leaves its tree in /dev/shm, where no gate cleanup reaches it.
// Every run first removes trees whose owner (pid and start tick in the name) is gone, and trees
// without an owner in the name that have not changed for an hour.
async function sweepScratch(): Promise<void> {
  for (const name of await readdir('/dev/shm').catch(() => [])) {
    if (!name.startsWith(PREFIX)) continue
    const path = join('/dev/shm', name)
    const [, pid, tick] = name.slice(PREFIX.length).match(/^(\d+)-(\d+)-/) ?? []
    const stale = pid
      ? (await startTick(pid)) !== tick
      : Date.now() - ((await stat(path).catch(() => undefined))?.mtimeMs ?? Date.now()) > 3_600_000
    if (stale) await rm(path, { recursive: true, force: true }).catch(() => undefined)
  }
}

// tmpfs pages are charged to this process's cgroup and, unlike page cache, cannot be dropped.
// A gate unit shares its class slice's memory.max with the other gates, a limit that host free
// memory does not show. So the room is the smallest `memory.max - memory.current + inactive_file`
// over the cgroups from this one up to the root, and never more than host free memory.
async function memoryRoom(): Promise<number> {
  const self = await readFile('/proc/self/cgroup', 'utf8').catch(() => '')
  let room = freemem()
  let path = self.match(/^0::(\/.*)$/m)?.[1]
  while (path) {
    const dir = join('/sys/fs/cgroup', path)
    path = path === '/' ? undefined : dirname(path)
    const read = (file: string) => readFile(join(dir, file), 'utf8').catch(() => 'max')
    const max = await read('memory.max')
    if (max.trim() === 'max') continue
    const inactive = Number((await read('memory.stat')).match(/^inactive_file (\d+)$/m)?.[1])
    room = Math.min(room, Number(max) - Number(await read('memory.current')) + inactive)
  }
  return room
}

async function scratchParent(): Promise<string> {
  await sweepScratch()
  const shm = await statfs('/dev/shm').catch(() => undefined)
  if (!shm || shm.bavail * shm.bsize < SCRATCH_BYTES) return tmpdir()
  // An unreadable cgroup file makes the room NaN, which also falls back to the system temp dir.
  return (await memoryRoom()) >= 2 * SCRATCH_BYTES ? '/dev/shm' : tmpdir()
}

it(
  'captures, verifies and restores a >3 GiB real-file archive with 128 MiB V8 old space',
  async () => {
    // The test owns the scratch tree: a child killed by the hang guard never runs its own cleanup,
    // and each run writes more than 3 GiB.
    const owner = `${process.pid}-${await startTick(process.pid)}-`
    const root = await mkdtemp(join(await scratchParent(), PREFIX + owner))
    try {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          '--max-old-space-size=128',
          '--import',
          'tsx',
          'tests/fixtures/workspace-streaming-memory.ts',
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, WORKSPACE_STREAMING_MEMORY_ROOT: root },
          timeout: HANG_GUARD_MS,
          maxBuffer: 1024 * 1024,
        },
      )
      const receipt = JSON.parse(stdout.trim())
      expect(receipt.restoredManifestMatches).toBe(true)
      expect(receipt.fileBytes[0]).toBeGreaterThan(2 * 1024 ** 3)
      expect(receipt.archiveBytes).toBeGreaterThan(3 * 1024 ** 3)
      expect(receipt.peakRss).toBeLessThan(384 * 1024 ** 2)
      expect(receipt.peakExternal).toBeLessThan(128 * 1024 ** 2)
      console.info('workspace streaming memory receipt', receipt)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
  HANG_GUARD_MS + 10_000,
)
