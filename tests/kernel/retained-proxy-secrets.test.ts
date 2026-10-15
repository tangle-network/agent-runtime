import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentEnvironmentGetOptions,
  AgentEnvironmentProvider,
  ProxySecretBinding,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, expect, it } from 'vitest'
import { providerAsExecutor } from '../../src/runtime/environment-provider'
import {
  assertRetainedRunReplayMaterial,
  mintRetainedIdentity,
  reconnectRetainedRun,
  startRetainedRun,
  startRetainedRunInEnvironment,
} from '../../src/runtime/retained-run-start'
import type { RetainedRunAdmission } from '../../src/runtime/retained-run-types'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { testAgentProfile } from './test-agent-profile'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'retained-proxy-'))
  roots.push(root)
  return durableRetainedProvider(join(root, 'provider.json'))
}
const binding: ProxySecretBinding = {
  envName: 'AGENT_RUNTIME_COORDINATION_TOKEN',
  secretRef: { kind: 'secret-ref', key: 'actor-reference' },
  hosts: ['coordination.example'],
  presentation: { type: 'bearer' },
  methods: ['POST'],
  paths: ['/manager'],
  ttlSeconds: 60,
}
const rootParents = { [binding.envName]: null }
const profile = testAgentProfile('retained-proxy')

it('rebinds a retained environment in place before continuing and preserves authored grants', async () => {
  const base = await fixture()
  let creates = 0
  const lookups: Array<AgentEnvironmentGetOptions | undefined> = []
  const provider: AgentEnvironmentProvider = {
    ...base,
    async create(input) {
      creates++
      return base.create(input)
    },
    async get(id, options) {
      lookups.push(options)
      return base.get!(id, options)
    },
  }
  const authored: ProxySecretBinding = {
    ...binding,
    envName: 'UPSTREAM_TOKEN',
    secretRef: { kind: 'secret-ref', key: 'upstream-reference' },
    hosts: ['upstream.example'],
    paths: ['/request'],
  }
  const parents = { [authored.envName]: null, [binding.envName]: null }
  const environment = {
    profile: { ...profile, proxySecrets: [authored] },
    proxySecrets: [binding],
    idempotencyKey: 'proxy-recovery',
  }
  const initial = await startRetainedRun({
    proxySecretParents: parents,
    provider,
    environment,
    turn: { turnId: 'first-turn', prompt: 'first' },
    onAdmission: async () => {},
  })
  const original = await base.get!(initial.controlRef.environmentId)
  const generation = original!.proxySecretReceipt!.generation
  const reconnected = await reconnectRetainedRun({
    proxySecretParents: parents,
    provider,
    controlRef: initial.controlRef,
    proxySecrets: [authored, binding],
  })
  expect(reconnected?.controlRef).toEqual(initial.controlRef)
  expect(lookups.at(-1)).toMatchObject({
    requireInPlace: true,
    proxySecrets: [authored, binding],
    proxySecretParents: parents,
  })
  expect(
    (await base.get!(initial.controlRef.environmentId))!.proxySecretReceipt!.generation,
  ).toBeGreaterThan(generation)
  const continued = await startRetainedRun({
    proxySecretParents: parents,
    provider,
    environment,
    existingEnvironmentId: initial.controlRef.environmentId,
    identity: {
      sessionId: initial.controlRef.sessionId,
      executionId: mintRetainedIdentity(environment.idempotencyKey, 'second-turn').executionId,
    },
    turn: { turnId: 'second-turn', prompt: 'continue' },
    onAdmission: async () => {},
  })
  expect(continued.controlRef.environmentId).toBe(initial.controlRef.environmentId)
  expect(continued.controlRef.sessionId).toBe(initial.controlRef.sessionId)
  expect(continued.controlRef.executionId).not.toBe(initial.controlRef.executionId)
  expect(creates).toBe(1)
  expect(
    (await base.get!(initial.controlRef.environmentId))!.proxySecretReceipt!.bindings.map(
      (entry) => entry.envName,
    ),
  ).toEqual(['UPSTREAM_TOKEN', 'AGENT_RUNTIME_COORDINATION_TOKEN'])
})

it('binds the complete proxy declaration into replay intent', async () => {
  const provider = await fixture()
  const admissions: RetainedRunAdmission[] = []
  const environment = { profile, proxySecrets: [binding], idempotencyKey: 'bound-proxy-intent' }
  const turn = { turnId: 'bound-turn', prompt: 'work' }
  await startRetainedRun({
    proxySecretParents: rootParents,
    provider,
    environment,
    turn,
    onAdmission: async (admission) => {
      admissions.push(admission)
    },
  })
  const intent = admissions.find((entry) => entry.phase === 'intent')!
  expect(() =>
    assertRetainedRunReplayMaterial(
      provider,
      {
        proxySecretParents: rootParents,
        environment: {
          ...environment,
          proxySecrets: [
            { ...binding, secretRef: { kind: 'secret-ref', key: 'another-reference' } },
          ],
        },
        turn,
      },
      intent,
    ),
  ).toThrow('retained run intent conflicts with replay material')
})

it('refuses a differently bound fresh receipt before native dispatch', async () => {
  const base = await fixture()
  let dispatches = 0
  const provider: AgentEnvironmentProvider = {
    ...base,
    async create(input) {
      const environment = await base.create(input)
      return {
        ...environment,
        proxySecretReceipt: {
          ...environment.proxySecretReceipt!,
          bindings: environment.proxySecretReceipt!.bindings.map((entry) => ({
            ...entry,
            secretRef: { kind: 'secret-ref' as const, key: 'wrong-reference' },
          })),
        },
        async dispatch(turn) {
          dispatches++
          return environment.dispatch!(turn)
        },
      }
    },
  }
  await expect(
    startRetainedRun({
      proxySecretParents: rootParents,
      provider,
      environment: { profile, proxySecrets: [binding], idempotencyKey: 'wrong-receipt' },
      turn: { turnId: 'turn', prompt: 'work' },
      onAdmission: async () => {},
    }),
  ).rejects.toThrow('did not confirm proxy-secret installation')
  expect(dispatches).toBe(0)
})

it('verifies original identity but refuses native reattachment after an unacknowledged rebind', async () => {
  const base = await fixture()
  const initial = await startRetainedRun({
    proxySecretParents: rootParents,
    provider: base,
    environment: { profile, proxySecrets: [binding], idempotencyKey: 'missing-receipt' },
    turn: { turnId: 'turn', prompt: 'work' },
    onAdmission: async () => {},
  })
  let sessions = 0
  let ownershipChecks = 0
  const provider: AgentEnvironmentProvider = {
    ...base,
    async get(id, options) {
      const environment = await base.get!(id, options)
      if (!environment) return null
      return {
        ...environment,
        proxySecretReceipt: undefined,
        session(id) {
          if (options?.proxySecrets === undefined) ownershipChecks++
          else sessions++
          return environment.session!(id)
        },
      }
    },
  }
  await expect(
    reconnectRetainedRun({
      proxySecretParents: rootParents,
      provider,
      controlRef: initial.controlRef,
      proxySecrets: [binding],
    }),
  ).rejects.toThrow('did not confirm proxy-secret installation')
  expect(ownershipChecks).toBe(1)
  expect(sessions).toBe(0)
})

it.each(['created', 'replayed', undefined] as const)(
  'cleans only a proven fresh allocation after nonretained receipt refusal, creation=%s',
  async (creation) => {
    const base = await fixture()
    let streams = 0
    let destroys = 0
    const provider: AgentEnvironmentProvider = {
      name: base.name,
      capabilities: base.capabilities,
      async create() {
        return {
          id: 'bad-materialization',
          provider: base.name,
          creation,
          status: async () => 'running',
          async *stream() {
            streams++
            yield { type: 'done', data: { finalText: 'must not run' } }
          },
          async destroy() {
            destroys++
          },
        }
      },
    }
    const signal = new AbortController().signal
    const executor = providerAsExecutor(provider, { defaults: { proxySecrets: [binding] } })(
      { profile, harness: null },
      { signal, seams: { 'runtime.proxySecretParents': rootParents } },
    )
    await expect(
      (async () => {
        const execution = executor.execute('work', signal)
        if (!(Symbol.asyncIterator in execution)) throw new Error('expected streamed execution')
        for await (const _event of execution) {
          /* consume the public execution boundary */
        }
      })(),
    ).rejects.toThrow('did not confirm proxy-secret installation')
    expect(streams).toBe(0)
    expect(destroys).toBe(creation === 'created' ? 1 : 0)
  },
)

it('preserves original and cleanup errors when a fresh refused allocation has no destroy operation', async () => {
  const base = await fixture()
  const provider: AgentEnvironmentProvider = {
    name: base.name,
    capabilities: base.capabilities,
    async create() {
      return {
        id: 'missing-destroy',
        provider: base.name,
        creation: 'created',
        status: async () => 'running',
        async *stream() {
          yield* []
        },
      }
    },
  }
  const signal = new AbortController().signal
  const executor = providerAsExecutor(provider, { defaults: { proxySecrets: [binding] } })(
    { profile, harness: null },
    { signal, seams: { 'runtime.proxySecretParents': rootParents } },
  )
  let error: unknown
  try {
    const execution = executor.execute('work', signal)
    if (!(Symbol.asyncIterator in execution)) throw new Error('expected streamed execution')
    for await (const _event of execution) {
      /* consume */
    }
  } catch (received) {
    error = received
  }
  expect(error).toBeInstanceOf(AggregateError)
  expect((error as AggregateError).errors).toHaveLength(2)
})

it('refuses omitted references on expired custody before a fresh retained native dispatch, then renews in place', async () => {
  const base = await fixture()
  const environment = { profile, proxySecrets: [binding], idempotencyKey: 'expired-omission' }
  const initial = await startRetainedRun({
    proxySecretParents: rootParents,
    provider: base,
    environment,
    turn: { turnId: 'first', prompt: 'first' },
    onAdmission: async () => {},
  })
  let dispatches = 0
  const provider: AgentEnvironmentProvider = {
    ...base,
    async get(id, options) {
      const current = await base.get!(id, options)
      if (!current) return null
      const stale =
        options?.proxySecrets === undefined
          ? {
              ...current.proxySecretReceipt!,
              bindings: current.proxySecretReceipt!.bindings.map((entry) => ({
                ...entry,
                grant: {
                  ...entry.grant,
                  issuedAt: '2020-01-01T00:00:00.000Z',
                  expiresAt: '2020-01-01T00:00:01.000Z',
                },
              })),
            }
          : current.proxySecretReceipt
      return {
        ...current,
        proxySecretReceipt: stale,
        async dispatch(turn) {
          dispatches++
          return current.dispatch!(turn)
        },
      }
    },
  }
  const next = {
    provider,
    environment: {
      id: initial.controlRef.environmentId,
      idempotencyKey: environment.idempotencyKey,
    },
    turn: { turnId: 'second', prompt: 'next' },
    onAdmission: async () => {},
  }
  await expect(startRetainedRunInEnvironment(next)).rejects.toThrow('stale or unconfirmed')
  expect(dispatches).toBe(0)
  const renewed = await startRetainedRunInEnvironment({
    ...next,
    proxySecrets: [binding],
    proxySecretParents: rootParents,
  })
  expect(renewed.controlRef.environmentId).toBe(initial.controlRef.environmentId)
  expect(dispatches).toBe(1)
})

it('checks retained ownership before replacing another logical run bindings', async () => {
  const base = await fixture()
  const initial = await startRetainedRun({
    proxySecretParents: rootParents,
    provider: base,
    environment: { profile, proxySecrets: [binding], idempotencyKey: 'owned-environment' },
    turn: { turnId: 'first', prompt: 'first' },
    onAdmission: async () => {},
  })
  let updates = 0
  const provider: AgentEnvironmentProvider = {
    ...base,
    async get(id, options) {
      if (options?.proxySecrets !== undefined) updates++
      return base.get!(id, options)
    },
  }
  await expect(
    startRetainedRun({
      proxySecretParents: rootParents,
      provider,
      environment: { profile, proxySecrets: [binding], idempotencyKey: 'different-logical-owner' },
      existingEnvironmentId: initial.controlRef.environmentId,
      turn: { turnId: 'forged', prompt: 'must refuse' },
      onAdmission: async () => {},
    }),
  ).rejects.toThrow('retained idempotency key')
  expect(updates).toBe(0)
})

it.each(['installed', 'revoked'] as const)(
  'accepts a fresh explicit empty selection receipt status=%s',
  async (status) => {
    const base = await fixture()
    const provider: AgentEnvironmentProvider = {
      ...base,
      async create(input) {
        const environment = await base.create(input)
        return {
          ...environment,
          proxySecretReceipt: {
            ...environment.proxySecretReceipt!,
            status,
            materializationAcknowledged: true as const,
          },
        }
      },
    }
    const handle = await startRetainedRun({
      proxySecretParents: {},
      provider,
      environment: { profile, proxySecrets: [], idempotencyKey: `empty-${status}` },
      turn: { turnId: 'first', prompt: 'work' },
      onAdmission: async () => {},
    })
    expect(handle.controlRef.environmentId).toBe(`environment-empty-${status}`)
  },
)
