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
    return response.end(JSON.stringify({ backends: [], timestamp: new Date(0).toISOString() }))
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
        interactions: {},
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
    const binding = { name: 'REPORTS_TOKEN', host: 'reports.example.com', header: 'Authorization' }
    const declaration = {
      envName: 'PROFILE_TOKEN',
      secretRef: { kind: 'secret-ref', key: 'PROFILE_TOKEN' },
      hosts: ['profile.example.com'],
      presentation: { type: 'bearer' },
    }
    const converted = freezeGenericAgentCandidateProfile({
      ...profile,
      proxySecrets: [declaration],
    })
    assert.deepEqual(converted.proxySecrets, [declaration])
    assert.deepEqual(agentCandidateProfileAsAgentProfile(converted).proxySecrets, [declaration])
    await providerAsSandboxClient(provider).create({
      backend: { type: 'opencode', profile: { ...profile, proxySecrets: [declaration] } },
      secrets: [binding],
    })
    assert.deepEqual(creates[0].secrets, [
      binding,
      { name: 'PROFILE_TOKEN', host: 'profile.example.com', header: 'Authorization' },
    ])
    console.log(
      JSON.stringify({
        selectorsPreserved: true,
        authoredBindingLowered: true,
        candidateRoundTripPreserved: true,
      }),
    )
  } else if (mode === 'mappers') {
    const binding = { name: 'TOKEN', host: 'reports.example.com', header: 'Authorization' }
    for (const secrets of [['TOKEN'], [], [{ ...binding, host: 'other.example.com' }]]) {
      const client = providerAsSandboxClient(provider, { mapCreateOptions: () => ({ secrets }) })
      await assert.rejects(
        client.create({ backend: { type: 'opencode', profile }, secrets: [binding] }),
        /stored host binding/,
      )
    }
    const mutate = providerAsSandboxClient(provider, {
      mapCreateOptions: (options) => {
        options.secrets[0].host = 'other.example.com'
        return { secrets: options.secrets }
      },
    })
    await assert.rejects(
      mutate.create({ backend: { type: 'opencode', profile }, secrets: [{ ...binding }] }),
      /stored host binding/,
    )
    const defaults = providerAsSandboxClient(provider, {
      defaults: { secrets: [binding] },
      mapCreateOptions: () => ({ secrets: ['TOKEN'] }),
    })
    await assert.rejects(
      defaults.create({ backend: { type: 'opencode', profile } }),
      /stored host binding/,
    )
    assert.equal(creates.length, 0)
    for (const mutate of [false, true]) {
      const declaration = {
        envName: 'TOKEN',
        secretRef: { kind: 'secret-ref', key: 'TOKEN' },
        hosts: [binding.host],
        presentation: { type: 'bearer' },
      }
      const client = providerAsSandboxClient(provider, {
        mapCreateOptions: (options) => {
          if (mutate) options.backend.profile.proxySecrets.length = 0
          return { profile }
        },
      })
      await client.create({
        backend: { type: 'opencode', profile: { ...profile, proxySecrets: [declaration] } },
      })
      assert.deepEqual(creates.at(-1).secrets, [binding])
    }
    const legacy = providerAsSandboxClient(provider, {
      mapCreateOptions: () => ({ secrets: ['LEGACY_TARGET'] }),
    })
    await legacy.create({ backend: { type: 'opencode', profile }, secrets: ['LEGACY_SOURCE'] })
    assert.deepEqual(creates.at(-1).secrets, ['LEGACY_TARGET'])
    console.log(
      JSON.stringify({
        deniedBeforeCreate: 5,
        authoredCustodyPreserved: 2,
        legacyTranslationPreserved: true,
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
    const first = await capture([
      { name: 'TOKEN', host: 'first.example.com', header: 'Authorization' },
    ])
    const hostChanged = await capture([
      { name: 'TOKEN', host: 'next.example.com', header: 'Authorization' },
    ])
    const headerChanged = await capture([
      { name: 'TOKEN', host: 'first.example.com', header: 'X-Api-Key' },
    ])
    assert.notEqual(first.requestDigest, hostChanged.requestDigest)
    assert.notEqual(first.requestDigest, headerChanged.requestDigest)
    const portable = {
      envName: 'TOKEN',
      secretRef: { kind: 'secret-ref', key: 'TOKEN' },
      hosts: ['first.example.com'],
      presentation: { type: 'bearer' },
    }
    const before = await capture(undefined, [portable])
    const after = await capture(undefined, [{ ...portable, hosts: ['next.example.com'] }])
    assert.notEqual(before.requestDigest, after.requestDigest)
    assert.equal(requests.length, 0)
    console.log(
      JSON.stringify({
        stringSelectionOrderStable: true,
        legacyWireIdentityPreserved: true,
        hostChangesIdentity: true,
        headerChangesIdentity: true,
        portableHostChangesIdentity: true,
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
