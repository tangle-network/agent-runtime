/**
 * judge-panel — P08: several attempts at one task, scored by a panel, the best one named.
 *
 * 31 of the 660 scripts run N attempts and let a panel of judges pick. Three `attempt` workers
 * (one `delegates` edge each) run in parallel; two judge analyst NODES watch all three. A judge
 * fires on each attempt's settle, so the ledger carries 2 judges x 3 attempts = 6 `analyzes` rows
 * to the root, and the root sums each attempt's scores and names the highest. The judges never
 * receive a delegation (an analyst is never delegated to), so no driver can hand them the rubric.
 *
 * Fully offline (reactive brain + leaf seam). Run:  pnpm tsx examples/graphs/judge-panel.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { type AgentGraph, promptHandle } from '@tangle-network/agent-runtime/kernel'
import { type RunGraphTestOptions, runGraphWithTestBrain } from '../../src/testing'
import { driverNode, findingsOf, leafSeam, printLedger, reactiveBrain, workerNode } from './shared'

const brief = promptHandle('delegates/worker-brief/v1')
const report = promptHandle('analyzes/findings-report/v1')

const ATTEMPTS = ['attempt-a', 'attempt-b', 'attempt-c'] as const
const JUDGES = ['judge-rigor', 'judge-clarity'] as const

/** Each judge's score for the attempt it sees, in settle order (a, b, c): attempt-b wins. */
const SCORES: Record<(typeof JUDGES)[number], number[]> = {
  'judge-rigor': [0.4, 0.9, 0.5],
  'judge-clarity': [0.5, 0.8, 0.6],
}

export interface PanelDecision {
  /** Worker id of the winning attempt. */
  readonly winner: string
  /** Summed judge score per attempt worker id. */
  readonly totals: Readonly<Record<string, number>>
}

export function judgePanel(): {
  graph: AgentGraph
  opts: RunGraphTestOptions
  decision: () => PanelDecision | undefined
} {
  // ── The topology: plain data ──
  const graph: AgentGraph = {
    nodes: [
      driverNode('lead', 'Run the attempts, then keep the one the panel scores highest.'),
      ...ATTEMPTS.map((a) => workerNode(a, 'Attempt the task your own way.')),
      workerNode('judge-rigor', 'Score the attempt for rigor.', 'anthropic'),
      workerNode('judge-clarity', 'Score the attempt for clarity.', 'openai'),
    ],
    edges: [
      ...ATTEMPTS.map((to) => ({
        kind: 'delegates' as const,
        from: 'lead',
        to,
        directive: brief,
        maxTraversals: 1,
      })),
      ...JUDGES.map((analyst) => ({
        kind: 'analyzes' as const,
        analyst,
        over: [...ATTEMPTS],
        to: 'lead',
        directive: report,
      })),
    ],
    deliverable: { describe: 'the best attempt', check: (out) => out !== undefined },
    budget: { maxIterations: 60, maxTokens: 100_000 },
  }

  let decided: PanelDecision | undefined
  const scoring = (judge: (typeof JUDGES)[number]) => ({
    shots: SCORES[judge].map((score) => ({ out: { score }, valid: true })),
  })
  const received: AgentProfile[] = []
  const opts: RunGraphTestOptions = {
    runId: 'panel',
    workerSlots: 3,
    wake: { debounceMs: 0 },
    makeLeafAgent: leafSeam(received, {
      'attempt-a': { withTrace: true },
      'attempt-b': { withTrace: true },
      'attempt-c': { withTrace: true },
      'judge-rigor': scoring('judge-rigor'),
      'judge-clarity': scoring('judge-clarity'),
    }),
    brain: reactiveBrain((events, call) => {
      if (call === 0) {
        return {
          toolCalls: ATTEMPTS.map((a) => ({
            name: 'spawn_worker',
            arguments: { profile: { name: a }, task: 'attempt the task' },
          })),
        }
      }
      const findings = findingsOf(events)
      if (findings.length < ATTEMPTS.length * JUDGES.length)
        return { content: 'waiting for the panel' }
      const totals: Record<string, number> = {}
      for (const f of findings) {
        totals[f.fromWorker] = (totals[f.fromWorker] ?? 0) + Number(f.findings.score ?? 0)
      }
      const winner = Object.entries(totals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
      decided = { winner, totals }
      return { content: `done: ${winner} wins` }
    }),
  }
  return { graph, opts, decision: () => decided }
}

export async function main(): Promise<void> {
  const { graph, opts, decision } = judgePanel()
  const res = await runGraphWithTestBrain(graph, opts)
  printLedger('judge-panel', res)
  const d = decision()
  const node = res.ledger.find((r) => r.kind === 'delegates' && r.workerId === d?.winner)?.to
  console.log(`winner: ${node} (${d?.winner}) totals: ${JSON.stringify(d?.totals)}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
