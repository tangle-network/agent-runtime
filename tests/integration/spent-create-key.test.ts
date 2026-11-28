import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { expect, it, onTestFinished } from 'vitest'
import { supervisePursuit } from '../../src/durable/supervise-pursuit'
import type { DriverAttemptRecord } from '../../src/runtime/supervise/driver-attempt-evidence'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import type { SpawnEvent } from '../../src/runtime/supervise/types'
import { testContinuation } from '../helpers/continuation'
import { nativeSeatProvider } from '../helpers/native-seat-provider'
import { testAgentProfile } from '../kernel/test-agent-profile'

function ofKind<K extends SpawnEvent['kind']>(
  events: readonly SpawnEvent[],
  kind: K,
): Array<Extract<SpawnEvent, { kind: K }>> {
  return events.filter((event): event is Extract<SpawnEvent, { kind: K }> => event.kind === kind)
}

/**
 * A turn's fresh box was created and then deleted before Runtime admitted it, so the turn's
 * create key names a box that no longer exists. claim-designated-summands-20261116a (spawn
 * journal rows 145-153), reopened on Runtime 10.0.18 into a fresh box: the Sandbox SDK created
 * sandbox-57666c62f399, timed out writing its 13 deferred profile files and threw
 * PartialFailureError HTTP 502 PROFILE_FILES_MATERIALIZE_INTERRUPTED, and the Tangle provider
 * deleted the box it had made. The retry replayed the same key, Sandbox refused it with HTTP 409
 * CREATION_RESULT_UNAVAILABLE "The keyed create's recorded project is unavailable; use a new key",
 * and the run settled failed with no model work. record-c1c-autocorrelation-20261117a (rows
 * 181-194) met the same refusal replaying a create its cancelled segment had started.
 */
it('a turn whose create key Sandbox refuses as spent starts a new turn under a new key', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spent-create-key-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const runId = 'spent-create-key'
  const runDir = join(directory, 'run')
  const native = nativeSeatProvider(directory, { recordOutput: true })
  // Every create key in call order, and the keys whose box was deleted after its create.
  const creates: string[] = []
  const spent = new Set<string>()
  let deleted: string | undefined
  const provider: AgentEnvironmentProvider = {
    ...native,
    capabilities: async () => ({
      ...(await native.capabilities()),
      create: { runtimeAttachments: { mcp: true } },
    }),
    create: async (input) => {
      const key = input.idempotencyKey!
      creates.push(key)
      if (spent.has(key))
        throw Object.assign(
          new Error("The keyed create's recorded project is unavailable; use a new key"),
          { name: 'StateError', code: 'CREATION_RESULT_UNAVAILABLE', status: 409 },
        )
      const environment = await native.create(input)
      if (deleted !== undefined) return environment
      // The first box: provisioning fails partway, and the provider deletes the box it made.
      deleted = environment.id
      spent.add(key)
      await environment.destroy()
      throw Object.assign(
        new Error(
          `Sandbox ${environment.id} is RUNNING but INCOMPLETELY PROVISIONED: materialization of its 13 deferred inline profile file mount(s) failed partway`,
        ),
        { name: 'PartialFailureError', code: 'PROFILE_FILES_MATERIALIZE_INTERRUPTED', status: 502 },
      )
    },
  }
  const backend = { backend: 'provider' as const, provider }
  const profile = testAgentProfile('root', {
    harness: 'opencode',
    model: { provider: 'fixture', default: 'fixture/native' },
  })
  const receipts = async (): Promise<Array<{ control: { environmentId: string } }>> =>
    (await readFile(join(directory, 'native-receipts.jsonl'), 'utf8').catch(() => ''))
      .trim()
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line))
  const attempts: DriverAttemptRecord[] = []
  const result = await supervisePursuit(profile, 'Produce one checked native result.', {
    pursuitId: runId,
    runId,
    runDir,
    backend,
    driverBackend: backend,
    budget: { maxTokens: 1000, maxIterations: 20 },
    driverRetry: { maxAttempts: 4, initialBackoffMs: 0, maxBackoffMs: 0 },
    continuation: testContinuation(),
    maxDepth: 0,
    coordination: {
      authentication: {
        signingKeys: {
          activeKeyId: 'integration',
          keys: { integration: 'integration-secret-'.repeat(4) },
        },
      },
      publicUrl: (address: { port: number }) => `http://127.0.0.1:${address.port}/manager`,
    },
    finalizer: () => 'done',
    deliverable: {
      check: async (value: unknown) => value === 'done' && (await receipts()).length >= 1,
    },
    onDriverAttempt: (record: DriverAttemptRecord) => {
      attempts.push(record)
    },
  })
  expect(result.result.kind, JSON.stringify(result.result)).toBe('winner')

  // The spent key was refused once and never sent again; the turn that ran had a new key.
  const first = creates[0]!
  expect(creates.filter((key) => key === first)).toHaveLength(2)
  expect(creates.at(-1)).not.toBe(first)
  const refused = attempts.filter((record) => record.error?.includes('use a new key'))
  expect(refused).toHaveLength(1)
  expect(refused[0]).toMatchObject({ abandoned: true })
  const ran = await receipts()
  expect(ran).toHaveLength(1)
  expect(ran[0]?.control.environmentId).not.toBe(deleted)

  // The journal closes the spent turn as stopped, nothing dispatched, and the next turn is new.
  const events = await createFileRunContext(runDir).journal.loadTree(runId)
  const inputs = ofKind(events ?? [], 'execution-input')
  expect(inputs).toHaveLength(2)
  const abandoned = ofKind(events ?? [], 'execution-abandoned')
  expect(abandoned).toMatchObject([
    { inputSeq: inputs[0]!.seq, pendingCause: 'request-rejected', outcome: 'stopped' },
  ])
  expect(abandoned[0]).not.toHaveProperty('stop')
  const intents = ofKind(events ?? [], 'execution-admitted').flatMap((event) =>
    event.admission.phase === 'intent' ? [event.admission.idempotencyKey] : [],
  )
  expect(intents).toEqual([first, creates.at(-1)])
}, 240_000)
