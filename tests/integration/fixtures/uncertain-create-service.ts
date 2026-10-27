import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { writeAtomicDurableFile } from '../../../src/runtime/supervise/durable-file'
import {
  attachments,
  digest,
  localUrl,
  type NativeRun,
  object,
  publicCreateMaterial,
  record,
  registry,
  runtimeCapabilities,
  type Scenario,
  type ServiceState,
} from './uncertain-create-protocol'

const directory = process.argv[2]!
const scenario = process.argv[3] as Scenario
const ledger = join(directory, 'service-ledger.jsonl')
const state: ServiceState = {
  scenario,
  createStatus: scenario === 'create-503' ? 503 : 408,
  finish: false,
  cancelEffect: scenario === 'cancel-requested' ? 'cancel_requested' : 'unknown',
  lost: [],
  routes: {},
  boxes: [],
  provisions: [],
  runs: [],
  requests: [],
  failures: [],
}
let origin = ''
const holds = new Set<ServerResponse>()
const nativeActions = new Map<string, Promise<void>>()
const acceptedSubscribers = new Map<string, Set<ServerResponse>>()
const observedReplays = new Map<string, { received: Promise<void>; observed: () => void }>()
function startAction(run: NativeRun): void {
  const action = act(run)
    .then(() => flushAccepted(run))
    .catch((error) => {
      state.failures.push(String(error))
      note('fixture-failure', { error: String(error) })
      throw error
    })
  nativeActions.set(run.executionId, action)
  void action.catch(() => undefined)
}
function note(kind: string, data: Record<string, unknown> = {}): void {
  const row = { kind, at: new Date().toISOString(), ...data }
  record(ledger, row)
  state.requests.push(row)
}
function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  let text = ''
  for await (const chunk of request) {
    text += chunk
    if (text.length > 2_000_000) throw new Error('request too large')
  }
  return text ? object(JSON.parse(text)) : {}
}
function boxInfo(id: string) {
  return {
    id,
    status: 'running',
    filesystemIncarnationId: `incarnation-${id}`,
    filesystemIncarnationProvenance: 'fresh',
    filesystemIncarnationReadiness: 'ready',
    metadata: state.boxes.find((box) => box.id === id)?.metadata,
    connection: { runtimeUrl: origin },
    createdAt: new Date().toISOString(),
  }
}
function writeFrames(
  response: ServerResponse,
  frames: Array<{ type: string; data: object }>,
  offset = 0,
): void {
  frames.forEach((frame, index) => {
    response.write(
      `id: ${offset + index + 1}\nevent: ${frame.type}\ndata: ${JSON.stringify(frame.data)}\n\n`,
    )
  })
}
function sse(response: ServerResponse, frames: Array<{ type: string; data: object }>): void {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  writeFrames(response, frames)
  response.end()
}
function subscribeAccepted(run: NativeRun, response: ServerResponse): void {
  const subscribers = acceptedSubscribers.get(run.executionId) ?? new Set<ServerResponse>()
  acceptedSubscribers.set(run.executionId, subscribers)
  subscribers.add(response)
  response.on('close', () => {
    subscribers.delete(response)
    if (subscribers.size === 0) acceptedSubscribers.delete(run.executionId)
    // A lost coordinator connection does not cancel the independent native execution.
  })
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  writeFrames(response, terminal(run).slice(0, 1))
  note('healthy-stream-open', { executionId: run.executionId, environmentId: run.environmentId })
}
function flushAccepted(run: NativeRun): void {
  if (scenario !== 'accepted' || run.status !== 'completed') return
  const subscribers = acceptedSubscribers.get(run.executionId)
  if (!subscribers) return
  for (const response of subscribers) {
    if (response.destroyed || response.writableEnded) continue
    // IDs 2 and 3 are the same canonical result/done positions as a completed replay.
    writeFrames(response, terminal(run).slice(1), 1)
    response.end()
    run.terminalReads += 1
  }
  acceptedSubscribers.delete(run.executionId)
  note('healthy-stream-completed', {
    executionId: run.executionId,
    environmentId: run.environmentId,
  })
}
function terminal(run: NativeRun) {
  return [
    {
      type: 'execution.started',
      data: {
        sessionId: run.sessionId,
        executionId: run.executionId,
        runControlRef: run.runControlRef,
      },
    },
    ...(scenario.startsWith('create-')
      ? [
          {
            type: 'message.part.updated',
            data: {
              sessionId: run.sessionId,
              executionId: run.executionId,
              part: { type: 'reasoning', text: run.executionId },
              delta: run.executionId,
            },
          },
        ]
      : []),
    {
      type: 'result',
      data: {
        sessionId: run.sessionId,
        executionId: run.executionId,
        success: true,
        status: 'success',
        response: '{"answer":"delivered"}',
        text: '{"answer":"delivered"}',
        usage: { inputTokens: 3, outputTokens: 2 },
      },
    },
    {
      type: 'done',
      data: {
        sessionId: run.sessionId,
        executionId: run.executionId,
        success: true,
        status: 'success',
        outcome: { type: 'completed' },
        usage: { inputTokens: 3, outputTokens: 2 },
      },
    },
  ]
}
async function replay(run: NativeRun, response: ServerResponse, exactResult = false): Promise<void> {
  if (scenario === 'accepted' && run.status === 'running') {
    subscribeAccepted(run, response)
    return
  }
  if (run.status === 'running' && nativeActions.has(run.executionId))
    await nativeActions.get(run.executionId)
  if (run.status === 'running') {
    json(response, 408, {
      error: {
        code: 'FIXTURE_OBSERVATION_UNKNOWN',
        message: 'exact execution remains unresolved',
      },
    })
    return
  }
  const replay = observedReplays.get(run.executionId)
  if (replay && exactResult) await replay.received
  run.terminalReads += 1
  sse(response, terminal(run))
  // A completed old invocation loses its environment before the next invocation starts.
  if (scenario === 'older-lost' && run.environmentId === 'box-1') state.lost.push('box-1')
}
async function proxy(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const key = url.pathname.split('/')[2]!
  const target = state.routes[key]
  if (!target) {
    json(response, 503, { error: 'coordinator not registered' })
    return
  }
  const destination = localUrl(target)
  destination.pathname = url.pathname
  destination.search = url.search
  const data =
    request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : JSON.stringify(await body(request))
  const headers = Object.fromEntries(
    Object.entries(request.headers).filter(
      ([name]) => !['host', 'connection', 'content-length', 'transfer-encoding'].includes(name),
    ),
  ) as Record<string, string>
  const forwarded = await fetch(destination, {
    method: request.method,
    headers,
    body: data,
    signal: AbortSignal.timeout(10_000),
  })
  response.writeHead(forwarded.status, {
    'content-type': forwarded.headers.get('content-type') ?? 'application/json',
  })
  response.end(Buffer.from(await forwarded.arrayBuffer()))
}
async function tool(run: NativeRun, name: string, args: object): Promise<unknown> {
  const stored = state.boxes.find((box) => box.id === run.environmentId)
  const secrets = { ...stored?.env, ...object(run.backend.runtimeSecrets ?? {}) } as Record<
    string,
    string
  >
  const options = attachments(run.backend, secrets)[0]
  if (!options) throw new Error(`no runtime MCP attachment for ${run.executionId}`)
  const response = await fetch(localUrl(options.url), {
    method: 'POST',
    headers: {
      ...options.headers,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `${run.executionId}:${name}`,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(10_000),
  })
  const result = object(await response.json())
  note('mcp-call', {
    environmentId: run.environmentId,
    executionId: run.executionId,
    name,
    arguments: args,
    status: response.status,
    result,
  })
  if (!response.ok || result.error || object(result.result).isError)
    throw new Error(`MCP ${name} refused: ${JSON.stringify(result)}`)
  return result.result
}
function runProfile(run: NativeRun): Record<string, unknown> {
  return object(
    run.backend.profile ?? state.boxes.find((box) => box.id === run.environmentId)?.backend.profile,
  )
}
async function act(run: NativeRun): Promise<void> {
  if (run.actionStarted) return
  run.actionStarted = true
  const profile = runProfile(run)
  const name = String(profile.name)
  const spawnChild =
    (name === 'root' && (scenario.startsWith('unsupported-') || scenario === 'accepted')) ||
    (name === 'credential-manager' && scenario === 'unsupported-descendant')
  const previous = state.requests.find(
    (row) => row.kind === 'spawned-by-service' && row.owner === name,
  )
  if (spawnChild && !previous) {
    const childName =
      name === 'credential-manager'
        ? 'pending-grandchild'
        : scenario === 'accepted'
          ? 'delivered-leaf'
          : 'credential-manager'
    const manager = childName === 'credential-manager'
    const spawned = object(
      await tool(run, 'spawn_worker', {
        key: childName,
        label: childName,
        task: `complete ${childName}`,
        budget:
          name === 'credential-manager'
            ? { maxIterations: 2, maxTokens: 100 }
            : { maxIterations: 20, maxTokens: 1000 },
        profile: {
          name: childName,
          harness: manager ? 'codex' : 'opencode',
          model: {
            provider: 'openai',
            default: 'fixture-model',
            ...(manager ? { metadata: { credentialSource: 'subscription' } } : {}),
          },
          ...(manager
            ? {
                tools: {
                  agent_runtime_coordination_spawn_worker: true,
                  agent_runtime_coordination_submit_result: true,
                },
              }
            : scenario === 'accepted' && childName === 'delivered-leaf'
              ? {
                  // Explicit refusals keep this ordinary native leaf from inheriting manager
                  // coordination rights; its provider result is checked by the run oracle.
                  tools: {
                    agent_runtime_coordination_spawn_worker: false,
                    agent_runtime_coordination_submit_result: false,
                    agent_runtime_coordination_observe_agent: false,
                    agent_runtime_coordination_steer_agent: false,
                  },
                }
              : {}),
        },
      }),
    )
    note('spawned-by-service', {
      owner: name,
      childName,
      workerId: object(spawned.structuredContent).workerId,
    })
  }
  // No model runs here. This process implements the external service's deterministic native turn.
  run.status = 'completed'
  note('native-result-ready', { environmentId: run.environmentId, executionId: run.executionId })
}
async function create(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const input = await body(request)
  const key = String(request.headers['idempotency-key'] ?? '')
  if (!key || key !== input.idempotencyKey)
    throw new Error('SDK did not bind create key in header and body')
  const backend = object(input.backend)
  const profile = object(backend.profile)
  if (scenario === 'terminal-ceiling') {
    const resources = object(input.resources)
    if (resources.cpuCores !== 16) throw new Error('ceiling case must request CPU16')
    note('create', { key, profile: profile.name, resources, status: 400 })
    json(response, 400, {
      error: { code: 'VALIDATION_ERROR', message: 'requested CPU 16 exceeds tenant ceiling 8' },
    })
    return
  }
  const prior = state.boxes.find((box) => box.key === key)
  const mustFail =
    scenario.startsWith('create-') ||
    scenario === 'historical' ||
    (scenario === 'older-lost' && state.boxes.length > 0) ||
    (scenario === 'current-lost' && state.boxes.length > 0) ||
    profile.name === 'pending-grandchild'
  const publicMaterial = publicCreateMaterial(input)
  const publicDigest = digest(publicMaterial)
  let provision = state.provisions.find((row) => row.key === key)
  if (provision && provision.publicDigest !== publicDigest) {
    note('create-conflict', {
      key,
      expectedDigest: provision.publicDigest,
      actualDigest: publicDigest,
    })
    json(response, 409, {
      error: { code: 'IDEMPOTENCY_CONFLICT', message: 'same create key changed public input' },
    })
    return
  }
  if (!provision) {
    provision = { id: `box-${state.provisions.length + 1}`, key, publicDigest }
    note('provision-admitted', { ...provision, publicMaterial })
    state.provisions.push(provision)
  }
  note('create', {
    key,
    provisionId: provision.id,
    publicDigest,
    publicMaterial,
    bodyDigest: digest(input),
    rawCreateBody: input,
    profile: profile.name,
    status: mustFail ? state.createStatus : 200,
    metadata: input.metadata,
  })
  if (mustFail && !state.finish) {
    json(response, state.createStatus, {
      error: {
        code: 'FIXTURE_AMBIGUOUS_CREATE',
        message: 'The service accepted an unresolved create; retry its identity',
        timeoutMs: 250,
      },
    })
    return
  }
  const box = prior ?? {
    id: provision.id,
    key,
    backend,
    metadata: object(input.metadata ?? {}),
    env: object(input.env ?? {}) as Record<string, string>,
  }
  if (!prior) state.boxes.push(box)
  json(response, 200, boxInfo(box.id))
}
async function runtime(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  environmentId: string,
  path: string,
): Promise<void> {
  if (path === '/backend') {
    json(response, 200, {
      type: state.boxes.find((box) => box.id === environmentId)?.backend.type ?? 'opencode',
    })
    return
  }
  if (path === '/health/detailed') {
    json(response, 503, { error: { message: 'fixture does not measure compute resources' } })
    return
  }
  if (path === '/capabilities') {
    json(response, 200, runtimeCapabilities)
    return
  }
  if (path === '/messages/turns') {
    response.writeHead(204)
    response.end()
    return
  }
  if (path === '/files/write' && request.method === 'POST') {
    const input = await body(request)
    if (input.path !== '.agent-runtime-checkpoint')
      throw new Error('unexpected non-checkpoint SDK file write')
    note('optional-checkpoint-unavailable', {
      environmentId,
      operation: 'marker-write',
      status: 501,
      input,
    })
    json(response, 501, {
      error: {
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'fixture exposes no checkpoint filesystem',
        capability: 'files.write',
      },
    })
    return
  }
  if (path === '/process/spawn' && request.method === 'POST') {
    const input = await body(request)
    // Native transcript capture is optional here. Never execute container shell commands
    // against the host; let the actual SDK expose its typed capability refusal.
    note('optional-transcript-unavailable', { environmentId, status: 501, input })
    json(response, 501, {
      error: {
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'fixture does not expose transcript process execution',
        capability: 'process.spawn',
      },
    })
    return
  }
  if (path === '/agents/run/stream') {
    const input = await body(request)
    const executionId = request.headers['x-execution-id']
    note('stream-http-request', { environmentId, executionId, input, bodyDigest: digest(input) })
    const existing = state.runs.find((candidate) => candidate.executionId === executionId)
    const ref =
      input.runControlRef === undefined && existing
        ? existing.runControlRef
        : object(input.runControlRef)
    if (
      ref.environmentId !== environmentId ||
      ref.executionId !== executionId ||
      ref.sessionId !== input.sessionId
    )
      throw new Error('SDK dispatch identity mismatch')
    if (existing) {
      if (
        existing.environmentId !== environmentId ||
        existing.sessionId !== input.sessionId ||
        digest(publicCreateMaterial(existing.runControlRef)) !== digest(publicCreateMaterial(ref))
      )
        throw new Error('SDK replay identity or request digest mismatch')
      note('stream-replay', {
        environmentId,
        executionId,
        sessionId: existing.sessionId,
        requestDigest: existing.runControlRef.requestDigest,
      })
      await replay(existing, response)
      return
    }
    // The SDK may omit backend overrides to use the environment's creation defaults.
    const stored = state.boxes.find((box) => box.id === environmentId)
    if (!stored) throw new Error('SDK dispatch target was not provisioned')
    const run: NativeRun = {
      environmentId,
      sessionId: String(input.sessionId),
      executionId: String(ref.executionId),
      runControlRef: ref,
      backend: input.backend === undefined ? stored.backend : object(input.backend),
      status: 'running',
      terminalReads: 0,
      ...(typeof input.turnId === 'string' ? { turnId: input.turnId } : {}),
    }
    state.runs.push(run)
    if (scenario.startsWith('create-')) {
      let observed!: () => void
      const received = new Promise<void>((resolve) => {
        observed = resolve
      })
      observedReplays.set(run.executionId, { received, observed })
    }
    note('dispatch', {
      environmentId,
      executionId: run.executionId,
      requestDigest: ref.requestDigest,
      sessionId: run.sessionId,
      turnId: run.turnId,
    })
    sse(response, terminal(run).slice(0, 1))
    if (scenario === 'current-lost') state.lost.push(environmentId)
    else if (
      state.finish ||
      (!(scenario === 'accepted' && runProfile(run).name === 'delivered-leaf' && !state.finish) &&
        !scenario.startsWith('cancel-') &&
        !scenario.startsWith('create-') &&
        scenario !== 'historical')
    ) {
      startAction(run)
    }
    return
  }
  if (path === '/agents/run/cancel') {
    const input = await body(request)
    const run = object(input.run)
    const effect = state.cancelEffect
    note('cancel', {
      environmentId,
      executionId: run.executionId,
      operationId: input.operationId,
      requestDigest: input.requestDigest,
      effect,
    })
    const current = state.runs.find((candidate) => candidate.executionId === run.executionId)
    if (current && (effect === 'cancelled' || effect === 'not_live')) current.status = 'cancelled'
    json(response, 200, {
      operationId: input.operationId,
      requestDigest: input.requestDigest,
      run,
      status: effect === 'unknown' ? 'unknown' : 'accepted',
      effect,
    })
    return
  }
  const sessionMatch = path.match(/^\/agents\/sessions\/([^/]+)$/)
  if (sessionMatch) {
    const run = state.runs
      .filter((candidate) => candidate.sessionId === decodeURIComponent(sessionMatch[1]!))
      .at(-1)
    note('session-status', { environmentId, executionId: run?.executionId, status: run?.status })
    if (!run) {
      json(response, 404, { error: { message: 'no session' } })
      return
    }
    json(response, 200, {
      id: run.sessionId,
      status: run.status,
      activeExecutionId: run.executionId,
      latestExecutionId: run.executionId,
      runControlRef: run.runControlRef,
    })
    return
  }
  const eventMatch = path.match(/^\/agents\/run\/([^/]+)\/events$/)
  if (eventMatch || path === '/agents/events') {
    const executionId = eventMatch
      ? decodeURIComponent(eventMatch[1]!)
      : url.searchParams.get('executionId')
    const run = state.runs.find((candidate) => candidate.executionId === executionId)
    // The SDK's result reader binds the session in its query; its native stream binds only the run.
    const exactResult = url.searchParams.has('sessionId')
    note('events', { environmentId, executionId, status: run?.status, exactResult })
    if (!run) {
      json(response, 404, { error: { message: 'no execution' } })
      return
    }
    if (run.environmentId !== environmentId) throw new Error('SDK event target mismatch')
    await replay(run, response, exactResult)
    return
  }
  throw new Error(`unexpected SDK runtime route ${request.method} ${path}`)
}
async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url!, origin)
  if (url.pathname.startsWith('/coordination/')) {
    await proxy(request, response, url)
    return
  }
  if (url.pathname === '/fixture/hold-success') {
    note('successful-attempt-observer-barrier', {
      phase: url.searchParams.get('phase') ?? 'native-result-committed',
    })
    holds.add(response)
    response.once('close', () => holds.delete(response))
    return
  }
  if (url.pathname === '/fixture/state') {
    json(response, 200, state)
    return
  }
  if (url.pathname === '/fixture/control') {
    const control = await body(request)
    if (typeof control.nativeReplayObserved === 'string') {
      const replay = observedReplays.get(control.nativeReplayObserved)
      if (!replay) throw new Error('native replay acknowledgement requires an admitted execution')
      note('native-replay-consumed', { executionId: control.nativeReplayObserved })
      replay.observed()
    }
    if (typeof control.routeKey === 'string' && typeof control.target === 'string')
      state.routes[control.routeKey] = localUrl(control.target).href
    if (control.steerManager === true) {
      if (
        scenario !== 'unsupported-descendant' ||
        state.requests.some((row) => row.kind === 'descendant-steer-started')
      )
        throw new Error('descendant steer is scenario-bound and once only')
      const spawn = state.requests.find(
        (row) => row.kind === 'spawned-by-service' && row.owner === 'root',
      )
      const root = state.runs.find((run) => runProfile(run).name === 'root')
      if (
        !root ||
        typeof spawn?.workerId !== 'string' ||
        !state.requests.some((row) => row.kind === 'create' && row.profile === 'pending-grandchild')
      )
        throw new Error('descendant steer requires actual root/manager/grandchild identities')
      note('descendant-steer-started', { executionId: root.executionId, workerId: spawn.workerId })
      const result = object(
        await tool(root, 'steer_agent', {
          workerId: spawn.workerId,
          instruction: 'Reconcile the admitted grandchild and continue the same assignment.',
          interrupt: false,
        }),
      )
      if (object(result.structuredContent).delivered !== true)
        throw new Error('actual manager steer was not delivered')
      note('descendant-steer-delivered', {
        executionId: root.executionId,
        workerId: spawn.workerId,
      })
    }
    if (typeof control.finish === 'boolean') state.finish = control.finish
    if (
      ['unknown', 'cancel_requested', 'cancelled', 'not_live'].includes(
        String(control.cancelEffect),
      )
    )
      state.cancelEffect = control.cancelEffect as ServiceState['cancelEffect']
    if (Array.isArray(control.lost)) state.lost = control.lost.map(String)
    if (control.nativeStatus === 'cancelled')
      for (const run of state.runs) {
        if (run.status === 'running') {
          run.status = 'cancelled'
          note('native-cancelled', { executionId: run.executionId })
        }
      }
    if (control.finish === true && scenario === 'accepted') {
      for (const run of state.runs.filter((run) => run.status === 'running')) {
        startAction(run)
      }
    }
    note('control', control)
    json(response, 200, { ok: true })
    return
  }
  if (url.pathname === '/usage' || url.pathname === '/subscription') {
    json(response, 503, { error: { message: 'fixture account usage is unmeasured' } })
    return
  }
  if (url.pathname === '/v1/capabilities') {
    json(response, 200, {})
    return
  }
  if (url.pathname === '/v1/backends') {
    json(response, 200, registry)
    return
  }
  if (url.pathname === '/v1/sandboxes' && request.method === 'POST') {
    await create(request, response)
    return
  }
  if (url.pathname === '/v1/sandboxes') {
    json(response, 200, { sandboxes: state.boxes.map((box) => boxInfo(box.id)) })
    return
  }
  const credentialGrant = url.pathname.match(/^\/v1\/sandboxes\/([^/]+)\/native-credentials$/)
  if (credentialGrant && request.method === 'POST') {
    const grant = await body(request)
    note('native-credential-grant', {
      environmentId: credentialGrant[1],
      harness: grant.harness,
      reference: grant.cliAuth,
    })
    json(response, 200, { installed: true, harness: grant.harness, cliAuth: grant.cliAuth })
    return
  }
  const snapshots = url.pathname.match(/^\/v1\/sandboxes\/([^/]+)\/snapshots$/)
  if (snapshots && request.method === 'GET') {
    note('optional-checkpoint-unavailable', {
      environmentId: snapshots[1],
      operation: 'inventory',
      status: 501,
    })
    json(response, 501, {
      error: {
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'fixture exposes no checkpoint inventory',
        capability: 'snapshots',
      },
    })
    return
  }
  const match = url.pathname.match(/^\/v1\/sandboxes\/([^/]+)(?:\/runtime(.*))?$/)
  if (match) {
    const id = decodeURIComponent(match[1]!)
    if (match[2] !== undefined) {
      await runtime(request, response, url, id, match[2])
      return
    }
    if (request.method === 'DELETE') {
      note('delete', { environmentId: id })
      state.lost.push(id)
      json(response, 200, { id, outcome: 'destroyed', removal: 'complete' })
      return
    }
    note('get', { environmentId: id, absent: state.lost.includes(id) })
    json(
      response,
      state.lost.includes(id) ? 404 : 200,
      state.lost.includes(id) ? { error: { message: 'authoritatively absent' } } : boxInfo(id),
    )
    return
  }
  throw new Error(`unexpected SDK route ${request.method} ${url.pathname}`)
}
const server = createServer((request, response) => {
  void route(request, response).catch((error) => {
    state.failures.push(String(error))
    note('fixture-failure', { error: String(error) })
    if (!response.headersSent) json(response, 500, { error: { message: String(error) } })
    else response.destroy()
  })
})
server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no HTTP address')
  origin = `http://127.0.0.1:${address.port}`
  writeAtomicDurableFile(
    join(directory, 'service-ready.json'),
    JSON.stringify({ url: origin, pid: process.pid }),
  )
  note('service-ready', { url: origin, pid: process.pid })
})
process.on('SIGTERM', () => {
  server.closeAllConnections()
  server.close(() => {
    process.exitCode = 0
  })
})
