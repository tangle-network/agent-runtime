/**
 * A harness-run graph lead submits through Runtime's actual local HTTP MCP endpoint.
 * The brain and leaf executor are offline fixtures; this is not hosted model or harness proof.
 */

import type { ToolSpan } from '@tangle-network/agent-eval'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemorySpawnJournal } from '../../src/durable/in-memory-spawn-stores'
import type {
  MakeWorkerAgent,
  WorkerSpawnContext,
} from '../../src/mcp/tools/coordination-contracts'
import type { DriveHarness } from '../../src/runtime/supervise/supervisor-agent'
import { createPushTraceSource } from '../../src/runtime/supervise/trace-source'
import type { Agent, AgentSpec, Executor, ExecutorResult } from '../../src/runtime/supervise/types'
import { supervise } from '../helpers/runtime-with-test-brain'
import { scriptedBrain, wakeEvents } from './scripted-brain'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

// ── Leaf fixtures (the offline execution seam; the graph machinery around them is real) ────────

const toolSpan = (runId: string): ToolSpan => ({
  spanId: `${runId}-t0`,
  runId,
  kind: 'tool',
  name: 'write_file',
  toolName: 'write_file',
  args: { path: 'out.ts' },
  status: 'ok',
  startedAt: 100,
  endedAt: 105,
})

interface LeafOptions {
  /** Block settlement until a deliver() arrives (so a steer can reach a LIVE worker). */
  awaitSteer?: boolean
  /** Expose a tool-trace source so settle-time analysts have evidence to read. */
  withTrace?: boolean
  /** Record this many IDENTICAL failing tool calls into a LIVE (push) trace at execute start —
   *  the stuck-loop storm the online detector panel fires on. Implies a live trace source. */
  storm?: number
  /** Settle by throwing instead of delivering. */
  fail?: boolean
  /** Settle `done` with an INVALID verdict — a completed worker that delivered nothing usable. */
  invalid?: boolean
  /** The result, computed from the spawn's task. Default `{ built: <name> }`. */
  output?: (task: unknown) => unknown
  /** Settle by throwing for these tasks only. */
  failOn?: (task: unknown) => boolean
  /** Hold the execution this long, per task, so concurrent executions overlap. */
  delayMs?: (task: unknown) => number
  /** Counts this node's concurrent executions. */
  running?: { now: number; max: number }
  /** Each task, in the order its execution finished. */
  completed?: unknown[]
}

/** A leaf agent whose PROFILE (what the graph pinned + the directive) is captured for assertion.
 *  `opts` may be one option set for every node, or per-node-name option sets. `contexts` captures
 *  each spawn's `WorkerSpawnContext` (the analyst marker + composed task assertions read it). */
function leafSeam(
  received: AgentProfile[],
  optsByNode: LeafOptions | Record<string, LeafOptions> = {},
  contexts?: Array<WorkerSpawnContext | undefined>,
): MakeWorkerAgent {
  const optionsFor = (name: string): LeafOptions =>
    'awaitSteer' in optsByNode ||
    'withTrace' in optsByNode ||
    'storm' in optsByNode ||
    'fail' in optsByNode ||
    'invalid' in optsByNode
      ? (optsByNode as LeafOptions)
      : ((optsByNode as Record<string, LeafOptions>)[name] ?? {})
  return (profile, context) => {
    received.push(profile)
    contexts?.push(context)
    const name = profile.name ?? 'leaf'
    const opts = optionsFor(name)
    let release: (() => void) | undefined
    const gate = opts.awaitSteer
      ? new Promise<void>((resolve) => {
          release = resolve
        })
      : undefined
    const pushed =
      opts.storm !== undefined ? createPushTraceSource({ runId: `leaf-${name}` }) : undefined
    let artifact: ExecutorResult<unknown> | undefined
    const ex: Executor<unknown> = {
      runtime: 'router',
      ...(opts.awaitSteer
        ? {
            deliver: () => {
              release?.()
              return true
            },
          }
        : {}),
      ...(pushed
        ? { traceSource: () => pushed.source }
        : opts.withTrace
          ? {
              traceSource: () => ({
                onSpan: () => () => {},
                collect: async () => [toolSpan(`leaf-${name}`)],
              }),
            }
          : {}),
      async execute() {
        for (let i = 0; i < (opts.storm ?? 0); i += 1) {
          pushed?.record({
            toolName: 'bash',
            args: { cmd: 'pnpm test' },
            status: 'error',
            error: '1 failing',
          })
        }
        if (gate) await gate
        const task = context?.task
        const running = opts.running
        if (running) {
          running.now += 1
          running.max = Math.max(running.max, running.now)
        }
        try {
          const delay = opts.delayMs?.(task) ?? 0
          if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
          if (opts.fail || opts.failOn?.(task) === true) {
            throw new Error(`${name}: deliberate failure`)
          }
          artifact = {
            outRef: `w:${name}`,
            out: opts.output ? opts.output(task) : { built: name },
            verdict: opts.invalid ? { valid: false, score: 0 } : { valid: true, score: 1 },
            spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
          }
          opts.completed?.push(task)
          return artifact
        } finally {
          if (running) running.now -= 1
        }
      },
      teardown: () => Promise.resolve({ destroyed: true }),
      resultArtifact: () => {
        if (!artifact) throw new Error('leaf: no terminal artifact')
        return artifact
      },
    }
    const spec: AgentSpec = { profile, harness: null, executor: ex }
    return { name, act: async () => undefined, executorSpec: spec } as Agent<unknown, unknown> & {
      executorSpec: AgentSpec
    }
  }
}

describe('run_graph — a director runs an agent graph as ONE subtask of its own run', () => {
  /** The graph as a model writes it: plain data, directives as `<surface>/v<n>` strings. */
  const refineGraph = {
    nodes: [
      {
        id: 'lead',
        profile: testAgentProfile('lead', {
          harness: 'cli-base',
          tools: runtimeToolDeclarations('spawn_worker'),
          prompt: { systemPrompt: 'Run generate, then critique, then refine.' },
        }),
      },
      {
        id: 'generate',
        profile: testAgentProfile('generate', { prompt: { systemPrompt: 'You write a draft.' } }),
      },
      {
        id: 'critique',
        profile: testAgentProfile('critique', {
          prompt: { systemPrompt: 'You name the weakest line.' },
        }),
      },
      {
        id: 'refine',
        profile: testAgentProfile('refine', {
          prompt: { systemPrompt: 'You fix what the critique names.' },
        }),
      },
    ],
    edges: ['generate', 'critique', 'refine'].map((to) => ({
      kind: 'delegates',
      from: 'lead',
      to,
      directive: 'delegates/worker-brief/v1',
    })),
  }
  const director = testAgentProfile('director', {
    harness: 'cli-base',
    tools: runtimeToolDeclarations('run_graph', 'spawn_worker'),
  })

  it('a harness-run graph lead with spawn rights starts and settles on its own submission', async () => {
    // test-canary-graph-tools-20261018c and -d (2026-10-18): run_graph refused every graph whose
    // lead runs on a harness. The lead held the node check and no continuation policy, which
    // supervisorAgent refuses for any harness manager, so the graph failed before its lead started.
    const journal = new InMemorySpawnJournal()
    const seen: Array<ReadonlyArray<Record<string, unknown>>> = []
    const submissions: unknown[] = []
    const harnessGraph = {
      ...refineGraph,
      nodes: refineGraph.nodes.map((node) =>
        node.id === 'lead'
          ? {
              ...node,
              profile: {
                ...node.profile,
                harness: 'opencode',
                tools: runtimeToolDeclarations('spawn_worker', 'submit_result'),
              },
            }
          : node,
      ),
    }
    const driveHarness: DriveHarness = async ({ profile, coordinationMcpUrl }) => {
      if (profile.name !== 'lead') return
      const response = await fetch(coordinationMcpUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'submit',
          method: 'tools/call',
          params: { name: 'submit_result', arguments: { result: 'the refined haiku' } },
        }),
      })
      submissions.push(await response.json())
    }
    await supervise(director, 'write a haiku through a graph', {
      runId: 'grg-harness-lead',
      journal,
      budget: { maxIterations: 100, maxTokens: 200_000 },
      deliverable: { describe: 'what only the run deadline ends', check: () => false },
      makeLeafAgent: leafSeam([]),
      driveHarness,
      brain: scriptedBrain(
        [
          {
            toolCalls: [
              {
                name: 'run_graph',
                arguments: {
                  graph: harnessGraph,
                  deliverable: 'a refined haiku',
                  budget: { maxIterations: 30, maxTokens: 40_000 },
                },
              },
            ],
          },
          { content: 'waiting for the graph' },
          { content: 'done' },
        ],
        seen,
      ),
    })

    // The lead ran and its one submission was accepted.
    expect(submissions).toHaveLength(1)
    expect(JSON.stringify(submissions)).not.toMatch(/accepted\\?"\s*:\s*false/)
    // The graph settled done and woke the director with it.
    const subtree = (await journal.loadTree('grg-harness-lead')) ?? []
    expect(
      subtree.find((event) => event.kind === 'settled' && event.id === 'grg-harness-lead:s0'),
    ).toMatchObject({ status: 'done' })
    expect(wakeEvents(seen[2]!)).toContainEqual(
      expect.objectContaining({ type: 'settled', status: 'done' }),
    )
  })
})
