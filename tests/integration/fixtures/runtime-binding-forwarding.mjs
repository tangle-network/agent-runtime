import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { json } from 'node:stream/consumers'
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
const exact = mode === 'identity'
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
    const body = await json(request)
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
        dispatch: { runControlRef: exact, executionIdOnAdmission: exact },
        cancel: { canonicalRunCancellation: exact, digestBound: exact, idempotent: exact },
        runs: { executionScopedStatus: exact, eventReplay: exact },
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
    await providerAsSandboxClient(provider, {
      mapCreateOptions: () => ({ secrets: ['LEGACY_ALL_TARGET'] }),
    }).create({ backend: { type: 'opencode', profile }, secrets: 'all' })
    assert.deepEqual(creates.at(-1).secrets, ['LEGACY_ALL_TARGET'])
    console.log(
      JSON.stringify({
        deniedBeforeCreate: 12,
        authoredCustodyPreserved: 2,
        legacyTranslationPreserved: true,
        canonicalDeclarationsPreserved: 2,
        asyncAliasDetached: true,
      }),
    )
  } else if (mode === 'identity') {
    const boundary = new Error('fixture durability boundary')
    const start = (secrets, proxySecrets, intent, onAdmission) =>
      startRetainedRun({
        provider,
        environment: {
          profile: 'custody-public-profile',
          secrets,
          proxySecrets,
          idempotencyKey: 'legacy-secret-identity',
        },
        identity: { sessionId: 'identity-session', executionId: 'identity-execution' },
        turn: { prompt: 'public identity only', turnId: 'identity-turn' },
        intent,
        onAdmission,
      })
    const capture = async (secrets, proxySecrets, prior) => {
      let intent
      await assert.rejects(
        start(secrets, proxySecrets, prior, async (admission) => {
          intent = admission
          throw boundary
        }),
        (error) => error.cause === boundary,
      )
      assert.equal(intent.phase, prior ? 'environment' : 'intent')
      return intent
    }
    const refuses = (secrets, proxySecrets, intent) =>
      assert.rejects(
        start(secrets, proxySecrets, intent, async () => assert.fail('unexpected admission')),
        /retained run intent conflicts with replay material/,
      )
    const ordered = await capture(['Z_TOKEN', 'A_TOKEN']),
      reversed = await capture(['A_TOKEN', 'Z_TOKEN'])
    assert.equal(ordered.requestDigest, reversed.requestDigest)
    const historicalIntent = Object.freeze({
      phase: 'intent',
      provider: 'tangle-sandbox',
      idempotencyKey: 'legacy-secret-identity',
      turnId: 'identity-turn',
      sessionId: 'identity-session',
      executionId: 'identity-execution',
      requestedProfileDigest:
        'sha256:a68f111a88eb6c7de50f36e8f9a89a9142d68186cb505d68bd1acf823a3888cf',
      requestDigest: 'sha256:cfec0632d6c681c1c0f930a9b831d9b0a03c894f15cbe4649dc787ba190cb229',
      runId: 'retained-intent-run:cfec0632d6c681c1c0f930a9b831d9b0a03c894f15cbe4649dc787ba190cb229',
    })
    assert.notEqual(ordered.requestDigest, historicalIntent.requestDigest)
    await refuses(['A_TOKEN', 'Z_TOKEN'], undefined, { ...historicalIntent, runId: ordered.runId })
    const legacyHost = { name: 'TOKEN', host: 'first.example.com' }
    const legacyIntent = await capture([legacyHost])
    for (const change of [{ host: 'other.example.com' }, { header: 'X-Api-Key' }])
      await refuses([{ ...legacyHost, ...change }], undefined, legacyIntent)
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
      await refuses(undefined, [{ ...portable, ...changed }], first)
    assert.equal(requests.length, 0)
    const admitted = await capture(['A_TOKEN', 'Z_TOKEN'], undefined, historicalIntent)
    assert.equal(admitted.environmentId, 'sandbox-bindings')
    assert.equal(creates.length, 1)
    assert.deepEqual(creates[0].secrets, ['A_TOKEN', 'Z_TOKEN'])
    assert.equal(metadata.retainedIdempotencyKey, historicalIntent.idempotencyKey)
    await (await provider.get(admitted.environmentId)).destroy()
    assert.equal(requests.at(-1), 'DELETE /v1/sandboxes/sandbox-bindings')
    console.log(
      JSON.stringify({
        legacyAdmissionReplayedThroughHttp: true,
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
