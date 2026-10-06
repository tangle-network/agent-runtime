import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []
const execute = promisify(execFile)
const tsx = createRequire(import.meta.url).resolve('tsx')
const fixture = fileURLToPath(
  new URL('../../scripts/fixtures/journal-outage-consumer.mjs', import.meta.url),
)

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'linux')(
  'durable storage outage across controller processes',
  () => {
    it.each(['dispatch', 'partial', 'result', 'root-dispatch', 'root-result'])(
      'preserves the exact native child across a real ENOSPC at %s',
      async (fault) => {
        const directory = await mkdtemp(join(tmpdir(), 'journal-outage-consumer-'))
        roots.push(directory)
        await execute(process.execPath, ['--import', tsx, fixture, fault, directory], {
          env: {
            ...process.env,
            RUNTIME_KERNEL_MODULE: new URL('../../src/runtime/index.ts', import.meta.url).href,
            RUNTIME_DURABLE_MODULE: new URL('../../src/durable/index.ts', import.meta.url).href,
          },
          // The consumer compiles the Runtime source through tsx before it starts; on a loaded
          // runner that alone has taken longer than 30 s.
          timeout: 120_000,
        })
        const receipt = JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8'))
        expect(receipt).toMatchObject({
          passed: true,
          fault: { code: 'ENOSPC' },
          first: { status: 'interrupted', resultExists: false },
          second: { status: 'settled', resultExists: true },
          finalCreates: 1,
          finalStarts: 1,
          finalNativeAlive: false,
          nativeResult: { answer: 42 },
          originalIdentityAndDeadlinePreserved: true,
          committedPrefixPreserved: true,
        })
      },
      150_000,
    )
  },
)
