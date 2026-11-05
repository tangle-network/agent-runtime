import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import { Sandbox } from '@tangle-network/sandbox'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createExecutor, createFileRunContext, createSupervisor } from '../../src/runtime'
import { testAgentProfile } from '../kernel/test-agent-profile'
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
  'preserves exact retained outcome through real SDK HTTP/native/File observation (%s)',
  async (scenario) => {
    const fixture = await ProcessFixture.start(scenario, executables, { coordinator: false })
    let passed = false
    try {
      await fixture.control({ finish: true })
      const provider = createTangleProvider({
        client: new Sandbox({
          apiKey: 'offline-not-a-secret',
          baseUrl: fixture.url,
          platformUrl: fixture.url,
          trustLocalCliAuth: false,
          directExec: false,
        }),
      })
      const context = createFileRunContext(join(fixture.directory, 'run'))
      const profile = testAgentProfile('fetch-pr')
      const executorFactory = createExecutor({ backend: 'provider', provider })
      let delivered: unknown
      await createSupervisor().run(
        {
          name: 'root',
          async act(_task, scope) {
            expect(
              scope.spawn(
                {
                  name: 'fetch-pr',
                  act: async () => {
                    throw new Error('executor owns native execution')
                  },
                  executorSpec: { profile, harness: null, executorFactory },
                },
                'read local evidence',
                {
                  budget: { maxIterations: 1, maxTokens: 100 },
                },
              ).ok,
            ).toBe(true)
            delivered = await scope.next()
            return 'observed'
          },
        },
        null,
        {
          ...context,
          runId: 'http-observation',
          rootIdentity: {
            profileDigest: canonicalCandidateDigest({ name: 'root' }),
            taskDigest: canonicalCandidateDigest(null),
          },
          workerSlots: 1,
          teardownConfirmMs: 0,
          budget: { maxIterations: 2, maxTokens: 200, deadlineMs: 8000 },
        },
      )
      await fixture.wait('actual native process closed', async () =>
        (await fixture.state()).requests.some((row) => row.kind === 'json-worker-closed'),
      )
      const events = (await context.journal.loadTree('http-observation'))!
      const state = await fixture.state()
      expect(state.failures).toEqual([])
      expect(state.runs).toHaveLength(1)
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
      passed = true
    } finally {
      await fixture.close()
      if (passed) await rm(fixture.directory, { recursive: true, force: true })
      else console.error('Retained observation proof artifacts:', fixture.directory)
    }
  },
  20000,
)
