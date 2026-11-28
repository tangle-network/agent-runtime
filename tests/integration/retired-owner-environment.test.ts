import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { createSelectSeat } from '@tangle-network/sandbox'
import { expect, it, onTestFinished } from 'vitest'
import { supervisePursuit } from '../../src/durable/supervise-pursuit'
import type { DriverAttemptRecord } from '../../src/runtime/supervise/driver-attempt-evidence'
import { cancelRun } from '../../src/runtime/supervise/run-cancellation'
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

/** The two refusals Sandbox answered a reopened run with, as its spawn journal recorded them. */
const REFUSALS = /Exact resume admission cleanup remains unconfirmed|Native seat continuation/u

/**
 * A run reopened after its settlement released the owner's box but could not destroy it, and the
 * box no longer runs. Before Runtime retired such a box, each case below stopped a real run:
 * - same seat: claim-cycle-count-gcd-20261117a (spawn journal rows 207-386) went back to the kept
 *   box, whose lookup Sandbox refused 58 times in 31 minutes with HTTP 503 "Exact resume
 *   admission cleanup remains unconfirmed", and settled with no model work.
 * - next stage: real-work-benchmark-20261127a (observer sequences 551-553) asked Sandbox's seat
 *   selector to continue the native session in the kept box, and each attempt was refused with
 *   HTTP 501 "Native seat continuation requires the running retained environment".
 */
it.each(['same seat', 'next stage'] as const)(
  'a reopened run whose kept box no longer runs continues in a fresh environment (%s)',
  async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), 'retired-owner-'))
    onTestFinished(() => rm(directory, { recursive: true, force: true }))
    const runId = 'retired-owner'
    const runDir = join(directory, 'run')
    // first: Sandbox keeps the first box under a retention hold, so settlement cannot destroy it.
    // dead: the kept box is stopped; a lookup asks Sandbox to resume it, and Sandbox refuses.
    // settled: the reopened run has its result, and settlement may destroy the kept box.
    let phase: 'first' | 'dead' | 'settled' = 'first'
    let kept: string | undefined
    let deadLookups = 0
    let boxReads = 0
    const native = nativeSeatProvider(directory, { recordOutput: true })
    const provider: AgentEnvironmentProvider = {
      ...native,
      capabilities: async () => ({
        ...(await native.capabilities()),
        create: { runtimeAttachments: { mcp: true } },
      }),
      get: async (id, options) => {
        if (phase === 'dead' && id === kept) {
          deadLookups += 1
          throw Object.assign(new Error('Exact resume admission cleanup remains unconfirmed'), {
            name: 'ServerError',
            code: 'UNAVAILABLE',
            status: 503,
          })
        }
        const environment = await native.get!(id, options)
        if (environment === null || phase !== 'first') return environment
        return {
          ...environment,
          destroy: async () => {
            throw Object.assign(new Error('sandbox is under retention hold'), {
              code: 'RETENTION_HOLD',
              status: 409,
            })
          },
        }
      },
    }
    const backend = { backend: 'provider' as const, provider }
    const stage = { harness: 'opencode', provider: 'fixture', model: 'fixture/native' } as const
    const profile = testAgentProfile('root', {
      harness: 'opencode',
      model: { provider: 'fixture', default: 'fixture/native' },
      seats: [
        { ...stage, selector: { kind: 'all-eligible' as const } },
        ...(mode === 'next stage'
          ? [{ ...stage, selector: { kind: 'seat' as const, id: 'seat-b' } }]
          : []),
      ],
    })
    const receipts = async (): Promise<Array<{ control: { environmentId: string } }>> =>
      (await readFile(join(directory, 'native-receipts.jsonl'), 'utf8').catch(() => ''))
        .trim()
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line))
    let reopening = false
    const selections: Array<{
      stageIndex: number
      requiresNativeTurnGrant: boolean
      retainedEnvironmentId?: string
      resumeSeatId?: string
    }> = []
    const selectSeat = createSelectSeat({
      // Sandbox's box read, which the selector makes before it grants a native continuation.
      client: {
        get: async (id: string) => {
          boxReads += 1
          return {
            id,
            status: phase === 'dead' && id === kept ? 'stopped' : 'running',
            capabilities: async () => ({}),
          }
        },
        fetch: async () => {
          throw new Error('seat selection reaches the account owner through its transport')
        },
      } as unknown as Parameters<typeof createSelectSeat>[0]['client'],
      // The account owner. Once the run is reopened, the first stage's seat is exhausted.
      transport: async ({ selection }) => {
        selections.push({
          stageIndex: selection.stageIndex,
          requiresNativeTurnGrant: selection.requiresNativeTurnGrant,
          ...(selection.retainedEnvironmentId === undefined
            ? {}
            : { retainedEnvironmentId: selection.retainedEnvironmentId }),
          ...(selection.resumeSeatId === undefined ? {} : { resumeSeatId: selection.resumeSeatId }),
        })
        if (mode === 'next stage' && reopening && selection.stageIndex === 0) {
          return {
            ok: false,
            status: 503,
            body: {
              error: {
                code: 'provider_quota_exhausted',
                reason: 'exhausted',
                resetAt: new Date(Date.now() + 3_600_000).toISOString(),
              },
            },
          }
        }
        return {
          ok: true,
          status: 200,
          body: {
            seatId: selection.stageIndex === 0 ? 'seat-a' : 'seat-b',
            credentials: { apiKeyEnv: 'FIXTURE_MODEL_KEY', baseUrl: 'https://fixture.invalid' },
          },
        }
      },
      runId,
      minimumValidUntil: new Date(Date.now() + 600_000).toISOString(),
      createBackend: () => backend,
    })
    const attempts: DriverAttemptRecord[] = []
    const options = {
      pursuitId: runId,
      runId,
      runDir,
      backend,
      driverBackend: backend,
      budget: { maxTokens: 1000, maxIterations: 20 },
      driverRetry: { enabled: false },
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
      finalizer: () => {
        if (!reopening)
          cancelRun(runDir, 'first-stop', { operator: 'integration', reason: 'stop first segment' })
        return 'done'
      },
      deliverable: {
        check: async (value: unknown) => {
          const done = value === 'done' && reopening && (await receipts()).length >= 2
          if (done) phase = 'settled'
          return done
        },
      },
      selectSeat,
      onDriverAttempt: (record: DriverAttemptRecord) => {
        attempts.push(record)
      },
    }
    const journal = async () =>
      (await createFileRunContext(runDir).journal.loadTree(runId)) ?? ([] as SpawnEvent[])

    const first = await supervisePursuit(profile, 'Produce one checked native result.', options)
    expect(first.result).toMatchObject({ kind: 'no-winner', reason: 'cancelled' })
    kept = (await receipts())[0]?.control.environmentId
    expect(kept).toBeDefined()
    // Settlement released the box but could not destroy it.
    const firstTeardowns = ofKind(await journal(), 'environment-teardown').filter(
      (event) => event.environmentId === kept,
    )
    expect(firstTeardowns.length).toBeGreaterThan(0)
    expect(firstTeardowns.every((event) => !event.destroyed && event.retired === undefined)).toBe(
      true,
    )
    const selectedBefore = selections.length

    phase = 'dead'
    reopening = true
    const reopened = await supervisePursuit(profile, 'Produce one checked native result.', {
      ...options,
      reopen: { operator: 'integration', reason: 'continue checked work', operationId: 'reopen-1' },
    })
    const refused = attempts.flatMap((record) =>
      record.error !== undefined && REFUSALS.test(record.error) ? [record.error] : [],
    )
    expect(refused).toEqual([])
    expect(reopened.result.kind, JSON.stringify(reopened.result)).toBe('winner')

    // The new turn ran in a new box, and the kept box was asked once and never again.
    const ran = await receipts()
    expect(ran).toHaveLength(2)
    expect(ran[1]?.control.environmentId).not.toBe(kept)
    expect(deadLookups).toBe(1)
    // No seat asked Sandbox to continue the native session in the kept box.
    expect(boxReads).toBe(0)
    const reopenedSelections = selections.slice(selectedBefore)
    expect(reopenedSelections.map((selection) => selection.retainedEnvironmentId)).not.toContain(
      kept,
    )
    if (mode === 'next stage') {
      expect(reopenedSelections.filter((selection) => selection.stageIndex === 1)).toEqual([
        { stageIndex: 1, requiresNativeTurnGrant: false },
      ])
    }

    // The journal says the box was retired and the conversation was not carried, and nothing
    // was admitted into the box after that.
    const events = await journal()
    const retired = ofKind(events, 'environment-teardown').filter((event) => event.retired === true)
    expect(retired).toMatchObject([{ environmentId: kept, destroyed: false }])
    expect(retired[0]?.detail).toContain('conversation context is not carried')
    expect(
      ofKind(events.slice(events.indexOf(retired[0]!)), 'execution-admitted').flatMap((event) =>
        event.admission.phase === 'environment' ? [event.admission.environmentId] : [],
      ),
    ).not.toContain(kept)
    // Retirement left the destroy owed, and this settlement paid it.
    expect(
      ofKind(events, 'environment-teardown').filter(
        (event) => event.environmentId === kept && event.destroyed,
      ),
    ).toHaveLength(1)
  },
  240_000,
)
