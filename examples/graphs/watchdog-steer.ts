/**
 * watchdog-steer — the mid-run intervention loop: detect a stuck worker WHILE it runs, correct
 * it BEFORE it settles.
 *
 * The builder node exposes a live tool-trace source. `RunGraphOptions.watchWorkers` forwards to
 * `supervise()`'s online detector panel (`watchTrace` + `defaultToolDetectors` — the same
 * streaming stuck-loop/error-streak kernel agent-eval ships), which watches every worker's live
 * trace and raises a `finding` on the coordination bus the moment the builder starts hammering
 * the same failing command. The driver pulls that finding from `await_event`, composes a
 * corrective instruction FROM it, and steers the still-live builder; the steer is the mid-run
 * leg of the delegates edge and lands in the ledger like every other traversal.
 *
 * Fully offline (reactive brain + leaf seam). Run:  pnpm tsx examples/graphs/watchdog-steer.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type AgentGraph,
  promptHandle,
  type RunGraphOptions,
  runGraph,
  type ToolLoopChat,
} from '@tangle-network/agent-runtime/kernel'
import { leafSeam, printLedger } from './shared'

const brief = promptHandle('delegates/worker-brief/v1')

/** The online finding the watchdog raised, read back out of the driver's own transcript. */
function onlineFinding(
  messages: ReadonlyArray<Record<string, unknown>>,
): { detector: string; reason: string; streak: number } | undefined {
  for (const message of messages) {
    const content = typeof message.content === 'string' ? message.content : undefined
    if (content === undefined || !content.includes('"analyst":"online:')) continue
    try {
      const event = JSON.parse(content) as {
        findings?: { detector?: string; reason?: string; streak?: number }
      }
      const f = event.findings
      if (f?.detector !== undefined) {
        return { detector: f.detector, reason: f.reason ?? '', streak: f.streak ?? 0 }
      }
    } catch {
      // a non-JSON tool message is simply not the finding
    }
  }
  return undefined
}

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

  // The builder blocks until a steer arrives, and its trace replays a stuck loop: the same
  // failing `pnpm test` five times — the storm the repeated-action/error-streak panel catches.
  const received: AgentProfile[] = []
  const seam = leafSeam(received, { builder: { awaitSteer: true, withTrace: true, storm: 5 } })

  // ── The driver: spawn, PULL the watchdog finding, steer with the evidence, settle ──
  let spawned = false
  let steered = false
  const brain: ToolLoopChat = async (messages) => {
    if (!spawned) {
      spawned = true
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
    const finding = onlineFinding(messages)
    if (finding === undefined) {
      // Yield one macrotask so the freshly-spawned builder's executor starts and the detector's
      // finding reaches the bus BEFORE this pull — otherwise the pull races the spawn by a few
      // microtasks and the driver burns a full await fence learning nothing.
      await new Promise((resolve) => setImmediate(resolve))
      return {
        toolCalls: [
          { id: 'cw', name: 'await_event', arguments: JSON.stringify({ kinds: ['finding'] }) },
        ],
      }
    }
    if (!steered) {
      steered = true
      return {
        toolCalls: [
          {
            id: 'c2',
            name: 'steer_agent',
            arguments: JSON.stringify({
              workerId: 'wd:s0',
              instruction:
                `Watchdog: ${finding.detector} fired (streak ${finding.streak}) — ${finding.reason}. ` +
                'Stop repeating the failing command and deliver what you have.',
            }),
          },
        ],
      }
    }
    const settled = messages.some(
      (message) =>
        typeof message.content === 'string' && message.content.includes('"type":"settled"'),
    )
    if (!settled) {
      return { toolCalls: [{ id: 'c3', name: 'await_event', arguments: JSON.stringify({}) }] }
    }
    return { content: 'done', toolCalls: [] }
  }

  const opts: RunGraphOptions = {
    runId: 'wd',
    makeWorkerAgent: seam,
    brain,
    watchWorkers: { maxFindingsPerWorker: 1 },
  }
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
