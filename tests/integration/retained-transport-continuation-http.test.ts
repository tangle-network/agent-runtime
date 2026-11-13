import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import { Sandbox } from '@tangle-network/sandbox'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createExecutor, createFileRunContext, createSupervisor } from '../../src/runtime'
import {
  type Executables,
  ProcessFixture,
  prepareExecutables,
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

it.each([
  ['chunk', 'success'],
  ['header', 'success'],
  ['header', 'caller'],
  ['chunk', 'untyped'],
] as const)(
  'retains transport continuation authority through SDK HTTP (%s/%s)',
  async (phase, mode) => {
    const continues = mode === 'success'
    const invocations = continues ? 2 : 1
    // This fixture proves the Runtime boundary using a real HTTP peer and work
    // processes. The producer separately proves real OpenCode/local upstream timeouts.
    const fixture = await ProcessFixture.start(
      `json-observation-long-transport-${phase}-${mode}`,
      executables,
      { coordinator: false },
    )
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
      const executorFactory = createExecutor({
        backend: 'provider',
        provider,
        unavailablePause: { unavailablePauseMs: 1, maxUnavailablePauseMs: 1 },
      })
      const profile = {
        name: 'fetch-pr',
        harness: 'opencode' as const,
        model: { provider: 'offline', default: 'offline-test-model' },
      }
      let deliveredKind: string | undefined
      let committedTokens: number | undefined
      const context = createFileRunContext(join(fixture.directory, 'run'))
      await createSupervisor().run(
        {
          name: 'root',
          async act(_task, scope) {
            const spawned = scope.spawn(
              {
                name: 'fetch-pr',
                act: async () => {
                  throw new Error('executor owns execution')
                },
                executorSpec: { profile, harness: null, executorFactory },
              },
              'Complete the original retained task.',
              { budget: { maxIterations: 2, maxTokens: 100 } },
            )
            expect(spawned.ok).toBe(true)
            const delivered = await scope.next()
            deliveredKind = delivered?.kind
            committedTokens = scope.budget.committedTokens
            return 'observed'
          },
        },
        null,
        {
          ...context,
          runId: `transport-${phase}-${mode}`,
          rootIdentity: {
            profileDigest: canonicalCandidateDigest({ name: 'root' }),
            taskDigest: canonicalCandidateDigest(null),
          },
          retainedAtSettlement: 'keep',
          workerSlots: 1,
          teardownConfirmMs: 0,
          budget: { maxIterations: 3, maxTokens: 200 },
          signal: AbortSignal.timeout(30_000),
        },
      )
      const state = await fixture.state()
      expect(state.failures).toEqual([])
      expect(state.boxes).toHaveLength(1)
      expect(state.runs).toHaveLength(invocations)
      expect(new Set(state.runs.map((run) => run.environmentId)).size).toBe(1)
      expect(new Set(state.runs.map((run) => run.sessionId)).size).toBe(1)
      expect(new Set(state.runs.map((run) => run.executionId)).size).toBe(invocations)
      const workers = readRecords(join(fixture.directory, 'json-worker-processes.jsonl'))
      expect(workers).toHaveLength(invocations)
      expect(new Set(workers.map((worker) => worker.pid)).size).toBe(invocations)
      const reopened = await createFileRunContext(join(fixture.directory, 'run')).journal.loadTree(
        `transport-${phase}-${mode}`,
      )
      const results = reopened?.filter((row) => row.kind === 'execution-result') ?? []
      if (mode === 'untyped') {
        expect(results[0]).toMatchObject({
          outcome: { success: false, error: 'SSE read timed out' },
        })
        expect(results[0]).not.toHaveProperty('outcome.failure')
      } else {
        expect(results[0]).toMatchObject({
          outcome: {
            success: false,
            errorCode: 'TRANSPORT_LOST',
            failure: { kind: mode === 'caller' ? 'caller' : 'infra', code: 'TRANSPORT_LOST' },
          },
        })
      }
      expect(
        state.runs.every((run) => run.status === 'completed' && run.processResult?.exitCode === 0),
      ).toBe(true)
      expect(deliveredKind).toBe(continues ? 'done' : 'down')
      if (continues) expect(committedTokens).toBe(10)
      const pauses = reopened?.filter((row) => row.kind === 'paused') ?? []
      expect(pauses).toHaveLength(continues ? 1 : 0)
      if (continues) expect(pauses[0]).toMatchObject({ signal: 'TRANSPORT_LOST' })
      expect(reopened?.filter((row) => row.kind === 'execution-input')).toHaveLength(invocations)
      expect(reopened?.filter((row) => row.kind === 'execution-result')).toHaveLength(invocations)
      expect(
        reopened?.filter(
          (row) =>
            row.kind === 'settled' &&
            row.status === (continues ? 'done' : 'down') &&
            row.id !== `transport-${phase}-${mode}`,
        ),
      ).toHaveLength(1)
      console.info('retained transport SDK boundary', {
        phase,
        mode,
        environments: state.boxes.length,
        invocations: state.runs.length,
        nativeSessions: new Set(state.runs.map((run) => run.sessionId)).size,
        pauses: pauses.length,
      })
    } finally {
      await fixture.captureCheckedFrontier('transport-continuation')
      await fixture.close()
    }
  },
  180_000,
)
