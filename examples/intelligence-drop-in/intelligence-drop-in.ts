/**
 * Tangle Intelligence — the Observe + Mode-0 drop-in.
 *
 * Wrap any `(input) => Promise<output>` agent, ship one trace per call to
 * Tangle Intelligence, and pay only inference at the OFF tier. The wrapper is
 * best-effort: a live agent never fails because Intelligence is down.
 *
 * This example stands up a throwaway local OTLP collector so the trace is
 * visible with no credentials, then shows the three load-bearing guarantees:
 *   1. a trace lands on a successful turn,
 *   2. the agent still answers when the trace endpoint is dead,
 *   3. effort:'off' runs as pure passthrough with intelligenceUsd = 0.
 *
 * Run: pnpm tsx examples/intelligence-drop-in/intelligence-drop-in.ts
 */
import { createServer } from 'node:http'
import {
  createIntelligenceClient,
  withTangleIntelligence,
} from '@tangle-network/agent-runtime/intelligence'

// A trivial agent — any async input → output works.
async function supportAgent(input: { question: string }): Promise<{ answer: string }> {
  return { answer: `You asked: ${input.question}. Here is a helpful reply.` }
}

async function main() {
  // ── A local OTLP collector so the trace is visible with no creds ──
  const received: unknown[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => {
      body += c
    })
    req.on('end', () => {
      received.push(JSON.parse(body || '{}'))
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
    })
  })
  await new Promise<void>((r) => server.listen(0, r))
  const port = (server.address() as { port: number }).port
  const endpoint = `http://127.0.0.1:${port}/v1/otlp`

  // ── 1. Observe — wrap the agent, run a turn, see the trace ────────
  const wrapped = withTangleIntelligence(supportAgent, {
    project: 'support-agent',
    apiKey: process.env.TANGLE_API_KEY ?? 'sk-tan-demo',
    endpoint,
  })
  const out = await wrapped({ question: 'how do I reset my password?' })
  console.log('agent output:', out.answer)

  // Force the best-effort batch to flush so we can read it back.
  const observeClient = createIntelligenceClient({ project: 'support-agent', endpoint })
  await observeClient.traceRun({ input: { ping: 1 } }, async (t) => {
    t.recordOutcome({ success: true, costUsd: 0.0012 })
    return 'pong'
  })
  await observeClient.flush()
  await new Promise((r) => setTimeout(r, 50))
  console.log(`traces received by collector: ${received.length}`)
  console.log(`doctor:`, JSON.stringify(observeClient.doctor().modes, null, 0))

  // ── 2. Survives a dead endpoint — the agent still answers ─────────
  const onDeadEndpoint = withTangleIntelligence(supportAgent, {
    project: 'support-agent',
    endpoint: 'http://127.0.0.1:1/v1/otlp', // nothing listening
  })
  const stillWorks = await onDeadEndpoint({ question: 'is intelligence down?' })
  console.log('survived dead endpoint:', stillWorks.answer.length > 0)

  // ── 3. Mode 0 / OFF — pure passthrough, intelligenceUsd = 0 ───────
  const offClient = createIntelligenceClient({
    project: 'support-agent',
    endpoint,
    effort: 'off',
  })
  await offClient.traceRun({ input: { q: 'cheap turn' } }, async (trace) => {
    // Even if a caller mis-reports intelligence spend, OFF clamps it to 0.
    trace.recordOutcome({ usage: { inferenceUsd: 0.0008, intelligenceUsd: 0.05 } })
    return await supportAgent({ question: 'cheap turn' })
  })
  await offClient.flush()
  await new Promise((r) => setTimeout(r, 50))
  console.log(`OFF tier intelligence_off:`, offClient.effort)

  server.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
