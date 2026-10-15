import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentEnvironmentProvider,
  AgentEnvironmentGetOptions,
  ProxySecretBinding,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, expect, it } from 'vitest'
import {
  assertRetainedRunReplayMaterial,
  reconnectRetainedRun,
  startRetainedRun,
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
const profile = testAgentProfile('retained-proxy')

it('rebinds a retained environment in place before continuing and preserves authored grants', async () => {
  const base = await fixture()
  let creates = 0
  const lookups: Array<AgentEnvironmentGetOptions | undefined> = []
  const provider: AgentEnvironmentProvider = {
    ...base,
    async create(input) { creates++; return base.create(input) },
    async get(id, options) { lookups.push(options); return base.get!(id, options) },
  }
  const authored: ProxySecretBinding = { ...binding,
    envName: 'UPSTREAM_TOKEN', secretRef: { kind: 'secret-ref', key: 'upstream-reference' },
    hosts: ['upstream.example'], paths: ['/request'],
  }
  const environment = {
    profile: { ...profile, proxySecrets: [authored] },
    proxySecrets: [binding], idempotencyKey: 'proxy-recovery',
  }
  const initial = await startRetainedRun({
    provider, environment, turn: { turnId: 'first-turn', prompt: 'first' },
    onAdmission: async () => {},
  })
  const original = await base.get!(initial.controlRef.environmentId)
  const generation = original!.proxySecretReceipt!.generation
  const reconnected = await reconnectRetainedRun({
    provider, controlRef: initial.controlRef, proxySecrets: [authored, binding],
  })
  expect(reconnected?.controlRef).toEqual(initial.controlRef)
  expect(lookups.at(-1)).toMatchObject({ requireInPlace: true, proxySecrets: [authored, binding] })
  expect((await base.get!(initial.controlRef.environmentId))!.proxySecretReceipt!.generation).toBeGreaterThan(generation)
  const continued = await startRetainedRun({
    provider, environment, existingEnvironmentId: initial.controlRef.environmentId,
    turn: { turnId: 'second-turn', prompt: 'continue' }, onAdmission: async () => {},
  })
  expect(continued.controlRef.environmentId).toBe(initial.controlRef.environmentId)
  expect(creates).toBe(1)
  expect((await base.get!(initial.controlRef.environmentId))!.proxySecretReceipt!.bindings.map((entry) => entry.envName))
    .toEqual(['UPSTREAM_TOKEN', 'AGENT_RUNTIME_COORDINATION_TOKEN'])
})

it('binds the complete proxy declaration into replay intent', async () => {
  const provider = await fixture()
  const admissions: RetainedRunAdmission[] = []
  const environment = { profile, proxySecrets: [binding], idempotencyKey: 'bound-proxy-intent' }
  const turn = { turnId: 'bound-turn', prompt: 'work' }
  await startRetainedRun({ provider, environment, turn,
    onAdmission: async (admission) => { admissions.push(admission) },
  })
  const intent = admissions.find((entry) => entry.phase === 'intent')!
  expect(() => assertRetainedRunReplayMaterial(provider, {
    environment: { ...environment, proxySecrets: [{ ...binding, secretRef: { kind: 'secret-ref', key: 'another-reference' } }] }, turn,
  }, intent)).toThrow('retained run intent conflicts with replay material')
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
            ...entry, secretRef: { kind: 'secret-ref', key: 'wrong-reference' },
          })),
        },
        async dispatch(turn) { dispatches++; return environment.dispatch!(turn) },
      }
    },
  }
  await expect(startRetainedRun({
    provider, environment: { profile, proxySecrets: [binding], idempotencyKey: 'wrong-receipt' },
    turn: { turnId: 'turn', prompt: 'work' }, onAdmission: async () => {},
  })).rejects.toThrow('did not confirm proxy-secret installation')
  expect(dispatches).toBe(0)
})

it('refuses an unacknowledged retained rebind before looking up its native session', async () => {
  const base = await fixture()
  const initial = await startRetainedRun({
    provider: base, environment: { profile, proxySecrets: [binding], idempotencyKey: 'missing-receipt' },
    turn: { turnId: 'turn', prompt: 'work' }, onAdmission: async () => {},
  })
  let sessions = 0
  const provider: AgentEnvironmentProvider = {
    ...base,
    async get(id, options) {
      const environment = await base.get!(id, options)
      if (!environment) return null
      return {
        ...environment, proxySecretReceipt: undefined,
        session(id) { sessions++; return environment.session!(id) },
      }
    },
  }
  await expect(reconnectRetainedRun({
    provider, controlRef: initial.controlRef, proxySecrets: [binding],
  })).rejects.toThrow('did not confirm proxy-secret installation')
  expect(sessions).toBe(0)
})
