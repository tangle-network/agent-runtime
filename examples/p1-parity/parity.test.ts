/**
 * The P1 parity harness's own validity proof, fully offline:
 *
 *   1. INPUT EQUIVALENCE (the core property) — the same cell's task text, coder/reviewer
 *      profiles, and shot budget demonstrably reach BOTH arms, asserted on inputs CAPTURED at
 *      each arm's execution seam (multishot transport requests, graph leaf factory),
 *      never on what the harness intended to send.
 *   2. Both arms return well-formed {@link ParityRecord}s whose asymmetries are the REAL ones:
 *      the graph settles at the first passing shot while `runMultishot` burns its whole budget
 *      (no deliverable check), and only the graph arm carries an edge ledger.
 *   3. The non-convergence path stays honest: a script with no passing shot drives the graph
 *      into its delegates cap (`GraphEdgeCapError`), which maps to `converged: false` with the
 *      refusal visible in the ledger — and the multishot arm reports the same verdict.
 */

import { describe, expect, it } from 'vitest'
import {
  buildParityGraph,
  type CellSpec,
  type ParityRecord,
  runGraphArm,
  runMultishotArm,
} from './arms'
import { offlineGraphBackend, offlineMultishotBackend, offlineShotPassed } from './offline'

const parityCell = (shots: number): CellSpec => ({
  task: 'make the failing test suite pass',
  coderProfile: { name: 'coder', prompt: { systemPrompt: 'Make tests pass.' } },
  reviewerProfile: { name: 'reviewer', prompt: { systemPrompt: 'Verify.' } },
  shots,
  budget: { maxIterations: 30, maxTokens: 100_000 },
})

function expectWellFormed(record: ParityRecord): void {
  expect(typeof record.converged).toBe('boolean')
  expect(Number.isInteger(record.shotsUsed)).toBe(true)
  expect(record.shotsUsed).toBeGreaterThanOrEqual(0)
  for (const n of [
    record.spend.tokens.input,
    record.spend.tokens.output,
    record.spend.usd,
    record.wallMs,
    record.steeringDelivered.count,
    record.steeringDelivered.bytes,
  ]) {
    expect(Number.isFinite(n)).toBe(true)
    expect(n).toBeGreaterThanOrEqual(0)
  }
}

describe('p1-parity — the same cell reaches both arms and both report honestly', () => {
  it('input equivalence: task, profiles, and shot budget arrive at both execution seams', async () => {
    const cell = parityCell(2)
    const script = ['fail', 'pass'] as const

    const multishot = offlineMultishotBackend(script)
    const graph = offlineGraphBackend(cell, script)
    const multishotRecord = await runMultishotArm(cell, multishot.backend)
    const graphRecord = await runGraphArm(cell, graph.backend)

    // ── Multishot arm, captured at the transport seam ──
    const firstAgentReq = multishot.capture.agentRequests[0]
    expect(firstAgentReq?.messages[0]).toEqual({
      role: 'system',
      content: cell.coderProfile.prompt?.systemPrompt,
    })
    expect(firstAgentReq?.messages[1]).toEqual({ role: 'user', content: cell.task })
    expect(multishot.capture.driverRequests[0]?.messages[0]).toEqual({
      role: 'system',
      content: cell.reviewerProfile.prompt?.systemPrompt,
    })
    // The shot budget reached `runMultishot`: exactly `shots` coder completions were requested.
    expect(multishot.capture.agentRequests).toHaveLength(cell.shots)

    // ── Graph arm, captured at the leaf factory ──
    const firstSpawn = graph.capture.spawnedProfiles[0]
    expect(firstSpawn?.name).toBe(cell.coderProfile.name)
    expect(firstSpawn?.prompt?.systemPrompt).toBe(cell.coderProfile.prompt?.systemPrompt)
    expect(graph.capture.spawnedTasks[0]).toBe(cell.task)
    // The shot budget reached the graph as the delegates edge's traversal cap, and the graph's
    // nodes ARE the cell's profiles (pinned by name, not copied into role builders).
    const topology = buildParityGraph(cell, offlineShotPassed)
    const delegates = topology.edges.find((edge) => edge.kind === 'delegates')
    expect(delegates?.kind === 'delegates' && delegates.maxTraversals).toBe(cell.shots)
    expect(topology.nodes.map((node) => node.profile)).toEqual([
      cell.reviewerProfile,
      cell.coderProfile,
    ])
    expect(topology.deliverable.describe).toBe(cell.task)

    // Both arms converged on the same scripted cell.
    expect(multishotRecord.converged).toBe(true)
    expect(graphRecord.converged).toBe(true)
  })

  it('both arms return well-formed ParityRecords with the REAL asymmetries visible', async () => {
    // Pass on shot 2 of a 3-shot budget: the early-convergence probe.
    const cell = parityCell(3)
    const script = ['fail', 'pass'] as const

    const multishotRecord = await runMultishotArm(cell, offlineMultishotBackend(script).backend)
    const graphRecord = await runGraphArm(cell, offlineGraphBackend(cell, script).backend)
    expectWellFormed(multishotRecord)
    expectWellFormed(graphRecord)

    expect(multishotRecord.converged).toBe(true)
    expect(graphRecord.converged).toBe(true)

    // The measured difference P1 exists to surface: the graph settles at the passing shot; the
    // `runMultishot` has no deliverable check and burns the full budget.
    expect(graphRecord.shotsUsed).toBe(2)
    expect(multishotRecord.shotsUsed).toBe(3)

    // Steering: corrective deliveries after the initial brief. Graph re-briefed once (shot 2);
    // the multishot driver kept steering after convergence too (turns 2 and 3).
    expect(graphRecord.steeringDelivered.count).toBe(1)
    expect(multishotRecord.steeringDelivered.count).toBe(2)
    expect(graphRecord.steeringDelivered.bytes).toBeGreaterThan(0)
    expect(multishotRecord.steeringDelivered.bytes).toBeGreaterThan(0)

    // Spend flows through each arm's own metering: graph = 2 leaf shots × {5,5} from the
    // conserved pool's journal; multishot = (3 agent + 2 driver) × {5,5} at the transport seam.
    expect(graphRecord.spend).toEqual({ tokens: { input: 10, output: 10 }, usd: 0 })
    expect(multishotRecord.spend).toEqual({ tokens: { input: 25, output: 25 }, usd: 0 })

    // The honest ledger asymmetry: the graph's edge ledger is present and complete (2 delivered
    // shot traversals + 2 delivered verify reports); `runMultishot` HAS no edge ledger and the
    // record must not fake one.
    expect(multishotRecord.ledger).toBeUndefined()
    expect(graphRecord.ledger?.map((row) => [row.edge, row.traversal, row.outcome])).toEqual([
      ['delegates:reviewer->coder', 1, 'delivered'],
      ['analyzes:verify:coder->reviewer', 1, 'delivered'],
      ['delegates:reviewer->coder', 2, 'delivered'],
      ['analyzes:verify:coder->reviewer', 2, 'delivered'],
    ])
  })

  it('non-convergence stays honest: the delegates cap refusal is a false verdict, not a crash', async () => {
    const cell = parityCell(2)
    const script = ['fail'] as const // every shot fails; the last repeats

    const multishotRecord = await runMultishotArm(cell, offlineMultishotBackend(script).backend)
    const graphRecord = await runGraphArm(cell, offlineGraphBackend(cell, script).backend)
    expectWellFormed(multishotRecord)
    expectWellFormed(graphRecord)

    expect(multishotRecord.converged).toBe(false)
    expect(graphRecord.converged).toBe(false)
    expect(multishotRecord.shotsUsed).toBe(2)
    expect(graphRecord.shotsUsed).toBe(2)

    // The graph's evidence: two delivered shots, then the cap REFUSED the third spawn — the
    // refusal is a ledger row, not a swallowed error.
    const last = graphRecord.ledger?.at(-1)
    expect(last?.outcome).toBe('unpropagated')
    expect(last?.reason).toContain('traversal-cap-exhausted')
  })
})
