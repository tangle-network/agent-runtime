/**
 * skeptic-majority — P06 + P07 (README catalog): lens-diverse adversarial verification, kept on a
 * 2-of-3 vote.
 *
 * The `claimant` worker states a claim; three skeptic analyst NODES attack it, each on a different
 * model family and with a different lens (accuracy, scope, reproducibility). Every skeptic fires on
 * the claimant's settle, so the ledger carries three `analyzes` rows per settle. The root counts
 * the verdicts it received and delivers its decision through `submit_result`: a kept claim carries
 * the claimant's output (read with `observe_agent`), a dropped one carries only the votes. The
 * deliverable accepts nothing else, so the claimant's raw output can never become the result of a
 * run that voted it down.
 *
 * Fully offline (reactive brain + leaf seam). Run:  pnpm tsx examples/graphs/skeptic-majority.ts
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

type Vote = 'holds' | 'refuted'

/** What the claimant states. */
export const CLAIM = { claim: 'the p99 regression comes from the cache miss path', runs: 12 }

/** The root's decision, as delivered. `claim` is present exactly when the claim was kept. */
export interface SkepticDecision {
  readonly kept: boolean
  readonly holds: number
  readonly refuted: number
  readonly claim?: unknown
}

export function skepticMajority(
  votes: readonly [Vote, Vote, Vote] = ['holds', 'holds', 'refuted'],
): {
  graph: AgentGraph
  opts: RunGraphTestOptions
} {
  // ── The topology: plain data — three skeptics, three model families, three lenses ──
  const graph: AgentGraph = {
    nodes: [
      driverNode(
        'lead',
        'Keep the claim only if two of three skeptics fail to refute it.',
        DECIDING_ROOT_TOOLS,
      ),
      workerNode('claimant', 'State and support the claim.'),
      workerNode('skeptic-accuracy', 'Attack the facts.', 'anthropic'),
      workerNode('skeptic-scope', 'Attack the scope.', 'openai'),
      workerNode('skeptic-repro', 'Attack reproducibility.', 'google'),
    ],
    edges: [
      { kind: 'delegates', from: 'lead', to: 'claimant', directive: brief, maxTraversals: 1 },
      ...['skeptic-accuracy', 'skeptic-scope', 'skeptic-repro'].map((analyst) => ({
        kind: 'analyzes' as const,
        analyst,
        over: ['claimant'],
        to: 'lead',
        directive: report,
      })),
    ],
    deliverable: {
      describe: 'the 2-of-3 decision on the claim, carrying the claim only if it was kept',
      check: (out) => {
        const d = out as Partial<SkepticDecision> | undefined
        if (typeof d?.kept !== 'boolean' || (d.holds ?? 0) + (d.refuted ?? 0) !== 3) return false
        return d.kept ? d.claim !== undefined && (d.holds ?? 0) >= 2 : d.claim === undefined
      },
    },
    budget: { maxIterations: 40, maxTokens: 100_000 },
  }

  const verdictOf = (vote: Vote) => ({ shots: [{ out: { verdict: vote }, valid: true }] })
  const received: AgentProfile[] = []
  const opts: RunGraphTestOptions = {
    runId: 'skep',
    wake: { debounceMs: 0 },
    makeLeafAgent: leafSeam(received, {
      claimant: { withTrace: true, shots: [{ out: CLAIM, valid: true }] },
      'skeptic-accuracy': verdictOf(votes[0]),
      'skeptic-scope': verdictOf(votes[1]),
      'skeptic-repro': verdictOf(votes[2]),
    }),
    brain: reactiveBrain((events, call, results) => {
      if (call === 0) {
        return {
          toolCalls: [
            {
              name: 'spawn_worker',
              arguments: { profile: { name: 'claimant' }, task: 'make the claim' },
            },
          ],
        }
      }
      const findings = findingsOf(events)
      if (findings.length < 3) return { content: 'waiting for the skeptics' }
      const holds = findings.filter((f) => f.findings.verdict === 'holds').length
      const tally = { holds, refuted: findings.length - holds }
      if (holds < 2) return submitTurn(results, call, { kept: false, ...tally })
      const claim = observedOutput(results, 'read-claim')
      if (claim === undefined) {
        // Every finding names the worker it analyzed: the claimant.
        const claimant = findings[0]?.fromWorker ?? ''
        return {
          toolCalls: [
            { id: 'read-claim', name: 'observe_agent', arguments: { workerId: claimant } },
          ],
        }
      }
      return submitTurn(results, call, { kept: true, ...tally, claim })
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
    const res = await runGraphWithTestBrain(graph, opts)
    printLedger(`skeptic-majority (${votes.join(', ')})`, res)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
