/**
 * LIVE real-model viability proof for createSteeringPlanner.
 *
 * The deterministic unit test (tests/loops/steering-planner.test.ts) proves the
 * MECHANISM: given a failure signal, a competent driver steers off the plateau.
 * It cannot prove that a REAL model, handed the planner's ACTUAL prompt, emits a
 * parseable move that steers in the right direction. That is what this does.
 *
 * Faithful, not hand-crafted: we run the real createSteeringPlanner with a
 * prompt-capturing fake client over a modeled-stuck QBI history, so the prompt
 * fired at the router is byte-for-byte what production would send. Then we send
 * it to real models and assert each returns a steered refine/fanout — kind valid,
 * a task that DIFFERS from the root task, addressing the analyst signal.
 *
 * No fake numbers: a model that fails to parse or replays the root task is a FAIL.
 */
import { createSteeringPlanner } from '../dist/loops.js'

const ROUTER = process.env.TANGLE_ROUTER_BASE_URL ?? 'https://router.tangle.tools'
const KEY = process.env.TANGLE_API_KEY
if (!KEY) throw new Error('TANGLE_API_KEY required')
const MODELS = (process.env.STEER_MODELS ?? 'claude-haiku-4-5-20251001,gpt-4o-mini').split(',')

// ── Modeled stuck loop: the matrix_multishot=0.316 QBI symptom ───────────────
// Shot 1 produced a Form-1040 attempt that never called the QBI calculator tool
// and got the line-13 deduction wrong. The validator rejected it (0.316). This
// is the exact plateau the blind planner replays forever.
const ROOT_TASK = {
  goal: 'Compute the Qualified Business Income deduction (Form 1040 line 13) for a Schedule-C filer with $120,000 net business income, MFJ, taxable income $180,000.',
}
const STUCK_OUTPUT = {
  line13_qbi_deduction: 0,
  reasoning:
    'Estimated the deduction as $0 because I was unsure whether the income phase-out applied. Did not compute 20% of QBI.',
  tools_used: [],
}
const ctx = {
  task: ROOT_TASK,
  iterationsSpent: 1,
  iterationsRemaining: 4,
  history: [
    {
      index: 0,
      agentRunName: 'tax-worker',
      task: ROOT_TASK,
      output: STUCK_OUTPUT,
      verdict: { valid: false, score: 0.316 },
      events: [],
      startedAt: 0,
      endedAt: 1,
      costUsd: 0,
      tokenUsage: { input: 0, output: 0 },
    },
  ],
}

// ── Capture the planner's REAL prompt (prompt-capturing fake driver client) ──
const captured = []
const planner = createSteeringPlanner({
  client: {
    async create() {
      return {
        async *streamPrompt(message) {
          captured.push(message)
          yield { type: 'result', data: { result: { kind: 'stop', rationale: 'capture' } } }
        },
      }
    },
  },
  profile: { name: 'driver' },
  decodeTask: (raw) => raw,
})
await planner(ctx)
const PROMPT = captured.find((p) => /invalid-attempt/.test(p))
if (!PROMPT) {
  console.error('FAIL: planner did not surface an invalid-attempt signal in its prompt')
  process.exit(1)
}
console.log(`Captured real steering prompt (${PROMPT.length} chars). Firing at ${MODELS.length} real model(s)…\n`)

// ── Parse a TopologyMove envelope from a model completion ────────────────────
function parseMove(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced?.[1] ?? text).trim()
  // tolerate prose around a bare object
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end < 0) return undefined
  try {
    return JSON.parse(body.slice(start, end + 1))
  } catch {
    return undefined
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function callModel(model) {
  // The platform key-verification service flaps with a 503 "retry in a few
  // seconds". That is transient infra, not a model failure — honor its retry
  // contract rather than scoring a flap as a steering failure.
  let lastErr = ''
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const res = await fetch(`${ROUTER}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 700,
        messages: [{ role: 'user', content: PROMPT }],
      }),
    })
    if (res.ok) {
      const json = await res.json()
      return json.choices?.[0]?.message?.content ?? ''
    }
    lastErr = `router ${res.status}: ${(await res.text()).slice(0, 160)}`
    if (res.status !== 503) throw new Error(lastErr)
    await sleep(3000 * (attempt + 1))
  }
  throw new Error(`exhausted retries — ${lastErr}`)
}

// ── Assertion: a real steer (not a replay, not a malformed move) ─────────────
function judge(move) {
  if (!move || typeof move.kind !== 'string') return { ok: false, why: 'no parseable move' }
  const kind = move.kind.toLowerCase()
  if (kind === 'stop') return { ok: false, why: 'stopped on a still-invalid (0.316) attempt' }
  if (kind !== 'refine' && kind !== 'fanout') return { ok: false, why: `unknown kind ${kind}` }
  const tasks = Array.isArray(move.tasks) ? move.tasks : []
  if (tasks.length === 0) return { ok: false, why: 'no steered task emitted (bare replay)' }
  const steered = JSON.stringify(tasks[0])
  if (steered === JSON.stringify(ROOT_TASK)) return { ok: false, why: 'task identical to root (replay)' }
  // The steer must point at the concrete fix: the QBI calc / 20% / the tool.
  const addressesSignal = /qbi|20\s*%|0\.20|calculat|deduction|phase|tool/i.test(steered)
  if (!addressesSignal) return { ok: false, why: `steer does not address the QBI fix: ${steered.slice(0, 160)}` }
  return { ok: true, why: `${kind} → ${steered.slice(0, 200)}` }
}

let pass = 0
for (const model of MODELS) {
  try {
    const content = await callModel(model)
    const verdict = judge(parseMove(content))
    console.log(`${verdict.ok ? '✅ PASS' : '❌ FAIL'}  ${model}`)
    console.log(`        ${verdict.why}\n`)
    if (verdict.ok) pass += 1
  } catch (err) {
    console.log(`❌ ERROR ${model}: ${err.message}\n`)
  }
}
console.log(`\nLIVE RESULT: ${pass}/${MODELS.length} real models emitted a valid steer from the production prompt.`)
process.exit(pass === MODELS.length ? 0 : 1)
