import { readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import { Sandbox } from '@tangle-network/sandbox'
import { afterAll, beforeAll, expect, it, onTestFinished } from 'vitest'
import { appendCommittedJsonLine } from '../../src/durable/jsonl-file'
import { reconnectRetainedRun, startRetainedRun } from '../../src/runtime/retained-run-start'
import { acquireSandbox } from '../../src/runtime/sandbox-acquire'
import {
  type DriverAttemptRecord,
  DriverAttemptsExhaustedError,
} from '../../src/runtime/supervise/driver-attempt-evidence'
import { runDriverWithRetry } from '../../src/runtime/supervise/driver-retry'
import { RetainedExecutionPendingError } from '../../src/runtime/supervise/retained-executor'
import {
  type Executables,
  prepareExecutables,
  ProcessFixture,
} from './fixtures/uncertain-create-harness'
import { readRecords } from './fixtures/uncertain-create-protocol'

let bundle: string
let executables: Executables
beforeAll(async () => {
  ;({ bundle, executables } = await prepareExecutables())
}, 180_000)
afterAll(async () => {
  if (bundle) await rm(bundle, { recursive: true, force: true })
})

it.each([401, 403, 500] as const)(
  'stops caller-auth retries without replacing the retained native execution (HTTP %s)',
  async (status) => {
    const fixture = await ProcessFixture.start(
      `json-observation-long-auth-${status}-success`,
      executables,
      { coordinator: false },
    )
    let passed = false
    try {
      const provider = createTangleProvider({
        client: new Sandbox({
          apiKey: 'offline-not-a-secret',
          baseUrl: fixture.url,
          platformUrl: fixture.url,
          trustLocalCliAuth: false,
          directExec: false,
        }),
      })
      const admissions = join(fixture.directory, 'admissions.jsonl')
      const original = await startRetainedRun({
        provider,
        environment: {
          idempotencyKey: 'retained-auth',
          profile: {
            name: 'fetch-pr',
            harness: 'opencode',
            model: { provider: 'offline', default: 'offline-test-model' },
          },
        },
        turn: { turnId: 'original-turn', prompt: 'Read local evidence.' },
        journalRoot: join(fixture.directory, 'admissions'),
        onAdmission: (admission) => appendCommittedJsonLine(admissions, admission),
      })
      await fixture.wait('independent native worker started', async () =>
        readRecords(join(fixture.directory, 'json-worker-processes.jsonl')).length === 1,
      )
      const prefix = await readFile(admissions)
      const records: DriverAttemptRecord[] = []
      let replacements = 0
      let failure: unknown
      try {
        await runDriverWithRetry({
          async drive() {
            try {
              await reconnectRetainedRun({ provider, controlRef: original.controlRef })
            } catch (cause) {
              throw new RetainedExecutionPendingError(cause)
            }
          },
          progress: () => ({ poolTokensSpent: 0, settledCount: 0, submitted: false }),
          budget: () => ({
            tokensLeft: 100,
            tokensKnown: true,
            cacheBreakdownKnown: true,
            usdLeft: 0,
            usdCapped: false,
            usdKnown: true,
            iterationsLeft: 10,
            deadlineMs: 0,
            reservedTokens: 0,
          }),
          signal: AbortSignal.timeout(20_000),
          policy: { initialBackoffMs: 1, maxBackoffMs: 1, transientOutageMs: 0 },
          async resolvePending() {
            replacements++
            return false
          },
          async onAttempt(record) {
            records.push(record)
            await appendCommittedJsonLine(join(fixture.directory, 'attempts.jsonl'), record)
          },
        })
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(DriverAttemptsExhaustedError)
      if (!(failure instanceof DriverAttemptsExhaustedError)) throw failure
      expect(failure.cause).toBeInstanceOf(RetainedExecutionPendingError)
      expect((failure.cause as RetainedExecutionPendingError).cause).toMatchObject({
        status,
        retryable: false,
      })
      expect(records).toHaveLength(1)
      expect(records.at(-1)).toMatchObject({
        classification: 'terminal',
        stop: 'terminal-error',
        pendingCause: status === 500 ? 'transport' : 'unobservable',
      })
      expect(replacements).toBe(0)
      const before = await fixture.state()
      expect(before.requests.filter((row) => row.kind === 'retained-read-refused')).toHaveLength(
        1,
      )
      expect(before.requests.filter((row) => row.kind === 'cancel' || row.kind === 'delete')).toEqual(
        [],
      )
      expect(before.runs).toHaveLength(1)
      expect(before.runs[0]).toMatchObject({ status: 'running' })
      expect(await readFile(admissions)).toEqual(prefix)
      const nativeProcess = readRecords(join(fixture.directory, 'json-worker-processes.jsonl'))[0]!
      expect(() => process.kill(Number(nativeProcess.pid), 0)).not.toThrow()

      // Restored reader authority adopts the original process, not a replacement invocation.
      await fixture.control({ finish: true })
      const recovered = await reconnectRetainedRun({ provider, controlRef: original.controlRef })
      expect(recovered?.controlRef).toEqual(original.controlRef)
      expect((await recovered!.result()).success).toBe(true)
      await fixture.wait('original native worker closed', async () =>
        (await fixture.state()).requests.some((row) => row.kind === 'json-worker-closed'),
      )
      const after = await fixture.state()
      expect(after.failures).toEqual([])
      expect(after.runs).toHaveLength(1)
      expect(after.requests.filter((row) => row.kind === 'dispatch')).toHaveLength(1)
      expect(after.requests.filter((row) => row.kind === 'cancel' || row.kind === 'delete')).toEqual(
        [],
      )
      expect(await readFile(admissions)).toEqual(prefix)
      expect(readRecords(join(fixture.directory, 'json-worker-processes.jsonl'))).toEqual([
        nativeProcess,
      ])
      passed = true
    } finally {
      await fixture.close()
      if (passed) await rm(fixture.directory, { recursive: true, force: true })
      else console.error('Retained auth proof artifacts:', fixture.directory)
    }
  },
  60_000,
)

it('does not repeat or search for a create refused by the real SDK nonretryable configuration verdict', async () => {
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`)
    response.writeHead(500, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      error: { code: 'CONFIGURATION_ERROR', message: 'Upstream service credential was refused', retryable: false },
    }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing HTTP boundary')
  const client = new Sandbox({ apiKey: 'offline-not-a-secret', baseUrl: `http://127.0.0.1:${address.port}` })
  let failure: unknown
  try {
    await acquireSandbox(client, {}, { readyTimeoutMs: 1_000, pollIntervalMs: 1, signal: AbortSignal.timeout(5_000) })
  } catch (error) {
    failure = error
  }
  expect(failure).toMatchObject({ code: 'CONFIGURATION_ERROR', status: 500, retryable: false })
  expect(requests).toEqual(['POST /v1/sandboxes'])
}, 15_000)
