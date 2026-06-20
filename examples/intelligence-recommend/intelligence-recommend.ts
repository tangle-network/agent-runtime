/**
 * The intelligence loop, end to end and OFFLINE: a recorded TRACE → derived FINDINGS → a gated
 * improvement CANDIDATE.
 *
 * The branch ships the two halves of this loop disconnected: Observe (`createIntelligenceClient` +
 * `recordTrace`, which exports a run's loop topology as a trace) and `improve()` (the held-out-gated
 * RSI verb). This example is the first to connect them — the seam a Recommend mode runs in production:
 *
 *   1. OBSERVE — record a run's `LoopTraceEvent` stream as one trace (best-effort export; with no
 *      OTLP endpoint configured it is a no-op, so this runs offline with no credentials).
 *   2. ANALYZE — derive `AnalystFinding`s from that trace. In production a trace analyst reads the
 *      spans; here we hand-derive two findings that cite the recorded trace, to keep it offline.
 *   3. IMPROVE — feed the findings to `improve()` (the REQUIRED positional `findings` arg) with a
 *      scripted generator + deterministic judge, and print the gated candidate.
 *
 * Run:  pnpm tsx examples/intelligence-recommend/intelligence-recommend.ts
 */

import { makeFinding } from '@tangle-network/agent-eval'
import type {
  DispatchContext,
  ImprovementDriver,
  JudgeConfig,
  MutableSurface,
  Scenario,
} from '@tangle-network/agent-eval/contract'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { improve } from '@tangle-network/agent-runtime'
import { createIntelligenceClient } from '@tangle-network/agent-runtime/intelligence'
import type { LoopTraceEvent } from '@tangle-network/agent-runtime/loops'

// ── 1. OBSERVE — record a run's loop topology as one trace ──────────────────
// A real run emits this `LoopTraceEvent` stream from the kernel; here a tiny two-event trace stands
// in. With no OTLP endpoint set, export is a no-op — offline, no credentials.
const runId = 'run-001'
const events: LoopTraceEvent[] = [
  {
    kind: 'loop.started',
    runId,
    timestamp: 0,
    payload: { driver: 'demo', agentRunNames: ['agent'], maxIterations: 3, maxConcurrency: 1 },
  },
  {
    kind: 'loop.ended',
    runId,
    timestamp: 1,
    payload: { winnerIterationIndex: 0, totalCostUsd: 0.01, durationMs: 1, iterations: 3 },
  },
]

const intelligence = createIntelligenceClient({ project: 'example' })
const traceId = intelligence.recordTrace(events, { traceId: 'a'.repeat(32) })

// ── 2. ANALYZE — derive findings that cite the recorded trace ───────────────
// In production a trace analyst reads the spans and emits these; offline we hand-derive two findings,
// each citing the trace via an EvidenceRef so the provenance chain is real.
const findings = [
  makeFinding({
    analyst_id: 'demo-analyst',
    severity: 'medium',
    area: 'agent-reasoning',
    claim: 'the agent under-specifies its answer format, leading to retries',
    confidence: 0.8,
    evidence_refs: [{ kind: 'span', uri: `span://${traceId}/${runId}` }],
  }),
  makeFinding({
    analyst_id: 'demo-analyst',
    severity: 'low',
    area: 'cost',
    claim: 'three iterations spent before the first valid answer',
    confidence: 0.7,
    evidence_refs: [{ kind: 'span', uri: `span://${traceId}/${runId}` }],
  }),
]

// ── 3. IMPROVE — feed the findings to the gated RSI verb (offline scripted) ──
interface DemoScenario extends Scenario {
  kind: 'demo'
}
const scenarios: DemoScenario[] = Array.from({ length: 12 }, (_, i) => ({
  id: `s${i}`,
  kind: 'demo' as const,
}))

const agent = async (
  surface: MutableSurface,
  _scenario: DemoScenario,
  ctx: DispatchContext,
): Promise<string> => {
  ctx.cost.observe(0.0001, 'example')
  ctx.cost.observeTokens({ input: 1, output: 1 })
  return String(surface)
}

const judge: JudgeConfig<string, DemoScenario> = {
  name: 'literal',
  dimensions: [{ key: 'q', description: 'q' }],
  score: ({ artifact }) => {
    const composite = artifact.includes('PROMOTED') ? 1 : 0
    return { dimensions: { q: composite }, composite, notes: '' }
  },
}

// The scripted stand-in for the reflective driver — in production this is `gepaDriver`, which reads
// the findings above and proposes a reworded prompt. Offline it returns a fixed winning candidate.
const scriptedWinner: ImprovementDriver = {
  kind: 'scripted-winner',
  async propose() {
    return [{ surface: 'PROMOTED', label: 'win', rationale: 'from findings' }]
  },
}

const profile: AgentProfile = { name: 'demo', prompt: { systemPrompt: 'BASELINE' } }

async function main(): Promise<void> {
  const out = await improve(profile, findings, {
    surface: 'prompt',
    generator: scriptedWinner,
    scenarios,
    judge,
    agent,
    budget: { generations: 1, populationSize: 2, reps: 3, holdoutFraction: 0.5 },
  })
  console.log(`trace recorded: ${traceId}`)
  console.log(`findings derived: ${findings.length}`)
  console.log(`gated candidate: shipped=${out.shipped} gate=${out.gateDecision}`)
  console.log(`prompt after: ${out.profile.prompt?.systemPrompt}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
