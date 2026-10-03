import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

it('captures, verifies and restores a >3 GiB real-file archive with 128 MiB V8 old space', async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['--max-old-space-size=128', '--import', 'tsx', 'tests/fixtures/workspace-streaming-memory.ts'],
    { cwd: process.cwd(), timeout: 240_000, maxBuffer: 1024 * 1024 },
  )
  const receipt = JSON.parse(stdout.trim())
  expect(receipt.restoredManifestMatches).toBe(true)
  expect(receipt.fileBytes[0]).toBeGreaterThan(2 * 1024 ** 3)
  expect(receipt.archiveBytes).toBeGreaterThan(3 * 1024 ** 3)
  expect(receipt.peakRss).toBeLessThan(384 * 1024 ** 2)
  expect(receipt.peakExternal).toBeLessThan(128 * 1024 ** 2)
  console.info('workspace streaming memory receipt', receipt)
}, 250_000)
