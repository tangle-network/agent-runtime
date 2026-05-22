import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

/**
 * Test the SessionSupervisorDO end-to-end under real workerd: real
 * `DurableObjectState`, real `ReadableStream`, real `Response`. The
 * fake-state suite in `src/durable/tests/session-supervisor-do.test.ts`
 * exercises the supervisor logic exhaustively (fresh / resumed / replayed /
 * orphan re-attach via `alarm()`); this file's job is to prove the same DO
 * host works against the actual Cloudflare runtime, catching any platform
 * quirk the structural fakes miss.
 */
describe('SessionSupervisorDO under real workerd', () => {
  it('streams a fresh supervised run end-to-end through a real DO', async () => {
    const res = await SELF.fetch('http://test/?session=s-fresh&runId=r-fresh&events=4')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    const text = await res.text()
    expect(text).toBe('data: 0\ndata: 1\ndata: 2\ndata: 3\n')
  })

  it('a second fetch for the same runId replays the same stream from the durable log', async () => {
    await SELF.fetch('http://test/?session=s-replay&runId=r-replay&events=3').then((r) => r.text())
    // Second fetch — the run already completed, so the supervisor enters the
    // replay path and re-yields the logged stream verbatim.
    const replayed = await SELF.fetch('http://test/?session=s-replay&runId=r-replay&events=3').then(
      (r) => r.text(),
    )
    expect(replayed).toBe('data: 0\ndata: 1\ndata: 2\n')
  })
})
