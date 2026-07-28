/**
 * The intelligence loop, end to end and OFFLINE: a recorded TRACE → derived FINDINGS → a gated
 * improvement CANDIDATE.
 *
 * This is `improve()` (see examples/improve/) with ONE thing changed: the findings the loop
 * reflects on are no longer hand-written — they are DERIVED from a recorded run trace. The agent
 * harness (scenarios, agent, judge, the complete method, the baseline profile) is imported from
 * improve.ts verbatim, so this file shows only the NEW seam a Recommend mode runs in production:
 *
 *   1. OBSERVE — record a run's `LoopTraceEvent` stream as one trace (best-effort export; with no
 *      tenant apiKey configured it is a no-op, so this runs offline with no credentials).
 *   2. ANALYZE — derive `AnalystFinding`s from that trace. In production a trace analyst reads the
 *      spans; here we hand-derive two findings that CITE the recorded trace, to keep it offline.
 *   3. IMPROVE — feed those findings to `improve()` and print the gated candidate.
 *
 * Run:  pnpm tsx examples/intelligence-recommend/intelligence-recommend.ts
 */

import { makeProposalFinding } from '@tangle-network/agent-eval'
import { inMemoryCampaignStorage } from '@tangle-network/agent-eval/campaign'
import { improve } from '@tangle-network/agent-runtime'
import { createIntelligenceClient } from '@tangle-network/agent-runtime/intelligence'
import type { LoopTraceEvent } from '@tangle-network/agent-runtime/loops'
import {
  agent,
  executionRef,
  judge,
  profile,
  scriptedWinner,
  selectionScenarios,
  testScenarios,
  trainScenarios,
} from '../improve/improve'

// ── 1. OBSERVE — record a run's loop topology as one trace ──────────────────
// A real run emits this `LoopTraceEvent` stream from the kernel; here a tiny two-event trace stands
// in. With no tenant apiKey set, export is a no-op — offline, no credentials.
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
  makeProposalFinding({
    analyst_id: 'demo-analyst',
    severity: 'medium',
    area: 'agent-reasoning',
    claim: 'the agent under-specifies its answer format, leading to retries',
    confidence: 0.8,
    evidence_refs: [{ kind: 'span', uri: `span://${traceId}/${runId}` }],
    proposal_origin: 'production',
  }),
  makeProposalFinding({
    analyst_id: 'demo-analyst',
    severity: 'low',
    area: 'cost',
    claim: 'three iterations spent before the first valid answer',
    confidence: 0.7,
    evidence_refs: [{ kind: 'span', uri: `span://${traceId}/${runId}` }],
    proposal_origin: 'production',
  }),
]

// ── 3. IMPROVE — feed the derived findings to the gated RSI verb (offline) ──
async function main(): Promise<void> {
  const out = await improve(profile, {
    surface: 'prompt',
    executionRef,
    method: scriptedWinner,
    findings,
    trainScenarios,
    selectionScenarios,
    testScenarios,
    judges: [judge],
    agent,
    runDir: 'mem://intelligence-recommend',
    storage: inMemoryCampaignStorage(),
    resamples: 40,
    confidence: 0.95,
  })
  console.log(`trace recorded: ${traceId}`)
  console.log(`findings derived: ${findings.length}`)
  console.log(`candidate decision: ${out.decision}`)
  console.log(`candidate prompt: ${out.candidate.profile.prompt?.systemPrompt}`)
  console.log(`live prompt unchanged: ${profile.prompt?.systemPrompt}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
