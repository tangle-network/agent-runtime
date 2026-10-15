/**
 * skeptic-majority — P06 + P07: lens-diverse adversarial verification, kept on a 2-of-3 vote.
 *
 * Verification is the most common second stage in the corpus (a single skeptic in 297 scripts,
 * lens-diverse skeptics in 127, majority-of-N in 19). The `claimant` worker states a claim; three
 * skeptic analyst NODES attack it, each on a different model family and with a different lens
 * (accuracy, scope, reproducibility). Every skeptic fires on the claimant's settle, so the ledger
 * carries three `analyzes` rows per settle, and the root keeps the claim only if at least two of
 * the three could not refute it. The decision is printed from the findings the root actually
 * received.
 *
 * Fully offline (reactive brain + leaf seam). Run:  pnpm tsx examples/graphs/skeptic-majority.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { type AgentGraph, promptHandle } from '@tangle-network/agent-runtime/kernel'
import { type RunGraphTestOptions, runGraphWithTestBrain } from '../../src/testing'
import { driverNode, findingsOf, leafSeam, printLedger, reactiveBrain, workerNode } from './shared'

const brief = promptHandle('delegates/worker-brief/v1')
const report = promptHandle('analyzes/findings-report/v1')

type Vote = 'holds' | 'refuted'

export interface SkepticDecision {
  readonly kept: boolean
  readonly holds: number
  readonly refuted: number
}

export function skepticMajority(
  votes: readonly [Vote, Vote, Vote] = ['holds', 'holds', 'refuted'],
): {
  graph: AgentGraph
  opts: RunGraphTestOptions
  /** The root's decision, once it has all three findings. */
  decision: () => SkepticDecision | undefined
} {
  // ── The topology: plain data — three skeptics, three model families, three lenses ──
  const graph: AgentGraph = {
    nodes: [
      driverNode('lead', 'Keep the claim only if two of three skeptics fail to refute it.'),
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
    deliverable: { describe: 'a claim that survived review', check: (out) => out !== undefined },
    budget: { maxIterations: 40, maxTokens: 100_000 },
  }

  let decided: SkepticDecision | undefined
  const verdictOf = (vote: Vote) => ({ shots: [{ out: { verdict: vote }, valid: true }] })
  const received: AgentProfile[] = []
  const opts: RunGraphTestOptions = {
    runId: 'skep',
    wake: { debounceMs: 0 },
    makeLeafAgent: leafSeam(received, {
      claimant: { withTrace: true },
      'skeptic-accuracy': verdictOf(votes[0]),
      'skeptic-scope': verdictOf(votes[1]),
      'skeptic-repro': verdictOf(votes[2]),
    }),
    brain: reactiveBrain((events, call) => {
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
      decided = { kept: holds >= 2, holds, refuted: findings.length - holds }
      return { content: decided.kept ? 'done: claim kept' : 'done: claim dropped' }
    }),
  }
  return { graph, opts, decision: () => decided }
}

export async function main(): Promise<void> {
  const { graph, opts, decision } = skepticMajority()
  const res = await runGraphWithTestBrain(graph, opts)
  printLedger('skeptic-majority', res)
  const d = decision()
  console.log(
    `decision: ${d?.kept ? 'KEEP' : 'DROP'} the claim (${d?.holds} hold, ${d?.refuted} refuted)`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
