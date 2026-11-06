import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { expect, it } from 'vitest'
import {
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
} from '../../src/durable/in-memory-spawn-stores'
import type { MakeWorkerAgent } from '../../src/mcp/tools/coordination-contracts'
import { profileChatClient } from '../../src/runtime/profile-chat-client'
import { FileCoordinationLog } from '../../src/runtime/supervise/coordination-log'
import { serveCoordinationMcpForManager } from '../../src/runtime/supervise/coordination-mcp'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Agent } from '../../src/runtime/supervise/types'

function bounded<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms)
  })
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer))
}

it('sends caller Router headers and keeps Runtime connection headers', async () => {
  const seen: Array<Record<string, string | string[] | undefined>> = []
  const server = createServer((request, response) => {
    seen.push(request.headers)
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const frames = [
      {
        model: 'header-proof-model',
        choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }],
      },
      {
        model: 'header-proof-model',
        choices: [],
        usage: { prompt_tokens: 2, completion_tokens: 1, cost: 0.001 },
      },
    ]
    for (const frame of frames) response.write(`data: ${JSON.stringify(frame)}\n\n`)
    response.end('data: [DONE]\n\n')
  })
  await bounded(
    new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    }),
    1_000,
    'loopback server startup',
  )
  try {
    const { port } = server.address() as AddressInfo
    const profile: AgentProfile = {
      name: 'header-proof',
      harness: 'cli-base',
      model: {
        provider: 'tangle-router',
        default: 'header-proof-model',
        metadata: { stream: true, retry: { maxAttempts: 1, requestTimeoutMs: 0 } },
      },
    }
    const client = profileChatClient({
      profile,
      context: 'header proof',
      headers: {
        'x-tangle-client': 'braid/test',
        authorization: 'Bearer caller-must-not-win',
        'content-type': 'text/plain',
        'idempotency-key': 'caller-must-not-win',
        'x-correlation-id': 'caller-must-not-win',
      },
      executor: {
        backend: 'router',
        routerBaseUrl: `http://127.0.0.1:${port}`,
        routerKey: 'loopback-only',
      },
    })
    const response = await bounded(
      client.chat(
        { messages: [{ role: 'user', content: 'hi' }] },
        { idempotencyKey: 'paid-call-1', correlationId: 'corr-1' },
      ),
      3_000,
      'profile chat',
    )
    expect(response.content).toBe('ok')
    expect(seen).toHaveLength(1)
    const headers = seen[0]
    expect(headers?.['x-tangle-client']).toBe('braid/test')
    expect(headers?.authorization).toBe('Bearer loopback-only')
    expect(headers?.['content-type']).toBe('application/json')
    expect(headers?.['idempotency-key']).toBe('paid-call-1')
    expect(headers?.['x-correlation-id']).toBe('corr-1')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

it('records handler timing for a coordination tool call in the coordination log', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tool-timing-'))
  const log = new FileCoordinationLog(join(directory, 'coordination-log.jsonl'))
  const blobs = new InMemoryResultBlobStore()
  const journal = new InMemorySpawnJournal()
  const scopeStop = new AbortController()
  const runId = 'tool-timing-proof'
  let exercise: Promise<void> | undefined
  const makeWorkerAgent: MakeWorkerAgent = () => {
    throw new Error('this proof does not spawn')
  }
  const root: Agent<unknown, unknown> = {
    name: 'tool-timing-owner',
    async act(_task, scope) {
      const { handle: mcp } = await serveCoordinationMcpForManager({
        scope,
        blobs,
        makeWorkerAgent,
        perWorker: { maxIterations: 1, maxTokens: 100 },
        toolNames: ['list_questions'],
        authentication: true,
        identity: { runId, actorId: scope.view.root },
        onEvent: (_event, record) => log.append(runId, record, runId),
      })
      try {
        exercise = (async () => {
          const response = await fetch(mcp.url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...mcp.headers },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: { name: 'list_questions', arguments: {} },
            }),
            signal: AbortSignal.timeout(5_000),
          })
          const body = (await response.json()) as {
            error?: unknown
            result?: { isError?: boolean }
          }
          expect(response.status, JSON.stringify(body)).toBe(200)
          expect(body.error, JSON.stringify(body)).toBeUndefined()
          expect(body.result?.isError, JSON.stringify(body)).not.toBe(true)
          const prior = await log.load(runId, runId)
          const timings = prior.records.filter((record) => record.event.type === 'tool-timing')
          expect(timings).toHaveLength(1)
          expect(timings[0]?.event).toMatchObject({
            type: 'tool-timing',
            call: { tool: 'list_questions', ok: true },
          })
          const call = timings[0]?.event.type === 'tool-timing' ? timings[0].event.call : undefined
          expect(call?.receivedAt).toBeGreaterThan(0)
          expect(call?.elapsedMs).toBeGreaterThanOrEqual(0)
          expect(call?.responseBytes).toBeGreaterThan(0)
        })()
        await exercise
        return { checked: true }
      } finally {
        await mcp.close()
      }
    },
  }
  try {
    await createSupervisor().run(
      root,
      {},
      {
        budget: { maxIterations: 4, maxTokens: 1000, deadlineMs: 15_000 },
        runId,
        journal,
        blobs,
        executors: createExecutorRegistry(),
        signal: scopeStop.signal,
      },
    )
    await exercise
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
