/**
 * The six example graph topologies (`examples/graphs/`) run offline end-to-end, and each one's
 * DECISIVE ledger facts hold — the counts, outcomes, and destinations that make the example's
 * claim true, not just "it ran":
 *
 *   1. collaborates-review-loop — the mediated peer-collaboration pattern: the critique analyzes
 *      traversal is DELIVERED TO THE REVIEWER'S WORKER ID (worker→worker only ever via a ledgered
 *      lens route), the verdict traversal reaches the driver, the re-brief is a second delivered
 *      implementer spawn, and the post-settle critique fires `unpropagated` — observable, never
 *      silently dropped.
 *   2. best-of-n — exactly two delivered spawn traversals, one per candidate edge, and the winner
 *      is the candidate whose settle passed the deliverable.
 *   3. watchdog-steer — the online finding arrives over the `watchWorkers` passthrough and the
 *      corrective steer lands as the delegates edge's SECOND delivered traversal on the SAME
 *      live worker, before settle, carrying the detector's evidence.
 *   4. shot-loop — two delivered shots under a 3-traversal cap (no exhaustion), each shot
 *      followed by a delivered verify traversal to the reviewer root; the winner is the shot
 *      whose tests pass.
 *   5. analyst-agent-review — the analyzes analyst is a NODE: the reviewer agent is spawned on
 *      the implementer's settle and its settle output arrives as the driver's finding, one
 *      delivered analyzes traversal from the implementer's worker id.
 *   6. shot-loop-resumed — continuity as data: the delegates edge's `continuity: 'resume'` makes
 *      shot 1 spawn `fresh` and shots 2-3 RESUME the coder's prior settled session (the executor
 *      seam receives `resume: { ofWorker, sequence }`), with every hop's continuity stamped in
 *      the ledger and all three shots' spend in the one conserved pool.
 */

import { runGraphWithTestBrain } from '@tangle-network/agent-runtime/testing'
import { describe, expect, it } from 'vitest'
import { analystAgentReview } from '../../examples/graphs/analyst-agent-review'
import { bestOfN } from '../../examples/graphs/best-of-n'
import { collaboratesReviewLoop } from '../../examples/graphs/collaborates-review-loop'
import { shotLoop } from '../../examples/graphs/shot-loop'
import { shotLoopResumed } from '../../examples/graphs/shot-loop-resumed'
import { watchdogSteer } from '../../examples/graphs/watchdog-steer'

describe('examples/graphs — the six topologies run offline with truthful ledgers', () => {
  it('collaborates-review-loop: every peer hop is mediated, ledgered, and addressed', async () => {
    const { graph, opts } = collaboratesReviewLoop()
    const res = await runGraphWithTestBrain(graph, opts)

    expect(res.result.kind).toBe('winner')
    if (res.result.kind === 'winner') expect(res.result.out).toEqual({ revision: 2 })

    // The re-brief loop: two delivered implementer spawns, one delivered reviewer spawn.
    const delegates = res.ledger.filter((row) => row.kind === 'delegates')
    expect(delegates.map((row) => [row.edge, row.traversal, row.outcome, row.workerId])).toEqual([
      ['delegates:driver->implementer', 1, 'delivered', 'collab:s0'],
      ['delegates:driver->reviewer', 1, 'delivered', 'collab:s1'],
      ['delegates:driver->implementer', 2, 'delivered', 'collab:s2'],
    ])

    // The mediated peer channel: the critique findings were DELIVERED to the reviewer's live
    // worker id — never a direct worker→worker edge, always a ledgered lens route.
    const analyzes = res.ledger.filter((row) => row.kind === 'analyzes')
    expect(analyzes.map((row) => [row.edge, row.traversal, row.outcome, row.workerId])).toEqual([
      ['analyzes:critique:implementer->reviewer', 1, 'delivered', 'collab:s1'],
      ['analyzes:verdict:reviewer->driver', 1, 'delivered', 'collab:s1'],
      ['analyzes:critique:implementer->reviewer', 2, 'unpropagated', 'reviewer'],
    ])
    // The honest tail: the post-re-brief critique had no live reviewer to reach, and the ledger
    // says so instead of dropping it.
    expect(analyzes[2]!.reason).toBe('unknown-worker')
    expect(res.exhaustedEdges).toEqual([])
  })

  it('best-of-n: two delivered spawn traversals, winner decided by the deliverable', async () => {
    const { graph, opts } = bestOfN()
    const res = await runGraphWithTestBrain(graph, opts)

    expect(res.result.kind).toBe('winner')
    if (res.result.kind === 'winner') expect(res.result.out).toEqual({ candidate: 'b', pass: true })

    expect(res.ledger).toHaveLength(2)
    expect(res.ledger.map((row) => [row.edge, row.traversal, row.outcome, row.workerId])).toEqual([
      ['delegates:lead->coder-a', 1, 'delivered', 'bon:s0'],
      ['delegates:lead->coder-b', 1, 'delivered', 'bon:s1'],
    ])
    expect(res.exhaustedEdges).toEqual([])
  })

  it('watchdog-steer: the corrective steer is the mid-run leg of the delegates edge', async () => {
    const { graph, opts } = watchdogSteer()
    const res = await runGraphWithTestBrain(graph, opts)

    expect(res.result.kind).toBe('winner')
    if (res.result.kind === 'winner') {
      expect(res.result.out).toEqual({ built: 'builder', attempt: 1 })
    }

    // Same edge, same live worker: traversal 1 is the spawn, traversal 2 is the steer that
    // landed BEFORE settle (the worker only settles once the steer releases it).
    expect(res.ledger).toHaveLength(2)
    expect(res.ledger.map((row) => [row.edge, row.traversal, row.outcome, row.workerId])).toEqual([
      ['delegates:driver->builder', 1, 'delivered', 'wd:s0'],
      ['delegates:driver->builder', 2, 'delivered', 'wd:s0'],
    ])
    // The steer carried the detector's evidence, not boilerplate.
    expect(res.ledger[1]!.bytes).toBeGreaterThan('Watchdog: '.length)
    expect(res.exhaustedEdges).toEqual([])
  })

  it('shot-loop: two shots under the 3-traversal cap, each with a delivered verify report', async () => {
    const { graph, opts } = shotLoop()
    const res = await runGraphWithTestBrain(graph, opts)

    expect(res.result.kind).toBe('winner')
    if (res.result.kind === 'winner') expect(res.result.out).toEqual({ tests: 'pass' })

    expect(res.ledger.map((row) => [row.edge, row.traversal, row.outcome, row.workerId])).toEqual([
      ['delegates:reviewer->coder', 1, 'delivered', 'shots:s0'],
      ['analyzes:verify:coder->reviewer', 1, 'delivered', 'shots:s0'],
      ['delegates:reviewer->coder', 2, 'delivered', 'shots:s1'],
      ['analyzes:verify:coder->reviewer', 2, 'delivered', 'shots:s1'],
    ])
    // The shot budget lives on the edge: 2 of 3 traversals used, nothing exhausted.
    expect(res.exhaustedEdges).toEqual([])
  })

  it('shot-loop-resumed: shot 1 fresh, shots 2-3 resume the prior settled session, one conserved pool', async () => {
    const { graph, opts, contexts } = shotLoopResumed()
    const res = await runGraphWithTestBrain(graph, opts)

    expect(res.result.kind).toBe('winner')
    if (res.result.kind === 'winner') expect(res.result.out).toEqual({ tests: 'pass' })

    // The ledger states how every hop continued: the effective first spawn is fresh, each later
    // shot re-attaches — and the shot budget (the cap) counts resumes exactly like fresh spawns.
    expect(
      res.ledger.map((row) => [row.edge, row.traversal, row.outcome, row.continuity, row.workerId]),
    ).toEqual([
      ['delegates:reviewer->coder', 1, 'delivered', 'fresh', 'rshots:s0'],
      ['delegates:reviewer->coder', 2, 'delivered', 'resume', 'rshots:s1'],
      ['delegates:reviewer->coder', 3, 'delivered', 'resume', 'rshots:s2'],
    ])
    expect(res.exhaustedEdges).toEqual([])

    // The executor seam received the resume lineage the kernel authored: shot 2 continues shot
    // 1's worker, shot 3 continues shot 2's — a session chain, in plain data.
    expect(contexts.map((c) => [c?.continuity, c?.resume?.ofWorker, c?.resume?.sequence])).toEqual([
      ['fresh', undefined, undefined],
      ['resume', 'rshots:s0', 2],
      ['resume', 'rshots:s1', 3],
    ])

    // Spend continuity: all three shots drew from the graph's ONE conserved Spend (5/5 each).
    if (res.result.kind === 'winner') {
      expect(res.result.spentTotal.tokens.input).toBe(15)
      expect(res.result.spentTotal.tokens.output).toBe(15)
    }
  })

  it('analyst-agent-review: the reviewer NODE runs as the analyst and its output is the finding', async () => {
    const { graph, opts } = analystAgentReview()
    const res = await runGraphWithTestBrain(graph, opts)

    expect(res.result.kind).toBe('winner')
    if (res.result.kind === 'winner') {
      expect(res.result.out).toEqual({ built: 'implementer', attempt: 1 })
    }

    // One delivered spawn traversal (the implementer), one delivered analyzes traversal whose
    // workerId is the SOURCE worker (driver-destined finding rows carry the analyzed worker).
    expect(res.ledger.map((row) => [row.edge, row.outcome, row.workerId])).toEqual([
      ['delegates:driver->implementer', 'delivered', 'rev:s0'],
      ['analyzes:reviewer:implementer->driver', 'delivered', 'rev:s0'],
    ])
    // The finding carried the reviewer AGENT's settle output — real findings bytes, not a ping.
    expect(res.ledger[1]!.bytes).toBeGreaterThan(
      JSON.stringify({ verdict: 'needs-changes', defects: ['no tests'] }).length,
    )
    expect(res.exhaustedEdges).toEqual([])
  })
})
