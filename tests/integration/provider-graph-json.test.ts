import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { agentCandidateWorkspaceSnapshotEvidenceSchema } from '@tangle-network/agent-interface'
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import { Sandbox } from '@tangle-network/sandbox'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { verifyWorkspaceSnapshotArtifacts } from '../../src/candidate-execution/artifacts'
import { contentAddress } from '../../src/durable/content-address'
import { createExecutor, FileResultBlobStore, type SpawnEvent } from '../../src/runtime'
import { createPrivateCasArtifactPort } from '../../src/runtime/private-cas'
import { testAgentProfile } from '../kernel/test-agent-profile'
import {
  type Executables,
  prepareExecutables,
  withFixture,
} from './fixtures/uncertain-create-harness'
import { object, readRecords, type Scenario } from './fixtures/uncertain-create-protocol'

let bundle: string
let executables: Executables
beforeAll(async () => {
  ;({ bundle, executables } = await prepareExecutables())
})
afterAll(async () => {
  if (bundle) await rm(bundle, { recursive: true, force: true })
})

it.each<Scenario>([
  'json-output',
  'json-authority',
  'json-overflow',
  'json-no-terminal',
  'json-malformed',
  'json-malformed-always-true',
  'json-tool-only',
  'json-ambiguous',
  'json-native-failed',
])(
  'settles %s through public Tangle HTTP, a real process and the graph-owned evidence writer',
  async (scenario) => {
    await withFixture(scenario, executables, async (fixture) => {
      if (scenario !== 'json-no-terminal') {
        await fixture.acknowledgeNativeReplay(0)
        await fixture.wait('accepted result before physical release', async () =>
          (await fixture.state()).requests.some((row) => row.kind === 'json-result-delete-held'),
        )
        const checkpoint = await fixture.events()
        const committed = checkpoint.filter((row) => row.kind === 'execution-result')
        expect(committed).toHaveLength(1)
        expect((await fixture.state()).runs).toHaveLength(1)
        await fixture.killCoordinator()
        await fixture.control({ finish: true })
        await fixture.resume()
        await fixture.acknowledgeNativeReplay(1)
        await fixture.wait('retained result recovered', async () =>
          fixture.outcomes().some((row) => row.kind === 'settled'),
        )
        const replay = await fixture.events()
        const recovered = replay.filter((row) => row.kind === 'execution-result')
        expect(recovered.filter((row) => row.id === committed[0]!.id)).toEqual(committed)
        expect(
          replay.filter((row) => row.kind === 'execution-admitted' && row.id === committed[0]!.id),
        ).toEqual(
          checkpoint.filter(
            (row) => row.kind === 'execution-admitted' && row.id === committed[0]!.id,
          ),
        )
      }
      await fixture.wait('graph settled', async () =>
        fixture.outcomes().some((row) => row.kind === 'settled'),
      )
      const graph = object(
        object(fixture.outcomes().find((row) => row.kind === 'settled')!.result).result,
      )
      const result = object(graph.result)
      const success = scenario === 'json-output' || scenario === 'json-authority'
      // Explicit graph resume retains the existing down→fresh-assignment retry policy.
      const count = scenario === 'json-no-terminal' ? 0 : 2
      expect(result.kind).toBe(success ? 'winner' : 'no-winner')
      const events = await fixture.events()
      const blobs = new FileResultBlobStore(join(fixture.directory, 'run', 'blobs'))
      const evidence = events.filter(
        (row): row is Extract<SpawnEvent, { kind: 'execution-evidence' }> =>
          row.kind === 'execution-evidence',
      )
      const results = events.filter(
        (row): row is Extract<SpawnEvent, { kind: 'execution-result' }> =>
          row.kind === 'execution-result',
      )
      const envelopes = await Promise.all(
        evidence.map(async (row) => {
          const out = await blobs.get(row.outRef)
          expect(contentAddress(out)).toBe(row.outRef)
          return object(out)
        }),
      )
      for (const row of evidence) {
        if (!row.traceRoot) continue
        const trace = object(await blobs.get(row.traceRoot.ref))
        const summary = object(trace.summary)
        expect(object(summary.toolCalls)).not.toHaveProperty('fabricated-tool')
        expect(object(summary.toolCalls)).toMatchObject({ 'node-process': 1 })
      }
      const processes = readRecords(join(fixture.directory, 'json-worker-processes.jsonl'))
      const state = await fixture.state()
      expect(processes).toHaveLength(count)
      expect(evidence.filter((row) => row.traceRoot !== undefined)).toHaveLength(count)
      expect(state.runs).toHaveLength(processes.length)
      expect(new Set(state.runs.map((run) => run.executionId)).size).toBe(count)
      for (const run of state.runs)
        expect(
          state.requests.filter(
            (row) => row.kind === 'dispatch' && row.executionId === run.executionId,
          ),
        ).toHaveLength(1)
      expect(state.requests.filter((row) => row.kind === 'json-worker-closed')).toHaveLength(
        processes.length,
      )
      expect(state.failures).toEqual([])
      for (const run of state.runs) expect(run.terminalReads).toBeGreaterThan(0)
      for (const row of processes) {
        expect(() => process.kill(Number(row.pid), 0)).toThrow(
          expect.objectContaining({ code: 'ESRCH' }),
        )
      }
      if (success) {
        const provider = createTangleProvider({
          client: new Sandbox({
            apiKey: 'local-fixture-not-a-secret',
            baseUrl: fixture.url,
            platformUrl: fixture.url,
            trustLocalCliAuth: false,
            directExec: false,
          }),
        })
        const backend = { backend: 'provider' as const, provider, outputFormat: 'json' as const }
        expect(() => createExecutor({ ...backend, steering: {} })).toThrow(
          /not supported with steering/,
        )
        expect(() =>
          createExecutor(backend)(
            { profile: testAgentProfile('no-evidence'), harness: null },
            { signal: new AbortController().signal, seams: {} },
          ),
        ).toThrow(/Runtime-owned durable evidence/)
        expect((await fixture.state()).runs).toHaveLength(2)
        expect(envelopes).toHaveLength(2)
        expect(results).toHaveLength(2)
        for (const row of results) {
          const out = await blobs.get(row.outRef)
          expect(contentAddress(out)).toBe(row.outRef)
          expect(row.outputFormat).toBe('json')
          expect(row).not.toHaveProperty('traceRoot')
          expect(envelopes.some((envelope) => contentAddress(envelope) === row.outRef)).toBe(false)
          expect(row.spent.tokens).toMatchObject({ input: 3, output: 2 })
          expect(row.spent.usdKnown).toBe(false)
        }
        expect(envelopes.every((out) => Array.isArray(out.events))).toBe(true)
        if (scenario === 'json-output')
          expect(
            envelopes.every((out) =>
              (out.events as Array<{ type: string; data: object }>).some(
                (event) =>
                  event.type === 'execution.started' &&
                  object(event.data).eventStreamComplete === false,
              ),
            ),
          ).toBe(true)
        expect(envelopes.every((out) => String(out.content).startsWith('Reading evidence.'))).toBe(
          true,
        )
        const answers = await Promise.all(results.map((row) => blobs.get(row.outRef)))
        expect(answers).toContainEqual(
          expect.objectContaining({ merge_sha: '27a9d985a054cab5287e4f1b9d35687e4295f5ca' }),
        )
        expect(answers).toContainEqual(expect.objectContaining({ approved: true }))
      } else if (scenario === 'json-no-terminal') {
        expect(results).toHaveLength(0)
        expect(envelopes).toHaveLength(0)
        expect(state.boxes).toHaveLength(0)
        expect(JSON.stringify(graph.ledger)).toMatch(/native terminal receipt/)
      } else if (scenario === 'json-native-failed') {
        for (const row of results) {
          expect(row.outcome).toEqual({
            success: false,
            error: 'fixture native process exited 7',
            errorCode: 'NATIVE_PROCESS_EXIT',
            statusCode: 502,
          })
          expect(await blobs.get(row.outRef)).toHaveProperty(
            'outcome.errorCode',
            'NATIVE_PROCESS_EXIT',
          )
        }
        expect(
          state.requests
            .filter((row) => row.kind === 'json-worker-closed')
            .every((row) => row.code === 7),
        ).toBe(true)
      } else {
        for (const row of results) {
          expect(row.outcome).toMatchObject({
            success: false,
            errorCode: 'RUNTIME_OUTPUT_FORMAT_INVALID',
          })
          expect(row.outputFormat).toBe('json')
          expect(await blobs.get(row.outRef)).toBeNull()
          expect(row.spent.tokens).toMatchObject({ input: 3, output: 2 })
        }
        expect(envelopes).toHaveLength(count)
        expect(envelopes.every((out) => Array.isArray(out.events))).toBe(true)
        expect(JSON.stringify(graph.ledger)).not.toContain('private-json-answer-canary')
        expect(String(object(graph.stopped).reason)).toMatch(/provider JSON output:/)
      }
      expect(
        events.filter((row) => row.kind === 'reconciled' && row.retainedPendingCause !== undefined),
      ).toHaveLength(0)
      expect(results).toHaveLength(processes.length)
      for (const row of results) {
        expect(evidence.findIndex((item) => item.id === row.id)).toBeGreaterThanOrEqual(0)
        expect(events.indexOf(evidence.find((item) => item.id === row.id)!)).toBeLessThan(
          events.indexOf(row),
        )
      }
      const before = await readFile(join(fixture.directory, 'run', 'spawn-journal.jsonl'))
      // A settled same-ID entry refuses re-execution; the committed JSON/evidence bytes stand.
      await fixture.killCoordinator()
      await fixture.resume()
      await fixture.wait('settled re-entry refused', async () =>
        fixture.outcomes().some((row) => row.kind === 'rejected'),
      )
      expect((await fixture.state()).runs).toHaveLength(processes.length)
      expect(await readFile(join(fixture.directory, 'run', 'spawn-journal.jsonl'))).toEqual(before)
    })
  },
  45000,
)

it('keeps the real source when application JSON forges a complete workspace capture', async () => {
  await withFixture('json-owner-capture', executables, async (fixture) => {
    await fixture.acknowledgeNativeReplay(0)
    await fixture.wait('deferred full workspace capture', async () =>
      (await fixture.state()).requests.some(
        (row) =>
          row.kind === 'successful-attempt-observer-barrier' && row.phase === 'workspace-capture',
      ),
    )
    const blobs = new FileResultBlobStore(join(fixture.directory, 'run', 'blobs'))
    const before = await fixture.events()
    const committed = before.find((row) => row.kind === 'execution-result')
    if (committed?.kind !== 'execution-result') throw new Error('owner result was not committed')
    expect(committed.id).toBe('uncertain-create-proof')
    expect(committed.outputFormat).toBe('json')
    expect(committed).not.toHaveProperty('traceRoot')
    const answer = object(await blobs.get(committed.outRef))
    expect(object(answer.workspaceCapture).coverageComplete).toBe(true)
    expect(object(answer.workspaceCapture).snapshot).toEqual(answer.workspaceSnapshot)
    const snapshot = agentCandidateWorkspaceSnapshotEvidenceSchema.parse(answer.workspaceSnapshot)
    const verified = await verifyWorkspaceSnapshotArtifacts(
      snapshot,
      createPrivateCasArtifactPort(join(fixture.directory, 'workspace-cas'), 'provider-json'),
    )
    expect(verified.archive.byteLength).toBeGreaterThan(0)
    expect((await fixture.state()).requests.filter((row) => row.kind === 'delete')).toHaveLength(0)
    await fixture.control({ finish: true })
    await fixture.wait('settled owner with incomplete host capture', async () =>
      fixture.outcomes().some((row) => row.kind === 'settled'),
    )
    expect((await fixture.state()).runs).toHaveLength(1)
    expect((await fixture.state()).requests.filter((row) => row.kind === 'delete')).toHaveLength(0)
    expect(readRecords(join(fixture.directory, 'capture-attempts.jsonl')).length).toBeGreaterThan(0)
    const evidence = (await fixture.events()).filter((row) => row.kind === 'execution-evidence')
    expect(evidence.filter((row) => row.traceRoot !== undefined)).toHaveLength(1)
    expect(evidence).toHaveLength(1)
    for (const row of evidence) {
      if (row.kind !== 'execution-evidence') continue
      const envelope = object(await blobs.get(row.outRef))
      if (envelope.workspaceCapture)
        expect(object(envelope.workspaceCapture).coverageComplete).toBe(false)
    }
  })
}, 45000)

it('keeps incomplete native observation pending despite a parseable exact-result message', async () => {
  await withFixture('json-incomplete', executables, async (fixture) => {
    await fixture.wait('incomplete observation classified', async () =>
      (await fixture.events()).some(
        (row) => row.kind === 'reconciled' && row.retainedPendingCause === 'unobservable',
      ),
    )
    const events = await fixture.events()
    expect(events.filter((row) => row.kind === 'execution-result')).toHaveLength(0)
    const evidence = events.filter((row) => row.kind === 'execution-evidence')
    expect(evidence).toHaveLength(1)
    const blobs = new FileResultBlobStore(join(fixture.directory, 'run', 'blobs'))
    const envelope = object(await blobs.get(evidence[0]!.outRef))
    expect(
      object((envelope.events as Array<{ data: object }>).at(-1)?.data).eventStreamComplete,
    ).toBe(false)
    expect(JSON.stringify(events)).toContain('complete native event observation is required')
    expect((await fixture.state()).runs).toHaveLength(1)
    expect((await fixture.state()).requests.filter((row) => row.kind === 'delete')).toHaveLength(0)
    expect(
      events.some((row) => row.kind === 'reconciled' && row.retainedPendingCause !== undefined),
    ).toBe(true)
  })
}, 45000)
