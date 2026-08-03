/**
 * shot-loop — the VB-shaped two-node resumed shot loop, as data.
 *
 * A 'reviewer' root drives one 'coder' worker. Each spawn of the coder is one SHOT; the
 * delegates edge's `maxTraversals: 3` is the shot budget, enforced by the edge itself (the
 * cyclic-graph backstop). After every shot the 'verify' lens reads the coder's settle trace and
 * reports to the reviewer, whose next spawn folds that report into the next brief. The
 * deliverable gates on the verdict — the run only settles a winner once a shot's tests pass.
 *
 * This is the graph form of the multishot/AgentDriver loop it subsumes: what a bespoke
 * reviewer↔coder driver loop hardcodes (shot cap, verify step, re-brief) is here two edges and
 * a cap in plain data, with every shot and every verify report in the edge ledger.
 *
 * Fully offline (scripted brain + leaf seam). Run:  pnpm tsx examples/graphs/shot-loop.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type AgentGraph,
  type AnalystRegistry,
  promptHandle,
  type RunGraphOptions,
  runGraph,
} from '@tangle-network/agent-runtime/kernel'
import { leafSeam, printLedger, scriptedBrain } from './shared'

const brief = promptHandle('delegates/worker-brief/v1')
const report = promptHandle('analyzes/findings-report/v1')

/** The verify lens is ENVIRONMENT: it reads the coder's trace, never sits in the graph. */
const analysts: AnalystRegistry = {
  kinds: [{ id: 'verify', description: 'read the coder trace, report test outcome', area: 'qa' }],
  run: async () => [{ check: 'test-suite', observed: 'see the settled output' }],
}

export function shotLoop(): { graph: AgentGraph; opts: RunGraphOptions } {
  // ── The topology: plain data ──
  const graph: AgentGraph = {
    nodes: [
      { id: 'reviewer', profile: { name: 'reviewer', prompt: { systemPrompt: 'Verify.' } } },
      { id: 'coder', profile: { name: 'coder', prompt: { systemPrompt: 'Make tests pass.' } } },
    ],
    edges: [
      { kind: 'delegates', from: 'reviewer', to: 'coder', directive: brief, maxTraversals: 3 },
      { kind: 'analyzes', analyst: 'verify', over: ['coder'], to: 'reviewer', directive: report },
    ],
    deliverable: {
      describe: 'coder output whose tests pass',
      check: (out) => (out as { tests?: string } | undefined)?.tests === 'pass',
    },
    budget: { maxIterations: 30, maxTokens: 100_000 },
  }

  const received: AgentProfile[] = []
  const opts: RunGraphOptions = {
    runId: 'shots',
    analysts,
    makeWorkerAgent: leafSeam(received, {
      // Shot 1 fails its tests; shot 2 (re-briefed from the verify report) passes.
      coder: {
        withTrace: true,
        shots: [
          { out: { tests: 'fail' }, valid: false },
          { out: { tests: 'pass' }, valid: true },
        ],
      },
    }),
    brain: scriptedBrain([
      {
        toolCalls: [
          {
            name: 'spawn_agent',
            arguments: { profile: { name: 'coder' }, task: 'shot 1: make the tests pass' },
          },
        ],
      },
      // Shot 1 settles, then its verify report lands: two bus events.
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      {
        toolCalls: [
          {
            name: 'spawn_agent',
            arguments: {
              profile: { name: 'coder' },
              task: 'shot 2: fix the failing suite the verifier reported',
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
  const { graph, opts } = shotLoop()
  const res = await runGraph(graph, opts)
  printLedger('shot-loop', res)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
