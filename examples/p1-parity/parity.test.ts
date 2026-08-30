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
 *   4. Validity channels ride every row: `infraShots` / `tokensKnown` / `usdKnown` / `usdSource`
 *      are all-clear on completed offline runs, and a scripted 500 in EITHER arm produces a row
 *      that is visibly an infra casualty (nonzero `infraShots`, unknown-marked spend) — never an
 *      ordinary non-convergence, never a crash of the cell run.
 *   5. Coder sampling parity: the one shared pin ({@link PARITY_CODER_SAMPLING}) is what the
 *      arms' coder completions actually carry, asserted at the captured wire requests.
 */

import { chatWorkerSeam } from '@tangle-network/agent-runtime/kernel'
import { describe, expect, it } from 'vitest'
import {
  buildParityGraph,
  type CellSpec,
  type GraphArmBackend,
  type MultishotArmBackend,
  PARITY_CODER_SAMPLING,
  type ParityRecord,
  runGraphArm,
  runMultishotArm,
} from './arms'
import {
  meteredScriptedBrain,
  offlineGraphBackend,
  offlineMultishotBackend,
  offlineShotPassed,
} from './offline'

const parityCell = (shots: number): CellSpec => ({
  task: 'make the failing test suite pass',
  // The coder model is mandatory and pinned (the arms refuse a silent fallback); the reviewer
  // profile stays model-less — the driver model is each arm's substrate config.
  coderProfile: {
    name: 'coder',
    harness: 'cli-base',
    model: {
      provider: 'scripted',
      default: 'scripted/parity-coder',
      metadata: { temperature: 0.7 },
      maxVisibleOutputTokens: 2500,
    },
    prompt: { systemPrompt: 'Make tests pass.' },
  },
  reviewerProfile: {
    name: 'reviewer',
    harness: 'cli-base',
    model: {
      provider: 'scripted',
      default: 'scripted/parity-reviewer',
      metadata: { temperature: 0.9 },
      maxVisibleOutputTokens: 600,
    },
    prompt: { systemPrompt: 'Verify.' },
  },
  shots,
  budget: { maxIterations: 30, maxTokens: 100_000 },
})

function expectWellFormed(record: ParityRecord): void {
  expect(typeof record.converged).toBe('boolean')
  expect(Number.isInteger(record.shotsUsed)).toBe(true)
  expect(record.shotsUsed).toBeGreaterThanOrEqual(0)
  expect(Number.isInteger(record.infraShots)).toBe(true)
  expect(record.infraShots).toBeGreaterThanOrEqual(0)
  expect(typeof record.tokensKnown).toBe('boolean')
  expect(typeof record.usdKnown).toBe('boolean')
  expect(['measured', 'estimated', 'unknown']).toContain(record.usdSource)
  // The dollar twin invariant: usdKnown ⟺ every counted completion carried a cost field.
  expect(record.usdKnown).toBe(record.usdSource === 'measured')
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

/** The all-clear validity channel a COMPLETED offline run must report: nothing died to infra,
 *  every completion carried usage + cost, and no estimator fired. */
function expectAllClearValidity(record: ParityRecord): void {
  expect(record.infraShots).toBe(0)
  expect(record.tokensKnown).toBe(true)
  expect(record.usdKnown).toBe(true)
  expect(record.usdSource).toBe('measured')
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
    // Coder sampling parity (F1): every agent-leg completion carries the ONE shared pin —
    // `runMultishot`'s hardcoded agent temperature asserted against the constant (drift in
    // either fails here, not silently in live rows) and the explicitly pinned turn-initial
    // max_tokens ceiling.
    for (const req of multishot.capture.agentRequests) {
      expect(req.temperature).toBe(PARITY_CODER_SAMPLING.temperature)
      expect(req.maxTokens).toBe(PARITY_CODER_SAMPLING.maxTokens)
    }

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

    // Completed offline runs are all-clear on the validity channel: zero infra deaths, every
    // completion metered (usage + cost), no estimator fired in either arm.
    expectAllClearValidity(multishotRecord)
    expectAllClearValidity(graphRecord)

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

    // Spend flows through each arm's own metering, driver leg included: graph = 2 leaf shots ×
    // {5,5} + 7 metered driver-brain turns × {5,5} (2 spawns + 4 awaits + the final stop),
    // reconciled from the conserved pool's journal; multishot = (3 agent + 2 driver) × {5,5} at
    // the transport seam.
    expect(graphRecord.spend).toEqual({ tokens: { input: 45, output: 45 }, usd: 0 })
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

    // ORDINARY non-convergence: the task failed, the infrastructure did not — the infra channel
    // is zero and every completion stayed fully metered (the scripted-500 rows below differ on
    // exactly these fields).
    expectAllClearValidity(multishotRecord)
    expectAllClearValidity(graphRecord)

    // The graph's evidence: two delivered shots, then the cap REFUSED the third spawn — the
    // refusal is a ledger row, not a swallowed error.
    const last = graphRecord.ledger?.at(-1)
    expect(last?.outcome).toBe('unpropagated')
    expect(last?.reason).toContain('traversal-cap-exhausted')
  })

  it('multishot arm: a scripted-500 transport death is an infra row with the measured partials, never a crash', async () => {
    const cell = parityCell(3)
    const scripted = offlineMultishotBackend(['fail'])
    let agentCalls = 0
    const backend: MultishotArmBackend = {
      ...scripted.backend,
      // Shot 1 completes (fails the check); the driver re-briefs; shot 2 dies on the wire.
      agentTransport: async (req) => {
        agentCalls += 1
        if (agentCalls === 2) throw new Error('upstream 500: bad gateway')
        return scripted.backend.agentTransport(req)
      },
    }
    const record = await runMultishotArm(cell, backend)
    expectWellFormed(record)
    expect(record.converged).toBe(false)
    // Visibly an infra casualty, not an ordinary non-convergence: the infra channel is nonzero
    // (`runMultishot` has no infra channel of its own and died on the throw — the arm's seam
    // caught it and settled this row instead of crashing the cell run).
    expect(record.infraShots).toBe(1)
    expect(record.shotsUsed).toBe(1)
    expect(record.steeringDelivered.count).toBe(1)
    // The completed turns' spend stayed measured (shot 1 + one driver re-brief, {5,5} each)…
    expect(record.spend.tokens).toEqual({ input: 10, output: 10 })
    expect(record.spend.usd).toBe(0)
    // …but the dead turn's spend is UNREPORTED, not zero: both channels marked unknown, and no
    // price-table estimate substituted (the loop died before its estimator could run).
    expect(record.tokensKnown).toBe(false)
    expect(record.usdKnown).toBe(false)
    expect(record.usdSource).toBe('unknown')
    expect(record.ledger).toBeUndefined()
  })

  it('graph arm: an infra-dead coder shot is counted from the down-INFRA settle, with unknown-marked spend', async () => {
    const cell = parityCell(1)
    // The REAL chat executor on a scripted transport that 500s on its one turn: the worker
    // settles down-INFRA (the executor's wrapped ValidationError is the scope's infra class),
    // the delegates cap refuses a retry spawn, and the arm still returns an honest row.
    const chatRequests: Array<Record<string, unknown>> = []
    const backend: GraphArmBackend = {
      kind: 'seam',
      makeLeafAgent: chatWorkerSeam({
        url: 'http://offline.invalid',
        deliverable: {
          describe: cell.task,
          check: (out) => typeof out === 'string' && offlineShotPassed(out),
        },
        complete: async (body) => {
          chatRequests.push(structuredClone(body))
          throw new Error('upstream 500: bad gateway')
        },
      }),
      // Metered like the backend's own brain, so the unknown-marked spend asserted below is
      // attributable to the INFRA DEATH alone, never to an unmetered driver turn.
      brain: meteredScriptedBrain([
        {
          toolCalls: [
            { name: 'spawn_worker', arguments: { profile: { name: 'coder' }, task: cell.task } },
          ],
        },
        // ONE event: the down settle. (No verify report — analysts fire on `done` settles only.)
        { toolCalls: [{ name: 'await_event', arguments: {} }] },
        // The retry spawn drives INTO the exhausted delegates cap — refused, ledgered.
        {
          toolCalls: [
            { name: 'spawn_worker', arguments: { profile: { name: 'coder' }, task: 'retry' } },
          ],
        },
        { content: 'done' },
      ]),
      shotPassed: offlineShotPassed,
    }
    const record = await runGraphArm(cell, backend)
    expectWellFormed(record)
    expect(record.converged).toBe(false)
    // Visibly an infra casualty: the dead worker's settle carried the kernel's infra flag and
    // the arm counted it against the delegates-bound shot.
    expect(record.infraShots).toBe(1)
    expect(record.shotsUsed).toBe(1)
    expect(record.steeringDelivered.count).toBe(0)
    // The kernel marks an infra-thrown executor's spend unreported — never zero, never estimated.
    expect(record.tokensKnown).toBe(false)
    expect(record.usdKnown).toBe(false)
    expect(record.usdSource).toBe('unknown')
    // The graph half of the F1 pin reached the wire before the 500.
    expect(chatRequests).toHaveLength(1)
    expect(chatRequests[0]?.temperature).toBe(PARITY_CODER_SAMPLING.temperature)
    expect(chatRequests[0]?.max_tokens).toBe(PARITY_CODER_SAMPLING.maxTokens)
    // The evidence trail: the delivered spawn bound to the dead worker, then the cap refusal.
    const delegates = record.ledger?.filter((row) => row.kind === 'delegates')
    expect(delegates?.map((row) => [row.traversal, row.outcome])).toEqual([
      [1, 'delivered'],
      [2, 'unpropagated'],
    ])
    expect(delegates?.at(-1)?.reason).toContain('traversal-cap-exhausted')
  })
})
