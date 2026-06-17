/**
 * LIVE validation of `decodeToolPart` against a REAL sandbox box running an opencode harness.
 *
 * The decoder was written defensively against the typed SDK surface + a mock. This proves it on
 * reality: spin a real box, make the harness call tools, capture the actual `streamPrompt` event /
 * message-part shapes, and check the decoder extracts the tool calls. If it misses, the raw dump
 * shows the true shape so we fix the decoder — no mock, no shortcut.
 *
 * Run: dotenvx run -f ~/company/devops/secrets/.env.keys -- pnpm exec tsx bench/src/decoder-live.mts
 */
import { Sandbox } from '@tangle-network/sandbox'
import { decodeToolPart } from '../../src/runtime/supervise/trace-source'

function must(k: string): string {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}

/** Walk an arbitrary stream event / message and yield every object that plausibly carries a part. */
function* candidateParts(node: unknown, depth = 0): Generator<unknown> {
  if (!node || typeof node !== 'object' || depth > 6) return
  const o = node as Record<string, unknown>
  // The event itself, its .part, and any .parts[] are all candidates.
  yield o
  if (o.part) yield o.part
  if (Array.isArray(o.parts)) for (const p of o.parts) yield p
  if (o.data) yield* candidateParts(o.data, depth + 1)
  if (o.message) yield* candidateParts(o.message, depth + 1)
}

async function main(): Promise<void> {
  const client = new Sandbox({
    baseUrl: process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools',
    apiKey: must('TANGLE_API_KEY'),
    timeoutMs: 600_000,
  } as never)

  console.error('[live] creating opencode box (deepseek-v4-flash)…')
  const box = (await client.create({
    backend: {
      type: 'opencode',
      model: {
        provider: process.env.WORKER_PROVIDER ?? 'openai',
        model: process.env.WORKER_MODEL ?? 'deepseek-v4-flash',
        baseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
      },
      profile: { name: 'decoder-live' },
    },
  } as never)) as Record<string, (...a: never[]) => unknown> & { id?: string }
  console.error('[live] box', box.id, '— waiting for running…')
  await box.waitFor('running' as never, { timeoutMs: 180_000 } as never)

  // Force several distinct tool calls.
  const prompt =
    'Use your tools, one tool call at a time, to do EACH of these: (1) list the files in the current ' +
    'directory; (2) run the shell command `echo hello-from-tool`; (3) create a file notes.txt with the ' +
    'text "hi". Make a separate tool call for each step. Then reply "done".'

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

  // Decode via the OPENCODE adapter + de-dup by callId (mirrors createPartsTraceSource).
  const decoded: Array<{ toolName: string; status?: string; callId?: string }> = []
  const toolShapes: unknown[] = []
  const seen = new Set<string>()
  for (const ev of rawEvents) {
    for (const part of candidateParts(ev)) {
      const step = decodeToolPart(part, 'opencode')
      if (!step) continue
      if (step.callId && seen.has(step.callId)) continue
      if (step.callId) seen.add(step.callId)
      decoded.push({ toolName: step.toolName, ...(step.status ? { status: step.status } : {}), ...(step.callId ? { callId: step.callId } : {}) })
      if (toolShapes.length < 3) toolShapes.push(part)
    }
  }

  // Ground truth: how many raw events MENTION a tool (so we can tell if the decoder under-counts).
  const rawToolish = rawEvents.filter((e) => JSON.stringify(e).match(/"tool|tool_call|toolName|"tool"/i)).length

  console.error('\n========== LIVE DECODER RESULT ==========')
  console.error(`raw stream events: ${rawEvents.length}`)
  console.error(`events mentioning a tool (ground-truth-ish): ${rawToolish}`)
  console.error(`decodeToolPart extracted: ${decoded.length} tool calls`)
  console.error(`decoded:`, JSON.stringify(decoded))
  console.error(`\n--- sample RAW tool-part shapes the decoder matched ---`)
  for (const s of toolShapes) console.error(JSON.stringify(s).slice(0, 400))
  console.error(`\n--- sample RAW events the decoder did NOT match (first 4 toolish) ---`)
  let shown = 0
  for (const e of rawEvents) {
    if (shown >= 4) break
    const str = JSON.stringify(e)
    if (str.match(/tool/i) && ![...candidateParts(e)].some((p) => decodeToolPart(p, 'opencode'))) {
      console.error(str.slice(0, 400))
      shown++
    }
  }

  await (box.delete as (...a: never[]) => Promise<void>)().catch(() => {})
  console.error('\n[live] box deleted.')
  console.error(
    decoded.length > 0
      ? `\n✅ VERDICT: decoder extracts real opencode tool calls (${decoded.length}).`
      : `\n❌ VERDICT: decoder extracted ZERO — the raw shapes above show the real schema to fix it.`,
  )
}

main().catch((e) => {
  console.error('[live] FAILED:', e)
  process.exit(1)
})
