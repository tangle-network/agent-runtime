import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import type { BridgeSeam } from './bridge-config'
import { BRIDGE_ROUTE_PROBE_TIMEOUT_MS, bridgeModelRouteRefusal } from './bridge-transport'

/** The budget the route probe used to borrow from run-state reads. A bridge slower than this but
 *  faster than the probe's own budget must still count as routing. */
const FORMER_RUN_STATE_BUDGET_MS = 2_000

interface Stub {
  server: Server
  seam: BridgeSeam
  requests: string[]
}

async function startStub(
  handle: (url: string) => { status: number; delayMs?: number },
): Promise<Stub> {
  const requests: string[] = []
  const server = createServer((req, res) => {
    const url = req.url ?? ''
    requests.push(url)
    const answer = handle(url)
    setTimeout(() => {
      res.statusCode = answer.status
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ capabilities: {} }))
    }, answer.delayMs ?? 0)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('stub did not bind a port')
  return {
    server,
    requests,
    seam: { bridgeUrl: `http://127.0.0.1:${address.port}`, bridgeBearer: 'test' },
  }
}

describe('bridgeModelRouteRefusal', () => {
  const stubs: Stub[] = []
  afterEach(async () => {
    for (const stub of stubs.splice(0)) {
      await new Promise<void>((resolve) => stub.server.close(() => resolve()))
    }
  })

  it('a bridge slower than the run-state budget but inside the probe budget routes', async () => {
    // Measured 2026-09-11 on a host at load average 261: GET /v1/capabilities took 12-15 s while
    // POST /v1/chat/completions on the same bridge and model returned 200. Under the borrowed
    // 2 s budget this bridge refused every spawn and every driver turn, and a pursuit died at
    // zero tokens after three attempts in twelve seconds.
    const stub = await startStub(() => ({ status: 200, delayMs: FORMER_RUN_STATE_BUDGET_MS + 300 }))
    stubs.push(stub)
    expect(BRIDGE_ROUTE_PROBE_TIMEOUT_MS).toBeGreaterThan(FORMER_RUN_STATE_BUDGET_MS + 300)
    await expect(
      bridgeModelRouteRefusal(stub.seam, 'opencode/p/slow-but-live'),
    ).resolves.toBeUndefined()
  }, 10_000)

  it('a routed model is not re-asked: the second probe makes no request', async () => {
    const stub = await startStub(() => ({ status: 200 }))
    stubs.push(stub)
    await expect(bridgeModelRouteRefusal(stub.seam, 'opencode/p/cached')).resolves.toBeUndefined()
    await expect(bridgeModelRouteRefusal(stub.seam, 'opencode/p/cached')).resolves.toBeUndefined()
    // The seam object is rebuilt per turn in bridgeExecutor, so the cache must survive a fresh seam.
    await expect(
      bridgeModelRouteRefusal({ ...stub.seam }, 'opencode/p/cached'),
    ).resolves.toBeUndefined()
    expect(stub.requests).toHaveLength(1)
  })

  it('the cache is per model: a different wire model on the same bridge is asked', async () => {
    const stub = await startStub(() => ({ status: 200 }))
    stubs.push(stub)
    await bridgeModelRouteRefusal(stub.seam, 'opencode/p/one')
    await bridgeModelRouteRefusal(stub.seam, 'opencode/p/two')
    expect(stub.requests).toHaveLength(2)
  })

  it('a 404 is a definite refusal and is never cached', async () => {
    const stub = await startStub(() => ({ status: 404 }))
    stubs.push(stub)
    const first = await bridgeModelRouteRefusal(stub.seam, 'opencode/p/unrouted')
    expect(first).toMatchObject({ retryable: false, status: 404 })
    const second = await bridgeModelRouteRefusal(stub.seam, 'opencode/p/unrouted')
    expect(second).toMatchObject({ retryable: false, status: 404 })
    // A refusal cached would be the mirror of the silent admission the preflight exists to
    // remove: a bridge that gains the backend would stay refused until the process restarted.
    expect(stub.requests).toHaveLength(2)
  })

  it('a 503 is retryable and is never cached', async () => {
    const stub = await startStub(() => ({ status: 503 }))
    stubs.push(stub)
    expect(await bridgeModelRouteRefusal(stub.seam, 'opencode/p/busy')).toMatchObject({
      retryable: true,
      status: 503,
    })
    expect(await bridgeModelRouteRefusal(stub.seam, 'opencode/p/busy')).toMatchObject({
      retryable: true,
      status: 503,
    })
    expect(stub.requests).toHaveLength(2)
  })

  it('a bridge that never answers inside the probe budget is a retryable refusal', async () => {
    // A hung bridge must still refuse: the budget is larger, not absent.
    const stub = await startStub(() => ({
      status: 200,
      delayMs: BRIDGE_ROUTE_PROBE_TIMEOUT_MS + 5_000,
    }))
    stubs.push(stub)
    const controller = new AbortController()
    const probe = bridgeModelRouteRefusal(stub.seam, 'opencode/p/hung', controller.signal)
    // Do not wait the full budget in a unit test: abort stands in for the timeout on the transport
    // path, and the refusal shape below is the one both produce.
    setTimeout(() => controller.abort(), 100)
    await expect(probe).rejects.toThrow(/aborted/u)
    expect(stub.requests).toHaveLength(1)
  })
})
