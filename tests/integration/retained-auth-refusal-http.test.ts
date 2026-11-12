import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import { Sandbox } from '@tangle-network/sandbox'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { appendCommittedJsonLine } from '../../src/durable/jsonl-file'
import { reconnectRetainedRun, startRetainedRun } from '../../src/runtime/retained-run-start'
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

it.each([401, 403, 404] as const)(
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
      const auth = status !== 404
      expect(records).toHaveLength(auth ? 1 : 3)
      expect(records.at(-1)).toMatchObject({
        classification: auth ? 'terminal' : 'transient',
        stop: auth ? 'terminal-error' : 'pending-unresolved',
        pendingCause: 'unobservable',
      })
      if (auth) expect(replacements).toBe(0)
      const before = await fixture.state()
      expect(before.requests.filter((row) => row.kind === 'retained-read-refused')).toHaveLength(
        auth ? 1 : 3,
      )
      expect(before.requests.filter((row) => row.kind === 'cancel' || row.kind === 'delete')).toEqual(
        [],
      )
      expect(before.runs).toHaveLength(1)
      expect(before.runs[0]).toMatchObject({ status: 'running' })
      expect(await readFile(admissions)).toEqual(prefix)
      const process = readRecords(join(fixture.directory, 'json-worker-processes.jsonl'))[0]!
      expect(() => globalThis.process.kill(Number(process.pid), 0)).not.toThrow()

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
      expect(readRecords(join(fixture.directory, 'json-worker-processes.jsonl'))).toEqual([process])
      passed = true
    } finally {
      await fixture.close()
      if (passed) await rm(fixture.directory, { recursive: true, force: true })
      else console.error('Retained auth proof artifacts:', fixture.directory)
    }
  },
  60_000,
)
