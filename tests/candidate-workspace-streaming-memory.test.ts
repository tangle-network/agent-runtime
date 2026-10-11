import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

// The assertions are memory bounds. The time limit only catches a hang: hashing and restoring
// more than 3 GiB took 144 s on an idle Beelink and passed 240 s under shared load.
const HANG_GUARD_MS = 900_000

it('captures, verifies and restores a >3 GiB real-file archive with 128 MiB V8 old space', async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['--max-old-space-size=128', '--import', 'tsx', 'tests/fixtures/workspace-streaming-memory.ts'],
    { cwd: process.cwd(), timeout: HANG_GUARD_MS, maxBuffer: 1024 * 1024 },
  )
  const receipt = JSON.parse(stdout.trim())
  expect(receipt.restoredManifestMatches).toBe(true)
  expect(receipt.fileBytes[0]).toBeGreaterThan(2 * 1024 ** 3)
  expect(receipt.archiveBytes).toBeGreaterThan(3 * 1024 ** 3)
  expect(receipt.peakRss).toBeLessThan(384 * 1024 ** 2)
  expect(receipt.peakExternal).toBeLessThan(128 * 1024 ** 2)
  console.info('workspace streaming memory receipt', receipt)
}, HANG_GUARD_MS + 10_000)
