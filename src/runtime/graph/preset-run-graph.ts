/**
 * The `runGraph` preset (agent-runtime#982, #975): today's `AgentGraph` compiled into an engine
 * graph and run by the engine. `runGraph` keeps its signature and becomes this call, so the six
 * consumers measured in #967 change nothing.
 *
 * WHAT THE ENGINE GRAPH LOOKS LIKE. One `supervisor` root carrying the whole graph, one pinned
 * `agent` node per worker, and the `delegates`/`analyzes` edges as authored. A `delegates` edge is
 * MODEL-fired (#971): its target is spawned by the supervisor through the coordination protocol,
 * with the node pin and the directive applied inside the kernel's authorized path. So the engine
 * schedules exactly one node — the supervisor — and the worker nodes are the declarative record of
 * what it may spawn. That record is what makes a `runGraph` graph a first-class engine graph:
 * compiled, type-checked, inspectable, and composable with `data` edges and `script` nodes.
 *
 * WHY THE ROOT NODE RUNS `superviseAgentGraph`. The engine's `supervisor` kind IS `supervisorAgent`
 * (#970), and the graph authority — pinning, the edge ledger, per-edge caps, continuity — already
 * lives in that one function. Executing it as the root node's body preserves every one of #967's
 * load-bearing properties by construction rather than by re-implementation.
 */

import { contentAddress } from '../../durable/content-address'
import { ValidationError } from '../../errors'
import type { AgentGraph, GraphResult, RunGraphOptions } from '../supervise/graph'
import { kernelPromptRegistry } from '../supervise/prompt-registry'
import type { Agent, AgentSpec, Executor, ExecutorResult, Spend } from '../supervise/types'
import type { ToolLoopChat } from '../tool-loop'
import { compileGraph } from './compile'
import type { EngineGraphEdge, EngineGraphNode, EngineGraphSpec } from './definition'
import { createGraphEngine, type GraphEngine } from './engine'
import type { NodeKind } from './kind'
import { agentKind } from './kinds'
import { runEngineGraph } from './scheduler'
import type { GraphRunResult } from './scheduler-types'

/** The preset's root kind: one node whose body is the graph's supervise run. */
export const RUN_GRAPH_KIND = 'run-graph.supervisor'

/** The graph supervise run, injected rather than imported: the preset describes the graph, and
 *  `runGraph` supplies the body, so this module never imports its caller at runtime. */
export type RunGraphBody = (
  graph: AgentGraph,
  options: RunGraphOptions,
  brain?: ToolLoopChat,
) => Promise<GraphResult>

/** Where the run body's raw failure is kept. A node's output crosses the edge-admission boundary
 *  (JSON round-trip), which would reduce an `Error` to a plain object and a typed
 *  `GraphEdgeCapError` to an untyped one. The error therefore travels beside the output, by
 *  reference, and the preset rethrows the ORIGINAL object. */
export interface RunGraphCapture {
  error?: unknown
}

/** What the root node carries: the authored graph, the caller's options, and the run body. */
export interface RunGraphNodeConfig {
  readonly graph: AgentGraph
  readonly options: RunGraphOptions
  readonly run: RunGraphBody
  readonly capture: RunGraphCapture
  readonly brain?: ToolLoopChat
}

/** The run's outcome as the root node's output: never a throw, so a typed failure (an exhausted
 *  delegates cap) reaches the caller as the exact error object rather than a settle reason. */
export type RunGraphNodeOut =
  | { readonly ok: true; readonly result: GraphResult }
  /** The message only; the raw error rides in {@link RunGraphCapture}. */
  | { readonly ok: false; readonly error: string }

function spendOf(out: RunGraphNodeOut): Spend {
  const measured = out.ok ? out.result.result.spentTotal : undefined
  return measured ?? { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 }
}

/**
 * The node kind behind the preset. Its executor runs the graph and reports the run's own measured
 * spend, so the engine pool debits what the graph actually used, never a second copy of it.
 */
export function runGraphKind(): NodeKind<RunGraphNodeConfig> {
  return {
    id: RUN_GRAPH_KIND,
    version: 1,
    description: 'One AgentGraph supervise run as an engine node (the runGraph preset).',
    validateConfig: (raw, context) => {
      if (typeof raw !== 'object' || raw === null) {
        throw new ValidationError(`${context}: config must carry { graph, options }`)
      }
      const config = raw as Partial<RunGraphNodeConfig>
      if (
        config.graph === undefined ||
        config.options === undefined ||
        config.run === undefined ||
        config.capture === undefined
      ) {
        throw new ValidationError(`${context}: config must carry { graph, options, run, capture }`)
      }
      return config as RunGraphNodeConfig
    },
    configSchema: {
      type: 'object',
      properties: { graph: { type: 'object' } },
      required: ['graph'],
    },
    inputs: [],
    outputs: [],
    effects: [],
    onCrash: 'restart',
    budget: 'metered',
    run: ({ config, profile }) => {
      let artifact: ExecutorResult<unknown> | undefined
      const executor: Executor<unknown> = {
        runtime: 'inline',
        async execute(): Promise<ExecutorResult<unknown>> {
          const out: RunGraphNodeOut = await config
            .run(config.graph, config.options, config.brain)
            .then(
              (result) => ({ ok: true, result }) as const,
              (error: unknown) => {
                config.capture.error = error
                return { ok: false, error: String(error) } as const
              },
            )
          artifact = { outRef: contentAddress({ runGraph: out.ok }), out, spent: spendOf(out) }
          return artifact
        },
        teardown: () => Promise.resolve({ destroyed: true }),
        resultArtifact: () => {
          if (!artifact) {
            throw new ValidationError(`${RUN_GRAPH_KIND}: resultArtifact() read before execute()`)
          }
          return artifact
        },
      }
      return {
        name: profile.name ?? 'graph',
        act: () =>
          Promise.reject(new ValidationError(`${RUN_GRAPH_KIND}: act() is not the execution path`)),
        executorSpec: { profile, harness: null, executor } as AgentSpec,
      } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
    },
  }
}

/** An engine with the preset kind registered beside the core `agent` kind the workers use. */
export function runGraphEngine(): GraphEngine {
  // Each kind fixes its own `Config`, so the heterogeneous set widens here — the registry stores
  // `NodeKind<unknown>` and every kind validates its own config on the way in.
  const kinds = [agentKind({}), runGraphKind()] as unknown as ReadonlyArray<NodeKind>
  return createGraphEngine({ coreKinds: kinds })
}

/**
 * Compile an `AgentGraph` into the engine graph that represents it: the supervisor root, one
 * pinned `agent` node per worker, and every authored edge. Pure — nothing runs, so a caller can
 * inspect, diff, or extend the result before handing it to the engine.
 */
export function graphFromRunGraph(
  graph: AgentGraph,
  options: RunGraphOptions,
  run: RunGraphBody,
  capture: RunGraphCapture = {},
  brain?: ToolLoopChat,
): EngineGraphSpec {
  const root = graph.nodes[0]
  if (root === undefined) throw new ValidationError('graphFromRunGraph: a graph needs a root node')
  const nodes: EngineGraphNode[] = graph.nodes.map((node, index) =>
    index === 0
      ? {
          id: node.id,
          kind: `${RUN_GRAPH_KIND}/v1`,
          config: { graph, options, run, capture, ...(brain !== undefined ? { brain } : {}) },
          profile: node.profile,
          budget: graph.budget,
          terminal: true,
          // The engine-level check is that the run produced its graph result; whether that result
          // found a winner is the graph's own business, carried inside it.
          deliverable: {
            check: (out: unknown) => (out as RunGraphNodeOut | undefined)?.ok === true,
          },
        }
      : {
          id: node.id,
          kind: 'agent/v1',
          profile: node.profile,
          // Spawned by the supervisor through its delegates edges: never entered, never awaited,
          // and never a terminal of the scheduler's run.
          entry: false,
          terminal: false,
          budget: options.perWorker ?? graph.budget,
        },
  )
  const edges: EngineGraphEdge[] = graph.edges.flatMap((edge): EngineGraphEdge[] =>
    edge.kind === 'delegates'
      ? [
          {
            kind: 'delegates' as const,
            from: { node: edge.from },
            to: { node: edge.to },
            directive: edge.directive,
            ...(edge.maxTraversals !== undefined ? { maxTraversals: edge.maxTraversals } : {}),
          },
        ]
      : // One engine edge per analysed source: the engine's edges are 1:1, the authored form fans in.
        edge.over.map((source) => ({
          kind: 'analyzes' as const,
          from: { node: source, port: 'trace' },
          to: { node: edge.to },
          directive: edge.directive,
          ...(edge.maxTraversals !== undefined ? { maxTraversals: edge.maxTraversals } : {}),
        })),
  )
  return { nodes, edges, root: root.id, deliverable: graph.deliverable }
}

/**
 * Run an `AgentGraph` through the engine: compile it with {@link graphFromRunGraph}, schedule it,
 * and answer the caller in `runGraph`'s own vocabulary. A typed failure the graph threw — an
 * exhausted delegates cap — is rethrown as the exact error object it was, never flattened into a
 * settle reason.
 */
export function runGraphThroughEngine(
  graph: AgentGraph,
  options: RunGraphOptions,
  run: RunGraphBody,
  brain?: ToolLoopChat,
): Promise<GraphResult> {
  const engine = runGraphEngine()
  const capture: RunGraphCapture = {}
  // Compiling here, synchronously, is deliberate: a structural refusal reaches the caller as a
  // throw rather than a rejection, which is the contract `runGraph` has always had.
  const spec = graphFromRunGraph(graph, options, run, capture, brain)
  const root = spec.root as string
  // The engine's own tree is a sibling of the graph's: the graph keeps `options.runId` for its
  // journal, so every consumer reading that tree (discovery-lab's provenance classifier) is
  // unaffected by the preset.
  const engineRunId = `${options.runId ?? contentAddress({ graph: root }).slice(0, 18)}:engine`
  const compiled = compileGraph(engine, spec, 'runGraph')
  return runEngineGraph(engine, compiled, graphRootTask(graph), {
    budget: graph.budget,
    perNode: graph.budget,
    ...(options.journal !== undefined ? { journal: options.journal } : {}),
    ...(options.blobs !== undefined ? { blobs: options.blobs } : {}),
    // The same default `runGraph` itself applies, so an authored directive always resolves.
    prompts: options.registry ?? kernelPromptRegistry(),
    runId: engineRunId,
  }).then((finished) => mapEngineResult(finished, root, capture))
}

function mapEngineResult(run: GraphRunResult, root: string, capture: RunGraphCapture): GraphResult {
  if (capture.error !== undefined) throw capture.error
  const settle = run.settles.find((entry) => entry.node === root)
  const out = settle?.out as RunGraphNodeOut | undefined
  if (out === undefined) {
    throw new ValidationError(
      `runGraph: the engine returned no settlement for root node '${root}' (${run.kind}${
        run.kind === 'no-winner' ? `/${run.reason}` : ''
      })`,
    )
  }
  if (!out.ok) throw new ValidationError(`runGraph: ${out.error}`)
  return out.result
}

/** The root's task line, as `runGraph` composes it today. */
function graphRootTask(graph: AgentGraph): string {
  const root = graph.nodes[0]
  return root === undefined ? 'run the graph' : `run graph from '${root.id}'`
}
