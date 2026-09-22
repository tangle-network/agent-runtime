import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it } from 'vitest'
import { spendFromUsageEvents } from './budget'
import { bridgeExecutor } from './runtime'
import type { UsageEvent } from './types'

const testRunDigest = `sha256:${'d'.repeat(64)}`

function numberSseDataFrames(body: string): string {
  let seq = 0
  return body.replace(/^data: (?!\[DONE\])/gmu, () => `id: ${++seq}\ndata: `)
}

/** Serve one canned cli-bridge response body per request (HTTP 200 unless told
 *  otherwise) and hand back the bridge URL — the upstream-failure shapes under
 *  test are byte-level wire artifacts, so the test speaks real HTTP. */
async function startBridgeStub(
  body: string,
  opts: { status?: number; contentType?: string } = {},
): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    const runId = String(req.headers['x-run-id'] ?? '')
    res.writeHead(opts.status ?? 200, {
      'content-type': opts.contentType ?? 'text/event-stream',
      'x-run-id': runId,
      'x-run-request-digest': testRunDigest,
    })
    res.end(
      (opts.contentType ?? 'text/event-stream') === 'text/event-stream'
        ? numberSseDataFrames(body)
        : body,
    )
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
      signal: new AbortController().signal,
      seams: { bridge: { bridgeUrl, bridgeBearer: 'test-bearer', model: 'kimi-k2' } },
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
    server?.closeAllConnections()
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

  it('reconnects one durable run from the last contiguous event id', async () => {
    const runIds: string[] = []
    const replayCursors: Array<string | undefined> = []
    let attempts = 0
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { run_id: string }
      runIds.push(body.run_id)
      replayCursors.push(req.headers['last-event-id'] as string | undefined)
      attempts += 1
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'x-run-id': body.run_id,
        'x-run-request-digest': testRunDigest,
      })
      if (attempts === 1) {
        res.write(
          `id: 1\ndata: ${JSON.stringify({ choices: [{ delta: { content: 'kept' } }] })}\n\n`,
        )
        setTimeout(() => res.socket?.destroy(new Error('transport dropped')), 5)
        return
      }
      res.end(
        [
          `id: 2\ndata: ${JSON.stringify({ usage: { prompt_tokens: 8, completion_tokens: 3, cost: 0 } })}`,
          '',
          'data: [DONE]',
          '',
        ].join('\n'),
      )
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const executor = makeExecutor(`http://127.0.0.1:${port}`)

    await drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )

    expect(attempts).toBe(2)
    expect(new Set(runIds).size).toBe(1)
    expect(replayCursors).toEqual([undefined, '1'])
    expect(executor.resultArtifact().out).toMatchObject({ content: 'kept' })
  })

  it("drains a cancelled run's buffered usage before starting the steered turn", async () => {
    const chats: Array<{ runId: string; after?: string }> = []
    let initialRunId: string | undefined
    server = createServer(async (req, res) => {
      const cancelMatch = req.url?.match(/^\/v1\/runs\/([^/]+)\/cancel(?:\?|$)/u)
      if (cancelMatch?.[1]) {
        const runId = decodeURIComponent(cancelMatch[1])
        res.writeHead(200, {
          'content-type': 'application/json',
          'x-run-id': runId,
          'x-run-request-digest': testRunDigest,
        })
        res.end(
          JSON.stringify({
            terminal: true,
            run: { id: runId, requestDigest: testRunDigest, terminal: true },
          }),
        )
        return
      }

      const body = await readRequestBody(req)
      const after = req.headers['last-event-id'] as string | undefined
      chats.push({ runId: body.run_id, ...(after ? { after } : {}) })
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'x-run-id': body.run_id,
        'x-run-request-digest': testRunDigest,
      })
      if (!initialRunId) {
        initialRunId = body.run_id
        res.write(
          `id: 1\ndata: ${JSON.stringify({
            choices: [{ delta: { content: 'old partial' } }],
            usage: { prompt_tokens: 2, completion_tokens: 1, cost: 0.01 },
          })}\n\n`,
        )
        return
      }
      if (body.run_id === initialRunId) {
        expect(after).toBe('1')
        res.end(
          [
            `id: 2\ndata: ${JSON.stringify({
              usage: { prompt_tokens: 5, completion_tokens: 3, cost: 0.02 },
            })}`,
            '',
            'data: [DONE]',
            '',
          ].join('\n'),
        )
        return
      }
      res.end(
        [
          `id: 1\ndata: ${JSON.stringify({
            choices: [{ delta: { content: 'new final' } }],
            usage: { prompt_tokens: 7, completion_tokens: 4, cost: 0.03 },
          })}`,
          '',
          'data: [DONE]',
          '',
        ].join('\n'),
      )
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const executor = makeExecutor(`http://127.0.0.1:${port}`)
    const events: UsageEvent[] = []
    let firstUsage!: () => void
    const sawFirstUsage = new Promise<void>((resolve) => {
      firstUsage = resolve
    })
    const draining = (async () => {
      for await (const event of executor.execute(
        'do the task',
        new AbortController().signal,
      ) as AsyncIterable<UsageEvent>) {
        events.push(event)
        if (event.kind === 'tokens' && event.input === 2) firstUsage()
      }
    })()

    await sawFirstUsage
    executor.deliver?.({ steer: 'stop and take the new path', interrupt: true })
    await draining

    expect(chats).toHaveLength(3)
    expect(chats[0]).toEqual({ runId: initialRunId })
    expect(chats[1]).toEqual({ runId: initialRunId, after: '1' })
    expect(chats[2]?.runId).not.toBe(initialRunId)
    expect(spendFromUsageEvents(events)).toMatchObject({
      iterations: 2,
      tokens: { input: 14, output: 8 },
      usdKnown: true,
      usd: 0.06,
    })
    expect(executor.resultArtifact()).toMatchObject({
      out: { content: 'new final' },
      spent: {
        iterations: 2,
        tokens: { input: 14, output: 8 },
        usdKnown: true,
        usd: 0.06,
      },
    })
  })

  it('cancels the server-owned run and waits for terminal proof during teardown', async () => {
    let started!: () => void
    const chatStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    let dispatchedRunId: string | undefined
    let cancelledRunId: string | undefined
    server = createServer(async (req, res) => {
      const cancelMatch = req.url?.match(/^\/v1\/runs\/([^/]+)\/cancel(?:\?|$)/u)
      if (cancelMatch?.[1]) {
        cancelledRunId = decodeURIComponent(cancelMatch[1])
        res.writeHead(200, {
          'content-type': 'application/json',
          'x-run-id': cancelledRunId,
          'x-run-request-digest': testRunDigest,
        })
        res.end(
          JSON.stringify({
            terminal: true,
            run: {
              id: cancelledRunId,
              requestDigest: testRunDigest,
              terminal: true,
            },
          }),
        )
        return
      }

      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { run_id: string }
      dispatchedRunId = body.run_id
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'x-run-id': body.run_id,
        'x-run-request-digest': testRunDigest,
      })
      res.write(
        `id: 1\ndata: ${JSON.stringify({ choices: [{ delta: { content: 'still running' } }] })}\n\n`,
      )
      started()
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const executor = makeExecutor(`http://127.0.0.1:${port}`)
    const draining = drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    ).catch((error: unknown) => error)

    await chatStarted
    const teardown = await executor.teardown('infinity')
    const streamError = await draining

    expect(teardown).toEqual({ destroyed: true })
    expect(cancelledRunId).toBe(dispatchedRunId)
    expect(streamError).toBeInstanceOf(Error)
  })

  it('bounds brutal teardown when the bridge cancel endpoint never responds', async () => {
    let chatStarted!: () => void
    const started = new Promise<void>((resolve) => {
      chatStarted = resolve
    })
    server = createServer(async (req, res) => {
      if (req.url?.startsWith('/v1/runs/')) {
        // A broken bridge accepted the connection but never acknowledges cancellation.
        return
      }
      const body = await readRequestBody(req)
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'x-run-id': body.run_id,
        'x-run-request-digest': testRunDigest,
      })
      res.write(
        `id: 1\ndata: ${JSON.stringify({ choices: [{ delta: { content: 'running' } }] })}\n\n`,
      )
      chatStarted()
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const executor = makeExecutor(`http://127.0.0.1:${port}`)
    const draining = drain(
      executor.execute('do the task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    ).catch((error: unknown) => error)

    await started
    const began = Date.now()
    const teardown = await executor.teardown('brutalKill')
    const elapsed = Date.now() - began

    expect(teardown).toEqual({ destroyed: false })
    expect(elapsed).toBeLessThan(1_000)
    expect(await draining).toBeInstanceOf(Error)
  })
})

async function readRequestBody(req: AsyncIterable<Uint8Array>): Promise<{ run_id: string }> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as { run_id: string }
}
