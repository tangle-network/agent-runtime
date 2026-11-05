import { execFile } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createFileRunContext } from '../../src/runtime'
import {
  type Executables,
  ProcessFixture,
  prepareExecutables,
} from './fixtures/uncertain-create-harness'
import {
  nativeEventFile,
  object,
  readRecords,
  type Scenario,
} from './fixtures/uncertain-create-protocol'

let bundle: string
let executables: Executables
beforeAll(async () => {
  ;({ bundle, executables } = await prepareExecutables())
})
afterAll(async () => {
  if (bundle) await rm(bundle, { recursive: true, force: true })
})

it.each<Scenario>([
  'json-observation-429',
  'json-observation-long-success',
  'json-observation-long-failed',
])(
  'preserves exact retained outcome and exits after real SDK HTTP/native/File observation (%s)',
  async (scenario) => {
    const fixture = await ProcessFixture.start(scenario, executables, { coordinator: false })
    let passed = false
    try {
      await fixture.control({ finish: true })
      const context = createFileRunContext(join(fixture.directory, 'run'))
      // A watchdog fails and reaps a leaking process; success requires its natural exit.
      const exit = await promisify(execFile)(
        process.execPath,
        [
          resolve('tests/integration/fixtures/provider-observation-process.mjs'),
          fixture.directory,
          fixture.url,
        ],
        {
          timeout: 5000,
          killSignal: 'SIGKILL',
          env: { PATH: process.env.PATH, HOME: fixture.directory },
        },
      ).then(
        () => ({ code: 0 }),
        (error: unknown) => ({
          error: String(error),
          signal: object(error).signal,
          killed: object(error).killed,
        }),
      )
      await writeFile(join(fixture.directory, 'observer-process-exit.json'), JSON.stringify(exit))
      const { delivered, budget } = JSON.parse(
        await readFile(join(fixture.directory, 'observed.json'), 'utf8'),
      )
      await fixture.wait('actual native process closed', async () =>
        (await fixture.state()).requests.some((row) => row.kind === 'json-worker-closed'),
      )
      const events = (await context.journal.loadTree('http-observation'))!
      const state = await fixture.state()
      expect(state.failures).toEqual([])
      expect(state.runs).toHaveLength(1)
      expect(state.requests.filter((row) => row.kind === 'cancel')).toEqual([])
      expect(budget).toMatchObject(
        scenario === 'json-observation-429'
          ? { tokensLeft: 200, reservedTokens: 0, committedTokens: 0, tokensKnown: false }
          : { tokensLeft: 195, reservedTokens: 0, committedTokens: 5, tokensKnown: true },
      )
      expect(state.requests.filter((row) => row.kind === 'delete')).toHaveLength(
        scenario === 'json-observation-429' ? 0 : 1,
      )
      expect(state.lost).toHaveLength(scenario === 'json-observation-429' ? 0 : 1)
      const run = state.runs[0]!
      const processes = readRecords(join(fixture.directory, 'json-worker-processes.jsonl'))
      expect(processes).toHaveLength(1)
      expect(processes[0]).toMatchObject({ executionId: run.executionId, sessionId: run.sessionId })
      expect(state.requests.filter((row) => row.kind === 'dispatch')).toHaveLength(1)
      expect(events.filter((row) => row.kind === 'execution-input')).toHaveLength(1)
      expect(
        events.filter(
          (row) => row.kind === 'execution-admitted' && row.admission.phase === 'dispatched',
        ),
      ).toHaveLength(1)
      expect(
        state.requests.some(
          (row) => row.kind === 'exact-result-handshake' && row.executionId === run.executionId,
        ),
      ).toBe(true)
      const results = events.filter((row) => row.kind === 'execution-result')
      if (scenario === 'json-observation-429') {
        expect(
          state.requests.some(
            (row) => row.kind === 'exact-result-http-error' && row.status === 429,
          ),
        ).toBe(true)
        expect(results).toHaveLength(0)
        const floor = events.find((row) => row.kind === 'reconciled')
        expect(floor).toMatchObject({
          retainedPendingCause: 'unobservable',
          spent: { tokensKnown: false },
        })
        expect(object(delivered)).toMatchObject({ kind: 'down', retainedExecution: 'pending' })
        expect(JSON.stringify(events)).not.toContain('provider_quota_exhausted')
      } else {
        const bytes = await readFile(
          join(fixture.directory, nativeEventFile(run.executionId)),
          'utf8',
        )
        expect(bytes.match(/^id: /gm)).toHaveLength(1032)
        expect(results).toHaveLength(1)
        expect(results[0]).toMatchObject({
          spent: { tokens: { input: 3, output: 2 }, usdKnown: false },
        })
        expect(results[0]!.spent.tokensKnown).not.toBe(false)
        const out = object(await context.blobs.get(results[0]!.outRef))
        const nativeEvents = out.events as Array<{ type: string; data: unknown }>
        expect(nativeEvents.some((event) => event.type === 'message.part.updated')).toBe(true)
        if (scenario.endsWith('success')) expect(out).not.toHaveProperty('outcome')
        else
          expect(out.outcome).toMatchObject({
            status: 'failed',
            error: 'native process exited 7',
            failure: { kind: 'work', code: 'native-process-exit' },
          })
        if (scenario.endsWith('failed'))
          expect(results[0]).toHaveProperty('outcome.failure', {
            kind: 'work',
            code: 'native-process-exit',
          })
        expect(object(delivered).kind).toBe(scenario.endsWith('success') ? 'done' : 'down')
      }
      expect(() => process.kill(Number(processes[0]!.pid), 0)).toThrow(
        expect.objectContaining({ code: 'ESRCH' }),
      )
      expect(exit).toEqual({ code: 0 })
      passed = true
    } finally {
      await fixture.close()
      if (passed) await rm(fixture.directory, { recursive: true, force: true })
      else console.error('Retained observation proof artifacts:', fixture.directory)
    }
  },
  20000,
)
