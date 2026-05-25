// The 4-package composition demo: agent-runtime + agent-eval + agent-knowledge + sandbox
// wired end-to-end into a single self-improving loop. Runs offline with stubbed router
// responses so the demo is reproducible; pass TANGLE_API_KEY to see it fire live.
//
// What this shows:
//   1. baseline AgentProfile (substrate type from @tangle-network/sandbox)
//   2. runMultishot over N personas (from @tangle-network/agent-eval/multishot)
//   3. 3 judges score conversations + artifacts
//   4. analyst phase reads transcripts → proposes a systemPrompt mutation
//   5. apply mutation → new AgentProfile variant
//   6. re-run multishot with v1 profile
//   7. gate compares v0 vs v1 means → ship / no-ship decision
//
// See README.md for the conceptual map.

import {
  type JudgeConfig,
  type MultishotMessage,
  type MultishotPersona,
  type MultishotResult,
  type MultishotShape,
  runJudge,
  runMultishot,
} from '@tangle-network/agent-eval/multishot'
import type { AgentProfile } from '@tangle-network/sandbox'

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

// ── 5. Analyst — reads v0 transcripts + scores, proposes a mutation ────────

interface AnalystFinding {
  rootCause: string
  proposedMutation: string
}

async function runAnalyst(
  v0Runs: Array<{ persona: FounderPersona; result: MultishotResult; score: { composite: number } }>,
): Promise<AnalystFinding> {
  // In a real product the analyst would be an LLM call (@tangle-network/agent-runtime/analyst-loop).
  // Here we synthesise the finding deterministically so the demo is reproducible.
  const worst = [...v0Runs].sort((a, b) => a.score.composite - b.score.composite)[0]
  return {
    rootCause: `${worst.persona.name} run scored ${worst.score.composite.toFixed(1)} — output was too generic, no concrete posts.`,
    proposedMutation:
      "Always include 2 ready-to-post examples tailored to the persona's exact domain (use specific verbs, numbers, and audience language).",
  }
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

// ── 6. Gate — promote v1 only if it beats v0 by >= delta ───────────────────

function gate(
  v0Mean: number,
  v1Mean: number,
  requiredDelta = 0.5,
): { ship: boolean; delta: number; reason: string } {
  const delta = v1Mean - v0Mean
  if (delta >= requiredDelta)
    return { ship: true, delta, reason: `v1 beat v0 by ${delta.toFixed(2)} (>= ${requiredDelta})` }
  return {
    ship: false,
    delta,
    reason: `v1 only beat v0 by ${delta.toFixed(2)} (< ${requiredDelta})`,
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
      score: { composite: number }
    }> = []
    for (const persona of PERSONAS) {
      const result = await runMultishot({ profile, persona, shape, maxTurns: 1 })
      const score = await runJudge(conversationJudge, { transcript: result.transcript, persona })
      runs.push({ persona, result, score })
    }
    const mean = runs.reduce((s, r) => s + r.score.composite, 0) / runs.length
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
    console.log(`    ${r.persona.id.padEnd(14)} composite=${r.score.composite.toFixed(2)}`)

  console.log('\n— Phase 2: analyst proposes mutation')
  const finding = await runAnalyst(v0.runs)
  console.log(`  root cause: ${finding.rootCause}`)
  console.log(`  mutation:   ${finding.proposedMutation}`)

  console.log('\n— Phase 3: apply mutation → v1 profile')
  const v1 = applyMutation(baseline, finding.proposedMutation)

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
    console.log(`    ${r.persona.id.padEnd(14)} composite=${r.score.composite.toFixed(2)}`)

  console.log('\n— Phase 5: gate decision')
  const verdict = gate(v0.mean, v1Result.mean)
  console.log(
    `  ship: ${verdict.ship} | delta: ${verdict.delta >= 0 ? '+' : ''}${verdict.delta.toFixed(2)} | ${verdict.reason}`,
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
