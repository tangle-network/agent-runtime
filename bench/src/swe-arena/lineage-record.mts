/**
 * Gen-5 lineage DAG wiring (SOTA adoption #3) — the hand-rolled parent fields
 * stop being the only ancestry record: every candidate becomes a
 * `LineageNode` in agent-eval's Lineage DAG (campaign/lineage.ts —
 * multi-parent merges, tracks, deterministic content-hash ids, append-only
 * fsLineageStore), every generation appends, and the library's
 * `heuristicGovernor` reads the graph to decide per-generation continuation
 * (extend the winner / branch on stall / merge frontier tips / prune). The
 * governor's decision is RECORDED in the round summary — the operator (or a
 * future automated outer loop) acts on it; this run never acts on it itself.
 *
 * Store location: `<outDir>/.evolve/lineage.jsonl` (an .evolve-compatible
 * path). The existing staircase rows are UNCHANGED and still written — the
 * observatory depends on them; the DAG is additive.
 *
 * Node semantics:
 *  - the BASELINE incumbent is the root (track 'baseline', proposer
 *    'baseline'),
 *  - configured Pareto parents (prior-run frontier commits) become nodes off
 *    the root under their own tracks, so a merge can name them as parents,
 *  - each evaluated candidate is a node under its proposer-named track:
 *    single-parent (root) for regular authors, MULTI-PARENT (the Pareto
 *    parent nodes) for the merge seat,
 *  - score = combined resolved fraction; scoreVector = per-instance
 *    fail-closed AND-verdicts over the lexicographically sorted instance ids.
 */

import { join } from 'node:path'
import {
  Lineage,
  fsLineageStore,
  heuristicGovernor,
  lineageNodeId,
  type GovernorOp,
  type LineageNode,
} from '@tangle-network/agent-eval/campaign'

export const LINEAGE_STORE_RELPATH = join('.evolve', 'lineage.jsonl')

export interface LineageCandidateInput {
  /** Proposer name — the node's track and proposer. */
  label: string
  /** Loops commit; null (never-committed candidate) is skipped with a note. */
  commit: string | null
  resolvedCount: number
  /** Per-instance AND-verdicts (missing instance = fail-closed false). */
  verdicts: Record<string, boolean>
  merge: boolean
  /** Staircase verdict — recorded as the node's rationale. */
  verdict: string
}

export interface LineageRecordArgs {
  outDir: string
  runId: string
  instances: readonly string[]
  baseline: { commit: string; resolvedCount: number; verdicts: Record<string, boolean> }
  paretoParents: Array<{ label: string; commit: string; resolvedInstances: string[] }>
  candidates: LineageCandidateInput[]
}

export interface LineageRecordResult {
  path: string
  /** Node ids appended by THIS call (idempotent re-runs append zero). */
  appended: string[]
  /** Nodes skipped because the candidate never became a commit. */
  skipped: string[]
  governor: GovernorOp
  nodesTotal: number
}

const scoreVectorOf = (instances: readonly string[], verdicts: Record<string, boolean>): number[] =>
  [...instances].sort().map((iid) => (verdicts[iid] === true ? 1 : 0))

const scoreOf = (resolvedCount: number, instanceCount: number): number =>
  instanceCount > 0 ? resolvedCount / instanceCount : 0

/** Record one generation into the lineage DAG and ask the governor for the
 *  continuation decision. Append-only + idempotent: node ids are content
 *  hashes, so re-recording an identical generation appends nothing. */
export async function recordLineageGeneration(args: LineageRecordArgs): Promise<LineageRecordResult> {
  const path = join(args.outDir, LINEAGE_STORE_RELPATH)
  const store = fsLineageStore(path)
  const lineage = await store.load()
  const appended: string[] = []
  const skipped: string[] = []

  const ensure = async (input: Parameters<Lineage['addNode']>[0]): Promise<LineageNode> => {
    const id = lineageNodeId({
      parentIds: input.parentIds,
      track: input.track,
      surface: input.surface,
      proposer: input.proposer,
    })
    const existed = lineage.all().some((n) => n.id === id)
    const node = lineage.addNode(input)
    if (!existed) {
      await store.append(node)
      appended.push(node.id)
    }
    return node
  }

  const n = args.instances.length
  const root = await ensure({
    parentIds: [],
    track: 'baseline',
    surface: `loops@${args.baseline.commit}`,
    score: scoreOf(args.baseline.resolvedCount, n),
    scoreVector: scoreVectorOf(args.instances, args.baseline.verdicts),
    proposer: 'baseline',
  })

  // Prior-run frontier commits become referenceable parent nodes.
  const parentNodeByLabel = new Map<string, LineageNode>()
  for (const parent of args.paretoParents) {
    const verdicts: Record<string, boolean> = {}
    for (const iid of parent.resolvedInstances) verdicts[iid] = true
    const node = await ensure({
      parentIds: [root.id],
      track: parent.label,
      surface: `loops@${parent.commit}`,
      score: scoreOf(parent.resolvedInstances.length, n),
      scoreVector: scoreVectorOf(args.instances, verdicts),
      proposer: parent.label,
    })
    parentNodeByLabel.set(parent.label, node)
  }

  for (const cand of args.candidates) {
    if (cand.commit === null) {
      skipped.push(cand.label)
      continue
    }
    const parentIds = cand.merge
      ? [...parentNodeByLabel.values()].map((p) => p.id)
      : [root.id]
    if (cand.merge && parentIds.length < 2) {
      throw new Error(
        `lineage: merge candidate ${cand.label} needs >=2 pareto parent nodes, got ${parentIds.length}`,
      )
    }
    await ensure({
      parentIds,
      track: cand.label,
      surface: `loops@${cand.commit}`,
      score: scoreOf(cand.resolvedCount, n),
      scoreVector: scoreVectorOf(args.instances, cand.verdicts),
      proposer: cand.merge ? 'merge' : cand.label,
      rationale: `run ${args.runId}: ${cand.verdict}`,
    })
  }

  // The continuation decision — recorded, not acted on here. budgetRemaining=1:
  // the operator approves one next generation at a time.
  const governor = await heuristicGovernor().decide({
    lineage,
    step: lineage.all().length,
    budgetRemaining: 1,
    prunedTracks: [],
  })

  return { path, appended, skipped, governor, nodesTotal: lineage.all().length }
}
