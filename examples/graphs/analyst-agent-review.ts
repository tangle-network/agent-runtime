/**
 * analyst-agent-review — the reviewer as a TOOL-EQUIPPED AGENT, not a registry lens.
 *
 * The analyzes edge names a graph NODE ('reviewer') as its analyst. When the implementer
 * settles, `runGraph` spawns the reviewer node's pinned profile as a real WORKER through the
 * same spawn machinery every worker uses: its task is the analyzes directive plus the
 * implementer's tool-trace evidence, its spend reserves from the graph's one conserved budget,
 * and its settle OUTPUT is the findings — published to the driver as a `finding` event and
 * ledgered as the analyzes traversal, exactly like a registry-analyst finding.
 *
 * Oracle doctrine holds structurally: the reviewer has NO delegates edge pointing at it (a graph
 * that adds one is refused), so the driver can never hand it work or smuggle capabilities into
 * it — it runs only as the lens over the evidence, with whatever tools its own profile grants.
 *
 * Fully offline (scripted brain + leaf seam). Run:  pnpm tsx examples/graphs/analyst-agent-review.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { type AgentGraph, promptHandle } from '@tangle-network/agent-runtime/kernel'
import { type RunGraphTestOptions, runGraphWithTestBrain } from '../../src/testing'
import { leafSeam, offlineProfile, printLedger, scriptedBrain } from './shared'

const brief = promptHandle('delegates/worker-brief/v1')
const report = promptHandle('analyzes/findings-report/v1')

export function analystAgentReview(): { graph: AgentGraph; opts: RunGraphTestOptions } {
  // ── The topology: plain data (the analyst is the 'reviewer' NODE, not a registry lens) ──
  const graph: AgentGraph = {
    nodes: [
      { id: 'driver', profile: offlineProfile('driver', 'Drive the build.') },
      { id: 'implementer', profile: offlineProfile('implementer', 'Build.') },
      {
        id: 'reviewer',
        profile: offlineProfile('reviewer', 'Review the trace evidence.'),
      },
    ],
    edges: [
      { kind: 'delegates', from: 'driver', to: 'implementer', directive: brief },
      {
        kind: 'analyzes',
        analyst: 'reviewer',
        over: ['implementer'],
        to: 'driver',
        directive: report,
      },
    ],
    deliverable: { describe: 'the built artifact', check: (out) => out !== undefined },
    budget: { maxIterations: 20, maxTokens: 50_000 },
  }

  const received: AgentProfile[] = []
  const opts: RunGraphTestOptions = {
    runId: 'rev',
    makeLeafAgent: leafSeam(received, {
      implementer: { withTrace: true },
      // The reviewer node settles with its review — that OUTPUT is the findings the driver gets.
      reviewer: {
        shots: [{ out: { verdict: 'needs-changes', defects: ['no tests'] }, valid: true }],
      },
    }),
    brain: scriptedBrain([
      {
        toolCalls: [
          {
            name: 'spawn_worker',
            arguments: { profile: { name: 'implementer' }, task: 'implement the feature' },
          },
        ],
      },
      // implementer settles → the reviewer AGENT is spawned over its trace → its settle output
      // arrives as the finding. Two bus events: settled, finding.
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { content: 'done' },
    ]),
  }
  return { graph, opts }
}

export async function main(): Promise<void> {
  const { graph, opts } = analystAgentReview()
  const res = await runGraphWithTestBrain(graph, opts)
  printLedger('analyst-agent-review', res)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
