/**
 * LIVE validation of the per-harness tool-part decoders against a REAL sandbox box.
 *
 * Spin a real box for HARNESS, make the harness call tools, capture the actual session part shapes,
 * and prove the harness's decoder extracts the tool calls (with error status where the harness carries
 * it). No mock. Exits non-zero on a decode miss so it can gate CI. The box is ALWAYS deleted.
 *
 * Run: HARNESS=opencode dotenvx run -f ~/company/devops/secrets/agent-state.env -- \
 *        pnpm exec tsx bench/src/decoder-live.mts        (also: claude-code, codex, kimi-code, …)
 */
import { Sandbox } from '@tangle-network/sandbox'
import { decodeToolPart } from '../../src/runtime/supervise/trace-source'

function must(k: string): string {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}

function* candidateParts(node: unknown, depth = 0): Generator<unknown> {
  if (!node || typeof node !== 'object' || depth > 6) return
  const o = node as Record<string, unknown>
  yield o
  if (o.part) yield o.part
  if (Array.isArray(o.parts)) for (const p of o.parts) yield p
  if (o.data) yield* candidateParts(o.data, depth + 1)
  if (o.message) yield* candidateParts(o.message, depth + 1)
}

const HARNESS = process.env.HARNESS ?? 'opencode'

async function main(): Promise<number> {
  const client = new Sandbox({
    baseUrl: process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools',
    apiKey: must('TANGLE_API_KEY'),
    timeoutMs: 600_000,
  } as never)

  console.error(`[live] creating ${HARNESS} box (${process.env.WORKER_MODEL ?? 'deepseek-v4-flash'})…`)
  const box = (await client.create({
    backend: {
      type: HARNESS,
      model: {
        provider: process.env.WORKER_PROVIDER ?? 'openai',
        model: process.env.WORKER_MODEL ?? 'deepseek-v4-flash',
        baseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
      },
      profile: { name: 'decoder-live' },
    },
  } as never)) as Record<string, (...a: never[]) => unknown> & { id?: string }

  try {
    console.error('[live] box', box.id, '— waiting for running…')
    await box.waitFor('running' as never, { timeoutMs: 180_000 } as never)

    // Force several distinct tool calls AND at least one tool error (to exercise error-status decode).
    const prompt =
      'Use your tools, one tool call at a time: (1) list the files in the current directory; ' +
      '(2) run `echo hello-from-tool`; (3) run `false` (this command fails on purpose); ' +
      '(4) create notes.txt containing "hi". A separate tool call for each. Then reply "done".'

    const rawEvents: unknown[] = []
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 240_000)
    try {
      for await (const ev of box.streamPrompt(prompt as never, {
        signal: ac.signal,
      } as never) as AsyncGenerator<unknown>) {
        rawEvents.push(ev)
      }
    } finally {
      clearTimeout(timer)
    }

    // Vocabulary: every distinct part `type` the harness emitted (so we learn its real schema).
    const types = new Map<string, number>()
    for (const ev of rawEvents)
      for (const part of candidateParts(ev)) {
        const t = (part as Record<string, unknown>)?.type
        if (typeof t === 'string') types.set(t, (types.get(t) ?? 0) + 1)
      }

    // Decode tool calls via the HARNESS adapter + de-dup by callId.
    const decoded: Array<{ toolName: string; status?: string; callId?: string }> = []
    const seen = new Set<string>()
    for (const ev of rawEvents)
      for (const part of candidateParts(ev)) {
        const step = decodeToolPart(part, HARNESS)
        if (!step) continue
        if (step.callId && seen.has(step.callId)) continue
        if (step.callId) seen.add(step.callId)
        decoded.push({ toolName: step.toolName, ...(step.status ? { status: step.status } : {}), ...(step.callId ? { callId: step.callId } : {}) })
      }

    // Surface any harness/model error events (so a no-tools run isn't mistaken for a decoder miss).
    const errs = rawEvents.filter((e) => JSON.stringify(e).match(/"error"/i)).slice(0, 2)
    if (errs.length) console.error(`[live] harness error events:`, errs.map((e) => JSON.stringify(e).slice(0, 300)))

    console.error(`\n========== LIVE DECODER RESULT — harness=${HARNESS} ==========`)
    console.error(`raw stream events: ${rawEvents.length}`)
    console.error(`part-type vocabulary:`, JSON.stringify(Object.fromEntries(types)))
    console.error(`decoded ${decoded.length} tool calls:`, JSON.stringify(decoded))
    console.error(`with error status: ${decoded.filter((d) => d.status === 'error').length}`)
    // Sample raw shapes the decoder did NOT match but that mention a tool (the schema to learn from).
    console.error(`\n--- raw toolish parts NOT decoded (first 4) ---`)
    let shown = 0
    for (const ev of rawEvents) {
      if (shown >= 4) break
      for (const part of candidateParts(ev)) {
        if (shown >= 4) break
        const s = JSON.stringify(part)
        if (s.match(/tool/i) && !decodeToolPart(part, HARNESS)) {
          console.error(s.slice(0, 380))
          shown++
        }
      }
    }
    return decoded.length > 0 ? 0 : 2
  } finally {
    await (box.delete as (...a: never[]) => Promise<void>)().catch(() => {})
    console.error('[live] box deleted.')
  }
}

main()
  .then((code) => {
    console.error(code === 0 ? `\n✅ ${HARNESS}: decoder extracts real tool calls.` : `\n❌ ${HARNESS}: decoder extracted ZERO — see raw shapes above.`)
    process.exit(code)
  })
  .catch((e) => {
    console.error('[live] FAILED:', e)
    process.exit(1)
  })
