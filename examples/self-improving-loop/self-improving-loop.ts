// The self-improvement cycle demo: agent-eval's multishot + judge primitives wired
// end-to-end into a single v0 → analyst → v1 → gate loop. Runs offline with stubbed
// router responses so the demo is reproducible; pass TANGLE_API_KEY to see it fire live.
//
// What this shows:
//   1. baseline AgentProfile (portable type from @tangle-network/agent-interface)
//   2. runMultishot over N personas (from @tangle-network/agent-eval/multishot)
//   3. 3 judges score conversations + artifacts
//   4. analyst phase reads transcripts → emits a canonical `AnalystFinding` (`makeFinding`,
//      agent-eval) carrying the proposed systemPrompt mutation as `recommended_action`
//   5. apply mutation → new AgentProfile variant
//   6. re-run multishot with v1 profile
//   7. gate pairs v1 vs v0 per persona and ships only if the `pairedBootstrap` CI lower bound
//      clears 0 — the production held-out gate's statistical core. (This demo gates at n=3 for a
//      runnable example, BELOW the production floor — the one authoritative caveat is the ⚠️ at § 6.)
//
// The finding type and the gate statistic are the real substrate primitives (not a local one-off);
// the analyst body, the proposer, and the LLM are scripted ONLY so the demo runs offline and
// deterministically. The production profile path is `improve()` with a complete
// OptimizationMethod and explicit train, selection, and final-test partitions.

import { type AnalystFinding, makeFinding, pairedBootstrap } from '@tangle-network/agent-eval'
import {
  type JudgeConfig,
  type JudgeRunResult,
  type MultishotMessage,
  type MultishotPersona,
  type MultishotResult,
  type MultishotShape,
  runJudge,
  runMultishot,
} from '@tangle-network/agent-eval/multishot'
import type { AgentProfile } from '@tangle-network/agent-interface'

// ── 1. Mocked router (set MOCK=0 + TANGLE_API_KEY to run live) ──────────────

interface ScriptedReply {
  text?: string
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>
}

function installMockRouter(replies: ScriptedReply[]): () => void {
  if (process.env.MOCK === '0') return () => undefined
  const original = global.fetch
  let i = 0
  global.fetch = (async () => {
    const r = replies[i++ % replies.length]
    if (!r) throw new Error('mock router: no scripted reply available')
    const message: Record<string, unknown> = { content: r.text ?? null }
    if (r.toolCalls?.length) {
      message.tool_calls = r.toolCalls.map((tc, idx) => ({
        id: `call-${i}-${idx}`,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.args) },
      }))
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message }],
        usage: { prompt_tokens: 100, completion_tokens: 200 },
      }),
      text: async () => 'ok',
    } as Response
  }) as typeof fetch
  return () => {
    global.fetch = original
  }
}

// ── 2. A tiny domain — viral content scoring ─────────────────────────────────

interface FounderPersona extends MultishotPersona {
  id: string
  name: string
  domain: string
}

const PERSONAS: FounderPersona[] = [
  { id: 'cpg-founder', name: 'Maya', domain: 'functional beverages' },
  { id: 'b2b-saas', name: 'Theo', domain: 'B2B analytics SaaS' },
  { id: 'creator', name: 'Aurora', domain: 'beauty creator economy' },
]

const shape: MultishotShape<FounderPersona> = {
  buildOpener: (p) =>
    `I'm ${p.name}, ${p.domain}. Help me write content that actually gets engagement.`,
  buildDriverSystemPrompt: (p) =>
    `You are ${p.name} working in ${p.domain}. Push back on vague advice; demand concrete posts.`,
}

// ── 3. Baseline AgentProfile (v0) — intentionally weak ──────────────────────

const baseline: AgentProfile = {
  name: 'content-coach',
  prompt: { systemPrompt: 'You help founders write better posts. Give general advice.' },
}

// ── 4. Judge — scores how concrete + audience-fit the agent's output is ────

const dims = [
  {
    key: 'concreteness',
    description: 'Real posts vs vague descriptions (0=descriptions, 10=ready-to-post)',
  },
  { key: 'audience_fit', description: "Tailored to the persona's domain (0=generic, 10=spot-on)" },
] as const

const conversationJudge: JudgeConfig<{ transcript: MultishotMessage[]; persona: FounderPersona }> =
  {
    name: 'content-quality',
    systemPrompt: 'You are a strict judge. Output ONLY valid JSON.',
    dimensions: [...dims],
    buildPrompt: ({ transcript, persona }) =>
      `Score this agent's output for ${persona.name} (${persona.domain}). 0-10 each.\n\n${transcript
        .filter((m) => m.role !== 'tool')
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n\n')}\n\nRespond with ONLY: {"concreteness":N,"audience_fit":N,"notes":"..."}`,
  }

// ── 5. Analyst — reads v0 transcripts + scores, emits a canonical AnalystFinding ──
// The reflective step a production analyst loop runs before a complete optimization method.
// The finding type is the canonical `AnalystFinding` from agent-eval — stamped via
// `makeFinding` (schema-version / finding-id / timestamp) — NOT a local one-off interface; that is the
// exact finding shape a method factory receives through `improve(profile, { findings, ... })`.
// The proposed mutation rides
// `recommended_action`. Offline we derive it deterministically so the demo stays reproducible.

async function runAnalyst(
  v0Runs: Array<{ persona: FounderPersona; result: MultishotResult; judge: JudgeRunResult }>,
): Promise<AnalystFinding> {
  const worst = [...v0Runs].sort((a, b) => a.judge.score.composite - b.judge.score.composite)[0]
  if (!worst) throw new Error('analyst: no v0 runs to analyze')
  return makeFinding({
    analyst_id: 'content-quality-analyst',
    severity: 'high',
    area: 'agent-reasoning',
    claim: `${worst.persona.name} run scored ${worst.judge.score.composite.toFixed(1)} — output was too generic, no concrete posts.`,
    confidence: 0.9,
    evidence_refs: [],
    recommended_action:
      "Always include 2 ready-to-post examples tailored to the persona's exact domain (use specific verbs, numbers, and audience language).",
  })
}

function applyMutation(base: AgentProfile, mutation: string): AgentProfile {
  return {
    ...base,
    prompt: {
      ...base.prompt,
      systemPrompt: `${base.prompt?.systemPrompt ?? ''}\n\nIMPROVED v1: ${mutation}`,
    },
  }
}

// ── 6. Gate — promote v1 only if the PAIRED-bootstrap CI lower bound clears 0 ──
// This shows the statistical core of `improve()` final-test scoring: pair v1 against v0 per scenario,
// bootstrap a CI on the median paired delta, and ship only if the CI's lower bound beats 0.
// `pairedBootstrap` (the same statistics primitive the real gate is built on) does exactly this; the
// `seed` keeps it deterministic offline.
//
// ⚠️ MINIMUM-EVIDENCE FLOOR — this demo deliberately omits it. We gate at n=3 personas so the example
// stays small and runnable, but n=3 is BELOW the floor the production gate enforces: agent-eval's
// `heldoutSignificance` won't even report a pair under `minSamples` (default 8), and `HeldOutGate`
// rejects with `few_runs` below `minProductiveRuns`. A CI on 3 paired points is the "small-n mirage"
// (this repo's documented #1 failure mode): a near-constant gap can clear 0 and still mean nothing.
// NEVER ship a real change on n=3 — call `improve()` / the held-out gate, which floors the evidence
// for you, and bring 20-50 paired observations to a defensible claim.

function gate(
  v0Scores: number[],
  v1Scores: number[],
): { ship: boolean; delta: number; low: number; high: number; reason: string } {
  const ci = pairedBootstrap(v0Scores, v1Scores, { seed: 42 })
  const ship = ci.low > 0
  return {
    ship,
    delta: ci.median,
    low: ci.low,
    high: ci.high,
    reason: ship
      ? `paired median +${ci.median.toFixed(2)}, 95% CI [${ci.low.toFixed(2)}, ${ci.high.toFixed(2)}] clears 0 (n=${ci.n})`
      : `paired median ${ci.median >= 0 ? '+' : ''}${ci.median.toFixed(2)}, 95% CI [${ci.low.toFixed(2)}, ${ci.high.toFixed(2)}] includes 0 — not beyond luck (n=${ci.n})`,
  }
}

// ── 7. Wire it together ─────────────────────────────────────────────────────

async function runVariant(profile: AgentProfile, scriptedReplies: ScriptedReply[]) {
  const restore = installMockRouter(scriptedReplies)
  process.env.TANGLE_API_KEY ??= 'test-key'
  try {
    const runs: Array<{
      persona: FounderPersona
      result: MultishotResult
      judge: JudgeRunResult
    }> = []
    for (const persona of PERSONAS) {
      // Each persona gets one shot (`maxTurns: 1`). `runMultishot` plays N shots in
      // parallel. (shot/round vocabulary: see examples/driver-loop/.)
      const result = await runMultishot({ profile, persona, shape, maxTurns: 1 })
      const judge = await runJudge(conversationJudge, { transcript: result.transcript, persona })
      runs.push({ persona, result, judge })
    }
    const mean = runs.reduce((s, r) => s + r.judge.score.composite, 0) / runs.length
    return { runs, mean }
  } finally {
    restore()
  }
}

async function main(): Promise<void> {
  console.log('═══ self-improving-loop demo ═══\n')

  // v0 replies: weak generic advice + judge scores low
  const v0Replies: ScriptedReply[] = [
    { text: 'Write engaging posts. Be authentic. Tell your story.' },
    { text: '{"concreteness":3,"audience_fit":4,"notes":"vague"}' },
    { text: 'Post consistently. Use hashtags.' },
    { text: '{"concreteness":2,"audience_fit":3,"notes":"generic"}' },
    { text: 'Mix images and text. Engage your audience.' },
    { text: '{"concreteness":3,"audience_fit":4,"notes":"no concrete posts"}' },
  ]
  console.log('— Phase 1: v0 baseline run')
  const v0 = await runVariant(baseline, v0Replies)
  console.log(`  v0 mean: ${v0.mean.toFixed(2)} (over ${v0.runs.length} personas)`)
  for (const r of v0.runs)
    console.log(`    ${r.persona.id.padEnd(14)} composite=${r.judge.score.composite.toFixed(2)}`)

  console.log('\n— Phase 2: analyst proposes mutation')
  const finding = await runAnalyst(v0.runs)
  const mutation = finding.recommended_action ?? ''
  console.log(`  root cause: ${finding.claim}`)
  console.log(`  mutation:   ${mutation}`)

  console.log('\n— Phase 3: apply mutation → v1 profile')
  const v1 = applyMutation(baseline, mutation)

  // v1 replies: now concrete + audience-fit
  const v1Replies: ScriptedReply[] = [
    {
      text: 'Here are 2 tweets for Maya: "Just opened our 50th retailer in TX — onboarding playbook is up on Notion." / "Why we said no to Kroger: margin math + ops bandwidth."',
    },
    { text: '{"concreteness":8,"audience_fit":9,"notes":"concrete + retail-specific"}' },
    {
      text: 'Here are 2 LinkedIn posts for Theo: "We cut MRR churn 32% by routing every renewal through a forecasted-risk score." / "Why your B2B PLG playbook stalls at $5M ARR (and what to do)."',
    },
    { text: '{"concreteness":9,"audience_fit":8,"notes":"B2B-specific metrics"}' },
    {
      text: 'Two TikTok hooks for Aurora: "POV: you finally found the foundation that matches NC15 + has SPF" / "What I wish I knew before booking my first brand deal at 50k followers."',
    },
    { text: '{"concreteness":8,"audience_fit":9,"notes":"creator-economy-specific"}' },
  ]

  console.log('\n— Phase 4: v1 re-run')
  const v1Result = await runVariant(v1, v1Replies)
  console.log(`  v1 mean: ${v1Result.mean.toFixed(2)} (over ${v1Result.runs.length} personas)`)
  for (const r of v1Result.runs)
    console.log(`    ${r.persona.id.padEnd(14)} composite=${r.judge.score.composite.toFixed(2)}`)

  console.log('\n— Phase 5: gate decision')
  // Pair v1 against v0 per persona (both iterate PERSONAS in order, so index aligns) and gate on the
  // paired-bootstrap CI — the production held-out gate's statistical core, not a bare mean delta.
  const v0Scores = v0.runs.map((r) => r.judge.score.composite)
  const v1Scores = v1Result.runs.map((r) => r.judge.score.composite)
  const verdict = gate(v0Scores, v1Scores)
  console.log(
    `  ship: ${verdict.ship} | paired median delta: ${verdict.delta >= 0 ? '+' : ''}${verdict.delta.toFixed(2)} | ${verdict.reason}`,
  )

  if (verdict.ship) {
    console.log('\n═══ PROMOTED v1 → production ═══')
    console.log(
      'In a real product the new systemPrompt would land in the production composer\nand subsequent chat turns would use it. See agent-eval-adoption skill Phase 3.',
    )
  } else {
    console.log('\n═══ HELD — keep v0 ═══')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
