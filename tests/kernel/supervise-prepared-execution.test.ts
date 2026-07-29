import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  type AgentProfile,
  buildAgentExecutionPreparationReceipt,
  buildAgentWorkspaceLeaseRecord,
  canonicalCandidateDigest,
  profileMaterializationRequests,
  type Sha256Digest,
} from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it } from 'vitest'
import { InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import type {
  RuntimeExecutorPreparationRequest,
  RuntimePreparedExecutorResult,
} from '../../src/runtime/supervise/prepared-executor'
import { supervise } from '../../src/runtime/supervise/supervise'
import type { NodeId, SpawnEvent } from '../../src/runtime/supervise/types'

type BridgeRequest = {
  readonly run_id: string
  readonly agent_profile: AgentProfile
}

const nowMs = 1_000
const runDigest = sha('c')

function sha(character: string): Sha256Digest {
  return `sha256:${character.repeat(64)}` as Sha256Digest
}

async function readJson(request: AsyncIterable<Uint8Array>): Promise<BridgeRequest> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as BridgeRequest
}

function numberSseFrames(body: string): string {
  let sequence = 0
  return body.replace(/^data: (?!\[DONE\])/gmu, () => `id: ${++sequence}\ndata: `)
}

function finishBridgeRun(
  response: ServerResponse,
  request: BridgeRequest,
  content: string,
  events: string[],
  role: 'supervisor' | 'worker',
): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'x-run-id': request.run_id,
    'x-run-request-digest': runDigest,
  })
  events.push(`terminal:${role}`)
  response.end(
    numberSseFrames(
      [
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
        `data: ${JSON.stringify({ usage: { prompt_tokens: 11, completion_tokens: 7, cost: 0.01 } })}`,
        'data: [DONE]',
        '',
      ].join('\n\n'),
    ),
  )
}

async function callCoordination(url: string, name: string, args: unknown): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `${name}-${Date.now()}`,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  if (!response.ok) throw new Error(`coordination ${name} returned ${response.status}`)
}

function preparationResult(
  request: RuntimeExecutorPreparationRequest,
  events: string[],
): RuntimePreparedExecutorResult {
  const issuedAtMs = Date.now()
  const profileActivation = { digest: sha('4') }
  const executionPlanDigest = canonicalCandidateDigest({
    kind: 'supervise-prepared-test-plan',
    requestDigest: request.requestDigest,
  })
  const leaseBase = {
    kind: 'agent-workspace-lease' as const,
    schemaVersion: 1 as const,
    leaseId: `lease-${request.node.attemptId}`,
    ownerId: 'supervise-prepared-test',
    workspace: {
      provider: 'test-private-workspace',
      root: `/tmp/${request.node.nodeId}`,
      identityDigest: sha('2'),
    },
    isolation: 'per-run' as const,
    sourceSnapshotDigest: sha('3'),
    sourceSnapshotPolicy: {
      kind: 'provider-declared' as const,
      name: 'test-source-policy',
      version: 1,
      digest: sha('1'),
    },
    preparedWorkspaceDigest: sha('5'),
    profileActivationDigest: profileActivation.digest,
    createdAtMs: issuedAtMs - 1_000,
    expiresAtMs: issuedAtMs + 60_000,
    cleanupAttempts: 0 as const,
  }
  const sealedLease = buildAgentWorkspaceLeaseRecord({
    ...leaseBase,
    phase: 'workspace-sealed',
    updatedAtMs: issuedAtMs - 500,
  })
  const authoredRequests = new Set(
    profileMaterializationRequests(request.authoredProfile).map(
      (profileRequest) => `${profileRequest.axis}:${profileRequest.path}`,
    ),
  )
  const effectiveRequests = new Set(
    profileMaterializationRequests(request.executionProfile).map(
      (profileRequest) => `${profileRequest.axis}:${profileRequest.path}`,
    ),
  )
  const requests = new Map(
    [
      ...profileMaterializationRequests(request.authoredProfile),
      ...profileMaterializationRequests(request.executionProfile),
    ].map((profileRequest) => [`${profileRequest.axis}:${profileRequest.path}`, profileRequest]),
  )
  const receipt = buildAgentExecutionPreparationReceipt({
    preparationId: `preparation-${request.node.attemptId}`,
    requestDigest: request.requestDigest,
    authoredProfile: request.authoredProfile,
    effectiveProfile: request.executionProfile,
    backend: 'bridge',
    harness: 'codex',
    harnessVersion: 'test-bridge-1',
    resolvedModel: {
      requested: request.executionProfile.model?.default ?? '',
      resolved: request.executionProfile.model?.default ?? 'test/model',
    },
    workspaceLease: sealedLease,
    profileActivation,
    axisResults: [...requests.entries()].map(([key, profileRequest]) => {
      const changed = !authoredRequests.has(key) || !effectiveRequests.has(key)
      return {
        ...profileRequest,
        disposition: changed ? ('overridden' as const) : ('behavior' as const),
        owner: 'executor' as const,
        mechanism: 'test-materializer',
        ...(changed ? { reason: 'Runtime attached its private coordination endpoint' } : {}),
      }
    }),
    executionPlanDigest,
    materializer: { name: 'test-materializer', version: '1.0.0' },
    expiresAtMs: issuedAtMs + 60_000,
    nowMs: issuedAtMs,
  })
  const workspaceLease = buildAgentWorkspaceLeaseRecord({
    ...leaseBase,
    phase: 'execution-bound',
    updatedAtMs: issuedAtMs,
    executionPreparationDigest: receipt.digest,
  })
  return {
    receipt,
    effectiveProfile: request.executionProfile,
    executionPlanDigest,
    profileActivation,
    workspaceLease,
    async release() {
      events.push(`release:${request.role}`)
    },
  }
}

class RecordingJournal extends InMemorySpawnJournal {
  constructor(private readonly events: string[]) {
    super()
  }

  override async appendEvent(root: NodeId, event: SpawnEvent): Promise<void> {
    await super.appendEvent(root, event)
    if (event.kind === 'prepared') this.events.push(`record-prepared:${event.evidence.role}`)
  }
}

function cancellationRunId(url: string | undefined): string | undefined {
  const match = url?.match(/^\/v1\/runs\/([^/]+)\/cancel(?:\?|$)/u)
  return match?.[1] ? decodeURIComponent(match[1]) : undefined
}

function finishCancellation(response: ServerResponse, runId: string): void {
  response.writeHead(200, {
    'content-type': 'application/json',
    'x-run-id': runId,
    'x-run-request-digest': runDigest,
  })
  response.end(
    JSON.stringify({
      terminal: true,
      run: { id: runId, requestDigest: runDigest, terminal: true },
    }),
  )
}

describe('supervise prepared execution', () => {
  let server: Server | undefined

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = undefined
  })

  it('prepares and meters the Runtime-owned PI and backend worker before compute', async () => {
    const events: string[] = []
    const journal = new RecordingJournal(events)
    server = createServer(async (request, response) => {
      try {
        const body = await readJson(request)
        const role = body.agent_profile.name === 'pi-leader' ? 'supervisor' : 'worker'
        events.push(`compute:${role}`)
        if (role === 'supervisor') {
          const coordination = body.agent_profile.mcp?.['agent-runtime-coordination']
          if (!coordination?.url) throw new Error('PI received no Runtime coordination endpoint')
          await callCoordination(coordination.url, 'spawn_agent', {
            profile: {
              name: 'experiment-worker',
              harness: 'codex',
              prompt: { systemPrompt: 'Return the exact measured result.' },
              model: { default: 'gpt-5.6' },
            },
            task: 'Return RESULT=42.',
          })
          await callCoordination(coordination.url, 'await_event', {})
          finishBridgeRun(response, body, 'managed', events, role)
          return
        }
        finishBridgeRun(response, body, 'RESULT=42', events, role)
      } catch (error) {
        response.writeHead(500, { 'content-type': 'text/plain' })
        response.end(error instanceof Error ? error.message : String(error))
      }
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo

    const result = await supervise(
      {
        name: 'pi-leader',
        harness: 'codex',
        prompt: { systemPrompt: 'Choose and supervise one experiment.' },
        model: { default: 'gpt-5.6' },
      },
      'Resolve the pursuit.',
      {
        backend: {
          backend: 'bridge',
          bridgeUrl: `http://127.0.0.1:${port}`,
          bridgeBearer: 'test-token',
          model: 'codex/gpt-5.6',
        },
        budget: { maxIterations: 8, maxTokens: 10_000, maxUsd: 1 },
        perWorker: { maxIterations: 2, maxTokens: 1_000, maxUsd: 0.1 },
        deliverable: {
          check: (output) =>
            typeof output === 'object' &&
            output !== null &&
            (output as { content?: unknown }).content === 'RESULT=42',
          describe: 'worker reports RESULT=42',
        },
        journal,
        now: () => nowMs,
        async prepareExecution(request) {
          events.push(`prepare:${request.role}`)
          return preparationResult(request, events)
        },
      },
    )

    expect(result).toMatchObject({ kind: 'winner', out: { content: 'RESULT=42' } })
    expect(events).toContain('record-prepared:worker')
    expect(result.spentTotal).toMatchObject({
      iterations: 2,
      tokens: { input: 22, output: 14 },
      usd: 0.02,
    })
    expect(result.tree.nodes).toMatchObject([
      {
        status: 'done',
        spent: {
          iterations: 1,
          tokens: { input: 11, output: 7 },
          usd: 0.01,
        },
      },
    ])
    expect(events.indexOf('record-prepared:supervisor')).toBeLessThan(
      events.indexOf('compute:supervisor'),
    )
    expect(events.indexOf('record-prepared:worker')).toBeLessThan(events.indexOf('compute:worker'))
    expect(events.indexOf('terminal:worker')).toBeLessThan(events.indexOf('release:worker'))
    expect(events.indexOf('terminal:supervisor')).toBeLessThan(events.indexOf('release:supervisor'))
    expect(events.filter((event) => event === 'release:worker')).toHaveLength(1)
    expect(events.filter((event) => event === 'release:supervisor')).toHaveLength(1)

    const durable = await journal.loadTree('supervise')
    expect(durable?.filter((event) => event.kind === 'prepared')).toHaveLength(2)
    expect(
      durable?.filter((event) => event.kind === 'prepared').map((event) => event.evidence.role),
    ).toEqual(['supervisor', 'worker'])
    expect(durable?.find((event) => event.kind === 'metered')).toMatchObject({
      spend: {
        iterations: 1,
        tokens: { input: 11, output: 7 },
        usd: 0.01,
      },
    })
  })

  it('cancels a failed backend run before releasing its private workspace', async () => {
    const events: string[] = []
    const journal = new RecordingJournal(events)
    const rolesByRun = new Map<string, 'supervisor' | 'worker'>()
    server = createServer(async (request, response) => {
      const cancelled = cancellationRunId(request.url)
      if (cancelled !== undefined) {
        const role = rolesByRun.get(cancelled)
        if (role) events.push(`cancel:${role}`)
        finishCancellation(response, cancelled)
        return
      }
      try {
        const body = await readJson(request)
        const role = body.agent_profile.name === 'pi-leader' ? 'supervisor' : 'worker'
        rolesByRun.set(body.run_id, role)
        events.push(`compute:${role}`)
        if (role === 'supervisor') {
          const coordination = body.agent_profile.mcp?.['agent-runtime-coordination']
          if (!coordination?.url) throw new Error('PI received no Runtime coordination endpoint')
          await callCoordination(coordination.url, 'spawn_agent', {
            profile: {
              name: 'failing-worker',
              harness: 'codex',
              model: { default: 'gpt-5.6' },
            },
            task: 'Fail after partial measured work.',
          })
          await callCoordination(coordination.url, 'await_event', {})
          finishBridgeRun(response, body, 'worker failed', events, role)
          return
        }
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'x-run-id': body.run_id,
          'x-run-request-digest': runDigest,
        })
        response.write(
          `id: 1\ndata: ${JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 2, cost: 0.004 } })}\n\n`,
        )
        setTimeout(() => response.socket?.destroy(new Error('worker transport failed')), 5)
      } catch (error) {
        response.writeHead(500, { 'content-type': 'text/plain' })
        response.end(error instanceof Error ? error.message : String(error))
      }
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo

    const result = await supervise(
      {
        name: 'pi-leader',
        harness: 'codex',
        model: { default: 'gpt-5.6' },
      },
      'Run the risky experiment.',
      {
        backend: {
          backend: 'bridge',
          bridgeUrl: `http://127.0.0.1:${port}`,
          bridgeBearer: 'test-token',
          model: 'codex/gpt-5.6',
        },
        budget: { maxIterations: 8, maxTokens: 10_000, maxUsd: 1 },
        perWorker: { maxIterations: 2, maxTokens: 1_000, maxUsd: 0.1 },
        journal,
        now: () => nowMs,
        async prepareExecution(request) {
          events.push(`prepare:${request.role}`)
          return preparationResult(request, events)
        },
      },
    )

    expect(result.kind).toBe('no-winner')
    expect(events.indexOf('record-prepared:worker')).toBeLessThan(events.indexOf('compute:worker'))
    expect(events.indexOf('cancel:worker')).toBeGreaterThan(events.indexOf('compute:worker'))
    expect(events.indexOf('cancel:worker')).toBeLessThan(events.indexOf('release:worker'))
    expect(events.filter((event) => event === 'release:worker')).toHaveLength(1)
    expect(events.indexOf('terminal:supervisor')).toBeLessThan(events.indexOf('release:supervisor'))
  })
})
