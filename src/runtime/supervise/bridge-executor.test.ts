import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it } from 'vitest'
import { spendFromUsageEvents } from './budget'
import { bridgeExecutor } from './runtime'
import type { UsageEvent } from './types'

/** Serve one canned cli-bridge response body per request (HTTP 200 unless told
 *  otherwise) and hand back the bridge URL — the upstream-failure shapes under
 *  test are byte-level wire artifacts, so the test speaks real HTTP. */
async function startBridgeStub(
  body: string,
  opts: {
    status?: number
    contentType?: string
    onRequest?: (body: Record<string, unknown>) => void
  } = {},
): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    let requestBody = ''
    req.on('data', (chunk) => {
      requestBody += String(chunk)
    })
    req.on('end', () => {
      if (opts.onRequest) {
        opts.onRequest(JSON.parse(requestBody) as Record<string, unknown>)
      }
      res.writeHead(opts.status ?? 200, {
        'content-type': opts.contentType ?? 'text/event-stream',
      })
      res.end(body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, server }
}

function makeExecutor(bridgeUrl: string) {
  const profile: AgentProfile = { name: 'bridge-test-worker' }
  return bridgeExecutor(
    { profile, harness: null },
    {
      nodeId: 'bridge-executor-test',
      signal: new AbortController().signal,
      seams: {
        bridge: {
          bridgeUrl,
          bridgeBearer: 'test-bearer',
          model: 'kimi-k2',
          maxTurns: 1,
        },
      },
    },
  )
}

async function drain(stream: AsyncIterable<UsageEvent>): Promise<UsageEvent[]> {
  const events: UsageEvent[] = []
  for await (const ev of stream) events.push(ev)
  return events
}

describe('bridgeExecutor upstream-error propagation', () => {
  let server: Server | undefined
  afterEach(async () => {
    if (server) await new Promise((resolve) => server?.close(resolve))
    server = undefined
  })

  it('throws the upstream error from a bare JSON error body (no SSE framing)', async () => {
    // The kimi failure shape: HTTP 200, plain JSON error object, zero SSE frames.
    // Before the tail parse this drained as one empty zero-token result.
    const stub = await startBridgeStub(
      JSON.stringify({ error: { type: 'access_terminated_error', message: 'account terminated' } }),
      { contentType: 'application/json' },
    )
    server = stub.server
    const executor = makeExecutor(stub.url)
    const stream = executor.execute('do the task', new AbortController().signal)
    await expect(drain(stream as AsyncIterable<UsageEvent>)).rejects.toThrow(
      /bridge upstream error: account terminated/,
    )
    // The run still fails loud end-to-end: no artifact was produced.
    expect(() => executor.resultArtifact()).toThrow(/before stream drained/)
  })

  it('throws from an UNTERMINATED final SSE error frame (no trailing blank line)', async () => {
    const frame = `data: ${JSON.stringify({ error: { type: 'access_terminated_error' } })}\n`
    const stub = await startBridgeStub(frame)
    server = stub.server
    const executor = makeExecutor(stub.url)
    const stream = executor.execute('do the task', new AbortController().signal)
    // No `message` on the payload — the error class must still surface, never 'unknown'.
    await expect(drain(stream as AsyncIterable<UsageEvent>)).rejects.toThrow(
      /bridge stream error: access_terminated_error/,
    )
  })

  it('still throws on a mid-stream terminated SSE error frame', async () => {
    const body = `data: ${JSON.stringify({ error: { message: 'quota exhausted' } })}\n\n`
    const stub = await startBridgeStub(body)
    server = stub.server
    const executor = makeExecutor(stub.url)
    const stream = executor.execute('do the task', new AbortController().signal)
    await expect(drain(stream as AsyncIterable<UsageEvent>)).rejects.toThrow(
      /bridge stream error: quota exhausted/,
    )
  })

  it('drains a healthy stream unchanged and settles the artifact (tail parse is inert)', async () => {
    const chunks = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'final answer' } }] })}`,
      `data: ${JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 4, cost: 0.01 } })}`,
      'data: [DONE]',
    ]
    const stub = await startBridgeStub(`${chunks.join('\n\n')}\n\n`)
    server = stub.server
    const executor = makeExecutor(stub.url)
    const events = await drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )
    expect(events).toContainEqual({ kind: 'tokens', input: 10, output: 4 })
    const artifact = executor.resultArtifact()
    expect(artifact.out).toMatchObject({ content: 'final answer' })
    expect(artifact.spent.tokens).toEqual({ input: 10, output: 4 })
  })

  it('meters one iteration per bridge turn instead of one per content chunk', async () => {
    const chunks = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'first ' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'second ' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'third' } }] })}`,
      `data: ${JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 4, cost: 0.01 } })}`,
      'data: [DONE]',
    ]
    const stub = await startBridgeStub(`${chunks.join('\n\n')}\n\n`)
    server = stub.server
    const executor = makeExecutor(stub.url)
    const events = await drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )

    expect(events.filter((event) => event.kind === 'iteration')).toHaveLength(1)
    const normalized = spendFromUsageEvents(events)
    const artifact = executor.resultArtifact()
    expect(artifact.out).toMatchObject({ content: 'first second third' })
    expect(normalized).toEqual({ ...artifact.spent, ms: 0 })
  })

  it('sends the exact effective profile and deterministic node identity', async () => {
    let requestBody: Record<string, unknown> | undefined
    const stub = await startBridgeStub(
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'done' } }] })}\n\ndata: [DONE]\n\n`,
      {
        onRequest: (body) => {
          requestBody = body
        },
      },
    )
    server = stub.server
    const profile: AgentProfile = {
      harness: 'claude-code',
      model: { default: 'sonnet' },
      mcp: {
        coordination: {
          transport: 'http',
          url: 'http://127.0.0.1:4444/mcp',
        },
      },
    }
    const executor = bridgeExecutor(
      { profile },
      {
        nodeId: 'tree:s3',
        signal: new AbortController().signal,
        seams: {
          bridge: {
            bridgeUrl: stub.url,
            bridgeBearer: 'test-bearer',
            maxTurns: 1,
          },
        },
      },
    )

    await drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )

    expect(requestBody).toMatchObject({
      model: 'claude-code/sonnet',
      session_id: 'tree:s3',
      run_id: 'tree:s3:turn:0',
      agent_profile: profile,
    })
  })
})
