/**
 * judge-panel — P08 (README catalog): several attempts at one task, scored by a panel, the best one
 * delivered.
 *
 * A flow graph: three `attempt` entries run in parallel; a join forks to two judge nodes once all
 * three settled, each judge reading every attempt from the join's evidence; a second join starts
 * `tally` with both judges' scores and the attempts as evidence. The tally sums each attempt's
 * scores and its result IS the panel's choice: the winning attempt's own output plus every total.
 * The decision is graph data, so no root scripts it (#1773), and the deliverable accepts only that
 * decision, so a raw attempt can never pass for it.
 *
 * Fully offline (leaf seam, no brain). Run:  pnpm tsx examples/graphs/judge-panel.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type AgentGraph,
  promptHandle,
  type RunGraphOptions,
  runGraph,
} from '@tangle-network/agent-runtime/kernel'
import { leafSeam, printLedger, workerNode } from './shared'

const brief = promptHandle('delegates/worker-brief/v1')

const ATTEMPTS = ['attempt-a', 'attempt-b', 'attempt-c'] as const
const JUDGES = ['judge-rigor', 'judge-clarity'] as const
type Attempt = (typeof ATTEMPTS)[number]

/** What each attempt produces: distinct work, so the delivered one is identifiable. */
export const ATTEMPT_OUT: Record<Attempt, { attempt: string; patch: string }> = {
  'attempt-a': { attempt: 'a', patch: 'retry the request once' },
  'attempt-b': { attempt: 'b', patch: 'retry with backoff and a deadline' },
  'attempt-c': { attempt: 'c', patch: 'drop the request on timeout' },
}

/** Each judge's score for an attempt, by the attempt it READ: attempt-b wins on 0.9 + 0.8. */
const SCORES: Record<(typeof JUDGES)[number], Record<string, number>> = {
  'judge-rigor': { a: 0.4, b: 0.9, c: 0.5 },
  'judge-clarity': { a: 0.5, b: 0.8, c: 0.6 },
}

/** The tally's decision, as delivered: the winning attempt's own output and every total. */
export interface PanelDecision {
  readonly winner: { attempt: string; patch: string }
  /** Summed judge score per attempt node. */
  readonly totals: Readonly<Record<string, number>>
}

type Evidence = Record<string, unknown>
const evidenceOf = (task: unknown) => (task as { evidence: Evidence }).evidence

export function judgePanel(): { graph: AgentGraph; opts: RunGraphOptions } {
  // ── The topology: plain data — three entries, a join-fork to the judges, a join to the tally ──
  const graph: AgentGraph = {
    nodes: [
      ...ATTEMPTS.map((a) => workerNode(a, 'Attempt the task your own way.')),
      workerNode('judge-rigor', 'Score every attempt for rigor.', 'anthropic'),
      workerNode('judge-clarity', 'Score every attempt for clarity.', 'openai'),
      workerNode('tally', 'Deliver the attempt the panel scores highest, with every total.'),
    ],
    entry: ATTEMPTS.map((a) => ({ node: a, task: 'attempt the task' })),
    edges: [
      { kind: 'routes', from: [...ATTEMPTS], to: [...JUDGES], directive: brief },
      { kind: 'routes', from: [...JUDGES], to: 'tally', evidence: [...ATTEMPTS], directive: brief },
    ],
    deliverable: {
      describe: 'the attempt the panel scored highest, with every total',
      check: (out) => {
        const d = (out as { tally?: Partial<PanelDecision> } | undefined)?.tally
        return typeof d?.winner?.attempt === 'string' && Object.keys(d.totals ?? {}).length === 3
      },
    },
    budget: { maxIterations: 60, maxTokens: 100_000 },
  }

  // A judge scores each attempt it read from the join's evidence.
  const judge = (name: (typeof JUDGES)[number]) => (task: unknown) =>
    Object.fromEntries(
      ATTEMPTS.map((a) => [
        a,
        SCORES[name][(evidenceOf(task)[a] as { attempt: string }).attempt] ?? 0,
      ]),
    )
  const tally = (task: unknown): PanelDecision => {
    const evidence = evidenceOf(task)
    const totals = Object.fromEntries(
      ATTEMPTS.map((a) => [
        a,
        JUDGES.reduce((sum, j) => sum + Number((evidence[j] as Evidence)[a]), 0),
      ]),
    )
    const top = Object.entries(totals).sort((x, y) => y[1] - x[1])[0]?.[0] as Attempt
    return { winner: evidence[top] as PanelDecision['winner'], totals }
  }
  const received: AgentProfile[] = []
  const opts: RunGraphOptions = {
    runId: 'panel',
    perWorker: { maxIterations: 4, maxTokens: 1_000 },
    workerSlots: 3,
    makeLeafAgent: leafSeam(received, {
      ...Object.fromEntries(
        ATTEMPTS.map((a) => [a, { shots: [{ out: ATTEMPT_OUT[a], valid: true }] }]),
      ),
      'judge-rigor': { shots: [{ fromTask: judge('judge-rigor'), valid: true }] },
      'judge-clarity': { shots: [{ fromTask: judge('judge-clarity'), valid: true }] },
      tally: { shots: [{ fromTask: tally, valid: true }] },
    }),
  }
  return { graph, opts }
}

export async function main(): Promise<void> {
  const { graph, opts } = judgePanel()
  const res = await runGraph(graph, opts)
  printLedger('judge-panel', res)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
