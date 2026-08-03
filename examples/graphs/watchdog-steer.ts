/**
 * watchdog-steer — the mid-run intervention loop: detect a stuck worker WHILE it runs, correct
 * it BEFORE it settles.
 *
 * The builder node exposes a live tool-trace source. The shipped online detector panel
 * (`watchTrace` + `defaultToolDetectors` — the same streaming stuck-loop/error-streak kernel
 * agent-eval ships) watches that trace and fires the moment the builder starts hammering the
 * same failing command. The driver waits on that signal, composes a corrective instruction FROM
 * it, and steers the still-live builder; the steer is the mid-run leg of the delegates edge and
 * lands in the ledger like every other traversal.
 *
 * Wiring note, stated plainly: `supervise()` accepts `watchWorkers` to run this exact panel and
 * raise bus `finding`s itself, but `RunGraphOptions` does not forward it — so this example wires
 * the SAME shipped panel directly over the worker's trace source at the leaf seam and hands the
 * signal to the driver brain. The corrective steer still flows driver → worker over the
 * delegates edge, authorized and ledgered.
 *
 * Fully offline (reactive brain + leaf seam). Run:  pnpm tsx examples/graphs/watchdog-steer.ts
 */

import type { DetectorSignal } from '@tangle-network/agent-eval'
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type AgentGraph,
  defaultToolDetectors,
  promptHandle,
  type RunGraphOptions,
  runGraph,
  type ToolLoopChat,
  watchTrace,
} from '@tangle-network/agent-runtime/kernel'
import { leafSeam, printLedger } from './shared'

const brief = promptHandle('delegates/worker-brief/v1')

export function watchdogSteer(): { graph: AgentGraph; opts: RunGraphOptions } {
  // ── The topology: plain data ──
  const graph: AgentGraph = {
    nodes: [
      { id: 'driver', profile: { name: 'driver', prompt: { systemPrompt: 'Watch and steer.' } } },
      { id: 'builder', profile: { name: 'builder', prompt: { systemPrompt: 'Build.' } } },
    ],
    edges: [{ kind: 'delegates', from: 'driver', to: 'builder', directive: brief }],
    deliverable: { describe: 'the built artifact', check: (out) => out !== undefined },
    budget: { maxIterations: 20, maxTokens: 50_000 },
  }

  // ── The watchdog: the online detector panel over the builder's LIVE trace ──
  let fireSignal: (signal: DetectorSignal) => void
  const firstSignal = new Promise<DetectorSignal>((resolve) => {
    fireSignal = resolve
  })
  const received: AgentProfile[] = []
  const seam = leafSeam(
    received,
    // The builder blocks until a steer arrives, and its trace replays a stuck loop: the same
    // failing `pnpm test` five times — the storm the repeated-action/error-streak panel catches.
    { builder: { awaitSteer: true, withTrace: true, storm: 5 } },
    {
      onTraceSource: (_nodeId, source) => {
        watchTrace(source, {
          detectors: defaultToolDetectors(),
          onSignal: (signal) => fireSignal(signal),
        })
      },
    },
  )

  // ── The driver: spawn, WAIT for the watchdog, steer with the evidence, settle ──
  let turn = 0
  const brain: ToolLoopChat = async () => {
    turn += 1
    if (turn === 1) {
      return {
        toolCalls: [
          {
            id: 'c1',
            name: 'spawn_agent',
            arguments: JSON.stringify({ profile: { name: 'builder' }, task: 'build the feature' }),
          },
        ],
      }
    }
    if (turn === 2) {
      const signal = await firstSignal
      return {
        toolCalls: [
          {
            id: 'c2',
            name: 'steer_agent',
            arguments: JSON.stringify({
              workerId: 'wd:s0',
              instruction:
                `Watchdog: ${signal.detector} fired (streak ${signal.streak}) — ${signal.reason}. ` +
                'Stop repeating the failing command and deliver what you have.',
            }),
          },
        ],
      }
    }
    if (turn === 3) {
      return { toolCalls: [{ id: 'c3', name: 'await_event', arguments: JSON.stringify({}) }] }
    }
    return { content: 'done', toolCalls: [] }
  }

  const opts: RunGraphOptions = { runId: 'wd', makeWorkerAgent: seam, brain }
  return { graph, opts }
}

export async function main(): Promise<void> {
  const { graph, opts } = watchdogSteer()
  const res = await runGraph(graph, opts)
  printLedger('watchdog-steer', res)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
