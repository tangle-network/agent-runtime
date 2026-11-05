import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createOtelExporter, type OtelSpan } from '../src/otel-export'

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not reached within 5s')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function testSpan(id: string): OtelSpan {
  return {
    traceId: 'a'.repeat(32),
    spanId: id.repeat(16).slice(0, 16),
    name: 'test',
    startTimeUnixNano: '1000000000000',
    endTimeUnixNano: '1000000000000',
  }
}

/**
 * A real OTLP/HTTP collector on a loopback port. `respond` decides each reply, so a test can
 * refuse, partially accept, or stall a batch exactly as a live collector does.
 */
async function startCollector(
  respond: (res: ServerResponse, spanCount: number) => void,
): Promise<{ endpoint: string; batches: number[]; close: () => Promise<void> }> {
  const batches: number[] = []
  const sockets = new Set<Socket>()
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      const body = JSON.parse(raw) as { resourceSpans: [{ scopeSpans: [{ spans: unknown[] }] }] }
      const count = body.resourceSpans[0].scopeSpans[0].spans.length
      batches.push(count)
      respond(res, count)
    })
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    endpoint: `http://127.0.0.1:${port}`,
    batches,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      }),
  }
}

describe('createOtelExporter delivery accounting against a real collector', () => {
  const collectors: Array<{ close: () => Promise<void> }> = []
  afterEach(async () => {
    await Promise.all(collectors.splice(0).map((collector) => collector.close()))
  })

  it('delivers later batches after empty and concurrent idle flushes', async () => {
    const collector = await startCollector((res) => res.writeHead(200).end('{}'))
    collectors.push(collector)
    const exporter = createOtelExporter({ endpoint: collector.endpoint, batchSize: 10 })!
    try {
      for (const id of ['1', '2', '3']) {
        await Promise.all([exporter.flush(), exporter.flush()])
        exporter.exportSpan(testSpan(id))
        await exporter.flush()
      }
      expect(collector.batches).toEqual([1, 1, 1])
      expect(exporter.stats()).toEqual({ written: 3, dropped: 0, pending: 0 })
    } finally {
      await exporter.shutdown()
    }
  })

  it('joins an in-flight delivery even when the waiting queue is empty', async () => {
    const stalled: ServerResponse[] = []
    const collector = await startCollector((res) => stalled.push(res))
    collectors.push(collector)
    const exporter = createOtelExporter({ endpoint: collector.endpoint, batchSize: 1 })!
    let finished = false
    try {
      exporter.exportSpan(testSpan('1'))
      await waitFor(() => stalled.length === 1)
      const flushed = exporter.flush().then(() => {
        finished = true
      })
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(finished).toBe(false)
      stalled.shift()!.writeHead(200).end('{}')
      await flushed
      expect(exporter.stats()).toEqual({ written: 1, dropped: 0, pending: 0 })
    } finally {
      for (const res of stalled) res.writeHead(200).end('{}')
      await exporter.shutdown()
    }
  })

  it('does not confirm delivery when a successful response body is interrupted', async () => {
    const collector = await startCollector((res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': '4096' })
      res.flushHeaders()
      res.write('{"partialSuccess":')
      setTimeout(() => res.destroy(), 100)
    })
    collectors.push(collector)
    const exporter = createOtelExporter({ endpoint: collector.endpoint })!
    try {
      exporter.exportSpan(testSpan('1'))
      await expect(exporter.flush()).rejects.toThrow(/dropped 1 spans/)
      expect(exporter.stats()).toMatchObject({ written: 0, dropped: 1, pending: 0 })
      expect(collector.batches).toEqual([1])
    } finally {
      await exporter.shutdown()
    }
  })

  it('counts every span the collector confirms as written', async () => {
    const collector = await startCollector((res) => res.writeHead(200).end('{}'))
    collectors.push(collector)
    const exporter = createOtelExporter({ endpoint: collector.endpoint, batchSize: 2 })!

    for (const id of ['1', '2', '3']) exporter.exportSpan(testSpan(id))
    await exporter.flush()

    expect(collector.batches).toEqual([2, 1])
    expect(exporter.stats()).toEqual({ written: 3, dropped: 0, pending: 0 })
    await exporter.shutdown()
  })

  it('counts a refused batch as dropped, reports it once from flush, and keeps the status', async () => {
    const collector = await startCollector((res) => res.writeHead(503).end('collector overloaded'))
    collectors.push(collector)
    const exporter = createOtelExporter({ endpoint: collector.endpoint, batchSize: 10 })!

    for (const id of ['1', '2', '3']) exporter.exportSpan(testSpan(id))

    await expect(exporter.flush()).rejects.toThrow(/dropped 3 spans.*HTTP 503.*overloaded/)
    expect(exporter.stats()).toMatchObject({ written: 0, dropped: 3, pending: 0 })
    expect(exporter.stats().lastError).toMatch(/HTTP 503/)
    // The loss was reported; a later flush with nothing new lost resolves.
    await expect(exporter.flush()).resolves.toBeUndefined()
    await exporter.shutdown()
  })

  it('counts spans an OTLP partialSuccess response rejects inside a 200', async () => {
    const collector = await startCollector((res) =>
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ partialSuccess: { rejectedSpans: '1', errorMessage: 'bad span' } })),
    )
    collectors.push(collector)
    const exporter = createOtelExporter({ endpoint: collector.endpoint, batchSize: 10 })!

    exporter.exportSpan(testSpan('1'))
    exporter.exportSpan(testSpan('2'))

    await expect(exporter.flush()).rejects.toThrow(/dropped 1 spans.*bad span/)
    expect(exporter.stats()).toMatchObject({ written: 1, dropped: 1, pending: 0 })
    await exporter.shutdown()
  })

  it('bounds queued plus in-flight spans while the collector stalls, and counts the overflow', async () => {
    const stalled: ServerResponse[] = []
    const collector = await startCollector((res) => stalled.push(res))
    collectors.push(collector)
    const exporter = createOtelExporter({
      endpoint: collector.endpoint,
      batchSize: 2,
      maxQueueSize: 4,
    })!

    // Two spans start the first POST; two more wait; the fifth has no room.
    for (const id of ['1', '2', '3', '4', '5']) exporter.exportSpan(testSpan(id))
    expect(exporter.stats()).toMatchObject({ written: 0, dropped: 1, pending: 4 })
    expect(exporter.stats().lastError).toMatch(/queue full/)

    const flushed = exporter.flush()
    for (let batch = 0; batch < 2; batch++) {
      await waitFor(() => stalled.length === 1)
      stalled.shift()!.writeHead(200).end()
    }

    await expect(flushed).rejects.toThrow(/dropped 1 spans.*queue full/)
    expect(collector.batches).toEqual([2, 2])
    expect(exporter.stats()).toMatchObject({ written: 4, dropped: 1, pending: 0 })
    await exporter.shutdown()
  })

  it('abandons a POST that outlives timeoutMs and counts its spans as dropped', async () => {
    const collector = await startCollector(() => {
      // Never answer: the exporter must not wait forever on a hung collector.
    })
    collectors.push(collector)
    const exporter = createOtelExporter({
      endpoint: collector.endpoint,
      batchSize: 10,
      timeoutMs: 50,
    })!

    exporter.exportSpan(testSpan('1'))

    await expect(exporter.flush()).rejects.toThrow(/dropped 1 spans/)
    expect(exporter.stats()).toMatchObject({ written: 0, dropped: 1, pending: 0 })
    await exporter.shutdown()
  })

  it('counts a span exported after the exporter stopped instead of discarding it silently', async () => {
    const collector = await startCollector((res) => res.writeHead(200).end())
    collectors.push(collector)
    const exporter = createOtelExporter({ endpoint: collector.endpoint })!
    await exporter.shutdown()

    exporter.exportSpan(testSpan('1'))

    expect(exporter.stats()).toMatchObject({ written: 0, dropped: 1, pending: 0 })
    expect(collector.batches).toEqual([])
  })
})
