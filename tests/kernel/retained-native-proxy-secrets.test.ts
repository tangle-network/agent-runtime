import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  NativeContextContinuationRequestSchema,
  nativeContextContinuationRequestDigest,
  nativeContextContinuationTurnDigest,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
  ProxySecretBinding,
  ProxySecretReceipt,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, expect, it } from 'vitest'
import { reconnectRetainedRun, startRetainedRun } from '../../src/runtime/retained-run-start'
import type { RetainedRunHandle } from '../../src/runtime/retained-run-types'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { proxySecretCapabilities } from '../helpers/proxy-coordination'
import { testAgentProfile } from './test-agent-profile'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const binding: ProxySecretBinding = {
  envName: 'SERVICE_TOKEN',
  secretRef: { kind: 'secret-ref', key: 'native-service' },
  hosts: ['service.example.test'],
  presentation: { type: 'bearer' },
  methods: ['GET'],
  paths: ['/result'],
  ttlSeconds: 60,
}
type InvalidCustody = 'expired' | 'revoked' | 'missing' | 'different-reference'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'native-proxy-'))
  roots.push(root)
  const base = durableRetainedProvider(join(root, 'provider.json'))
  let receipt: ProxySecretReceipt | undefined
  let nativeCalls = 0
  let expireOnControlRead = false
  function invalidate(reason: InvalidCustody) {
    if (!receipt) throw new Error('fixture receipt is unavailable')
    if (reason === 'missing') receipt = undefined
    else if (reason === 'revoked')
      receipt = { ...receipt, status: 'revoked', materializationAcknowledged: true, bindings: [] }
    else
      receipt = {
        ...receipt,
        bindings: receipt.bindings.map((entry) =>
          reason === 'expired'
            ? {
                ...entry,
                grant: {
                  ...entry.grant,
                  issuedAt: new Date(Date.now() - 2_000).toISOString(),
                  expiresAt: new Date(Date.now() - 1_000).toISOString(),
                },
              }
            : { ...entry, secretRef: { kind: 'secret-ref', key: 'different-service' } },
        ),
      }
  }
  function wrap(environment: AgentEnvironment): AgentEnvironment {
    return {
      ...environment,
      get proxySecretReceipt() {
        return receipt
      },
      session(id, options) {
        const session = environment.session!(id, options)
        return {
          ...session,
          get controlRef() {
            if (expireOnControlRead) {
              expireOnControlRead = false
              invalidate('expired')
            }
            return session.controlRef
          },
          async continueNative(request, continuation) {
            nativeCalls++
            const result = await session.continueNative!(request, continuation)
            if (result.controlRef) continuation.onAdmission?.(result.controlRef)
            return result
          },
        }
      },
    }
  }
  const provider: AgentEnvironmentProvider = {
    ...base,
    async capabilities() {
      const capabilities = await base.capabilities()
      return {
        ...capabilities,
        create: { ...capabilities.create, proxySecrets: proxySecretCapabilities },
        nativeContinuation: {
          atomicBoundary: true,
          requestIdempotency: true,
          admissionControl: true,
        },
      }
    },
    async create(input) {
      const environment = await base.create(input)
      receipt = environment.proxySecretReceipt
      return wrap(environment)
    },
    async get(id, options) {
      const environment = await base.get!(id, options)
      if (!environment) return null
      if (options?.proxySecrets !== undefined) receipt = environment.proxySecretReceipt
      return wrap(environment)
    },
  }
  const handle = await startRetainedRun({
    provider,
    environment: {
      profile: testAgentProfile('native-proxy'),
      proxySecrets: [binding],
      idempotencyKey: 'native-proxy',
    },
    turn: { turnId: 'initial', prompt: 'start' },
    onAdmission: async () => {},
  })
  return {
    provider,
    handle,
    invalidate,
    nativeCalls: () => nativeCalls,
    expireDuringValidation: () => {
      expireOnControlRead = true
    },
  }
}
async function continuation(handle: RetainedRunHandle) {
  const turn = { prompt: 'continue in the same native session' }
  const boundary = await handle.contextBoundary()
  if (!boundary) throw new Error('fixture native boundary is unavailable')
  const material = {
    operationId: 'native-proxy-continuation',
    run: handle.controlRef,
    expectedBoundary: boundary,
    turnDigest: nativeContextContinuationTurnDigest(turn),
  }
  const request = NativeContextContinuationRequestSchema.parse({
    ...material,
    requestDigest: nativeContextContinuationRequestDigest(material),
  })
  return { request, turn }
}

it.each(['expired', 'revoked', 'missing', 'different-reference'] as const)(
  'refuses a held native handle with %s custody before provider continuation',
  async (reason) => {
    for (const entry of ['continueNative', 'beginNativeContinuation'] as const) {
      const current = await fixture()
      const { request, turn } = await continuation(current.handle)
      current.invalidate(reason)
      const pending =
        entry === 'continueNative'
          ? current.handle.continueNative(request, turn)
          : current.handle.beginNativeContinuation(request, turn).result
      await expect(pending).rejects.toThrow(/proxy-secret/)
      expect(current.nativeCalls()).toBe(0)
    }
  },
)

it('checks custody after native request validation immediately before provider dispatch', async () => {
  const current = await fixture()
  const { request, turn } = await continuation(current.handle)
  current.expireDuringValidation()
  await expect(current.handle.continueNative(request, turn)).rejects.toThrow(/proxy-secret/)
  expect(current.nativeCalls()).toBe(0)
})

it('continues the same native session after checked in-place rebinding returns a fresh handle', async () => {
  const current = await fixture()
  current.invalidate('revoked')
  const handle = await reconnectRetainedRun({
    provider: current.provider,
    controlRef: current.handle.controlRef,
    proxySecrets: [binding],
  })
  if (!handle) throw new Error('retained environment disappeared')
  expect(handle.controlRef).toEqual(current.handle.controlRef)
  const { request, turn } = await continuation(handle)
  const result = await handle.continueNative(request, turn)
  expect(result.acknowledgement.status).toBe('accepted')
  expect(result.controlRef?.environmentId).toBe(current.handle.controlRef.environmentId)
  expect(result.controlRef?.sessionId).toBe(current.handle.controlRef.sessionId)
  expect(current.nativeCalls()).toBe(1)
})
