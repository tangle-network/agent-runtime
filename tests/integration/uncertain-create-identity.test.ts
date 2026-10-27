import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { build } from 'tsdown'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FileResultBlobStore, FileSpawnJournal, type SpawnEvent } from '../../src/runtime'
import {
  type Executables,
  type ProcessFixture,
  rootId,
  withFixture,
} from './fixtures/uncertain-create-harness'
import { object, readRecords, record } from './fixtures/uncertain-create-protocol'

let bundle: string
let executables: Executables
beforeAll(async () => {
  bundle = await mkdtemp(join(resolve('node_modules'), '.uncertain-create-'))
  await build({
    config: false,
    entry: {
      service: resolve('tests/integration/fixtures/uncertain-create-service.ts'),
      coordinator: resolve('tests/integration/fixtures/uncertain-create-coordinator.ts'),
      credential: resolve('tests/integration/fixtures/uncertain-create-credential.ts'),
    },
    outDir: bundle,
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    fixedExtension: true,
    dts: false,
    sourcemap: false,
    deps: { neverBundle: true },
    logLevel: 'error',
  })
  executables = {
    service: join(bundle, 'service.mjs'),
    coordinator: join(bundle, 'coordinator.mjs'),
    credential: join(bundle, 'credential.mjs'),
  }
})
afterAll(async () => {
  if (bundle) await rm(bundle, { recursive: true, force: true })
})
function inputs(events: SpawnEvent[], id = rootId) {
  return events.filter(
    (event): event is Extract<SpawnEvent, { kind: 'execution-input' }> =>
      event.kind === 'execution-input' && event.id === id,
  )
}
function intents(events: SpawnEvent[], id = rootId) {
  return events.flatMap((event) =>
    event.kind === 'execution-admitted' && event.id === id && event.admission.phase === 'intent'
      ? [event.admission]
      : [],
  )
}
function abandoned(events: SpawnEvent[], id = rootId) {
  return events.filter((event) => event.kind === 'execution-abandoned' && event.id === id)
}
async function assertAcceptedNativeResult(
  fixture: ProcessFixture,
  event: Extract<SpawnEvent, { kind: 'execution-result' }>,
): Promise<void> {
  const artifact = await new FileResultBlobStore(join(fixture.directory, 'run', 'blobs')).get(
    event.outRef,
  )
  expect(artifact).toMatchObject({
    content: '{"answer":"delivered"}',
    events: expect.arrayContaining([
      expect.objectContaining({
        type: 'done',
        data: expect.objectContaining({ success: true, outcome: { type: 'completed' } }),
      }),
    ]),
  })
}
async function assertOneIdentity(fixture: ProcessFixture, expected?: unknown): Promise<unknown> {
  const events = await fixture.events()
  expect(inputs(events), 'one durable input must own unresolved create').toHaveLength(1)
  expect(
    intents(events),
    'one intent must retain key/digest/session/execution identity',
  ).toHaveLength(1)
  expect(abandoned(events), 'unknown create or cancellation cannot authorize abandon').toHaveLength(
    0,
  )
  const identity = { input: inputs(events)[0], intent: intents(events)[0] }
  if (expected !== undefined) expect(identity).toEqual(expected)
  const creates = (await fixture.state()).requests.filter((row) => row.kind === 'create')
  expect(creates.length).toBeGreaterThan(2)
  expect(
    new Set(creates.map((row) => row.key)).size,
    'service independently observed one create key',
  ).toBe(1)
  expect(creates.every((row) => row.key === intents(events)[0]?.idempotencyKey)).toBe(true)
  expect(
    new Set(creates.map((row) => row.publicDigest)).size,
    'public HTTP create material must not drift',
  ).toBe(1)
  expect(new Set(creates.map((row) => JSON.stringify(row.publicMaterial))).size).toBe(1)
  expect((await fixture.state()).provisions).toHaveLength(1)
  const originalEnv = object(object(creates[0]!.rawCreateBody).env ?? {})
  for (const create of creates) {
    const env = object(object(create.rawCreateBody).env ?? {})
    expect(Object.keys(env).sort()).toEqual(Object.keys(originalEnv).sort())
    for (const key of Object.keys(env)) {
      if (key !== 'AGENT_RUNTIME_COORDINATION_TOKEN') expect(env[key]).toEqual(originalEnv[key])
    }
  }
  return identity
}

describe('actual Tangle SDK uncertain root create identities', () => {
  it.each(['create-408', 'create-503'] as const)(
    'UC1 %s retains key/digest/execution/input beyond two failures and SIGKILL/resume',
    async (scenario) => {
      await withFixture(scenario, executables, async (fixture) => {
        await fixture.wait(
          'at least six SDK requests and three failed Runtime root attempts',
          async () =>
            (await fixture.state()).requests.filter((row) => row.kind === 'create').length >= 6 &&
            (await fixture.events()).filter(
              (event) =>
                event.kind === 'driver-attempt' &&
                event.id === rootId &&
                event.record.error !== undefined,
            ).length >= 3,
        )
        const identity = await assertOneIdentity(fixture)
        const before = (await fixture.state()).requests.filter(
          (row) => row.kind === 'create',
        ).length
        const servicePid = JSON.parse(
          await readFile(join(fixture.directory, 'service-ready.json'), 'utf8'),
        ).pid
        const previousPid = fixture.coordinator!.pid
        await fixture.killCoordinator()
        const beforeAttempts = (await fixture.events()).filter(
          (event) =>
            event.kind === 'driver-attempt' &&
            event.id === rootId &&
            event.record.error !== undefined,
        ).length
        await fixture.resume()
        expect(fixture.coordinator!.pid).not.toBe(previousPid)
        expect(
          JSON.parse(await readFile(join(fixture.directory, 'service-ready.json'), 'utf8')).pid,
        ).toBe(servicePid)
        await fixture.wait(
          'same invocation actually retried in replacement process',
          async () =>
            (await fixture.state()).requests.filter((row) => row.kind === 'create').length >=
              before + 4 &&
            (await fixture.events()).filter(
              (event) =>
                event.kind === 'driver-attempt' &&
                event.id === rootId &&
                event.record.error !== undefined,
            ).length >=
              beforeAttempts + 3,
        )
        await assertOneIdentity(fixture, identity)
        expect((await fixture.events()).some((event) => event.kind === 'root-reentered')).toBe(true)
        await fixture.control({ finish: true })
        // The service writes this native reasoning frame and result/done in one SSE batch.
        // Observe the real Runtime stream before allowing the independent exact-result reply.
        await fixture.wait('native replay reached the root stream', async () => {
          const run = (await fixture.state()).runs[0]
          return (
            run !== undefined &&
            readRecords(join(fixture.directory, 'run', 'root-stream.jsonl')).some(
              (row) =>
                object(row.event).kind === 'reasoning_delta' &&
                object(row.event).text === run.executionId,
            )
          )
        })
        await fixture.control({ nativeReplayObserved: (await fixture.state()).runs[0]!.executionId })
        await fixture.wait('original provision resolves to its exact native result', async () => {
          const state = await fixture.state()
          return (
            state.requests.some((row) => row.kind === 'successful-attempt-observer-barrier') &&
            (await fixture.events()).some(
              (event) => event.kind === 'execution-result' && event.id === rootId,
            )
          )
        })
        await assertOneIdentity(fixture, identity)
        const state = await fixture.state()
        expect(state.provisions).toHaveLength(1)
        expect(state.requests.filter((row) => row.kind === 'provision-admitted')).toHaveLength(1)
        expect(state.requests.filter((row) => row.kind === 'dispatch')).toHaveLength(1)
        expect(
          (await fixture.events()).filter(
            (event) => event.kind === 'execution-result' && event.id === rootId,
          ),
        ).toEqual([
          expect.objectContaining({
            outRef: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            spent: expect.objectContaining({
              tokens: { input: 3, output: 2, cacheBreakdownKnown: false },
            }),
          }),
        ])
        const accepted = (await fixture.events()).find(
          (event): event is Extract<SpawnEvent, { kind: 'execution-result' }> =>
            event.kind === 'execution-result' && event.id === rootId,
        )!
        await assertAcceptedNativeResult(fixture, accepted)
        expect(state.requests.filter((row) => row.kind === 'native-replay-consumed')).toHaveLength(1)
      })
    },
    45000,
  )

  it('UC2 accepted older A then authoritative loss cannot reset pending B after a real 408', async () => {
    await withFixture('older-lost', executables, async (fixture) => {
      await fixture.wait('old result plus B retry frontier', async () => {
        const events = await fixture.events()
        return (
          events.some((event) => event.kind === 'execution-result' && event.id === rootId) &&
          (await fixture.state()).requests.filter(
            (row) => row.kind === 'create' && row.status === 408,
          ).length >= 5
        )
      })
      await fixture.killCoordinator()
      const before = await fixture.events()
      const allInputs = inputs(before)
      expect(allInputs, 'A accepted and B pending are exactly two invocations').toHaveLength(2)
      const b = intents(before).at(-1)!
      const bInput = allInputs.at(-1)!
      expect(
        before.some(
          (event) =>
            event.kind === 'environment-teardown' &&
            event.environmentId === 'box-1' &&
            event.destroyed,
        ),
      ).toBe(true)
      expect(
        before.some(
          (event) =>
            event.kind === 'execution-result' && event.id === rootId && event.seq > bInput.seq,
        ),
      ).toBe(false)
      expect(abandoned(before)).toHaveLength(0)
      const count = (await fixture.state()).requests.filter((row) => row.kind === 'create').length
      await fixture.resume()
      await fixture.wait(
        'B actually retries after process restart',
        async () =>
          (await fixture.state()).requests.filter((row) => row.kind === 'create').length >=
          count + 3,
      )
      const after = await fixture.events()
      expect(inputs(after)).toEqual(allInputs)
      expect(intents(after).at(-1)).toEqual(b)
      expect(abandoned(after)).toHaveLength(0)
      const failures = (await fixture.state()).requests.filter(
        (row) => row.kind === 'create' && row.status === 408,
      )
      expect(new Set(failures.map((row) => row.key))).toEqual(new Set([b.idempotencyKey]))
    })
  }, 45000)

  it('UC3 authoritative loss of the current admitted target permits a genuinely new invocation', async () => {
    await withFixture('current-lost', executables, async (fixture) => {
      await fixture.wait('current target loss and replacement intent', async () => {
        const events = await fixture.events()
        return inputs(events).length >= 2 && intents(events).length >= 2
      })
      await fixture.killCoordinator()
      const events = await fixture.events()
      const identities = intents(events)
      expect(new Set(identities.map((row) => row.idempotencyKey)).size).toBeGreaterThanOrEqual(2)
      expect(
        events.some(
          (event) =>
            event.kind === 'environment-teardown' &&
            event.environmentId === 'box-1' &&
            event.destroyed,
        ),
      ).toBe(true)
      expect(
        (await fixture.state()).requests.some(
          (row) => row.kind === 'get' && row.environmentId === 'box-1' && row.absent,
        ),
      ).toBe(true)
    })
  }, 45000)

  it.each(['cancel-unknown', 'cancel-requested'] as const)(
    'UC4 %s retains the current identity until exact cancelled/not_live evidence',
    async (scenario) => {
      await withFixture(scenario, executables, async (fixture) => {
        await fixture.wait('actual exact cancellation', async () =>
          (await fixture.state()).requests.some((row) => row.kind === 'cancel'),
        )
        // This is an external-service barrier: inspect actual status polls, never fake elapsed time.
        await fixture.wait(
          'second unknown cancellation or asynchronous status observation',
          async () => {
            const requests = (await fixture.state()).requests
            return scenario === 'cancel-unknown'
              ? requests.filter((row) => row.kind === 'cancel').length >= 3
              : requests
                  .slice(requests.findIndex((row) => row.kind === 'cancel') + 1)
                  .filter((row) => row.kind === 'session-status' && row.status === 'running')
                  .length >= 2
          },
        )
        const held = await fixture.events()
        expect(inputs(held)).toHaveLength(1)
        expect(intents(held)).toHaveLength(1)
        expect(abandoned(held)).toHaveLength(0)
        const first = intents(held)[0]!
        await fixture.control({
          cancelEffect: scenario === 'cancel-unknown' ? 'not_live' : 'cancelled',
          ...(scenario === 'cancel-requested' ? { nativeStatus: 'cancelled' } : {}),
        })
        await fixture.wait(
          'confirmed terminal stop authorizes next invocation',
          async () => {
            const events = await fixture.events()
            return (
              abandoned(events).length > 0 &&
              inputs(events).length > 1 &&
              intents(events).length > 1
            )
          },
          35000,
        )
        const events = await fixture.events()
        expect(abandoned(events)).toContainEqual(
          expect.objectContaining({
            outcome: 'stopped',
            stop: expect.objectContaining({
              effect: scenario === 'cancel-unknown' ? 'not_live' : 'cancelled',
              executionId: first.executionId,
            }),
          }),
        )
        expect(intents(events).at(-1)?.idempotencyKey).not.toBe(first.idempotencyKey)
      })
    },
    60000,
  )
})

describe('typed real command credential refusal and accepted evidence', () => {
  it('UC5 unsupported route before SDK create settles the nested manager once without abandon', async () => {
    await withFixture('unsupported-intent', executables, async (fixture) => {
      const child = `${rootId}:s0`
      await fixture.wait('typed nested refusal disposition', async () => {
        const events = await fixture.events()
        const down = events.some(
          (event) => event.kind === 'settled' && event.id === child && event.status === 'down',
        )
        const retained = events.some(
          (event) =>
            event.kind === 'reconciled' &&
            event.id === child &&
            event.retainedPendingCause === 'nested-recovery',
        )
        const terminalRefusal = events.some(
          (event) =>
            event.kind === 'driver-attempt' &&
            event.id === child &&
            event.record.stop === 'terminal-error' &&
            event.record.pendingCause === 'request-rejected',
        )
        const commanded = readRecords(join(fixture.directory, 'credential-calls.jsonl')).some(
          (row) => row.kind === 'credential-command' && row.profile === 'credential-manager',
        )
        // Baseline closes this cursor only on later recovery/release, so its fsynced retained
        // disposition is the causal frontier; another command invocation is not guaranteed.
        return down || (retained && terminalRefusal && commanded)
      })
      await fixture.killCoordinator()
      const events = await fixture.events()
      const down = events.filter(
        (event) => event.kind === 'settled' && event.id === child && event.status === 'down',
      )
      expect(
        down,
        'definitive intent-only refusal must settle once without nested recovery',
      ).toHaveLength(1)
      expect(down[0]).not.toHaveProperty('retainedExecution')
      expect(down[0]).not.toHaveProperty('retainedPendingCause')
      const journal = new FileSpawnJournal(join(fixture.directory, 'run', 'spawn-journal.jsonl'))
      const parentTree = (await journal.loadTree(rootId))!
      const wrapper = parentTree.find(
        (event): event is Extract<SpawnEvent, { kind: 'spawned' }> =>
          event.kind === 'spawned' && event.id === child,
      )!
      expect(wrapper.ownedTreeRoot).toBeDefined()
      const nativeTree = (await journal.loadTree(wrapper.ownedTreeRoot!))!
      const wrapperInputs = inputs(parentTree, child)
      const nativeInputs = inputs(nativeTree, child)
      // A managed child has one wrapper admission and one native owner input in distinct trees.
      // Keep provenance instead of treating their shared node id as a second native attempt.
      expect(wrapperInputs).toHaveLength(1)
      expect(nativeInputs).toHaveLength(1)
      expect(wrapperInputs[0]!.taskRef).toBe(nativeInputs[0]!.taskRef)
      expect(inputs(events, child)).toHaveLength(wrapperInputs.length + nativeInputs.length)
      expect(intents(parentTree, child)).toHaveLength(0)
      expect(intents(nativeTree, child)).toHaveLength(1)
      expect(intents(events, child)).toHaveLength(1)
      expect(abandoned(events, child)).toHaveLength(0)
      expect(readRecords(join(fixture.directory, 'credential-calls.jsonl'))).toHaveLength(1)
      const state = await fixture.state()
      expect(
        state.requests.filter(
          (row) => row.kind === 'create' && row.profile === 'credential-manager',
        ),
      ).toHaveLength(0)
      expect(
        state.requests.filter((row) => row.kind === 'dispatch' && row.environmentId !== 'box-1'),
      ).toHaveLength(0)
      expect(
        events.filter((event) => event.kind === 'driver-attempt' && event.id === child),
      ).toEqual([
        expect.objectContaining({
          record: expect.objectContaining({ stop: 'terminal-error', attempt: 1 }),
        }),
      ])
    })
  }, 45000)

  it.each(['unsupported-environment', 'unsupported-descendant'] as const)(
    'UC6 %s cannot turn existing admission or descendant work into terminal refusal',
    async (scenario) => {
      await withFixture(scenario, executables, async (fixture) => {
        const child = `${rootId}:s0`
        if (scenario === 'unsupported-descendant') {
          await fixture.wait(
            'accepted manager turn and actual grandchild create',
            async () =>
              (await fixture.events()).some(
                (event) => event.kind === 'execution-result' && event.id === child,
              ) &&
              (await fixture.state()).requests.some(
                (row) => row.kind === 'create' && row.profile === 'pending-grandchild',
              ),
          )
          const commands = readRecords(join(fixture.directory, 'credential-calls.jsonl'))
          expect(commands.length).toBeGreaterThan(0)
          expect(commands.every((row) => row.refused === false)).toBe(true)
          fixture.credentialMode(true)
          record(join(fixture.directory, 'proof-phases.jsonl'), {
            kind: 'descendant-refusal-armed',
            at: new Date().toISOString(),
            credentialCalls: commands.length,
          })
          // Arm only after actual accepted manager work and grandchild create; create/recovery
          // may legitimately resolve credentials more than once. The public steer supplies work.
          await fixture.control({ steerManager: true })
        }
        await fixture.wait('typed refusal preserves the admitted nested manager', async () => {
          const events = await fixture.events()
          return (
            readRecords(join(fixture.directory, 'credential-calls.jsonl')).some(
              (row) => row.refused === true,
            ) &&
            events.some(
              (event) =>
                event.kind === 'driver-attempt' &&
                event.id === child &&
                event.record.stop === 'terminal-error' &&
                event.record.pendingCause === 'request-rejected',
            ) &&
            events.some(
              (event) =>
                event.kind === 'reconciled' &&
                event.id === child &&
                event.retainedPendingCause === 'nested-recovery',
            )
          )
        })
        await fixture.killCoordinator()
        const events = await fixture.events()
        const commands = readRecords(join(fixture.directory, 'credential-calls.jsonl'))
        const refusals = commands.filter((row) => row.refused === true)
        expect(refusals).toEqual([
          expect.objectContaining({ profile: 'credential-manager', refused: true }),
        ])
        if (scenario === 'unsupported-environment') expect(commands).toHaveLength(2)
        else {
          const firstRefusal = commands.findIndex((row) => row.refused === true)
          expect(firstRefusal).toBeGreaterThan(0)
          expect(commands.slice(0, firstRefusal).every((row) => row.refused === false)).toBe(true)
          expect(commands.slice(firstRefusal)).toHaveLength(1)
        }
        expect(
          events.some(
            (event) =>
              event.kind === 'execution-admitted' &&
              event.id === child &&
              event.admission.phase === 'environment',
          ),
        ).toBe(true)
        expect(
          events.some(
            (event) =>
              (event.kind === 'settled' || event.kind === 'cancelled') && event.id === child,
          ),
        ).toBe(false)
        expect(abandoned(events, child)).toHaveLength(0)
        expect(
          events.filter(
            (event) =>
              event.kind === 'reconciled' &&
              event.id === child &&
              event.retainedPendingCause === 'nested-recovery',
          ),
        ).toHaveLength(1)
        expect(
          events.filter(
            (event) =>
              event.kind === 'driver-attempt' &&
              event.id === child &&
              event.record.stop === 'terminal-error' &&
              event.record.pendingCause === 'request-rejected',
          ),
        ).toHaveLength(1)
        if (scenario === 'unsupported-descendant') {
          expect(
            events.some((event) => event.kind === 'spawned' && event.id === `${child}:s0`),
          ).toBe(true)
          const accepted = events.filter(
            (event): event is Extract<SpawnEvent, { kind: 'execution-result' }> =>
              event.kind === 'execution-result' && event.id === child,
          )
          expect(accepted).toHaveLength(1)
          await assertAcceptedNativeResult(fixture, accepted[0]!)
          expect(
            (await fixture.state()).requests.filter(
              (row) => row.kind === 'descendant-steer-delivered',
            ),
          ).toHaveLength(1)
          // The executor aborts and joins its descendants before recording nested recovery.
          // That owned cleanup must not become ordinary terminal settlement of the manager.
          expect(
            events.filter(
              (event) =>
                event.kind === 'settled' &&
                event.id === `${child}:s0` &&
                event.status === 'down' &&
                event.reason === 'driver stopped',
            ),
          ).toHaveLength(1)
          expect(
            (await fixture.state()).requests.some(
              (row) => row.kind === 'create' && row.profile === 'pending-grandchild',
            ),
          ).toBe(true)
        }
      })
    },
    45000,
  )
})

describe('accepted native recovery and historical identities', () => {
  it('UC7 accepted native result, descendant accounting and delivered-only finalizer survive process recovery', async () => {
    await withFixture('accepted', executables, async (fixture) => {
      await fixture.wait(
        'child admission durable',
        async () =>
          (await fixture.events()).some(
            (event) =>
              event.kind === 'execution-admitted' &&
              event.id === `${rootId}:s0` &&
              event.admission.phase === 'dispatched',
          ) &&
          (await fixture.events()).some(
            (event) => event.kind === 'execution-result' && event.id === rootId,
          ),
      )
      await fixture.killCoordinator()
      const committed = await fixture.events()
      const accepted = committed.filter((event) => event.kind === 'execution-result')
      const dispatched = (await fixture.state()).requests.filter((row) => row.kind === 'dispatch')
      const heldState = await fixture.state()
      const heldChild = dispatched.find((row) => row.environmentId === 'box-2')!
      expect(heldChild).toBeDefined()
      const previousChildReads = heldState.requests.filter(
        (row) => row.kind === 'events' && row.executionId === heldChild.executionId,
      ).length
      const previousRegistrations = Object.keys(heldState.routes).map((key) => ({
        key,
        count: heldState.requests.filter((row) => row.kind === 'control' && row.routeKey === key)
          .length,
      }))
      await fixture.resume()
      await fixture.wait(
        'replacement owners registered and exact child actually rejoined',
        async () => {
          const state = await fixture.state()
          return (
            previousRegistrations.every(
              ({ key, count }) =>
                state.requests.filter((row) => row.kind === 'control' && row.routeKey === key)
                  .length > count,
            ) &&
            state.requests.filter(
              (row) => row.kind === 'events' && row.executionId === heldChild.executionId,
            ).length > previousChildReads
          )
        },
      )
      // The original native execution stays held until its replacement owner has restored
      // coordination authority and actually rejoined that exact child execution.
      await fixture.control({ finish: true })
      await fixture.wait('recovered child native result and settlement committed', async () => {
        const events = await fixture.events()
        return (
          events.some(
            (event) =>
              event.kind === 'settled' && event.id === `${rootId}:s0` && event.status === 'done',
          ) &&
          events.some((event) => event.kind === 'execution-result' && event.id === `${rootId}:s0`)
        )
      })
      const recovered = (await fixture.events()).filter(
        (event) =>
          (event.kind === 'execution-result' || event.kind === 'settled') &&
          event.id === `${rootId}:s0`,
      )
      for (const event of recovered) {
        expect(event.verdict?.valid, 'recovered leaf must preserve its delivery verdict').toBe(true)
      }
      await fixture.wait('pursuit settled through existing finalizer', async () =>
        fixture.outcomes().some((row) => row.kind === 'settled'),
      )
      const events = await fixture.events()
      for (const event of accepted) expect(events).toContainEqual(event)
      const child = `${rootId}:s0`
      expect(events.filter((event) => event.kind === 'spawned' && event.id === child)).toHaveLength(
        1,
      )
      expect(
        events.filter(
          (event) => event.kind === 'settled' && event.id === child && event.status === 'done',
        ),
      ).toHaveLength(1)
      const finalizers = readRecords(join(fixture.directory, 'finalizer.jsonl'))
      expect(
        finalizers.filter((row) => Array.isArray(row.delivered) && row.delivered.length === 1),
      ).toHaveLength(1)
      expect(
        events.filter((event) => event.kind === 'execution-result' && event.id === child),
      ).toHaveLength(1)
      const allDispatches = (await fixture.state()).requests.filter(
        (row) => row.kind === 'dispatch',
      )
      const childDispatch = dispatched.find((row) => row.environmentId === 'box-2')!
      expect(childDispatch).toBeDefined()
      expect(
        allDispatches.filter((row) => row.executionId === childDispatch.executionId),
      ).toHaveLength(1)
      const settled = events.find(
        (event): event is Extract<SpawnEvent, { kind: 'settled' }> =>
          event.kind === 'settled' && event.id === child && event.status === 'done',
      )!
      // This explicitly authored ordinary leaf owns its native spend in its settlement.
      // No nested driver re-homes a second inference charge for the same native execution.
      expect(settled).toMatchObject({
        spent: { tokens: { input: 3, output: 2, cacheBreakdownKnown: false } },
      })
      const parentEvents = (await new FileSpawnJournal(
        join(fixture.directory, 'run', 'spawn-journal.jsonl'),
      ).loadTree(rootId))!
      expect(
        parentEvents.filter((event) => event.kind === 'metered' && event.id === child),
      ).toHaveLength(0)
      const nativeResult = parentEvents.find(
        (event): event is Extract<SpawnEvent, { kind: 'execution-result' }> =>
          event.kind === 'execution-result' && event.id === child,
      )!
      expect(nativeResult).toBeDefined()
      expect(settled.outRef).toBe(nativeResult.outRef)
      await assertAcceptedNativeResult(fixture, nativeResult)
      const leafCreate = (await fixture.state()).requests.find(
        (row) => row.kind === 'create' && row.profile === 'delivered-leaf',
      )!
      expect(leafCreate).toBeDefined()
      const leafProfile = object(object(object(leafCreate.rawCreateBody).backend).profile)
      expect(leafProfile).not.toHaveProperty('seats')
      expect(
        Object.keys(object(leafProfile.tools ?? {})).filter((name) =>
          name.startsWith('agent_runtime_coordination_'),
        ),
      ).toHaveLength(0)
      const outcomes = fixture.outcomes().filter((row) => row.kind === 'settled')
      expect(outcomes).toHaveLength(1)
      const pursuit = outcomes[0]!.result as {
        result: {
          kind: string
          spentTotal: {
            tokens: { input: number; output: number; cacheBreakdownKnown?: false }
            tokensKnown: boolean
            usdKnown: boolean
          }
          tree: { inFlight: number }
        }
      }
      expect(pursuit.result.kind).toBe('winner')
      const acceptedResults = events.filter(
        (event): event is Extract<SpawnEvent, { kind: 'execution-result' }> =>
          event.kind === 'execution-result',
      )
      for (const result of acceptedResults) await assertAcceptedNativeResult(fixture, result)
      const acceptedExecutions = new Set(
        acceptedResults.map((result) => {
          const admission = events
            .slice(0, events.indexOf(result))
            .filter(
              (event): event is Extract<SpawnEvent, { kind: 'execution-admitted' }> =>
                event.kind === 'execution-admitted' &&
                event.id === result.id &&
                event.admission.phase === 'dispatched',
            )
            .at(-1)?.admission
          if (admission?.phase !== 'dispatched')
            throw new Error('accepted result has no exact native admission')
          return admission.controlRef.executionId
        }),
      )
      expect(acceptedExecutions.size).toBe(acceptedResults.length)
      const completedExecutions = new Set(
        (await fixture.state()).runs
          .filter((run) => run.status === 'completed')
          .map((run) => run.executionId),
      )
      expect(acceptedExecutions).toEqual(completedExecutions)
      expect(pursuit.result.spentTotal.tokens).toEqual({
        input: acceptedExecutions.size * 3,
        output: acceptedExecutions.size * 2,
        cacheBreakdownKnown: false,
      })
      expect(pursuit.result.spentTotal.tokensKnown).toBe(true)
      const acceptance = finalizers.filter(
        (row) => Array.isArray(row.delivered) && row.delivered.length === 1,
      )[0]!
      expect(acceptance.budget).toMatchObject({
        reservedTokens: 0,
        tokensLeft: 10000 - acceptedExecutions.size * 5,
      })
      expect(pursuit.result.spentTotal.usdKnown).toBe(false)
      expect(pursuit.result.tree.inFlight).toBe(0)
      expect(abandoned(events)).toHaveLength(0)
    })
  }, 45000)

  it('UC8 historical uncertain abandonment remains closed without rewriting or claiming cleanup', async () => {
    await withFixture('historical', executables, async (fixture) => {
      await fixture.wait(
        'original real SDK intent',
        async () => intents(await fixture.events()).length === 1,
      )
      await fixture.killCoordinator()
      const previous = await fixture.events()
      const input = inputs(previous)[0]!
      const oldIdentity = intents(previous)[0]!
      const journal = new FileSpawnJournal(join(fixture.directory, 'run', 'spawn-journal.jsonl'))
      // A compatibility fixture models an ALREADY-CLOSED historical record. It does not invent
      // a provider error or claim that the current implementation should publish this record.
      const historical: Extract<SpawnEvent, { kind: 'execution-abandoned' }> = {
        kind: 'execution-abandoned',
        id: rootId,
        inputSeq: input.seq,
        pendingCause: 'transport',
        failures: 2,
        detail: 'historical unresolved create; physical allocation remains unknown',
        outcome: 'uncertain',
        seq: Math.max(...previous.map((event) => event.seq)) + 1,
        at: new Date().toISOString(),
      }
      await journal.appendEvent(rootId, historical)
      const prefix = await readFile(join(fixture.directory, 'run', 'spawn-journal.jsonl'))
      await fixture.resume()
      await fixture.wait(
        'later historical-compatible invocation admitted',
        async () => intents(await fixture.events()).length >= 2,
      )
      await fixture.killCoordinator()
      const after = await fixture.events()
      expect(after).toContainEqual(historical)
      expect(
        after.filter((event) => event.kind === 'execution-input' && event.seq === input.seq),
      ).toEqual([input])
      expect(intents(after).at(-1)?.idempotencyKey).not.toBe(oldIdentity.idempotencyKey)
      expect(
        (await readFile(join(fixture.directory, 'run', 'spawn-journal.jsonl'))).subarray(
          0,
          prefix.length,
        ),
      ).toEqual(prefix)
      expect(
        (await fixture.state()).requests.filter(
          (row) => row.kind === 'cancel' || row.kind === 'delete',
        ),
      ).toHaveLength(0)
    })
  }, 45000)
})
