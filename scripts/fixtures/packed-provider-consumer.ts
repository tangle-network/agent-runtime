import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import {
  agentProfileSchema,
  canonicalAgentProfileDigest,
  ProxySecretCapabilitiesSchema,
  ProxySecretReceiptSchema,
  ProxySecretsSchema,
  ContextTransferReceiptSchema,
  contextTransferReceiptMatches,
  createContextTransferRequest,
  portableConversationContextDigest,
  portableContextPlanDigest,
  type AgentProfile,
  type ContextTransferRequest,
  type ContextTransferReceipt,
  type PortableConversationContext,
  type PortableContextPlanMaterial,
} from '@tangle-network/agent-interface'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import {
  createCliBridgeProvider,
  defaultCliBridgeCapabilities,
} from '@tangle-network/agent-provider-cli-bridge'
import { createTangleProvider, defaultTangleSandboxCapabilities } from '@tangle-network/agent-provider-tangle'
import { createDaytonaProvider } from '@tangle-network/agent-provider-daytona'
import { createE2BProvider } from '@tangle-network/agent-provider-e2b'
import {
  createAgentEnvironmentProviderRegistry,
  resolveAgentEnvironmentProvider,
  assertProfileMaterializes,
  startRetainedRun,
  providerAsSandboxClient,
} from '@tangle-network/agent-runtime/kernel'
import { Sandbox } from '@tangle-network/sandbox'
import { assertProfileMaterializes as assertAgentProfileMaterializes } from '@tangle-network/agent-runtime/agent'

let fixtureStage = 'initial contract preparation'
let lastFixtureRequest = 'none'
const fixtureDeadline = setTimeout(() => {
  throw new Error('Packed provider fixture deadline: stage=' + fixtureStage + '; last_request=' + lastFixtureRequest)
}, 30_000)
fixtureDeadline.unref()

// Exercise public packed adapters with a bounded transport fixture, never a provider allocation.
const profile: AgentProfile = { name: 'packed-transfer', harness: 'codex' }
assert.deepEqual(assertProfileMaterializes(profile, 'codex', 'packed kernel consumer').unsupported, [])
assert.deepEqual(assertAgentProfileMaterializes(profile, 'codex', 'packed agent consumer').unsupported, [])
const sourceMaterial: Omit<PortableConversationContext, 'digest'> = {
  source: {
    provider: 'source-provider',
    environmentId: 'source-environment',
    sessionId: 'source-session',
    runId: 'source-run',
    executionId: 'source-execution',
    messageId: 'source-message',
    requestDigest: `sha256:${'a'.repeat(64)}`,
  },
  completeness: 'complete',
  messages: [
    {
      id: 'source-message',
      role: 'user',
      parts: [{ type: 'text', text: 'retain the approved context' }],
      timestamp: '2026-10-11T00:00:00.000Z',
    },
  ],
  attachments: [],
}
const source = { ...sourceMaterial, digest: portableConversationContextDigest(sourceMaterial) }
const material: PortableContextPlanMaterial = {
  planId: 'packed-provider-plan',
  source,
  context: source,
  destination: {
    provider: 'cli-bridge',
    runner: 'codex',
    sessionId: 'destination-session',
    runId: 'destination-run',
    executionId: 'destination-execution',
    profileDigest: canonicalAgentProfileDigest(profile),
  },
  messages: [
    {
      messageId: 'source-message',
      action: 'include',
      parts: [{ partIndex: 0, action: 'include' }],
    },
  ],
  requiresAcceptance: false,
}
const plan = { ...material, digest: portableContextPlanDigest(material) }
const transferMaterial = {
  operationId: 'packed-provider-transfer',
  plan,
  profile,
  acceptance: {
    planDigest: plan.digest,
    acceptedAt: '2026-10-11T00:01:00.000Z',
    acceptedBy: 'system' as const,
  },
}
const request: ContextTransferRequest = createContextTransferRequest(transferMaterial)
const receipt: ContextTransferReceipt = ContextTransferReceiptSchema.parse({
  status: 'accepted',
  operationId: request.operationId,
  requestDigest: request.requestDigest,
  planDigest: plan.digest,
  contextDigest: source.digest,
  source: source.source,
  destination: plan.destination,
  provider: 'cli-bridge',
  environmentId: 'provider-issued-environment',
  sessionId: plan.destination.sessionId,
  runId: plan.destination.runId,
  executionId: plan.destination.executionId,
  sessionCreatedForOperationId: request.operationId,
  sessionCreatedAt: '2026-10-11T00:01:01.000Z',
  admittedAt: '2026-10-11T00:01:02.000Z',
  transferredMessageIds: ['source-message'],
  omittedMessageIds: [],
})
assert.equal(request.plan.destination.environmentId, undefined)
assert.equal(contextTransferReceiptMatches(request, receipt), true)
assert.equal(
  contextTransferReceiptMatches(request, {
    ...receipt,
    environmentId: source.source.environmentId,
  }),
  false,
)
assert.throws(() => createContextTransferRequest({ ...transferMaterial, profile: undefined }))

const calls: string[] = []
let lookupCount = 0
let rejectLookupAt: number | undefined
const transport: typeof fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
  lastFixtureRequest = (options?.method ?? 'GET') + ' ' + url.pathname
  calls.push(`${options?.method ?? 'GET'} ${url.pathname}`)
  if (url.pathname === '/v1/chat/completions' && options?.method === 'POST') {
    const body = JSON.parse(String(options.body))
    assert.deepEqual(body.agent_profile, profile)
    assert.deepEqual(body.context_transfer, request)
    assert.equal(body.environment_id, receipt.environmentId)
    assert.equal(body.session_id, receipt.sessionId)
    assert.equal(body.execution_id, receipt.executionId)
    assert.equal(body.run_id, receipt.runId)
    return new Response('data: [DONE]\n\n', { headers: {
      'content-type': 'text/event-stream', 'x-run-id': receipt.runId,
      'x-run-provider': receipt.provider, 'x-run-environment-id': receipt.environmentId,
      'x-run-session-id': receipt.sessionId, 'x-run-execution-id': receipt.executionId,
      'x-run-request-digest': `sha256:${'e'.repeat(64)}`,
    } })
  }
  if (url.pathname === '/v1/context-transfers' && options?.method === 'POST') {
    assert.deepEqual(JSON.parse(String(options.body)), request)
    return Response.json(receipt)
  }
  if (url.pathname === `/v1/context-transfers/${request.operationId}`) {
    assert.equal(url.searchParams.get('request_digest'), request.requestDigest)
    lookupCount++
    return Response.json({ ...receipt, status: 'replayed',
      ...(lookupCount === rejectLookupAt ? { executionId: 'different-authoritative-execution' } : {}),
    })
  }
  if (url.pathname === `/v1/context-transfer-environments/${receipt.environmentId}`)
    return Response.json(receipt)
  if (url.pathname === '/v1/capabilities')
    return Response.json(defaultCliBridgeCapabilities('codex'))
  throw new Error(`unexpected fixture request ${url.pathname}`)
}
const local = () =>
  createCliBridgeProvider({
    baseUrl: 'https://packed-provider.invalid',
    defaultModel: 'codex',
    fetch: transport,
  })
const adapters: AgentEnvironmentProvider[] = [
  local(),
  createTangleProvider({
    client: new Sandbox({
      apiKey: 'fixture-not-a-key',
      baseUrl: 'https://packed-sandbox.invalid',
    }),
  }),
  createDaytonaProvider(),
  createE2BProvider(),
]
const registry = createAgentEnvironmentProviderRegistry(adapters)
assert.deepEqual(registry.names(), ['cli-bridge', 'daytona', 'e2b', 'tangle-sandbox'])
for (const adapter of adapters)
  assert.equal(resolveAgentEnvironmentProvider(adapter.name, registry), adapter)
const selected = registry.require(request.plan.destination.provider)
const capabilities = await registry.capabilities(selected.name)
assert.ok(capabilities.contextTransfer)
assert.equal(capabilities.contextTransfer.freshSession, true)
assert.equal(capabilities.contextTransfer.requestIdempotency, true)
assert.equal(capabilities.contextTransfer.lookup, true)
assert.ok(selected.contextTransfer)
fixtureStage = 'context transfer acceptance'
const accepted = await selected.contextTransfer.transfer(request)
if (accepted.status !== 'accepted' && accepted.status !== 'replayed')
  throw new Error(`fixture transfer was refused: ${accepted.status}`)
assert.equal(contextTransferReceiptMatches(request, accepted), true)

// Restart from serialized acceptance, then use the shared retained start with no allocation.
const resumed = createAgentEnvironmentProviderRegistry([local()])
const receiver = resumed.require(accepted.provider)
receiver.create = async () => { throw new Error('accepted attachment must never allocate') }
const admissions: string[] = []
fixtureStage = 'retained attachment and first dispatch'
const run = await startRetainedRun({ provider: receiver,
  environment: { profile, backend: 'codex', idempotencyKey: 'packed-product-admission' },
  turn: { prompt: 'first imported turn', turnId: 'packed-product-turn', contextTransfer: request },
  contextTransferReceipt: JSON.parse(JSON.stringify(accepted)),
  onAdmission: async admission => { admissions.push(admission.phase) },
})
assert.equal(run.controlRef.environmentId, accepted.environmentId)
assert.equal(run.controlRef.provider, accepted.provider)
assert.equal(run.controlRef.sessionId, accepted.sessionId)
assert.equal(run.controlRef.executionId, accepted.executionId)
assert.equal(run.controlRef.runId, accepted.runId)
assert.notEqual(run.controlRef.runId, 'packed-product-turn')
assert.deepEqual(admissions, ['intent', 'environment', 'dispatched'])
assert.deepEqual(calls.filter(call => !call.endsWith('/v1/capabilities')), [
  'POST /v1/context-transfers',
  `GET /v1/context-transfers/${request.operationId}`,
  // Attachment and first dispatch independently confirm the authoritative receipt.
  `GET /v1/context-transfers/${request.operationId}`,
  'POST /v1/chat/completions',
])
// A receipt that changes between attachment and dispatch must stop before model execution.
calls.length = 0
lookupCount = 0
rejectLookupAt = 2
const refusingReceiver = local()
refusingReceiver.create = async () => { throw new Error('refused attachment must never allocate') }
const refusedAdmissions: string[] = []
fixtureStage = 'changed dispatch receipt refusal'
await assert.rejects(startRetainedRun({ provider: refusingReceiver,
  environment: { profile, backend: 'codex', idempotencyKey: 'packed-refused-admission' },
  turn: { prompt: 'must not dispatch', turnId: 'packed-refused-turn', contextTransfer: request },
  contextTransferReceipt: JSON.parse(JSON.stringify(accepted)),
  onAdmission: async admission => { refusedAdmissions.push(admission.phase) },
}))
assert.deepEqual(refusedAdmissions, ['intent', 'environment'])
assert.deepEqual(calls.filter(call => !call.endsWith('/v1/capabilities')), [
  `GET /v1/context-transfers/${request.operationId}`,
  `GET /v1/context-transfers/${request.operationId}`,
])
assert.equal(lookupCount, 2)
// Exercise the actual Runtime -> Tangle provider -> installed SDK create path.
// Exact-origin HTTP proves reference transport and receipt admission, not
// production TLS, custody, placeholder injection, or model execution.
const sdkRequire = createRequire(createRequire(import.meta.url).resolve('@tangle-network/sandbox'))
const sdkInterface = await import(pathToFileURL(sdkRequire.resolve('@tangle-network/agent-interface')).href)
const proxySecrets = ProxySecretsSchema.parse([{
  envName: 'PACKED_SERVICE_TOKEN',
  secretRef: { kind: 'secret-ref', key: 'packed-service-reference' },
  hosts: ['service.packed.invalid'],
  presentation: { type: 'bearer' },
  methods: ['POST'],
  paths: ['/tasks'],
  ttlSeconds: 60,
}])
const fixtureModel = { provider: 'fixture', model: 'fixture/model' }
const protectedProfile = agentProfileSchema.parse({
  ...profile,
  model: { provider: ` ${fixtureModel.provider} `, default: ` ${fixtureModel.model} ` },
  proxySecrets,
})
const sdkProtectedProfile = sdkInterface.agentProfileSchema.safeParse(protectedProfile)
const sdkProxySchemaSupported = sdkProtectedProfile.success &&
  sdkProtectedProfile.data.proxySecrets !== undefined
if (sdkProxySchemaSupported) {
  assert.deepEqual(sdkProtectedProfile.data, protectedProfile)
  assert.equal(sdkInterface.canonicalAgentProfileDigest(protectedProfile), canonicalAgentProfileDigest(protectedProfile))
}
const proxyCapabilities = ProxySecretCapabilitiesSchema.parse({
  protocolVersion: 1,
  supportedDrivers: ['docker'],
  presentations: ['bearer'],
  placeholderFormats: ['opaque'],
  enforcement: 'exact',
  transports: ['https:443'],
  lifecycle: true,
  placementReceiptRequired: true,
})
const issuedAt = Date.now()
const proxyReceipt = ProxySecretReceiptSchema.parse({
  protocolVersion: 1,
  sandboxId: 'packed-proxy-environment',
  generation: 0,
  status: 'installed',
  proxyAcknowledged: true,
  materializationAcknowledged: true,
  bindings: proxySecrets.map(binding => ({
    envName: binding.envName,
    secretRef: binding.secretRef,
    grant: {
      protocolVersion: 1,
      grantId: 'packed-proxy-grant',
      sandboxId: 'packed-proxy-environment',
      epoch: 'packed-epoch',
      identity: { tenantId: 'packed-tenant', issuerId: 'packed-issuer', secretId: 'packed-secret', revision: 'packed-revision' },
      scope: { hosts: binding.hosts, methods: binding.methods, paths: binding.paths },
      presentation: binding.presentation,
      placeholderFormat: 'opaque',
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(issuedAt + 60_000).toISOString(),
    },
  })),
})
const proxySandboxInfo = {
  id: proxyReceipt.sandboxId,
  connection: {
    runtimeUrl: 'https://packed-sandbox.invalid/v1/sandboxes/' + proxyReceipt.sandboxId + '/runtime',
    edgeStatus: 'ready',
  },
  status: 'running',
  filesystemIncarnationId: 'packed-filesystem',
  filesystemIncarnationProvenance: 'fresh',
  filesystemIncarnationReadiness: 'ready',
}
const proxyCalls: string[] = []
let mismatchedLiveReceipt = false
let proxyReceiptReads = 0
const originalFetch = globalThis.fetch
try {
  globalThis.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
    assert.equal(url.origin, 'https://packed-sandbox.invalid')
    const method = options?.method ?? 'GET'
    proxyCalls.push(method + ' ' + url.pathname)
    lastFixtureRequest = method + ' ' + url.pathname
    if (url.pathname === '/v1/capabilities') return Response.json({ proxySecrets: proxyCapabilities })
    if (url.pathname === '/v1/sandboxes' && method === 'POST') {
      const body = JSON.parse(String(options?.body))
      assert.deepEqual(body.proxySecrets, proxySecrets)
      assert.deepEqual(body.backend.profile.proxySecrets, proxySecrets)
      assert.deepEqual(body.backend.profile.model, protectedProfile.model)
      for (const binding of proxySecrets) {
        assert.equal(Object.hasOwn(body.env ?? {}, binding.envName), false)
        assert.equal(Object.hasOwn(body.env ?? {}, binding.secretRef.key), false)
      }
      assert.deepEqual(body.secrets, [])
      return Response.json({
        ...proxySandboxInfo,
        createReceipt: { outcome: 'created', idempotencyKeyApplied: true, proxySecretReceipt: proxyReceipt },
        proxySecrets,
        proxySecretReceipt: proxyReceipt,
      })
    }
    if (url.pathname === '/v1/sandboxes/' + proxyReceipt.sandboxId && method === 'GET') {
      proxyReceiptReads += 1
      return Response.json({
        ...proxySandboxInfo,
        proxySecrets,
        proxySecretReceipt: mismatchedLiveReceipt
          ? { ...proxyReceipt, bindings: proxyReceipt.bindings.map(binding => ({ ...binding, secretRef: { kind: 'secret-ref', key: 'different-reference' } })) }
          : proxyReceipt,
      })
    }
    if (url.pathname === '/v1/sandboxes/' + proxyReceipt.sandboxId + '/runtime/capabilities') {
      return Response.json({
        schema: 1, agentInterface: 'fixture', sidecarVersion: 'fixture', image: 'fixture',
        dispatch: { runControlRef: true, executionIdOnAdmission: true },
        cancel: { canonicalRunCancellation: true, digestBound: true, idempotent: true },
        runs: { executionScopedStatus: true, eventReplay: true },
        interactions: {}, proxySecrets: proxyCapabilities,
      })
    }
    if (url.pathname === '/v1/sandboxes/' + proxyReceipt.sandboxId && method === 'DELETE') return new Response(null, { status: 204 })
    throw new Error('unexpected packed proxy fixture request ' + method + ' ' + url.pathname)
  }
  const sandboxProvider = createTangleProvider({
    client: new Sandbox({ apiKey: 'fixture-not-a-key', baseUrl: 'https://packed-sandbox.invalid' }),
    capabilities: { ...defaultTangleSandboxCapabilities('codex'), interactions: undefined, create: { proxySecrets: proxyCapabilities } },
  })
  const runtimeSandbox = providerAsSandboxClient(sandboxProvider)
  const createProtected = () => runtimeSandbox.create({
    backend: { type: 'codex', profile: protectedProfile, model: fixtureModel },
    proxySecrets,
  })
  if (sdkProxySchemaSupported) {
    fixtureStage = 'installed SDK proxy create'
    const created = await createProtected()
    assert.equal(created.id, proxyReceipt.sandboxId)
    assert.ok(proxyReceiptReads >= 2, 'provider must confirm live declarations and receipt')
    fixtureStage = 'live receipt mismatch refusal'
    mismatchedLiveReceipt = true
    await assert.rejects(createProtected(), /reference|receipt|custody/i)
    // Only an exact duplicate of the profile's model is portable. A different
    // selection or extra credential control must remain visible for refusal.
    fixtureStage = 'model selection and credential control refusals'
    for (const model of [
      { ...fixtureModel, model: 'fixture/different-model' },
      { ...fixtureModel, authMode: 'oauth' as const },
    ]) {
      const allocationsBefore = proxyCalls.filter(call => call === 'POST /v1/sandboxes').length
      await assert.rejects(runtimeSandbox.create({
        backend: { type: 'codex', profile: protectedProfile, model },
        proxySecrets,
      }), /providerOptions|unsupported/i)
      assert.equal(proxyCalls.filter(call => call === 'POST /v1/sandboxes').length, allocationsBefore)
    }
  } else {
    fixtureStage = 'unsupported SDK proxy refusal'
    await assert.rejects(createProtected())
    assert.equal(proxyCalls.some(call => call === 'POST /v1/sandboxes'), false)
  }
  assert.equal(proxyCalls.some(call => call.includes('/messages') || call.includes('/sessions')), false)
} finally {
  globalThis.fetch = originalFetch
}
clearTimeout(fixtureDeadline)
console.log(
  JSON.stringify({
    kind: 'packed-provider-consumer',
    registered: registry.names(),
    contextTransferExercised: ['cli-bridge'],
    sdkProxySchemaSupported,
    proxyReferenceAdapterCreateMatched: sdkProxySchemaSupported,
    mismatchedProxyReceiptRefused: sdkProxySchemaSupported,
    modelMismatchAndCredentialControlRefusedBeforeAllocation: sdkProxySchemaSupported,
    unsupportedSdkProxyRefusedBeforeAllocation: !sdkProxySchemaSupported,
    proxyReceiptReads,
    proofScope: 'public adapter transport fixture; no live receiver or provider allocation',
    providerIssuedEnvironment: run.controlRef.environmentId,
    retainedSession: run.controlRef.sessionId,
    receiptMatched: true,
    restartLookupMatched: true,
    authoritativeLookupCount: 2,
    firstDispatchMatched: true,
    changedDispatchReceiptRefusedBeforeModel: true,
    realAllocations: 0,
    realModelCalls: 0,
  }),
)
