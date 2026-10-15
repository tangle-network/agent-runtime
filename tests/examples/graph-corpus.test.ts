/**
 * The corpus examples (`examples/graphs/`) run offline end-to-end, and each one's DECISIVE ledger
 * facts hold. The examples come from what 660 Claude Workflow scripts actually do (counts in the
 * README catalog); each test asserts the ledger rows that make its pattern true, through the
 * example's exported factory and the shipped `runGraphWithTestBrain` path. Nothing is mocked
 * below the leaf seam and the driver brain.
 *
 *   static-fanout-synthesize   3 delegates (one per dimension) + 3 analyzes rows into the root;
 *                              result.out is the joined synthesis, and it flips with one dimension
 *   per-item-pipeline          one verify row per finder settle; a publisher spawns BEFORE the
 *                              last verify (no barrier, or the run would deadlock)
 *   role-chain                 scout, builder, reviewer in order, each task carrying the output the
 *                              root read from the stage before; result.out is the reviewed fix
 *   isolated-writers-integrate three writers, then the integrator
 *   discovered-fanout-reduce   4 traversals on ONE edge, then the reducer; peak live readers equals
 *                              workerSlots (2, and 4 in the control)
 *   skeptic-majority           3 analyzes rows per settle; result.out keeps the claim on 2 of 3 and
 *                              carries no claim when the votes drop it
 *   conditional-skip           zero findings: zero traversals on the verify edge
 *   judge-panel                2 judges x 3 attempts = 6 scores; result.out is the top attempt's work
 *   loop-until-dry             stops at two dry rounds, under the cap
 *   hierarchical-nested        the lead's workers have ids nested under the lead's
 *   dependency-waves           ledger order respects the DAG
 *   proof-gate                 no proof, no traversal on the destructive edge
 *   arm-comparison             3 registry records; the cheapest delivery wins and replays
 *   sandbox-e2e                skips cleanly without credentials
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { digestOfGraph, type GraphResult } from '@tangle-network/agent-runtime/kernel'
import { runGraphWithTestBrain } from '@tangle-network/agent-runtime/testing'
import { describe, expect, it } from 'vitest'
import { arms, compareArms } from '../../examples/graphs/arm-comparison'
import { conditionalSkip } from '../../examples/graphs/conditional-skip'
import { DAG, dependencyWaves } from '../../examples/graphs/dependency-waves'
import { discoveredFanoutReduce } from '../../examples/graphs/discovered-fanout-reduce'
import { hierarchicalNested } from '../../examples/graphs/hierarchical-nested'
import { isolatedWritersIntegrate } from '../../examples/graphs/isolated-writers-integrate'
import { ATTEMPT_OUT, judgePanel, type PanelDecision } from '../../examples/graphs/judge-panel'
import { loopUntilDry } from '../../examples/graphs/loop-until-dry'
import { perItemPipeline } from '../../examples/graphs/per-item-pipeline'
import { proofGate } from '../../examples/graphs/proof-gate'
import { roleChain, STAGE_OUT } from '../../examples/graphs/role-chain'
import { sandboxE2e } from '../../examples/graphs/sandbox-e2e'
import { CLAIM, skepticMajority } from '../../examples/graphs/skeptic-majority'
import {
  DIMENSIONS,
  type Recommendation,
  staticFanoutSynthesize,
} from '../../examples/graphs/static-fanout-synthesize'

const delegatesOf = (res: GraphResult) => res.ledger.filter((row) => row.kind === 'delegates')
const analyzesOf = (res: GraphResult) => res.ledger.filter((row) => row.kind === 'analyzes')
const edgesOf = (res: GraphResult, edge: string) => res.ledger.filter((row) => row.edge === edge)
/** What the run delivered: `result.out` of a winner. */
const delivered = (res: GraphResult): unknown => {
  if (res.result.kind !== 'winner') throw new Error(`no winner: ${res.result.reason}`)
  return res.result.out
}

describe('examples/graphs corpus — every pattern runs offline with a truthful ledger', () => {
  it('static-fanout-synthesize: one traversal per dimension, and the root delivers the joined synthesis', async () => {
    const { graph, opts } = staticFanoutSynthesize()
    const res = await runGraphWithTestBrain(graph, opts)

    expect(res.result.kind).toBe('winner')
    expect(delegatesOf(res).map((r) => [r.edge, r.traversal, r.outcome])).toEqual([
      ['delegates:lead->risk', 1, 'delivered'],
      ['delegates:lead->cost', 1, 'delivered'],
      ['delegates:lead->fit', 1, 'delivered'],
    ])
    // The synthesis analyst fires once per settle: three traversals, each delivered to the root,
    // each naming the dimension worker it read.
    const found = analyzesOf(res)
    expect(found.map((r) => [r.edge, r.to, r.outcome])).toEqual(
      [1, 2, 3].map(() => ['analyzes:synthesis:risk+cost+fit->lead', 'lead', 'delivered']),
    )
    expect(found.map((r) => r.traversal)).toEqual([1, 2, 3])
    expect(new Set(found.map((r) => r.workerId))).toEqual(
      new Set(delegatesOf(res).map((r) => r.workerId)),
    )
    expect(res.exhaustedEdges).toEqual([])
    // The result is the synthesis the root joined, one finding per dimension.
    const out = delivered(res) as Recommendation
    expect(out.recommendation).toBe('ship')
    expect(out.basis.map((b) => b.dimension).sort()).toEqual([...DIMENSIONS].sort())
    expect(out.basis.find((b) => b.dimension === 'cost')).toMatchObject({
      level: 'medium',
      supportsShipping: true,
    })

    // The control: one high-risk dimension, read by the synthesis, turns the delivery to hold.
    const risky = staticFanoutSynthesize({ risk: 'high', cost: 'medium', fit: 'low' })
    const held = await runGraphWithTestBrain(risky.graph, risky.opts)
    expect((delivered(held) as Recommendation).recommendation).toBe('hold')
  })

  it('per-item-pipeline: a publisher spawns before the last verification, so there is no barrier', async () => {
    const { graph, opts } = perItemPipeline()
    const res = await runGraphWithTestBrain(graph, opts)

    expect(res.result.kind).toBe('winner')
    expect(edgesOf(res, 'delegates:lead->finder').map((r) => r.outcome)).toEqual(
      Array(3).fill('delivered'),
    )
    const verifies = edgesOf(res, 'analyzes:verifier:finder->lead')
    expect(verifies.map((r) => r.outcome)).toEqual(Array(3).fill('delivered'))
    // Items a and b verified, c did not: two publishers, not three.
    expect(edgesOf(res, 'delegates:lead->publisher')).toHaveLength(2)
    // The third finder cannot settle until a publisher exists, so the first publisher spawn is
    // ledgered before the third verification. A barriered pipeline would never get here.
    const at = (row: unknown) => res.ledger.indexOf(row as (typeof res.ledger)[number])
    const firstPublisher = edgesOf(res, 'delegates:lead->publisher')[0]
    expect(at(firstPublisher)).toBeLessThan(at(verifies[2]))
    expect(at(firstPublisher)).toBeGreaterThan(at(verifies[0]))
    expect(res.exhaustedEdges).toEqual([])
  })

  it('role-chain: scout, builder, reviewer in order, each task carrying the output the root read', async () => {
    const { graph, opts, tasks } = roleChain()
    const res = await runGraphWithTestBrain(graph, opts)

    expect(res.result.kind).toBe('winner')
    const rows = delegatesOf(res)
    expect(rows.map((r) => [r.edge, r.outcome, r.workerId])).toEqual([
      ['delegates:lead->scout', 'delivered', 'chain:s0'],
      ['delegates:lead->builder', 'delivered', 'chain:s1'],
      ['delegates:lead->reviewer', 'delivered', 'chain:s2'],
    ])
    // Each brief carries what the previous worker produced, as observe_agent returned it.
    expect(String(tasks().builder)).toContain(JSON.stringify(STAGE_OUT.scout))
    expect(String(tasks().reviewer)).toContain(JSON.stringify(STAGE_OUT.builder))
    expect(delivered(res)).toEqual({ fix: STAGE_OUT.builder, review: STAGE_OUT.reviewer })
    expect(res.exhaustedEdges).toEqual([])

    // The control: a different scout finding changes the builder's brief, so the brief is read
    // from the worker, not written into the script.
    const other = { ...STAGE_OUT, scout: { file: 'src/lex.ts', defect: 'drops a byte-order mark' } }
    const alt = roleChain(other)
    await runGraphWithTestBrain(alt.graph, alt.opts)
    expect(String(alt.tasks().builder)).toContain(JSON.stringify(other.scout))
    expect(String(alt.tasks().builder)).not.toContain(JSON.stringify(STAGE_OUT.scout))
  })

  it('isolated-writers-integrate: three writer traversals, then the integrator', async () => {
    const { graph, opts } = isolatedWritersIntegrate()
    const res = await runGraphWithTestBrain(graph, opts)

    expect(res.result.kind).toBe('winner')
    if (res.result.kind === 'winner') expect(res.result.out).toEqual({ merged: 3 })
    expect(delegatesOf(res).map((r) => [r.edge, r.outcome, r.workerId])).toEqual([
      ['delegates:lead->writer-auth', 'delivered', 'iso:s0'],
      ['delegates:lead->writer-api', 'delivered', 'iso:s1'],
      ['delegates:lead->writer-ui', 'delivered', 'iso:s2'],
      ['delegates:lead->integrator', 'delivered', 'iso:s3'],
    ])
    expect(analyzesOf(res)).toEqual([])
  })

  it('discovered-fanout-reduce: N traversals on one edge, workerSlots live at a time, then the reducer', async () => {
    const { graph, opts, peakLive } = discoveredFanoutReduce(2)
    const res = await runGraphWithTestBrain(graph, opts)

    expect(res.result.kind).toBe('winner')
    if (res.result.kind === 'winner') expect(res.result.out).toEqual({ items: 4 })
    expect(edgesOf(res, 'delegates:lead->reader').map((r) => [r.traversal, r.outcome])).toEqual([
      [1, 'delivered'],
      [2, 'delivered'],
      [3, 'delivered'],
      [4, 'delivered'],
    ])
    expect(edgesOf(res, 'delegates:lead->reducer')).toHaveLength(1)
    // The reducer is the last row: it waited for every reader.
    expect(res.ledger.at(-1)?.edge).toBe('delegates:lead->reducer')
    // Concurrency is the run's workerSlots (2), reached and never exceeded.
    expect(peakLive()).toBe(2)
    expect(res.exhaustedEdges).toEqual([])

    // The control: the same run with workerSlots 4 has all four readers live together, so the
    // measurement sees the slot limit rather than a ceiling of its own.
    const wide = discoveredFanoutReduce(4)
    const wideRes = await runGraphWithTestBrain(wide.graph, wide.opts)
    expect(edgesOf(wideRes, 'delegates:lead->reader')).toHaveLength(4)
    expect(wide.peakLive()).toBe(4)
  })

  it('skeptic-majority: three findings per settle, and the delivered decision follows the votes', async () => {
    const kept = skepticMajority(['holds', 'holds', 'refuted'])
    const res = await runGraphWithTestBrain(kept.graph, kept.opts)
    expect(res.result.kind).toBe('winner')
    expect(edgesOf(res, 'delegates:lead->claimant')).toHaveLength(1)
    expect(
      analyzesOf(res)
        .map((r) => [r.edge, r.to, r.outcome])
        .sort(),
    ).toEqual([
      ['analyzes:skeptic-accuracy:claimant->lead', 'lead', 'delivered'],
      ['analyzes:skeptic-repro:claimant->lead', 'lead', 'delivered'],
      ['analyzes:skeptic-scope:claimant->lead', 'lead', 'delivered'],
    ])
    expect(delivered(res)).toEqual({ kept: true, holds: 2, refuted: 1, claim: CLAIM })
    // The panel is diverse by construction: three skeptics, three model families.
    const families = kept.graph.nodes
      .filter((n) => n.id.startsWith('skeptic-'))
      .map((n) => n.profile.model?.provider)
    expect(new Set(families).size).toBe(3)

    // The negative control: the same graph with two refutations drops the claim, and the run
    // returns the votes without it.
    const dropped = skepticMajority(['refuted', 'holds', 'refuted'])
    const droppedRes = await runGraphWithTestBrain(dropped.graph, dropped.opts)
    expect(delivered(droppedRes)).toEqual({ kept: false, holds: 1, refuted: 2 })
    expect(JSON.stringify(delivered(droppedRes))).not.toContain(CLAIM.claim)
  })

  it('conditional-skip: with zero findings the verify edge has zero traversals, by design', async () => {
    const found = conditionalSkip(['null deref', 'stale cache'])
    const some = await runGraphWithTestBrain(found.graph, found.opts)
    expect(some.result.kind).toBe('winner')
    expect(delegatesOf(some).map((r) => [r.edge, r.outcome])).toEqual([
      ['delegates:lead->finder', 'delivered'],
      ['delegates:lead->verifier', 'delivered'],
    ])

    const none = conditionalSkip([])
    const skipped = await runGraphWithTestBrain(none.graph, none.opts)
    expect(skipped.result.kind).toBe('winner')
    expect(delegatesOf(skipped).map((r) => r.edge)).toEqual(['delegates:lead->finder'])
    expect(edgesOf(skipped, 'delegates:lead->verifier')).toEqual([])
    expect(skipped.exhaustedEdges).toEqual([])
  })

  it('judge-panel: two judges score all three attempts, and the run delivers the top total', async () => {
    const { graph, opts } = judgePanel()
    const res = await runGraphWithTestBrain(graph, opts)

    expect(res.result.kind).toBe('winner')
    const scores = analyzesOf(res)
    expect(scores).toHaveLength(6)
    expect(scores.every((r) => r.to === 'lead' && r.outcome === 'delivered')).toBe(true)
    expect(scores.filter((r) => r.edge.startsWith('analyzes:judge-rigor:'))).toHaveLength(3)
    expect(scores.filter((r) => r.edge.startsWith('analyzes:judge-clarity:'))).toHaveLength(3)

    // result.out is attempt-b's own work (not attempt-a, the default finalizer's tie pick).
    const out = delivered(res) as PanelDecision
    expect(out.winner).toEqual(ATTEMPT_OUT['attempt-b'])
    const attemptB = delegatesOf(res).find((r) => r.to === 'attempt-b')?.workerId as string
    expect(out.totals[attemptB]).toBeCloseTo(1.7)
    expect(Math.max(...Object.values(out.totals))).toBeCloseTo(1.7)
  })

  it('loop-until-dry: stops at two dry rounds, with the cap unused', async () => {
    const { graph, opts } = loopUntilDry()
    const res = await runGraphWithTestBrain(graph, opts)

    expect(res.result.kind).toBe('winner')
    const sweeps = edgesOf(res, 'delegates:lead->finder')
    // Sweeps 1 and 2 found things, 3 and 4 were dry: four sweeps, the first fresh, the rest resumed.
    expect(sweeps.map((r) => [r.traversal, r.outcome, r.continuity])).toEqual([
      [1, 'delivered', 'fresh'],
      [2, 'delivered', 'resume'],
      [3, 'delivered', 'resume'],
      [4, 'delivered', 'resume'],
    ])
    expect(edgesOf(res, 'analyzes:critic:finder->lead')).toHaveLength(4)
    expect(sweeps.length).toBeLessThan(6)
    expect(res.exhaustedEdges).toEqual([])
  })

  it("hierarchical-nested: the lead's workers run under the lead, the integrator under the planner", async () => {
    const { graph, opts } = hierarchicalNested()
    const res = await runGraphWithTestBrain(graph, opts)

    expect(res.result.kind).toBe('winner')
    expect(delegatesOf(res).map((r) => [r.edge, r.outcome, r.workerId])).toEqual([
      ['delegates:planner->lead', 'delivered', 'h:s0'],
      ['delegates:planner->impl-a', 'delivered', 'h:s0:s0'],
      ['delegates:planner->impl-b', 'delivered', 'h:s0:s1'],
      ['delegates:planner->integrator', 'delivered', 'h:s1'],
    ])
    expect(res.exhaustedEdges).toEqual([])
  })

  it('dependency-waves: every node is ledgered after the nodes it needs', async () => {
    const { graph, opts } = dependencyWaves()
    const res = await runGraphWithTestBrain(graph, opts)

    expect(res.result.kind).toBe('winner')
    const order = delegatesOf(res).map((r) => r.to)
    expect([...order].sort()).toEqual(Object.keys(DAG).sort())
    for (const [node, needs] of Object.entries(DAG)) {
      for (const need of needs) {
        expect(order.indexOf(node), `${node} must follow ${need}`).toBeGreaterThan(
          order.indexOf(need),
        )
      }
    }
    expect(order[0]).toBe('schema')
    expect(order.at(-1)).toBe('e2e')
    expect(res.exhaustedEdges).toEqual([])
  })

  it('proof-gate: a proven backup releases the purge, an empty one leaves its edge at zero', async () => {
    const proven = proofGate(4096)
    const withProof = await runGraphWithTestBrain(proven.graph, proven.opts)
    expect(withProof.result.kind).toBe('winner')
    expect(delegatesOf(withProof).map((r) => r.edge)).toEqual([
      'delegates:lead->backup',
      'delegates:lead->purge',
    ])
    expect(analyzesOf(withProof).map((r) => [r.edge, r.outcome])).toEqual([
      ['analyzes:proof:backup->lead', 'delivered'],
    ])

    const empty = proofGate(0)
    const noProof = await runGraphWithTestBrain(empty.graph, empty.opts)
    expect(noProof.result.kind).toBe('winner')
    expect(delegatesOf(noProof).map((r) => r.edge)).toEqual(['delegates:lead->backup'])
    expect(edgesOf(noProof, 'delegates:lead->purge')).toEqual([])
    expect(analyzesOf(noProof)).toHaveLength(1)
  })

  it('arm-comparison: three recorded runs, the cheapest delivery wins and is what lookup replays', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arm-comparison-test-'))
    const out = await compareArms(dir)

    expect(out.records).toHaveLength(3)
    const byArm = Object.fromEntries(
      out.arms.map((arm) => [
        arm.name,
        out.records.find((r) => r.graphDigest === digestOfGraph(arm.graph)),
      ]),
    )
    expect(byArm.solo?.outcome.kind).toBe('no-winner')
    expect(byArm.reviewed?.outcome.kind).toBe('delivered')
    expect(byArm['best-of-3']?.outcome.kind).toBe('delivered')
    expect(byArm.reviewed?.cost.tokens).toBeLessThan(byArm['best-of-3']?.cost.tokens as number)

    expect(out.winnerArm).toBe('reviewed')
    expect(out.winner?.graphDigest).toBe(digestOfGraph(arms()[1]!.graph))
    // The registry now answers the task shape with that graph.
    expect(out.replay.kind).toBe('replay')
    if (out.replay.kind === 'replay') expect(out.replay.graph.digest).toBe(out.winner?.graphDigest)
  })

  it('sandbox-e2e: skips cleanly, naming what is missing, when there are no credentials', async () => {
    const out = await sandboxE2e({})
    expect(out).toEqual({
      status: 'skipped',
      missing: [
        'TANGLE_API_KEY',
        'SANDBOX_BASE_URL',
        'ROOT_MODEL',
        'WORKER_MODEL',
        'SKEPTIC_A_MODEL',
        'SKEPTIC_B_MODEL',
      ],
    })
  })
})
