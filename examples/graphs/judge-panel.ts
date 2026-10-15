/**
 * judge-panel — P08 (README catalog): several attempts at one task, scored by a panel, the best one
 * delivered.
 *
 * Three `attempt` workers (one `delegates` edge each) run in parallel; two judge analyst NODES
 * watch all three. A judge fires on each attempt's settle, so the ledger carries 2 judges x 3
 * attempts = 6 `analyzes` rows to the root. The root sums each attempt's scores, reads the top
 * attempt's output with `observe_agent`, and delivers it through `submit_result`, so the run's
 * `result.out` IS the panel's choice. The deliverable accepts only that decision (an attempt plus
 * the totals it won on), so a raw attempt the default finalizer would pick can never pass for it.
 * The judges never receive a delegation (an analyst is never delegated to), so no driver can hand
 * them the rubric.
 *
 * Fully offline (reactive brain + leaf seam). Run:  pnpm tsx examples/graphs/judge-panel.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { type AgentGraph, promptHandle } from '@tangle-network/agent-runtime/kernel'
import { type RunGraphTestOptions, runGraphWithTestBrain } from '../../src/testing'
import {
  DECIDING_ROOT_TOOLS,
  driverNode,
  findingsOf,
  leafSeam,
  observedOutput,
  printLedger,
  reactiveBrain,
  submitTurn,
  workerNode,
} from './shared'

const brief = promptHandle('delegates/worker-brief/v1')
const report = promptHandle('analyzes/findings-report/v1')

const ATTEMPTS = ['attempt-a', 'attempt-b', 'attempt-c'] as const
const JUDGES = ['judge-rigor', 'judge-clarity'] as const

/** What each attempt produces: distinct work, so the delivered one is identifiable. */
export const ATTEMPT_OUT: Record<(typeof ATTEMPTS)[number], { attempt: string; patch: string }> = {
  'attempt-a': { attempt: 'a', patch: 'retry the request once' },
  'attempt-b': { attempt: 'b', patch: 'retry with backoff and a deadline' },
  'attempt-c': { attempt: 'c', patch: 'drop the request on timeout' },
}

/** Each judge's score for an attempt, by the attempt it READ (a judge scores the source output its
 *  task carried, never a settle ordinal): attempt-b wins on 0.9 + 0.8. */
const SCORES: Record<(typeof JUDGES)[number], Record<string, number>> = {
  'judge-rigor': { a: 0.4, b: 0.9, c: 0.5 },
  'judge-clarity': { a: 0.5, b: 0.8, c: 0.6 },
}

/** The root's decision, as delivered: the winning attempt's own output and every total. */
export interface PanelDecision {
  readonly winner: { attempt: string; patch: string }
  /** Summed judge score per attempt worker id. */
  readonly totals: Readonly<Record<string, number>>
}

export function judgePanel(): { graph: AgentGraph; opts: RunGraphTestOptions } {
  // ── The topology: plain data ──
  const graph: AgentGraph = {
    nodes: [
      driverNode(
        'lead',
        'Run the attempts, then deliver the one the panel scores highest.',
        DECIDING_ROOT_TOOLS,
      ),
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
    deliverable: {
      describe: 'the attempt the panel scored highest, with every total',
      check: (out) => {
        const d = out as Partial<PanelDecision> | undefined
        return typeof d?.winner?.attempt === 'string' && Object.keys(d.totals ?? {}).length === 3
      },
    },
    budget: { maxIterations: 60, maxTokens: 100_000 },
  }

  const scoring = (judge: (typeof JUDGES)[number]) => ({
    shots: [
      {
        fromSource: (source: unknown) => ({
          score: SCORES[judge][(source as { attempt: string }).attempt],
        }),
        valid: true,
      },
    ],
  })
  const received: AgentProfile[] = []
  const opts: RunGraphTestOptions = {
    runId: 'panel',
    workerSlots: 3,
    wake: { debounceMs: 0 },
    makeLeafAgent: leafSeam(received, {
      ...Object.fromEntries(
        ATTEMPTS.map((a) => [
          a,
          { withTrace: true, shots: [{ out: ATTEMPT_OUT[a], valid: true }] },
        ]),
      ),
      'judge-rigor': scoring('judge-rigor'),
      'judge-clarity': scoring('judge-clarity'),
    }),
    brain: reactiveBrain((events, call, results) => {
      if (call === 0) {
        return {
          toolCalls: ATTEMPTS.map((a) => ({
            name: 'spawn_worker',
            arguments: { profile: { name: a }, task: 'attempt the task' },
          })),
        }
      }
      const findings = findingsOf(events)
      if (findings.length < ATTEMPTS.length * JUDGES.length) {
        return { content: 'waiting for the panel' }
      }
      const totals: Record<string, number> = {}
      for (const f of findings) {
        totals[f.fromWorker] = (totals[f.fromWorker] ?? 0) + Number(f.findings.score ?? 0)
      }
      const top = Object.entries(totals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
      const winner = observedOutput(results, 'read-winner')
      if (winner === undefined) {
        return {
          toolCalls: [{ id: 'read-winner', name: 'observe_agent', arguments: { workerId: top } }],
        }
      }
      return submitTurn(results, call, { winner, totals })
    }),
  }
  return { graph, opts }
}

export async function main(): Promise<void> {
  const { graph, opts } = judgePanel()
  const res = await runGraphWithTestBrain(graph, opts)
  printLedger('judge-panel', res)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
