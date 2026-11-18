import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm, stat, statfs } from 'node:fs/promises'
import { freemem, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

// The assertions are memory bounds. The time limit only catches a hang: hashing and restoring
// more than 3 GiB took 144 s on an idle Beelink and passed 240 s under shared load.
const HANG_GUARD_MS = 900_000
const PREFIX = 'workspace-streaming-memory-'
// A run writes about 9 GiB of real files and holds at most 6 GiB at once. Disk speed is not under
// test, so the tree goes to /dev/shm when it has room: in alternating runs on beelink2 under
// shared load, the file took 240-294 s in the system temp directory and 131-144 s in /dev/shm.
const SCRATCH_BYTES = 8 * 1024 ** 3

async function scratchParent(): Promise<string> {
  const shm = await statfs('/dev/shm').catch(() => undefined)
  if (!shm || shm.bavail * shm.bsize < SCRATCH_BYTES || freemem() < 2 * SCRATCH_BYTES)
    return tmpdir()
  // A killed test runner leaves its tree in memory. A live run changes its root at least every
  // few minutes, so a tree untouched for an hour is stale; another run may sweep it first.
  for (const name of await readdir('/dev/shm')) {
    if (!name.startsWith(PREFIX)) continue
    const path = join('/dev/shm', name)
    const touched = (await stat(path).catch(() => undefined))?.mtimeMs ?? Date.now()
    if (Date.now() - touched > 3_600_000)
      await rm(path, { recursive: true, force: true }).catch(() => undefined)
  }
  return '/dev/shm'
}

it(
  'captures, verifies and restores a >3 GiB real-file archive with 128 MiB V8 old space',
  async () => {
    // The test owns the scratch tree: a child killed by the hang guard never runs its own cleanup,
    // and each run writes more than 3 GiB.
    const root = await mkdtemp(join(await scratchParent(), PREFIX))
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
