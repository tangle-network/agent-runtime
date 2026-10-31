import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { runSettledCommand } from '../../../src/mcp/worktree-harness'
import { writeAtomicDurableFile } from '../../../src/runtime/supervise/durable-file'
import {
  attachments,
  digest,
  encodeFrame,
  localUrl,
  type NativeRun,
  nativeEventFile,
  object,
  publicCreateMaterial,
  record,
  registry,
  runtimeCapabilities,
  secretProfileReceipt,
  type Scenario,
  type ServiceState,
  terminal,
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
// Synthetic public container coordinates belong only to this loopback service. They do not
// claim a real transcript or complete capture; these cases stop at execution admission.
const captureProof = {
  hostId: 'local-http-fixture',
  containerId: 'a'.repeat(64),
  imageId: `sha256:${'b'.repeat(64)}`,
  bundleRevision: 'c'.repeat(40),
  bundleChecksum: `sha256:${'d'.repeat(64)}`,
}
let origin = ''
const holds = new Set<ServerResponse>()
const nativeActions = new Map<string, Promise<void>>()
const sessions = new Map<
  string,
  { backend: Record<string, unknown>; receipt?: string; publicDigest?: unknown }
>()
const acceptedSubscribers = new Map<string, Set<ServerResponse>>()
// A real provider streams a turn's frames before its result is readable. The fixture serves the
// exact-result read this long after the observation stream's terminal frames, so Runtime's quiet
// stream never closes on the result before it reads done (RETAINED_TAIL_FLOW_MS is 100).
const EXACT_RESULT_AFTER_STREAM_MS = 250
const exactSubscribers = new WeakSet<ServerResponse>()
const streamFlushedAt = new Map<string, number>()
const observedReplays = new Map<string, { received: Promise<void>; observed: () => void }>()
function startAction(run: NativeRun): void {
  const action = act(run)
  nativeActions.set(run.executionId, action)
  void action.catch((error) => {
    state.failures.push(String(error))
    note('fixture-failure', { error: String(error) })
  })
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
function jsonError(response: ServerResponse, status: number, error: object): void {
  json(response, status, { error })
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  let text = ''
  for await (const chunk of request) {
    text += chunk
    if (text.length > 2_000_000) throw new Error('request too large')
  }
  return text ? object(JSON.parse(text)) : {}
}
function boxInfo(id: string, outcome: 'created' | 'idempotent_replay' = 'idempotent_replay') {
  return {
    id,
    status: 'running',
    filesystemIncarnationId: `incarnation-${id}`,
    filesystemIncarnationProvenance: 'fresh',
    filesystemIncarnationReadiness: 'ready',
    metadata: state.boxes.find((box) => box.id === id)?.metadata,
    connection: { runtimeUrl: origin },
    ...(scenario.startsWith('dispatch-')
      ? {
          captureProof,
          createReceipt: { outcome, idempotencyKeyApplied: true, captureProof },
        }
      : {}),
    createdAt: new Date().toISOString(),
  }
}
function writeFrames(
  response: ServerResponse,
  frames: Array<{ type: string; data: object }>,
  offset = 0,
): void {
  frames.forEach((frame, index) => {
    response.write(encodeFrame(frame, offset + index + 1))
  })
}
function sse(
  response: ServerResponse,
  frames: Array<{ type: string; data: object }> | Buffer,
): void {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  if (Buffer.isBuffer(frames)) response.end(frames)
  else {
    writeFrames(response, frames)
    response.end()
  }
}
function subscribeAccepted(run: NativeRun, response: ServerResponse, exactResult: boolean): void {
  if (exactResult) exactSubscribers.add(response)
  const subscribers = acceptedSubscribers.get(run.executionId) ?? new Set<ServerResponse>()
  acceptedSubscribers.set(run.executionId, subscribers)
  subscribers.add(response)
  response.on('close', () => {
    subscribers.delete(response)
    if (subscribers.size === 0) acceptedSubscribers.delete(run.executionId)
    // A lost coordinator connection does not cancel the independent native execution.
  })
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  writeFrames(response, terminal(run, scenario).slice(0, 1))
  note('healthy-stream-open', { executionId: run.executionId, environmentId: run.environmentId })
}
function flushAccepted(run: NativeRun): void {
  if (scenario !== 'accepted' || run.status !== 'completed') return
  const subscribers = acceptedSubscribers.get(run.executionId)
  if (!subscribers) return
  const finish = (response: ServerResponse) => {
    if (response.destroyed || response.writableEnded) return
    // IDs 2 and 3 are the same canonical result/done positions as a completed replay.
    writeFrames(response, terminal(run, scenario).slice(1), 1)
    response.end()
    run.terminalReads += 1
  }
  const exact = [...subscribers].filter((response) => exactSubscribers.has(response))
  for (const response of subscribers) if (!exactSubscribers.has(response)) finish(response)
  streamFlushedAt.set(run.executionId, Date.now())
  if (exact.length > 0) setTimeout(() => exact.forEach(finish), EXACT_RESULT_AFTER_STREAM_MS)
  acceptedSubscribers.delete(run.executionId)
  note('healthy-stream-completed', {
    executionId: run.executionId,
    environmentId: run.environmentId,
  })
}
async function replay(
  run: NativeRun,
  response: ServerResponse,
  exactResult = false,
): Promise<void> {
  if ((scenario === 'accepted' || scenario.startsWith('dispatch-')) && run.status === 'running') {
    subscribeAccepted(run, response, exactResult)
    return
  }
  if (run.status === 'running' && nativeActions.has(run.executionId))
    await nativeActions.get(run.executionId)
  if (run.status === 'running') {
    jsonError(response, 408, {
      code: 'FIXTURE_OBSERVATION_UNKNOWN',
      message: 'exact execution remains unresolved',
    })
    return
  }
  if (scenario === 'json-incomplete' && !exactResult) {
    subscribeAccepted(run, response, exactResult)
    return
  }
  const flushedAt = streamFlushedAt.get(run.executionId)
  if (exactResult && flushedAt !== undefined) {
    const wait = flushedAt + EXACT_RESULT_AFTER_STREAM_MS - Date.now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  }
  const replay = observedReplays.get(run.executionId)
  if (replay && exactResult) await replay.received
  // Let the independently requested exact result win before this connection's first frame.
  // The actual closed worker already supplied the terminal data; no observation is fabricated.
  if (scenario === 'sql-conformance' && !exactResult)
    await new Promise<void>((resolve) => setTimeout(resolve, 40))
  run.terminalReads += 1
  sse(
    response,
    scenario.startsWith('trace-tree-') && run.processResult?.exitCode === 0
      ? readFileSync(join(directory, nativeEventFile(run.executionId)))
      : terminal(run, scenario),
  )
  // A completed old invocation loses its environment before the next invocation starts.
  if (scenario === 'older-lost' && run.environmentId === 'box-1') state.lost.push('box-1')
}
async function proxy(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const key = url.pathname.split('/')[2]!
  const target = state.routes[key]
  if (!target) {
    return json(response, 503, { error: 'coordinator not registered' })
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
  if (
    scenario.startsWith('json-') ||
    scenario.startsWith('trace-') ||
    scenario === 'sql-conformance'
  ) {
    const startedAt = Date.now()
    const worker = await runSettledCommand({
      command: process.execPath,
      args: [
        join(import.meta.dirname, 'json-worker.mjs'),
        String(profile.name),
        scenario,
        JSON.stringify({ executionId: run.executionId, sessionId: run.sessionId }),
      ],
      cwd: directory,
      timeoutMs: 5000,
      signal: new AbortController().signal,
    })
    run.processResult = {
      output: worker.stdout,
      exitCode: worker.exitCode,
      startedAt,
      closedAt: Date.now(),
    }
    note('json-worker-closed', { executionId: run.executionId, code: worker.exitCode })
    if (scenario === 'json-owner-capture' || scenario.startsWith('trace-owner'))
      await tool(run, 'submit_result', { result: { answer: 'delivered' } })
  }
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
  // Same tick as completion: no exact-result read can observe the run before its open stream
  // receives the result and done frames, so Runtime never closes that stream on its result.
  flushAccepted(run)
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
    return json(response, 400, {
      error: { code: 'VALIDATION_ERROR', message: 'requested CPU 16 exceeds tenant ceiling 8' },
    })
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
    return json(response, 409, {
      error: { code: 'IDEMPOTENCY_CONFLICT', message: 'same create key changed public input' },
    })
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
    jsonError(response, state.createStatus, {
      code: 'FIXTURE_AMBIGUOUS_CREATE',
      message: 'The service accepted an unresolved create; retry its identity',
      timeoutMs: 250,
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
  json(response, 200, boxInfo(box.id, prior ? 'idempotent_replay' : 'created'))
}
async function runtime(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  environmentId: string,
  path: string,
): Promise<void> {
  const input = request.method === 'POST' ? await body(request) : {}
  if (path === '/backend') {
    const selected =
      !scenario.startsWith('dispatch-') ||
      (scenario === 'dispatch-refused' && state.runs.length > 0)
    if (scenario.startsWith('dispatch-'))
      note('backend-status', { environmentId, status: selected ? 200 : 404 })
    return json(
      response,
      selected ? 200 : 404,
      selected
        ? { type: state.boxes.find((box) => box.id === environmentId)?.backend.type ?? 'opencode' }
        : { code: 'NOT_FOUND', message: 'No selected backend' },
    )
  }
  if (path === '/health/detailed') {
    return json(response, 503, { error: { message: 'fixture does not measure compute resources' } })
  }
  if (path === '/capabilities') {
    if (scenario.startsWith('dispatch-')) note('required-capture-capabilities', { environmentId })
    return json(response, 200, {
      ...runtimeCapabilities,
      ...(scenario.startsWith('dispatch-')
        ? { nativeSessionCaptureVersion: 2, nativeSessionCaptureHarnesses: ['opencode'] }
        : {}),
    })
  }
  if (path === '/messages/turns') {
    response.writeHead(204)
    response.end()
    return
  }
  const inventory = path === '/snapshots' && request.method === 'GET'
  if (
    inventory ||
    (request.method === 'POST' && ['/files/write', '/process/spawn'].includes(path))
  ) {
    const checkpoint = path !== '/process/spawn'
    if (!inventory && checkpoint && input.path !== '.agent-runtime-checkpoint')
      throw new Error('unexpected non-checkpoint SDK file write')
    // This transport peer exposes neither checkpoint storage nor container shell execution.
    note(checkpoint ? 'optional-checkpoint-unavailable' : 'optional-transcript-unavailable', {
      environmentId,
      ...(checkpoint ? { operation: inventory ? 'inventory' : 'marker-write' } : {}),
      status: 501,
      ...(inventory ? {} : { input }),
    })
    return jsonError(response, 501, {
      code: 'CAPABILITY_UNSUPPORTED',
      message: inventory
        ? 'fixture exposes no checkpoint inventory'
        : checkpoint
          ? 'fixture exposes no checkpoint filesystem'
          : 'fixture does not expose transcript process execution',
      capability: inventory ? 'snapshots' : checkpoint ? 'files.write' : 'process.spawn',
    })
  }
  const prepare = path.match(/^\/agents\/sessions\/([^/]+)\/public-profile-revisions\/prepare$/)
  if ((path === '/agents/sessions' || prepare) && request.method === 'POST') {
    const id = prepare ? decodeURIComponent(prepare[1]!) : String(input.sessionId)
    const key = `${environmentId}:${id}`
    const backend = object(input.backend)
    const prior = sessions.get(key)
    if (!prepare) {
      if (
        backend.runtimeSecrets !== undefined ||
        (prior && digest(prior.backend) !== digest(backend))
      )
        throw new Error('session create changed persisted backend or exposed turn-only secrets')
      sessions.set(key, prior ?? { backend })
      note('session-created', { environmentId, sessionId: id })
      json(response, 200, { id, status: 'running' })
    } else {
      if (
        !prior ||
        input.secret !== true ||
        object(backend.metadata).profileSecretIsolation !== true ||
        typeof input.expectedPublicProfileRequestDigest !== 'string'
      )
        throw new Error('private preparation changed session or public request identity')
      prior.receipt = secretProfileReceipt(backend)
      prior.publicDigest = input.expectedPublicProfileRequestDigest
      note('private-profile-prepared', { environmentId, sessionId: id, transportOnly: true })
      json(response, 200, {
        workspacePlanDigest: digest(publicCreateMaterial(backend)),
        executorReceipt: prior.receipt,
        conflicts: [],
      })
    }
    return
  }
  if (path === '/agents/run/stream') {
    const executionId = request.headers['x-execution-id']
    note('stream-http-request', { environmentId, executionId, input, bodyDigest: digest(input) })
    const existing = state.runs.find((candidate) => candidate.executionId === executionId)
    const prepared = sessions.get(`${environmentId}:${input.sessionId}`)
    const isolated =
      object(object(input.backend ?? {}).metadata ?? {}).profileSecretIsolation === true
    if (
      !existing &&
      isolated &&
      (!prepared?.receipt ||
        input.expectedSecretProfileReceipt !== prepared.receipt ||
        prepared.receipt !== secretProfileReceipt(input.backend) ||
        input.expectedPublicProfileRequestDigest !== prepared.publicDigest)
    )
      throw new Error('dispatch did not match its private profile preparation')
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
    if (scenario === 'dispatch-refused' && !state.finish) {
      if (existing) throw new Error('predispatch refusal cannot hide an admitted execution')
      note('dispatch-refused', { environmentId, executionId, input, status: 503 })
      return json(response, 503, {
        status: 'error',
        code: 'HUB_CREDENTIAL_REFRESH_FAILED',
        message: 'Sandbox Hub credential is temporarily unavailable.',
      })
    }
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
    if (
      scenario.startsWith('create-') ||
      ((scenario.startsWith('json-') || scenario.startsWith('trace-')) &&
        scenario !== 'json-incomplete')
    ) {
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
    if (scenario === 'dispatch-lost-reply') {
      note('dispatch-reply-lost', { environmentId, executionId: run.executionId })
      return json(response, 503, {
        status: 'error',
        code: 'SERVER_ERROR',
        message: 'Admission reply lost',
      })
    }
    sse(response, terminal(run, scenario).slice(0, 1))
    if (scenario.startsWith('dispatch-')) {
      note('execution-started-sent', { environmentId, executionId: run.executionId })
      return
    }
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
    return json(response, 200, {
      operationId: input.operationId,
      requestDigest: input.requestDigest,
      run,
      status: effect === 'unknown' ? 'unknown' : 'accepted',
      effect,
    })
  }
  const sessionMatch = path.match(/^\/agents\/sessions\/([^/]+)$/)
  const eventMatch = path.match(/^\/agents\/run\/([^/]+)\/events$/)
  if (sessionMatch || eventMatch || path === '/agents/events') {
    const match = sessionMatch ?? eventMatch
    const id = match ? decodeURIComponent(match[1]!) : url.searchParams.get('executionId')
    const key = sessionMatch ? 'sessionId' : 'executionId'
    const run = state.runs.filter((candidate) => candidate[key] === id).at(-1)
    // Only the independently requested exact result binds a session query.
    const exactResult = url.searchParams.has('sessionId')
    note(sessionMatch ? 'session-status' : 'events', {
      environmentId,
      executionId: sessionMatch ? run?.executionId : id,
      status: run?.status,
      ...(sessionMatch ? {} : { exactResult }),
    })
    if (!run)
      return jsonError(response, 404, { message: sessionMatch ? 'no session' : 'no execution' })
    if (sessionMatch) {
      return json(response, 200, {
        id: run.sessionId,
        status: run.status,
        activeExecutionId: run.executionId,
        latestExecutionId: run.executionId,
        runControlRef: run.runControlRef,
      })
    }
    if (run.environmentId !== environmentId) throw new Error('SDK event target mismatch')
    return replay(run, response, exactResult)
  }
  throw new Error(`unexpected SDK runtime route ${request.method} ${path}`)
}
async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url!, origin)
  if (url.pathname.startsWith('/coordination/')) {
    return proxy(request, response, url)
  }
  if (url.pathname === '/fixture/hold-success') {
    if (
      (scenario === 'json-owner-capture' || scenario === 'trace-owner-evidence') &&
      state.finish
    ) {
      return json(response, 200, { ok: true })
    }
    note('successful-attempt-observer-barrier', {
      phase: url.searchParams.get('phase') ?? 'native-result-committed',
    })
    holds.add(response)
    response.once('close', () => holds.delete(response))
    return
  }
  if (url.pathname === '/fixture/state') {
    return json(response, 200, state)
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
    if ((scenario === 'json-owner-capture' || scenario === 'trace-owner-evidence') && state.finish)
      for (const held of holds) json(held, 200, { ok: true })
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
    return json(response, 200, { ok: true })
  }
  if (url.pathname === '/usage' || url.pathname === '/subscription') {
    return json(response, 503, { error: { message: 'fixture account usage is unmeasured' } })
  }
  if (url.pathname === '/v1/capabilities') {
    return json(response, 200, {})
  }
  if (url.pathname === '/v1/backends') {
    return json(response, 200, registry)
  }
  if (url.pathname === '/v1/sandboxes' && request.method === 'POST') {
    return create(request, response)
  }
  if (url.pathname === '/v1/sandboxes') {
    return json(response, 200, { sandboxes: state.boxes.map((box) => boxInfo(box.id)) })
  }
  const credentialGrant = url.pathname.match(/^\/v1\/sandboxes\/([^/]+)\/native-credentials$/)
  if (credentialGrant && request.method === 'POST') {
    const grant = await body(request)
    note('native-credential-grant', {
      environmentId: credentialGrant[1],
      harness: grant.harness,
      reference: grant.cliAuth,
    })
    return json(response, 200, { installed: true, harness: grant.harness, cliAuth: grant.cliAuth })
  }
  const snapshots = url.pathname.match(/^\/v1\/sandboxes\/([^/]+)\/snapshots$/)
  if (snapshots && request.method === 'GET')
    return runtime(request, response, url, snapshots[1]!, '/snapshots')
  const match = url.pathname.match(/^\/v1\/sandboxes\/([^/]+)(?:\/runtime(.*))?$/)
  if (match) {
    const id = decodeURIComponent(match[1]!)
    if (match[2] !== undefined) {
      return runtime(request, response, url, id, match[2])
    }
    if (request.method === 'DELETE') {
      if (scenario.startsWith('json-') && !state.finish) {
        note('json-result-delete-held', { environmentId: id })
        holds.add(response)
        response.once('close', () => holds.delete(response))
        return
      }
      note('delete', { environmentId: id })
      state.lost.push(id)
      return json(response, 200, { id, outcome: 'destroyed', removal: 'complete' })
    }
    note('get', { environmentId: id, absent: state.lost.includes(id) })
    return json(
      response,
      state.lost.includes(id) ? 404 : 200,
      state.lost.includes(id) ? { error: { message: 'authoritatively absent' } } : boxInfo(id),
    )
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
  server.close()
})
