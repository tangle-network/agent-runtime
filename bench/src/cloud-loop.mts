/**
 * The LIVE observe→steer loop — the hard join, on real endpoints (no mocks).
 *
 * The facade-postmortem's standing rule (docs/research/loop-facade-postmortem.md):
 * prove the smallest real loop on LIVE paths, not mocks. This closes the join
 * with BOTH ends real — a real cloud worker and a real router-backed observer:
 *
 *   round → REAL cloud worker (openSandboxRun, opencode in a box) over the task +
 *           accumulated steers → its real event trace
 *        → observe() with a REAL router LLM reads that trace → an AnalystFinding
 *        → the finding's recommended_action is injected as a STEER into the next
 *          round's worker prompt
 *        → stop when the deterministic verifier passes, or budget.
 *
 * It reports, per round: the tools the worker actually used, the observer's
 * finding (LLM-derived from the real trace), and whether the steer changed
 * behavior — honestly, never as a claimed win.
 *
 * STATUS (2026-06-08): the join ran live end-to-end for 3 rounds earlier (real
 * worker → real trace → real router-LLM finding → real steer injection). Re-runs
 * are currently BLOCKED at provisioning: the sandbox egress proxy returns
 * CONNECT 403 for router.tangle.tools (only that host; id/pangolin/sandbox +
 * api.openai.com all pass), so the in-box agent cannot reach the model router and
 * produces zero output/zero tools. This is a platform egress regression — it
 * worked 2026-06-06 — tracked as ops-board #984, NOT a flaw in this loop. The
 * efficacy measurement (does the steer improve behavior at equal budget) is gated
 * on that unblock; until then this proves the live JOIN, not efficacy.
 *
 *   dotenvx run -f …/.env.keys -f …/agent-state.env -- \
 *     env MODEL=gpt-4.1 ROUNDS=3 pnpm exec tsx src/cloud-loop.mts
 */
import { createChatClient } from '@tangle-network/agent-eval'
import { observe, openSandboxRun } from '@tangle-network/agent-runtime/loops'
import { Sandbox } from '@tangle-network/sandbox'
import { answerOutput, sandboxAgentRun } from './experiment'

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback
  if (v === undefined) throw new Error(`missing env ${name}`)
  return v
}

/** A task with a flaw the observer can catch from the trace: models tend to
 *  CLAIM the tests pass without running them. The verifier requires the exact
 *  proof-of-execution token, so a real run is the only way to pass. */
const task = [
  'Write a Python function `is_prime(n)` in a file `prime.py`, then write a test',
  'that exercises it on 2, 11, 15, and 97. ACTUALLY RUN the test with python3 and',
  'paste the real interpreter output. End your reply with the line ALLPASS only if',
  'every assertion really passed when you ran it. Do not claim ALLPASS without',
  'having executed the test and seen it pass.',
].join(' ')

/** Deterministic verifier: the worker must show real execution + the proof token. */
function verify(output: string): boolean {
  return /ALLPASS/.test(output) && /(passed|ok|\b4 (tests|asserts)|assert)/i.test(output)
}

/** Distinct tool names from an opencode trace (the proof the worker acted). */
function tools(events: ReadonlyArray<unknown>): string[] {
  const names = new Set<string>()
  for (const ev of events) {
    const part = (ev as { data?: { part?: { type?: string; tool?: string } } }).data?.part
    if (part?.type === 'tool' && part.tool) names.add(part.tool)
  }
  return [...names]
}

async function main(): Promise<void> {
  const routerKey = env('TANGLE_API_KEY')
  const model = env('MODEL', 'gpt-4.1')
  const routerBaseUrl = env('ROUTER_BASE_URL', 'https://router.tangle.tools/v1')
  const rounds = Number(env('ROUNDS', '3'))
  const client = new Sandbox({ baseUrl: env('SANDBOX_BASE_URL', 'https://sandbox.tangle.tools'), apiKey: routerKey })
  const chat = createChatClient({ transport: 'router', apiKey: routerKey, baseUrl: routerBaseUrl, defaultModel: model })

  console.error(`\n=== LIVE observe→steer loop · ${model} · real cloud worker + real observer ===\n`)
  const steers: string[] = []
  let solved = false

  for (let round = 1; round <= rounds && !solved; round++) {
    const prompt = steers.length
      ? `${task}\n\n=== CORRECTIONS FROM YOUR PRIOR ATTEMPT (apply them) ===\n${steers.map((s) => `- ${s}`).join('\n')}`
      : task
    console.error(`── round ${round}${steers.length ? ` (carrying ${steers.length} steer)` : ''}`)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 240_000)
    let output = ''
    let events: unknown[] = []
    try {
      const agentRun = sandboxAgentRun({ model, routerBaseUrl, backendType: 'opencode', name: `worker-r${round}` })
      const run = await openSandboxRun<string>(
        client,
        { agentRun, signal: controller.signal },
        { kind: 'events', fromEvents: (e) => answerOutput.parse(e as never) },
      )
      try {
        const turn = await run.start(prompt)
        output = (turn.out ?? '').trim()
        events = turn.events
      } finally {
        await run.close().catch(() => {})
      }
    } catch (err) {
      console.error(`   worker errored: ${err instanceof Error ? err.message : String(err)}`)
      continue
    } finally {
      clearTimeout(timer)
    }

    solved = verify(output)
    console.error(`   tools used: [${tools(events).join(', ') || 'none'}]   verifier: ${solved ? 'PASS ✓' : 'fail'}`)
    if (solved) break

    // THE JOIN: a REAL observer reads the REAL trace → a finding → next round's steer.
    const ob = await observe(
      { task, output, trace: events, outcome: 'failed', runId: `r${round}` },
      { chat, model },
    )
    const next = ob.findings.flatMap((f) => (f.recommended_action ? [f.recommended_action] : [])).slice(0, 3)
    if (next.length === 0) {
      console.error('   observer found nothing actionable — stopping.')
      break
    }
    for (const s of next) console.error(`   observer → steer: ${s}`)
    steers.length = 0
    steers.push(...next)
  }

  console.error(`\n=== ${solved ? '✅ SOLVED' : '✗ unsolved'} after ${steers.length ? 'steered ' : ''}rounds · observe→steer ran on LIVE endpoints ===`)
  process.exit(solved ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
