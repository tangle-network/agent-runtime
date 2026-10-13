import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

// The assertions are memory bounds. The time limit only catches a hang: hashing and restoring
// more than 3 GiB took 144 s on an idle Beelink and passed 240 s under shared load.
const HANG_GUARD_MS = 900_000

it(
  'captures, verifies and restores a >3 GiB real-file archive with 128 MiB V8 old space',
  async () => {
    // The test owns the scratch tree: a child killed by the hang guard never runs its own cleanup,
    // and each run writes more than 3 GiB.
    const root = await mkdtemp(join(tmpdir(), 'workspace-streaming-memory-'))
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
