/**
 * collaborates-review-loop — the PEER-COLLABORATION pattern expressible today.
 *
 * Two worker nodes under one root: an 'implementer' and a 'reviewer'. An analyzes edge (the
 * 'critique' lens over the implementer's settle trace) routes findings to the REVIEWER as an
 * authorized, ledgered steer; a second analyzes edge ('verdict' over the reviewer) routes the
 * review verdict back to the DRIVER, which re-briefs the implementer with a second spawn.
 *
 * Say it plainly: a DIRECT worker-to-worker channel is not a first-class edge. Workers never
 * address each other; what exists today is this MEDIATED form — findings travel worker → analyst
 * lens → routed steer / driver re-brief — and every hop lands in the edge ledger, so nothing
 * crosses between agents unobserved.
 *
 * The ledger this prints also shows the honest tail: when the re-briefed implementer settles,
 * the critique lens fires again, but the reviewer has already settled — that traversal is
 * ledgered `unpropagated` (unknown-worker), not silently dropped.
 *
 * Fully offline (scripted brain + leaf seam). Run:  pnpm tsx examples/graphs/collaborates-review-loop.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type AgentGraph,
  type AnalystRegistry,
  promptHandle,
} from '@tangle-network/agent-runtime/kernel'
import { type RunGraphTestOptions, runGraphWithTestBrain } from '../../src/testing'
import { leafSeam, offlineProfile, printLedger, scriptedBrain } from './shared'

const brief = promptHandle('delegates/worker-brief/v1')
const report = promptHandle('analyzes/findings-report/v1')

/** The two lenses are ENVIRONMENT (registry entries), never nodes in the graph. */
const analysts: AnalystRegistry = {
  kinds: [
    { id: 'critique', description: 'read the implementer trace, list defects', area: 'review' },
    { id: 'verdict', description: 'read the reviewer trace, extract the verdict', area: 'review' },
  ],
  run: async (kindId) => ({
    summary:
      kindId === 'critique'
        ? 'MAJOR: the implementation lacks tests.'
        : 'Needs changes: add the missing tests.',
  }),
}

export function collaboratesReviewLoop(): { graph: AgentGraph; opts: RunGraphTestOptions } {
  // ── The topology: plain data ──
  const graph: AgentGraph = {
    nodes: [
      {
        id: 'driver',
        profile: {
          ...offlineProfile('driver', 'Drive the loop.'),
          tools: {
            agent_runtime_coordination_spawn_worker: true,
            agent_runtime_coordination_await_event: true,
          },
        },
      },
      { id: 'implementer', profile: offlineProfile('implementer', 'Build.') },
      { id: 'reviewer', profile: offlineProfile('reviewer', 'Review.') },
    ],
    edges: [
      { kind: 'delegates', from: 'driver', to: 'implementer', directive: brief },
      { kind: 'delegates', from: 'driver', to: 'reviewer', directive: brief },
      {
        kind: 'analyzes',
        analyst: 'critique',
        over: ['implementer'],
        to: 'reviewer',
        directive: report,
      },
      { kind: 'analyzes', analyst: 'verdict', over: ['reviewer'], to: 'driver', directive: report },
    ],
    deliverable: { describe: 'the re-briefed implementation', check: (out) => out !== undefined },
    budget: { maxIterations: 40, maxTokens: 100_000 },
  }

  const received: AgentProfile[] = []
  const opts: RunGraphTestOptions = {
    runId: 'collab',
    analysts,
    makeLeafAgent: leafSeam(received, {
      // Shot 1 is the draft; shot 2 (after the driver's re-brief) is the revision that wins.
      implementer: {
        withTrace: true,
        shots: [
          { out: { revision: 1 }, valid: true, score: 0.5 },
          { out: { revision: 2 }, valid: true, score: 1 },
        ],
      },
      // The reviewer stays LIVE until the routed critique steer arrives (that steer is what
      // releases it), and exposes its own trace so the verdict lens can read it.
      reviewer: {
        awaitSteer: true,
        withTrace: true,
        shots: [{ out: { review: 'needs-changes' }, valid: true, score: 0.6 }],
      },
    }),
    brain: scriptedBrain([
      {
        toolCalls: [
          {
            name: 'spawn_worker',
            arguments: { profile: { name: 'implementer' }, task: 'implement the feature' },
          },
        ],
      },
      {
        toolCalls: [
          {
            name: 'spawn_worker',
            arguments: { profile: { name: 'reviewer' }, task: 'review the implementation' },
          },
        ],
      },
      // implementer settles → critique steers the live reviewer → reviewer settles → verdict
      // finding reaches the driver. Four bus events: settled, finding, settled, finding.
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      // The re-brief: the driver folds the verdict into a second implementer spawn.
      {
        toolCalls: [
          {
            name: 'spawn_worker',
            arguments: {
              profile: { name: 'implementer' },
              task: 'address the review verdict: add the missing tests',
            },
          },
        ],
      },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { content: 'done' },
    ]),
  }
  return { graph, opts }
}

export async function main(): Promise<void> {
  const { graph, opts } = collaboratesReviewLoop()
  const res = await runGraphWithTestBrain(graph, opts)
  printLedger('collaborates-review-loop', res)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
