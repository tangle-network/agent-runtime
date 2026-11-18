import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { compileFixture } from '../helpers/compile-fixture'

const roots: string[] = []
const execute = promisify(execFile)
const fixture = fileURLToPath(
  new URL('../../scripts/fixtures/journal-outage-consumer.mjs', import.meta.url),
)

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'linux')(
  'durable storage outage across controller processes',
  () => {
    let modules: Awaited<ReturnType<typeof compileFixture>>
    beforeAll(async () => {
      modules = await compileFixture('tests/integration/fixtures/journal-outage-runtime.ts')
    })
    afterAll(() => modules?.dispose())

    it.each(['dispatch', 'partial', 'result', 'root-dispatch', 'root-result'])(
      'preserves the exact native child across a real process storage limit at %s',
      async (fault) => {
        const directory = await mkdtemp(join(tmpdir(), 'journal-outage-consumer-'))
        try {
          const entry = pathToFileURL(modules.path).href
          await execute(process.execPath, [fixture, fault, directory], {
            env: {
              ...process.env,
              RUNTIME_KERNEL_MODULE: entry,
              RUNTIME_DURABLE_MODULE: entry,
            },
            timeout: 120_000,
          })
        } catch (cause) {
          const failure = cause as Error & {
            code?: unknown
            signal?: unknown
            killed?: boolean
            stdout?: string
            stderr?: string
          }
          const records = await Promise.all(
            ['receipt.json', 'interrupt.log', 'resume.log'].map(async (name) => {
              const text = await readFile(join(directory, name), 'utf8').catch(() => 'unavailable')
              return `${name}: ${text.slice(-16_384)}`
            }),
          )
          throw new Error(
            `storage-limit ${fault} failed; retained ${directory}\n${JSON.stringify({ code: failure.code, signal: failure.signal, killed: failure.killed })}\nstdout: ${failure.stdout?.slice(-16_384) ?? ''}\nstderr: ${failure.stderr?.slice(-16_384) ?? ''}\n${records.join('\n')}`,
            { cause },
          )
        }
        const receipt = JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8'))
        expect(receipt, `retained ${directory}`).toMatchObject({
          passed: true,
          fault: { code: 'EFBIG' },
          first: { status: 'interrupted', resultExists: false },
          second: { status: 'settled', resultExists: true },
          finalCreates: 1,
          finalStarts: 1,
          finalNativeAlive: false,
          nativeResult: { answer: 42 },
          originalIdentityAndDeadlinePreserved: true,
          committedPrefixPreserved: true,
        })
        roots.push(directory)
      },
      150_000,
    )
  },
)
