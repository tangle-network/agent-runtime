/**
 * skeptic-majority — P06 + P07 (README catalog): lens-diverse adversarial verification, kept on a
 * 2-of-3 vote.
 *
 * A flow graph: the `claimant` entry states a claim; a fork sends it to three skeptic nodes, each
 * on a different model family and with a different lens (accuracy, scope, reproducibility); a join
 * starts `tally` once all three settled, with every verdict and the claim as evidence. The tally's
 * result is the run's output: a kept claim carries the claimant's output, a dropped one only the
 * votes. The decision is graph data, so no root scripts it (#1773), and the deliverable accepts
 * nothing else, so the claim can never become the result of a run that voted it down.
 *
 * Fully offline (leaf seam, no brain). Run:  pnpm tsx examples/graphs/skeptic-majority.ts
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
const SKEPTICS = ['skeptic-accuracy', 'skeptic-scope', 'skeptic-repro'] as const

type Vote = 'holds' | 'refuted'

/** What the claimant states. */
export const CLAIM = { claim: 'the p99 regression comes from the cache miss path', runs: 12 }

/** The tally's decision, as delivered. `claim` is present exactly when the claim was kept. */
export interface SkepticDecision {
  readonly kept: boolean
  readonly holds: number
  readonly refuted: number
  readonly claim?: unknown
}

/** Count the verdicts the join carried and keep the claim on two of three. */
function tally(task: unknown): SkepticDecision {
  const evidence = (task as { evidence: Record<string, { verdict?: Vote }> }).evidence
  const holds = SKEPTICS.filter((s) => evidence[s]?.verdict === 'holds').length
  const votes = { holds, refuted: SKEPTICS.length - holds }
  return holds >= 2 ? { kept: true, ...votes, claim: evidence.claimant } : { kept: false, ...votes }
}

export function skepticMajority(
  votes: readonly [Vote, Vote, Vote] = ['holds', 'holds', 'refuted'],
): { graph: AgentGraph; opts: RunGraphOptions } {
  // ── The topology: plain data — a fork to three skeptics, a join into the tally ──
  const graph: AgentGraph = {
    nodes: [
      workerNode('claimant', 'State and support the claim.'),
      workerNode('skeptic-accuracy', 'Attack the facts.', 'anthropic'),
      workerNode('skeptic-scope', 'Attack the scope.', 'openai'),
      workerNode('skeptic-repro', 'Attack reproducibility.', 'google'),
      workerNode('tally', 'Keep the claim only if two of three skeptics fail to refute it.'),
    ],
    entry: [{ node: 'claimant', task: 'make the claim' }],
    edges: [
      { kind: 'routes', from: 'claimant', to: [...SKEPTICS], directive: brief },
      {
        kind: 'routes',
        from: [...SKEPTICS],
        to: 'tally',
        evidence: ['claimant'],
        directive: brief,
      },
    ],
    deliverable: {
      describe: 'the 2-of-3 decision on the claim, carrying the claim only if it was kept',
      check: (out) => {
        const d = (out as { tally?: Partial<SkepticDecision> } | undefined)?.tally
        if (typeof d?.kept !== 'boolean' || (d.holds ?? 0) + (d.refuted ?? 0) !== 3) return false
        return d.kept ? d.claim !== undefined && (d.holds ?? 0) >= 2 : d.claim === undefined
      },
    },
    budget: { maxIterations: 40, maxTokens: 100_000 },
  }

  const verdictOf = (vote: Vote) => ({ shots: [{ out: { verdict: vote }, valid: true }] })
  const received: AgentProfile[] = []
  const opts: RunGraphOptions = {
    runId: 'skep',
    perWorker: { maxIterations: 4, maxTokens: 1_000 },
    workerSlots: 3,
    makeLeafAgent: leafSeam(received, {
      claimant: { shots: [{ out: CLAIM, valid: true }] },
      'skeptic-accuracy': verdictOf(votes[0]),
      'skeptic-scope': verdictOf(votes[1]),
      'skeptic-repro': verdictOf(votes[2]),
      tally: { shots: [{ fromTask: tally, valid: true }] },
    }),
  }
  return { graph, opts }
}

export async function main(): Promise<void> {
  for (const votes of [
    ['holds', 'holds', 'refuted'],
    ['refuted', 'holds', 'refuted'],
  ] as const) {
    const { graph, opts } = skepticMajority(votes)
    const res = await runGraph(graph, opts)
    printLedger(`skeptic-majority (${votes.join(', ')})`, res)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
