/**
 * debate-rounds — P16 (README catalog): several agents answer the same question at once, read each
 * other, and refine over bounded rounds; a judge ends the rounds and writes the one answer.
 *
 * `a` and `b` are both entries, so round 1 runs them in parallel. A join (`from: [a, b]`) starts
 * the `judge` once both settled, with both answers as evidence. The judge's first edge sends both
 * back (a fork, `continuity: 'resume'`, so each continues its own session with the other's answer
 * and the judge's note as evidence) while `/converged` is false and the cap allows; its default
 * edge finishes the run with the synthesis. The deliverable accepts only a judge settle that
 * carries `synthesis`, so a raw round answer can never be the result. No root decides anything.
 *
 * This is what a product agent authors from intent ("let them debate for up to three rounds, then
 * one answer"): `debate-rounds.graph.yaml` beside this file is the stored form, loaded by
 * `loadGraphFile` and run through the same `runGraph`; `main()` runs both and prints both ledgers.
 *
 * Fully offline (leaf seam, no brain). Run:  pnpm tsx examples/graphs/debate-rounds.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type AgentGraph,
  loadGraphFile,
  promptHandle,
  type RunGraphOptions,
  runGraph,
} from '@tangle-network/agent-runtime/kernel'
import { leafSeam, printLedger, workerNode } from './shared'

const brief = promptHandle('delegates/worker-brief/v1')

export const QUESTION = 'Should the launch announcement lead with the capability or with the proof?'

/** What each debater says per round: a position, then a refined one after reading the other. */
const POSITIONS: Record<'a' | 'b', readonly string[]> = {
  a: ['Lead with the capability; proof follows in the body.', 'Lead with the capability, but open with one proof line.'],
  b: ['Lead with the proof; a capability claim without it is noise.', 'Lead with the proof as the first line, then the capability.'],
}

/** The judge's settle from what it was handed: round 1 still disagrees, round 2 converges. */
function judgeRound(task: unknown): { round: number; converged: boolean; note?: string; synthesis?: string } {
  const t = task as { evidence?: { judge?: { round?: number }; a?: { position?: string }; b?: { position?: string } } }
  const round = Number(t.evidence?.judge?.round ?? 0) + 1
  if (round === 1) return { round, converged: false, note: 'You differ on what comes first; each read the other and say what you would concede.' }
  return { round, converged: true, synthesis: `Open with one proof line, then the capability: ${t.evidence?.a?.position} / ${t.evidence?.b?.position}` }
}

export function debateRounds(): { graph: AgentGraph; opts: RunGraphOptions } {
  // ── The topology: plain data, the rounds and their stop included ──
  const graph: AgentGraph = {
    nodes: [
      workerNode('a', 'Answer as yourself; in a later round, read the other answer and the note, then keep, refine or rebut.'),
      workerNode('b', 'Answer as yourself; in a later round, read the other answer and the note, then keep, refine or rebut.'),
      workerNode('judge', 'Read both answers; send them back while they disagree and rounds remain, else write the one answer.'),
    ],
    entry: [
      { node: 'a', task: { question: QUESTION } },
      { node: 'b', task: { question: QUESTION } },
    ],
    edges: [
      { kind: 'routes', from: ['a', 'b'], to: 'judge', directive: brief, evidence: ['a', 'b'] },
      {
        kind: 'routes',
        from: 'judge',
        to: ['a', 'b'],
        directive: brief,
        when: { pointer: '/converged', equals: false },
        evidence: ['a', 'b', 'judge'],
        maxTraversals: 2,
        continuity: 'resume',
      },
      { kind: 'routes', from: 'judge', to: { finish: 'synthesis' }, directive: brief },
    ],
    deliverable: {
      describe: 'one answer the judge wrote after the rounds',
      check: (out) => typeof (out as { judge?: { synthesis?: unknown } } | undefined)?.judge?.synthesis === 'string',
    },
    budget: { maxIterations: 40, maxTokens: 200_000 },
  }
  const received: AgentProfile[] = []
  const opts: RunGraphOptions = {
    runId: 'debate',
    workerSlots: 2,
    makeLeafAgent: leafSeam(received, {
      a: { shots: POSITIONS.a.map((position) => ({ out: { position }, valid: true })) },
      b: { shots: POSITIONS.b.map((position) => ({ out: { position }, valid: true })) },
      judge: { shots: [{ fromTask: judgeRound, valid: true }] },
    }),
  }
  return { graph, opts }
}

export async function main(): Promise<void> {
  const { graph, opts } = debateRounds()
  const literal = await runGraph(graph, opts)
  printLedger('debate-rounds (data literal)', literal)
  // The stored form: the same topology loaded from the file an agent would write.
  const file = new URL('./debate-rounds.graph.yaml', import.meta.url).pathname
  const loaded = await loadGraphFile(file, { params: { question: QUESTION } })
  const stored = await runGraph(loaded.graph, { ...debateRounds().opts, runId: 'debate-stored' })
  printLedger('debate-rounds (stored file)', stored)
  const same = JSON.stringify(literal.out) === JSON.stringify(stored.out)
  console.log(`stored file and data literal deliver the same output: ${same}`)
  if (!same) throw new Error('the stored graph and the literal diverged')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
