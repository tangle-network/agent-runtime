/**
 * Tangle Intelligence — the Observe + Mode-0 drop-in.
 *
 * Wrap any `(input) => Promise<output>` agent, ship one trace per call to Tangle Intelligence, and pay
 * only INFERENCE (the base model stream) at the OFF tier. "Mode 0" = the OFF tier: telemetry stays on,
 * but intelligence spend (analysts, corpus, extra spawns) is clamped to 0. The wrapper is best-effort:
 * a live agent never fails because Intelligence is down.
 *
 * This stands up a throwaway local OTLP collector so the trace is visible with NO credentials, then
 * proves the three load-bearing guarantees BY READING THE EXPORTED SPAN (not by asserting a label):
 *   1. a trace lands on a successful turn,
 *   2. the agent still answers when the trace endpoint is dead,
 *   3. at effort:'off' the exported span carries `intelligence_usd = 0` — the billing floor.
 *
 * Run ($0, no creds):  pnpm tsx examples/intelligence-drop-in/intelligence-drop-in.ts
 */
import { createServer } from 'node:http'
import {
  createIntelligenceClient,
  withTangleIntelligence,
} from '@tangle-network/agent-runtime/intelligence'

async function supportAgent(input: { question: string }): Promise<{ answer: string }> {
  return { answer: `You asked: ${input.question}. Here is a helpful reply.` }
}

/** Dig the intelligence-usd attribute out of an OTLP payload. The exporter emits the verbatim key
 *  `tangle.usage.intelligence_usd`, with the value under `doubleValue` or (for 0) `intValue: "0"` —
 *  so we suffix-match the key and coerce either numeric form. Walks the whole tree, robust to nesting. */
function intelligenceUsd(otlpPayload: unknown): number | undefined {
  let found: number | undefined
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return void node.forEach(visit)
    const o = node as Record<string, unknown>
    if (
      typeof o.key === 'string' &&
      o.key.endsWith('tangle.usage.intelligence_usd') &&
      o.value &&
      typeof o.value === 'object'
    ) {
      const v = o.value as Record<string, unknown>
      const raw = v.doubleValue ?? v.intValue
      if (raw !== undefined) found = Number(raw)
    }
    for (const child of Object.values(o)) visit(child)
  }
  visit(otlpPayload)
  return found
}

const settle = () => new Promise((r) => setTimeout(r, 150))

async function main() {
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
  const project = 'support-agent'

  // 1) THE ERGONOMICS — wrap any `(input) => Promise<output>` in one line; it ships a trace best-effort
  //    (fire-and-forget: the call returns as soon as the agent does, the span flushes in the background).
  const wrapped = withTangleIntelligence(supportAgent, {
    project,
    apiKey: process.env.TANGLE_API_KEY ?? 'sk-tan-demo',
    endpoint,
  })
  const out = await wrapped({ question: 'how do I reset my password?' })
  console.log(`1) wrapped an agent, got its answer: ${JSON.stringify(out.answer).slice(0, 48)}…`)

  // 2) The agent still answers when the trace endpoint is dead — best-effort telemetry never breaks the app.
  const onDead = withTangleIntelligence(supportAgent, {
    project,
    endpoint: 'http://127.0.0.1:1/v1/otlp', // nothing listening
  })
  const stillWorks = await onDead({ question: 'is intelligence down?' })
  console.log(`2) survived a dead endpoint: ${stillWorks.answer.length > 0}`)

  // 3) THE HEADLINE — a trace lands, AND at OFF the exported span carries intelligence_usd = 0. We use an
  //    explicit client so we can `flush()` and READ THE SPAN BACK off the collector. At OFF there is no
  //    intelligence spawn, so only the base inference stream costs anything (we record just that); the
  //    span's intelligence_usd is 0 by construction — a `standard`-tier run would fill it itself.
  received.length = 0
  const off = createIntelligenceClient({ project, endpoint, effort: 'off' })
  await off.traceRun({ input: { q: 'cheap turn' } }, async (trace) => {
    trace.recordOutcome({ usage: { inferenceUsd: 0.0008 } })
    return supportAgent({ question: 'cheap turn' })
  })
  await off.flush()
  await settle()

  console.log(`3a) a trace landed on the collector: ${received.length > 0}`)
  const usd = received.map(intelligenceUsd).find((v) => v !== undefined)
  console.log(
    `3b) OFF tier — intelligence_usd on the exported span: ${usd} (0 = the billing floor)`,
  )
  if (received.length === 0) throw new Error('expected a trace to land on the collector')
  if (usd !== 0) throw new Error(`OFF tier must export intelligence_usd = 0, got ${usd}`)

  server.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
