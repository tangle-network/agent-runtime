import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createServer as createTlsServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  createTangleProvider,
  defaultTangleSandboxCapabilities,
} from '@tangle-network/agent-provider-tangle'
import { supervise } from '@tangle-network/agent-runtime/kernel'
import { Sandbox } from '@tangle-network/sandbox'

const [mode, certificate, key] = process.argv.slice(2)
const safeFailure = (text) =>
  String(text ?? '')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 600)
const host = 'localhost.localdomain'
const profile = {
  name: 'custody-http',
  harness: 'opencode',
  model: { provider: 'openai', default: 'fixture-model' },
  tools: { agent_runtime_coordination_stop: true },
}
const callerBinding = {
  envName: 'CALLER_ALIAS',
  secretRef: { kind: 'secret-ref', key: 'CALLER_SECRET' },
  hosts: ['caller.example.com'],
  methods: ['POST'],
  paths: ['/v1/events'],
  presentation: { type: 'header', name: 'X-Api-Key' },
}
const callerDefaults = {
  proxySecrets: [callerBinding],
  env: { AGENT_RUNTIME_COORDINATION_TOKEN_DEBUG: 'caller-debug-kept' },
}
if (mode === 'bound')
  callerDefaults.env.AGENT_RUNTIME_COORDINATION_TOKEN = 'fixture-stale-private-coordination'
const stored = new Map(),
  revisions = new Map(),
  policies = new Map(),
  secretValues = new Set(),
  creates = [],
  sessions = new Map(),
  nativeRuns = new Map(),
  requests = [],
  protocolFailures = [],
  privateTurns = []
const policyRequests = []
const policyAttempts = []
let baseUrl = '',
  publicUrl = '',
  upstream = '',
  issued = '',
  metadata,
  mcpAccepted = false,
  mcpRefusedWrongBearer = false
let prepared = false,
  publicSessionSafe = true,
  deleteCalls = 0,
  metadataGets = 0,
  updates = 0,
  handoverOverlap = false,
  oldRevokedAfterAcknowledgement = false
let firstCommit
const committed = new Promise((resolve) => {
  firstCommit = resolve
})
let rekeyBeforeResumedDispatch = false,
  nativeTurns = 0
let secretRevision = 0
const nextRevision = () => new Date(Date.now() + ++secretRevision).toISOString()
const secretMetadata = (name) => ({
  name,
  createdAt: new Date(0).toISOString(),
  updatedAt: revisions.get(name),
  proxySecrets: policies.get(name),
})
const capturePolicy = (body, name) => {
  assert.equal(body.proxySecrets?.length, 1)
  assert.equal(body.proxySecrets[0].envName, name)
  assert.equal(body.proxySecrets[0].secretRef.key, name)
  policyAttempts.push(body.proxySecrets)
  return body.proxySecrets
}
const assertPolicyIdentity = () => {
  if (mode === 'fallback') assert.equal(policyRequests.length, 0)
  else if (!policyRequests.length) return false
  for (const request of policyRequests) {
    for (const create of creates.filter((create) =>
      create.proxySecrets?.some((binding) => binding.envName === request[0].envName),
    ))
      assert.deepEqual(
        request.map(({ ttlSeconds: _, ...binding }) => binding),
        create.proxySecrets.filter((binding) => binding.secretRef.key === request[0].secretRef.key),
      )
  }
  return true
}
const answer = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}
const read = async (request) => {
  const chunks = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
}
const listen = async (server) => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return address.port
}
const close = (server) =>
  new Promise((resolve, reject) => {
    server.closeAllConnections()
    server.close((error) => (error ? reject(error) : resolve()))
  })
const info = () => ({
  id: 'sandbox-custody',
  status: 'running',
  filesystemIncarnationId: '11111111-1111-4111-8111-111111111111',
  filesystemIncarnationProvenance: 'fresh',
  filesystemIncarnationReadiness: 'ready',
  createdAt: new Date(0).toISOString(),
  metadata,
  connection: {
    runtimeUrl: `${baseUrl}/runtime`,
    authToken: 'fixture-control-token',
    edgeStatus: 'ready',
  },
})
const sessionInfo = (id) => ({
  id,
  status: nativeRuns.get(id)?.status ?? 'queued',
  ...(nativeRuns.get(id) ?? {}),
  backendType: 'opencode',
  createdAt: new Date(0).toISOString(),
})
const tls = createTlsServer(
  { cert: readFileSync(certificate), key: readFileSync(key) },
  async (request, response) => {
    try {
      const forwarded = await fetch(upstream, {
        method: request.method,
        headers: {
          authorization: request.headers.authorization ?? '',
          'content-type': 'application/json',
        },
        body: JSON.stringify(await read(request)),
      })
      answer(response, forwarded.status, await forwarded.json())
    } catch {
      answer(response, 502, { error: 'local forwarding failed' })
    }
  },
)
const api = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://fixture').pathname
  requests.push(`${request.method} ${path}`)
  try {
    const body = await read(request)
    if (path === '/fixture/coordination') {
      upstream = body.upstream
      return answer(response, 200, { ready: true })
    }
    if (path === '/fixture/hold-after-commit') {
      firstCommit()
      return
    }
    if (path === '/v1/backends')
      return answer(response, 200, {
        timestamp: new Date(0).toISOString(),
        backends: ['opencode', 'codex'].map((type) => ({
          type,
          name: type,
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
        })),
      })
    if (path === '/v1/secrets' && request.method === 'GET') {
      metadataGets++
      return answer(response, 200, { secrets: [...stored.keys()].map(secretMetadata) })
    }
    if (path === '/v1/secrets' && request.method === 'POST') {
      assert.match(body.name, /^AGENT_RUNTIME_COORDINATION_TOKEN_[A-F0-9]{24}$/)
      const policy = capturePolicy(body, body.name)
      secretValues.add(body.value)
      if (!issued) issued = body.value
      if (['quiescent-rebind', 'rekey-conflict'].includes(mode) && !stored.has(body.name)) {
        stored.set(body.name, 'fixture-prior-quiescent-value')
        revisions.set(body.name, nextRevision())
      }
      if (stored.has(body.name))
        return answer(response, 409, { code: 'CONFLICT', message: 'secret exists' })
      if (mode === 'create-refused')
        return answer(response, 400, {
          code: 'INVALID_REQUEST',
          message: 'fixture refused before persistence',
        })
      stored.set(body.name, body.value)
      policyRequests.push(policy)
      policies.set(body.name, policy)
      revisions.set(body.name, nextRevision())
      if (mode === 'uncertain-create')
        return answer(response, 400, {
          code: 'INVALID_REQUEST',
          message: 'receipt lost after persistence',
        })
      return answer(response, 200, {
        secret: secretMetadata(body.name),
      })
    }
    if (path.startsWith('/v1/secrets/') && request.method === 'PUT') {
      const name = decodeURIComponent(path.slice('/v1/secrets/'.length))
      const policy = capturePolicy(body, name)
      assert.equal(stored.has(name), true)
      if (mode === 'rekey-conflict' || body.expectedUpdatedAt !== revisions.get(name))
        return answer(response, 409, { code: 'CONFLICT', message: 'revision changed' })
      const prior = stored.get(name)
      secretValues.add(body.value)
      if (mode === 'renewal') {
        const accepted = async (value) => {
          const response = await fetch(publicUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${value}`, 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 'handover', method: 'tools/list' }),
          })
          return response.status === 200
        }
        handoverOverlap = (await accepted(prior)) && (await accepted(body.value))
      }
      stored.set(name, body.value)
      policyRequests.push(policy)
      policies.set(name, policy)
      revisions.set(name, nextRevision())
      updates++
      return answer(response, 200, {
        secret: secretMetadata(name),
      })
    }
    if (path.startsWith('/v1/secrets/') && request.method === 'DELETE') {
      deleteCalls++
      if (mode === 'delete-refused')
        return answer(response, 403, { code: 'FORBIDDEN', message: 'fixture refuses revocation' })
      const name = decodeURIComponent(path.slice('/v1/secrets/'.length))
      if (mode === 'delete-conflict') {
        stored.set(name, 'fixture-newer-owner-value')
        revisions.set(name, nextRevision())
      }
      if (
        stored.has(name) &&
        new URL(request.url, 'http://fixture').searchParams.get('expectedUpdatedAt') !==
          revisions.get(name)
      )
        return answer(response, 409, { code: 'CONFLICT', message: 'revision changed' })
      const existed = stored.delete(name)
      if (existed) revisions.delete(name)
      return answer(
        response,
        existed ? 200 : 404,
        existed ? { success: true } : { code: 'NOT_FOUND', message: 'secret absent' },
      )
    }
    if (path === '/v1/sandboxes' && request.method === 'POST') {
      creates.push(body)
      metadata = body.metadata
      return answer(response, 200, info())
    }
    if (path === '/v1/sandboxes/sandbox-custody' && request.method === 'DELETE')
      return answer(response, 200, {
        id: 'sandbox-custody',
        outcome: 'destroyed',
        removal: 'complete',
      })
    if (path === '/v1/sandboxes/sandbox-custody') return answer(response, 200, info())
    if (path.endsWith('/capabilities'))
      return answer(response, 200, {
        schema: 1,
        agentInterface: '0.49.0',
        sidecarVersion: 'fixture',
        image: 'fixture',
        dispatch: { runControlRef: mode === 'restart', executionIdOnAdmission: mode === 'restart' },
        cancel: {
          canonicalRunCancellation: mode === 'restart',
          digestBound: mode === 'restart',
          idempotent: mode === 'restart',
        },
        runs: { executionScopedStatus: mode === 'restart', eventReplay: mode === 'restart' },
        interactions: { responseDedupe: false },
      })
    if (path.endsWith('/backend')) return answer(response, 200, { type: 'opencode' })
    if (path.endsWith('/agents/sessions') && request.method === 'POST') {
      if (mode === 'fallback')
        publicSessionSafe &&=
          body.backend.metadata.profileSecretIsolation === true &&
          body.backend.runtimeSecrets === undefined
      sessions.set(body.sessionId, body.backend)
      return answer(response, 200, sessionInfo(body.sessionId))
    }
    if (/\/public-profile-revisions\/prepare$/.test(path)) {
      assert.equal(body.secret, true)
      assert.equal(body.backend.metadata.profileSecretIsolation, true)
      assert.match(body.expectedPublicProfileRequestDigest, /^sha256:[a-f0-9]{64}$/)
      prepared = true
      return answer(response, 200, {
        workspacePlanDigest: `sha256:${'e'.repeat(64)}`,
        executorReceipt: `hmac-sha256:${'f'.repeat(64)}`,
        conflicts: [],
      })
    }
    const selectedSession = path.match(/\/agents\/sessions\/([^/]+)$/)
    if (selectedSession) {
      const id = decodeURIComponent(selectedSession[1])
      return sessions.has(id) || nativeRuns.has(id)
        ? answer(response, 200, sessionInfo(id))
        : answer(response, 404, { code: 'NOT_FOUND', message: 'session absent' })
    }
    if (path.endsWith('/messages/turns')) {
      response.writeHead(204)
      response.end()
      return
    }
    const replay = path.match(/\/agents\/run\/([^/]+)\/events$/)
    if (mode === 'restart' && (replay || path.endsWith('/agents/events'))) {
      const executionId =
        replay?.[1] ?? new URL(request.url, baseUrl).searchParams.get('executionId')
      const run = [...nativeRuns.values()].find(
        (candidate) => candidate.executionId === executionId,
      )
      assert.ok(run)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(run.frames)
      return
    }
    if (path.endsWith('/agents/run/stream')) {
      const backend = { ...creates.at(-1).backend, ...body.backend }
      const attachment = backend.runtimeAttachments.mcp['agent-runtime-coordination']
      const reference = attachment.headers.Authorization
      assert.equal(reference.kind, 'secret-ref')
      assert.equal(reference.format, 'bearer')
      const value =
        stored.get(reference.key) ??
        backend.runtimeSecrets?.[reference.key] ??
        (mode === 'legacy-store' ? creates.at(-1).env?.[reference.key] : undefined)
      assert.equal(typeof value, 'string')
      if (mode === 'legacy-store') secretValues.add(value)
      if (mode === 'fallback') {
        issued = value
        secretValues.add(value)
        privateTurns.push(body)
        assert.equal(prepared, true)
        assert.equal(backend.metadata.profileSecretIsolation, true)
        assert.equal(JSON.stringify([...sessions.values()]).includes(value), false)
      }
      const rpc = async (authorization) => {
        const result = await fetch(attachment.url, {
          method: 'POST',
          headers: { Authorization: authorization, 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params:
              mode === 'restart'
                ? {
                    name: 'submit_result',
                    arguments: { result: { answer: 'custody-resume-delivered' } },
                  }
                : { name: 'stop', arguments: { reason: 'HTTP custody proof complete' } },
          }),
        })
        return { status: result.status, body: await result.json() }
      }
      if (mode === 'restart') {
        const executionId = request.headers['x-execution-id'] ?? body.executionId
        if (nativeTurns) {
          assert.ok(updates > 0)
          assert.notEqual(value, issued)
          rekeyBeforeResumedDispatch = true
          const accepted = await rpc(`Bearer ${value}`)
          assert.equal(accepted.status, 200)
          assert.notEqual(accepted.body.result?.isError, true)
        }
        nativeTurns++
        const common = { sessionId: body.sessionId, executionId }
        const frames = [
          ['execution.started', { ...common, runControlRef: body.runControlRef }],
          [
            'result',
            {
              ...common,
              success: true,
              status: 'success',
              response: '{"answer":"turn-complete"}',
              usage: { inputTokens: 1, outputTokens: 1 },
            },
          ],
          ['done', { ...common, success: true, status: 'success', outcome: { type: 'completed' } }],
        ]
          .map(
            ([event, data], index) =>
              `id: ${index + 1}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
          )
          .join('')
        nativeRuns.set(body.sessionId, {
          status: 'completed',
          executionId,
          activeExecutionId: executionId,
          latestExecutionId: executionId,
          runControlRef: body.runControlRef,
          frames,
        })
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(frames)
        return
      }
      if (mode === 'renewal') {
        const deadline = Date.now() + 6000
        while (!updates && Date.now() < deadline) await delay(20)
        assert.ok(updates > 0)
        while (Date.now() < deadline) {
          const prior = await fetch(attachment.url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${issued}`, 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 'retired', method: 'tools/list' }),
          })
          await prior.body?.cancel()
          if (prior.status === 401) {
            oldRevokedAfterAcknowledgement = true
            break
          }
          await delay(20)
        }
      }
      const refused = await rpc('Bearer fixture-invalid-bearer')
      mcpRefusedWrongBearer = refused.status === 401
      const accepted = await rpc(`Bearer ${stored.get(reference.key) ?? value}`)
      mcpAccepted =
        accepted.status === 200 && !accepted.body.error && accepted.body.result?.isError !== true
      const executionId = request.headers['x-execution-id'] ?? body.executionId
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(
        `event: result\ndata: ${JSON.stringify({ success: true, status: 'success', executionId, response: 'HTTP boundary complete', durationMs: 1, usage: { inputTokens: 1, outputTokens: 1 } })}\n\nevent: done\ndata: {"outcome":{"type":"completed"}}\n\n`,
      )
      return
    }
    answer(response, 404, { code: 'NOT_FOUND', message: 'fixture route absent' })
  } catch (error) {
    protocolFailures.push({
      path,
      cause: safeFailure(error instanceof Error ? error.message : error),
    })
    answer(response, 500, {
      code: 'SERVER_ERROR',
      message:
        error instanceof assert.AssertionError
          ? 'fixture assertion failed'
          : 'fixture operation failed',
    })
  }
})
try {
  const tlsPort = await listen(tls)
  baseUrl = `http://127.0.0.1:${await listen(api)}`
  publicUrl = `https://${host}:${tlsPort}/coordination`
  const capabilities = defaultTangleSandboxCapabilities('opencode')
  delete capabilities.retainedControl
  delete capabilities.nativeContinuation
  capabilities.streaming = { live: true, replay: false, detach: false, turnIdempotency: false }
  capabilities.sessions = { continue: false, list: false, messages: false }
  const Client = mode === 'legacy-store' ? (await import('legacy-sandbox')).Sandbox : Sandbox
  const createProvider =
    mode === 'legacy-fenced' ? (await import('legacy-provider')).createTangleProvider : createTangleProvider
  const provider = createProvider({
    client: new Client({
      apiKey: 'fixture-api-key',
      baseUrl,
      platformUrl: baseUrl,
      trustLocalCliAuth: false,
      directExec: false,
    }),
    capabilities,
  })
  if (mode === 'restart') {
    const directory = await mkdtemp(join(tmpdir(), 'runtime-custody-resume-'))
    const helper = fileURLToPath(new URL('./runtime-secret-resume.mjs', import.meta.url))
    const args = ['--dns-result-order=ipv4first', helper, baseUrl, publicUrl, directory]
    const child = spawn(process.execPath, [...args, 'first'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let firstDiagnostic = ''
    child.stderr.on('data', (chunk) => {
      firstDiagnostic += chunk.toString()
    })
    child.stdout.resume()
    const exited = new Promise((resolve) => child.once('exit', resolve))
    try {
      await Promise.race([
        committed,
        exited.then(() => {
          throw new Error(
            `first coordinator exited before committing: ${safeFailure(firstDiagnostic)}`,
          )
        }),
      ])
      assert.equal(stored.size, 1)
      const originalPolicy = structuredClone([...policies.values()][0])
      child.kill('SIGKILL')
      await exited
      await delay(1200)
      const { stdout } = await promisify(execFile)(process.execPath, [...args, 'resume'], {
        timeout: 12000,
      })
      assert.equal(JSON.parse(stdout.trim().split('\n').at(-1)).resumed, true)
      assert.deepEqual(policyRequests.at(-1), originalPolicy)
      assert.ok(policyAttempts.at(-2)[0].ttlSeconds < originalPolicy[0].ttlSeconds)
      console.log(
        JSON.stringify({
          resumed: true,
          priorProcessKilledAfterCommit: true,
          rekeyBeforeResumedDispatch,
          issuerPolicyPreserved: assertPolicyIdentity(),
          originalRootPolicyReplayed: true,
          creates: creates.length,
          nativeTurns,
          updates,
          stored: stored.size,
          noRawCreate: creates.every((body) =>
            [...secretValues].every((value) => !JSON.stringify(body).includes(value)),
          ),
        }),
      )
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL')
      await rm(directory, { recursive: true, force: true })
    }
  } else {
    let settled = false,
      rejected = false,
      resultKind,
      resultReason,
      failureText
    try {
      for (let run = 0; run < (mode === 'namespace' ? 2 : 1); run++) {
        mcpAccepted = false
        mcpRefusedWrongBearer = false
        const result = await supervise(
          profile,
          'Exercise credential custody over the actual HTTP boundary.',
          {
            runId: `runtime-secret-bindings-${mode}`,
            backend: {
              backend: 'provider',
              provider,
              ...(['bound', 'prefix-env'].includes(mode) ? { defaults: callerDefaults } : {}),
            },
            budget: {
              maxIterations: 4,
              maxTokens: 1000,
              ...(['explicit-ttl', 'unbounded', 'long-ttl'].includes(mode)
                ? {}
                : { deadlineMs: 10000 }),
            },
            perWorker: { maxIterations: 1, maxTokens: 100 },
            driverRetry: { enabled: false },
            finalizer: () => (mcpAccepted ? { custody: 'complete' } : undefined),
            coordination: {
              authentication:
                mode === 'long-ttl'
                  ? { ttlMs: 2 ** 33 }
                  : mode === 'explicit-ttl'
                    ? { ttlMs: 10000 }
                    : mode === 'renewal'
                      ? { ttlMs: 4000 }
                      : true,
              publicUrl: ({ port }) => {
                upstream = `http://127.0.0.1:${port}/coordination`
                return mode === 'fallback' ? upstream : publicUrl
              },
            },
          },
        )
        resultKind = result.kind
        resultReason = result.reason
        failureText = safeFailure(result.error?.message)
        settled = result.kind === 'winner' && result.out?.custody === 'complete'
        rejected = result.kind === 'no-winner' && result.reason === 'driver-failed'
        if (!settled) break
      }
    } catch (error) {
      rejected = true
      failureText = safeFailure(error instanceof Error ? error.message : error)
    }
    const noRawCreate = creates.every((create) =>
      [...secretValues].every((value) => !JSON.stringify(create).includes(value)),
    )
    const namesValid = creates.every((create) => {
      const bindings = (create.proxySecrets ?? []).filter((binding) =>
        binding.envName.startsWith('AGENT_RUNTIME_COORDINATION_TOKEN_'),
      )
      return (
        (mode === 'fallback' || (bindings.length === 1 && create.secrets?.length === 0)) &&
        bindings.every(
          (binding) =>
            /^AGENT_RUNTIME_COORDINATION_TOKEN_[A-F0-9]{24}$/.test(binding.envName) &&
            binding.secretRef.key === binding.envName &&
            binding.ttlSeconds === undefined &&
            binding.hosts.length === 1 &&
            binding.hosts[0] === host &&
            binding.presentation.type === 'bearer',
        )
      )
    })
    let callerDefaultsPreserved = false
    if (mode === 'renewal') {
      assert.ok(policyRequests[0][0].ttlSeconds > 4 && policyRequests[0][0].ttlSeconds <= 10)
      assert.ok(policyRequests.length >= 2)
      assert.deepEqual(policyRequests.at(-1), policyRequests[0])
    }
    if (['explicit-ttl', 'unbounded', 'long-ttl'].includes(mode))
      assert.equal(policyRequests[0][0].ttlSeconds, undefined)
    if (['bound', 'prefix-env'].includes(mode) && creates.length) {
      assert.equal(creates.length, 1)
      assert.equal(Object.hasOwn(creates[0].env, 'AGENT_RUNTIME_COORDINATION_TOKEN'), false)
      assert.equal(creates[0].env.AGENT_RUNTIME_COORDINATION_TOKEN_DEBUG, 'caller-debug-kept')
      assert.equal(JSON.stringify(creates).includes('fixture-stale-private-coordination'), false)
      assert.deepEqual(
        creates[0].proxySecrets.find((binding) => binding.envName === callerBinding.envName),
        callerBinding,
      )
      callerDefaultsPreserved = true
    }
    console.log(
      JSON.stringify({
        mode,
        issuerPolicyPreserved: assertPolicyIdentity(),
        rootLifetimeOutlivesLease: mode === 'renewal',
        unrelatedDeclarationPreserved: callerDefaultsPreserved,
        legacyCoordinationEnvNormalized: mode === 'bound' && callerDefaultsPreserved,
        prefixEnvPreserved: callerDefaultsPreserved,
        settled,
        rejected,
        resultKind,
        resultReason,
        failureText,
        protocolFailures,
        mcpAccepted,
        mcpRefusedWrongBearer,
        noRawCreate,
        namesValid,
        distinctCredentialNames: new Set(
          creates.flatMap((create) =>
            (create.proxySecrets ?? []).map((binding) => binding.envName),
          ),
        ).size,
        creates: creates.length,
        stored: stored.size,
        deleteCalls,
        metadataGets,
        prepared,
        publicSessionSafe,
        privateTurns: privateTurns.length,
        updates,
        handoverOverlap,
        oldRevokedAfterAcknowledgement,
        secretPosts: requests.filter((request) => request === 'POST /v1/secrets').length,
        legacyStorePortAbsent: provider.secrets === undefined,
        legacyOwnedReferencePreserved:
          mode === 'legacy-store' &&
          creates[0]?.backend.runtimeAttachments.mcp['agent-runtime-coordination'].headers
            .Authorization.key === 'AGENT_RUNTIME_COORDINATION_TOKEN',
        legacyDeliveryPreserved:
          mode === 'legacy-store' &&
          mcpAccepted &&
          secretValues.size === 1 &&
          creates.length === 1 &&
          [...secretValues].every((value) => Object.values(creates[0].env).includes(value)),
        legacyFencedDeliveryPreserved:
          mode === 'legacy-fenced' &&
          mcpAccepted &&
          noRawCreate &&
          creates[0]?.secrets?.some(
            (binding) => binding.host === host && binding.name === policyRequests[0][0].envName,
          ) &&
          policyRequests[0][0].ttlSeconds > 0,
      }),
    )
  }
} finally {
  await Promise.all([close(api), close(tls)])
}
