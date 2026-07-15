/**
 * `improve()` — the one pluggable RSI verb, offline.
 *
 * `improve(profile, findings, opts)` optimizes ONE surface of an agent's profile (here the system
 * prompt) and ships the winner only if it clears the held-out gate. It is a facade over agent-eval's
 * `selfImprove`: you name a `surface` and it picks the matching default mutator, extracts the baseline
 * from the profile, runs the loop, and — on a ship verdict — writes the promoted surface back into the
 * profile field.
 *
 * The REQUIRED positional `findings` (an `AnalystFinding[]`) is what the loop reflects on: the trace
 * analysts' read of what went wrong. Here it is a single hand-written finding.
 *
 * This example runs OFFLINE with no credentials: a scripted `SurfaceProposer` proposes a fixed
 * winning candidate, a deterministic judge scores it, and the "agent" returns the surface verbatim
 * while reporting token usage (so agent-eval's backend-integrity guard sees a real backend). Mirrors
 * `tests/improve.test.ts`.
 *
 * Run:  pnpm tsx examples/improve/improve.ts
 */

import { makeFinding } from '@tangle-network/agent-eval'
import type {
  DispatchContext,
  JudgeConfig,
  MutableSurface,
  Scenario,
  SurfaceProposer,
} from '@tangle-network/agent-eval/contract'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { improve } from '@tangle-network/agent-runtime'

export interface DemoScenario extends Scenario {
  kind: 'demo'
}

// 12 trivial scenarios — enough for the held-out gate's minimum-evidence floor.
export const scenarios: DemoScenario[] = Array.from({ length: 12 }, (_, i) => ({
  id: `s${i}`,
  kind: 'demo' as const,
}))

// The agent returns the surface verbatim as the artifact AND reports usage, so the backend-integrity
// guard sees a real backend rather than a stub-zero cell. No LLM.
export const agent = async (
  surface: MutableSurface,
  _scenario: DemoScenario,
  ctx: DispatchContext,
): Promise<string> => {
  const paid = await ctx.cost.runPaidCall({
    channel: 'agent',
    actor: 'example',
    model: 'deterministic-example',
    maximumCharge: { externallyEnforcedMaximumUsd: 0.0001 },
    execute: async () => String(surface),
    receipt: () => ({
      model: 'deterministic-example',
      inputTokens: 1,
      outputTokens: 1,
      actualCostUsd: 0.0001,
    }),
  })
  if (!paid.succeeded) throw paid.error
  return paid.value
}

// Deterministic judge: the literal string `PROMOTED` scores 1.0, anything else 0.0 — no LLM.
export const judge: JudgeConfig<string, DemoScenario> = {
  name: 'literal',
  dimensions: [{ key: 'q', description: 'q' }],
  score: ({ artifact }) => {
    const composite = artifact.includes('PROMOTED') ? 1 : 0
    return { dimensions: { q: composite }, composite, notes: '' }
  },
}

// A scripted SurfaceProposer that always proposes the winning surface — the offline stand-in for
// `gepaProposer`, no router call.
export const scriptedWinner: SurfaceProposer = {
  kind: 'scripted-winner',
  async propose() {
    return [{ surface: 'PROMOTED', label: 'win', rationale: 'from findings' }]
  },
}

// What the loop reflects on: the trace analysts' read of what went wrong. `makeFinding` stamps the
// schema-version / finding-id / timestamp the full `AnalystFinding` shape requires.
const findings = [
  makeFinding({
    analyst_id: 'demo-analyst',
    severity: 'medium',
    area: 'agent-reasoning',
    claim: 'the agent under-specifies its answer format',
    confidence: 0.8,
    evidence_refs: [],
  }),
]

export const profile: AgentProfile = { name: 'demo', prompt: { systemPrompt: 'BASELINE' } }

async function main(): Promise<void> {
  const out = await improve(profile, findings, {
    surface: 'prompt',
    generator: scriptedWinner,
    scenarios,
    judge,
    agent,
    // A perfect +1.0 lift at this n/reps clears the default held-out gate.
    budget: { generations: 1, populationSize: 2, reps: 3, holdoutFraction: 0.5 },
  })
  console.log(
    'improve() — proposed a new "prompt" surface from the analyst findings, measured it on held-out scenarios, and shipped only because the gate cleared (offline: scripted proposer, deterministic judge):',
  )
  console.log(`shipped: ${out.shipped}  lift: ${out.lift.toFixed(3)}  gate: ${out.gateDecision}`)
  console.log(`prompt after: ${out.profile.prompt?.systemPrompt}`)
}

// Only run the demo when this file is executed directly — intelligence-recommend.ts imports the
// scaffolding above (scenarios / agent / judge / scriptedWinner / profile) and must not trigger
// this loop on import.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
