import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import {
  agentCandidateProfileAsAgentProfile,
  buildAgentCandidateBundle,
  freezeGenericAgentCandidateProfile,
  verifyAgentCandidateBundle,
} from '@tangle-network/agent-runtime/candidate-execution'
import { providerAsSandboxClient, startRetainedRun } from '@tangle-network/agent-runtime/kernel'
import { Sandbox } from '@tangle-network/sandbox'

const mode = process.argv[2]
const profile = {
  name: 'binding-http',
  harness: 'opencode',
  model: { provider: 'openai', default: 'fixture-model' },
}
const creates = [],
  requests = []
let baseUrl = '',
  metadata
const info = () => ({
  id: 'sandbox-bindings',
  status: 'running',
  createdAt: new Date(0).toISOString(),
  metadata,
  filesystemIncarnationId: '11111111-1111-4111-8111-111111111111',
  filesystemIncarnationProvenance: 'fresh',
  filesystemIncarnationReadiness: 'ready',
  connection: {
    runtimeUrl: `${baseUrl}/runtime`,
    authToken: 'fixture-runtime-token',
    edgeStatus: 'ready',
  },
})
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://fixture').pathname
  requests.push(`${request.method} ${path}`)
  response.setHeader('content-type', 'application/json')
  if (path === '/v1/backends')
    return response.end(
      JSON.stringify({
        timestamp: new Date(0).toISOString(),
        backends: [
          {
            type: 'opencode',
            name: 'opencode',
            description: 'Actual HTTP protocol fixture; no model',
            callerCredentialOnly: false,
            capabilities: {
              streaming: true,
              toolUse: true,
              reasoning: false,
              multimodal: false,
              imageInput: false,
              contextWindow: 100000,
              mcp: true,
              runtimeAttachments: { mcp: true },
              sessions: true,
              configurable: true,
              interactions: [],
            },
          },
        ],
      }),
    )
  if (path === '/v1/sandboxes' && request.method === 'POST') {
    const chunks = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString())
    creates.push(body)
    metadata = body.metadata
    return response.end(JSON.stringify(info()))
  }
  if (path === '/v1/sandboxes/sandbox-bindings') return response.end(JSON.stringify(info()))
  if (path.endsWith('/capabilities'))
    return response.end(
      JSON.stringify({
        schema: 1,
        agentInterface: '0.49.0',
        sidecarVersion: '1.0.0-test',
        image: 'fixture',
        dispatch: { runControlRef: false, executionIdOnAdmission: false },
        cancel: { canonicalRunCancellation: false, digestBound: false, idempotent: false },
        runs: { executionScopedStatus: false, eventReplay: false },
        interactions: { responseDedupe: false },
      }),
    )
  response.writeHead(404)
  response.end(
    JSON.stringify({ code: 'NOT_FOUND', message: 'No custody receipt protocol is served' }),
  )
})
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
  const provider = createTangleProvider({
    client: new Sandbox({
      apiKey: 'fixture-api-key',
      baseUrl,
      platformUrl: baseUrl,
      trustLocalCliAuth: false,
      directExec: false,
    }),
  })
  if (mode === 'selectors') {
    const binding = {
      envName: 'REPORTS_ALIAS',
      secretRef: { kind: 'secret-ref', key: 'REPORTS_TOKEN' },
      hosts: ['reports.example.com', 'backup.example.com'],
      methods: ['GET', 'POST'],
      paths: ['/v1/reports/*'],
      presentation: { type: 'query', name: 'api_key' },
      placeholderFormat: 'jwt',
      ttlSeconds: 60,
    }
    const declaration = {
      envName: 'PROFILE_TOKEN',
      secretRef: { kind: 'secret-ref', key: 'PROFILE_TOKEN' },
      hosts: ['profile.example.com'],
      presentation: { type: 'basic', username: 'reader' },
    }
    const converted = freezeGenericAgentCandidateProfile({
      ...profile,
      proxySecrets: [declaration],
    })
    assert.deepEqual(converted.proxySecrets, [declaration])
    assert.deepEqual(agentCandidateProfileAsAgentProfile(converted).proxySecrets, [declaration])
    await providerAsSandboxClient(provider).create({
      backend: { type: 'opencode', profile: { ...profile, proxySecrets: [declaration] } },
      proxySecrets: [binding],
    })
    assert.equal(creates[0].proxySecrets.length, 2)
    for (const expected of [declaration, binding])
      assert.deepEqual(
        creates[0].proxySecrets.find((entry) => entry.envName === expected.envName),
        expected,
      )
    assert.deepEqual(creates[0].secrets, [])
    for (const secrets of [
      ['BARE_NAME'],
      [{ name: 'HOST_NAME', host: 'legacy.example.com' }],
      [{ name: 'RAW_NAME', exposeInBox: true }],
      'all',
    ]) {
      await providerAsSandboxClient(provider).create({
        backend: { type: 'opencode', profile },
        secrets,
        metadata: { reason: 'fixture legacy customer consent' },
      })
      assert.deepEqual(creates.at(-1).secrets, secrets)
    }
    await providerAsSandboxClient(provider, {
      mapCreateOptions: () => ({ proxySecrets: undefined }),
    }).create({ backend: { type: 'opencode', profile }, proxySecrets: [] })
    assert.deepEqual(creates.at(-1).proxySecrets, [])
    console.log(
      JSON.stringify({
        selectorsPreserved: true,
        canonicalDeclarationPreserved: true,
        candidateRoundTripPreserved: true,
        fullSchemaPreserved: true,
        legacyDeliveryPreserved: true,
      }),
    )
  } else if (mode === 'mappers') {
    const binding = {
      envName: 'TOKEN',
      secretRef: { kind: 'secret-ref', key: 'TOKEN' },
      hosts: ['reports.example.com'],
      presentation: { type: 'bearer' },
    }
    const changes = [
      { hosts: ['other.example.com'] },
      { methods: ['POST'] },
      { paths: ['/other'] },
      { secretRef: { kind: 'secret-ref', key: 'OTHER' } },
      { presentation: { type: 'header', name: 'X-Api-Key' } },
      { placeholderFormat: 'jwt' },
      { ttlSeconds: 2 },
    ]
    for (const change of changes) {
      const client = providerAsSandboxClient(provider, {
        mapCreateOptions: () => ({ proxySecrets: [{ ...binding, ...change }] }),
      })
      await assert.rejects(
        client.create({ backend: { type: 'opencode', profile }, proxySecrets: [binding] }),
        /declarations disagree/,
      )
    }
    const mutate = providerAsSandboxClient(provider, {
      mapCreateOptions: (options) => {
        options.proxySecrets[0].hosts[0] = 'other.example.com'
        return {}
      },
    })
    await assert.rejects(
      mutate.create({
        backend: { type: 'opencode', profile },
        proxySecrets: [structuredClone(binding)],
      }),
      /declarations disagree/,
    )
    const defaults = providerAsSandboxClient(provider, {
      defaults: { proxySecrets: [binding] },
      mapCreateOptions: () => ({ proxySecrets: [{ ...binding, hosts: ['other.example.com'] }] }),
    })
    await assert.rejects(
      defaults.create({ backend: { type: 'opencode', profile } }),
      /declarations disagree/,
    )
    const all = providerAsSandboxClient(provider, {
      mapCreateOptions: () => ({ secrets: [] }),
    })
    await assert.rejects(
      all.create({ backend: { type: 'opencode', profile }, secrets: 'all' }),
      /changed all stored-secret selection/,
    )
    for (const secrets of [
      ['TOKEN'],
      [{ name: 'TOKEN', host: 'other.example.com' }],
      [{ name: 'TOKEN', exposeInBox: true }],
    ]) {
      await assert.rejects(
        providerAsSandboxClient(provider, { mapCreateOptions: () => ({ secrets }) }).create({
          backend: { type: 'opencode', profile },
          secrets: [{ name: 'TOKEN', host: 'reports.example.com' }],
        }),
        /changed a stored host binding/,
      )
    }
    assert.equal(creates.length, 0)
    for (const proxySecrets of [undefined, []]) {
      await providerAsSandboxClient(provider, {
        mapCreateOptions: () => ({ proxySecrets }),
      }).create({ backend: { type: 'opencode', profile }, proxySecrets: [binding] })
      assert.deepEqual(creates.at(-1).proxySecrets, [binding])
    }
    let queuedMutationRan = false
    const queued = providerAsSandboxClient(provider, {
      defaults: {
        runtimeAttachments: { mcp: { boundary: { transport: 'http', url: `${baseUrl}/mcp` } } },
      },
      mapCreateOptions: (options) => {
        queueMicrotask(() => {
          options.proxySecrets[0].hosts[0] = 'other.example.com'
          options.backend.profile.proxySecrets[0].hosts[0] = 'other.example.com'
          queuedMutationRan = true
        })
        return {}
      },
    })
    await queued.create({
      backend: {
        type: 'opencode',
        profile: { ...profile, proxySecrets: [structuredClone(binding)] },
      },
      proxySecrets: [structuredClone(binding)],
    })
    assert.equal(queuedMutationRan, true)
    assert.deepEqual(creates.at(-1).proxySecrets, [binding])
    for (const mutate of [false, true]) {
      const client = providerAsSandboxClient(provider, {
        mapCreateOptions: (options) => {
          if (mutate) options.backend.profile.proxySecrets.length = 0
          return { profile }
        },
      })
      await client.create({
        backend: {
          type: 'opencode',
          profile: { ...profile, proxySecrets: [structuredClone(binding)] },
        },
      })
      assert.deepEqual(creates.at(-1).proxySecrets, [binding])
    }
    await providerAsSandboxClient(provider, {
      mapCreateOptions: () => ({ secrets: ['LEGACY_TARGET'] }),
    }).create({ backend: { type: 'opencode', profile }, secrets: ['LEGACY_SOURCE'] })
    assert.deepEqual(creates.at(-1).secrets, ['LEGACY_TARGET'])
    console.log(
      JSON.stringify({
        deniedBeforeCreate: 13,
        authoredCustodyPreserved: 2,
        legacyTranslationPreserved: true,
        canonicalDeclarationsPreserved: 2,
        asyncAliasDetached: true,
      }),
    )
  } else if (mode === 'identity') {
    const capture = async (secrets, proxySecrets) => {
      let intent
      try {
        await startRetainedRun({
          provider,
          environment: {
            profile: 'custody-public-profile',
            secrets,
            proxySecrets,
            idempotencyKey: 'legacy-secret-identity',
          },
          identity: { sessionId: 'identity-session', executionId: 'identity-execution' },
          turn: { prompt: 'public identity only', turnId: 'identity-turn' },
          onAdmission: async (admission) => {
            intent = admission
            throw new Error('durability boundary intentionally held')
          },
        })
      } catch {}
      assert.equal(intent?.phase, 'intent')
      return intent
    }
    const ordered = await capture(['Z_TOKEN', 'A_TOKEN']),
      reversed = await capture(['A_TOKEN', 'Z_TOKEN'])
    assert.equal(ordered.requestDigest, reversed.requestDigest)
    const historicalWireIdentity = {
      kind: 'retained-run-intent.v1',
      provider: provider.name,
      idempotencyKey: 'legacy-secret-identity',
      turnId: 'identity-turn',
      sessionId: 'identity-session',
      executionId: 'identity-execution',
      requestedProfileDigest: canonicalCandidateDigest('custody-public-profile'),
      create: { secretNames: ['A_TOKEN', 'Z_TOKEN'] },
      turn: { prompt: 'public identity only' },
    }
    assert.equal(ordered.requestDigest, canonicalCandidateDigest(historicalWireIdentity))
    const allSelection = await capture('all')
    assert.equal(
      allSelection.requestDigest,
      canonicalCandidateDigest({
        ...historicalWireIdentity,
        create: { secretNames: 'all' },
      }),
    )
    const legacyHost = { name: 'TOKEN', host: 'first.example.com' }
    const legacyIntent = await capture([legacyHost])
    for (const change of [{ host: 'other.example.com' }, { header: 'X-Api-Key' }])
      assert.notEqual(
        legacyIntent.requestDigest,
        (await capture([{ ...legacyHost, ...change }])).requestDigest,
      )
    const portable = {
      envName: 'TOKEN',
      secretRef: { kind: 'secret-ref', key: 'TOKEN' },
      hosts: ['first.example.com'],
      presentation: { type: 'bearer' },
    }
    const first = await capture(undefined, [portable])
    for (const changed of [
      { hosts: ['next.example.com'] },
      { methods: ['POST'] },
      { paths: ['/other'] },
      { presentation: { type: 'header', name: 'X-Api-Key' } },
      { presentation: { type: 'query', name: 'api_key' } },
      { placeholderFormat: 'jwt' },
      { ttlSeconds: 60 },
      { envName: 'ALIAS' },
      { secretRef: { kind: 'secret-ref', key: 'OTHER' } },
    ])
      assert.notEqual(
        first.requestDigest,
        (await capture(undefined, [{ ...portable, ...changed }])).requestDigest,
      )
    assert.equal(requests.length, 0)
    console.log(
      JSON.stringify({
        stringSelectionOrderStable: true,
        legacyWireIdentityPreserved: true,
        hostChangesIdentity: true,
        headerChangesIdentity: true,
        canonicalScopeChangesIdentity: true,
      }),
    )
  } else if (mode === 'raw-candidate') {
    const declaration = {
      envName: 'TOKEN',
      secretRef: { kind: 'secret-ref', key: 'TOKEN' },
      hosts: ['reports.example.com'],
      presentation: { type: 'bearer' },
    }
    const bundle = buildAgentCandidateBundle({
      profile: { kind: 'profile', profile: { ...profile, proxySecrets: [declaration] } },
      code: { kind: 'disabled' },
      memory: { mode: 'disabled' },
      execution: {
        harness: 'opencode',
        harnessVersion: '1.2.3',
        launch: { kind: 'container-command', executable: 'opencode' },
        instructionDelivery: { kind: 'stdin-utf8' },
        cwd: { workspace: 'task', path: '.' },
        env: { PATH: { kind: 'public', value: '/usr/local/bin:/usr/bin:/bin' } },
        environment: { kind: 'evaluator-task-container' },
        isolation: {
          network: 'disabled',
          remoteIntegrations: 'disabled',
          candidateSecrets: 'disabled',
        },
      },
    })
    await assert.rejects(verifyAgentCandidateBundle(bundle, {}), /proxySecrets/)
    assert.equal(requests.length, 0)
    console.log(
      JSON.stringify({
        rawCandidateRefusedBeforeEffects: true,
        convertedBindingRetained: bundle.profile.proxySecrets.length === 1,
      }),
    )
  } else throw new Error('unknown fixture mode')
} finally {
  server.closeAllConnections()
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}
