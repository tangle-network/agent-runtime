/**
 * `graphDesignerExtraTools` — the designer's toolset on the existing
 * `RunGraphOptions.extraTools` seam.
 *
 * A meta-graph designer is an ordinary supervisor ROOT whose ONLY tools are
 * these three: look up what this task shape has run, run a graph (authored or
 * replayed — every run recorded, terminal accounting included), and read the
 * history. The agent authors graphs as DATA (nodes, edges, budget, deliverable
 * description); execution is ENVIRONMENT-OWNED — the caller closes over how
 * graphs run (backend/brain/leaf seam) and how the deliverable's check is
 * re-bound, because oracles are environment, never agent-supplied.
 *
 * This is the `measure_rung` pattern from the graph contract generalized: the
 * root's profile declares the tools; the graph options supply them; nothing
 * new exists below this line but the registry calls themselves.
 */

import { ValidationError } from '../../errors'
import type { AgentGraph, GraphResult } from './graph'
import {
  digestOfGraph,
  type GraphRunRecord,
  graphFromStored,
  graphRegistry,
  graphRunsFor,
  lookupGraph,
  recordGraphRun,
  taskShapeDigest,
} from './graph-registry'

/** How the ENVIRONMENT executes a graph the designer asked to run. */
export interface DesignerRunGraphEnv {
  /** Run one graph (check already re-bound by {@link DesignerToolsEnv.bindCheck}). */
  readonly runGraph: (graph: AgentGraph) => Promise<GraphResult>
  /** Attach the environment's deliverable check to an authored graph. */
  readonly bindCheck: (graph: AgentGraph) => AgentGraph
}

export interface DesignerToolsEnv extends DesignerRunGraphEnv {
  /** Workspace holding the graph registry (the sandbox's persistent volume). */
  readonly registryDir: string
  /** Distinct run ids per inner run; default: `designer-<n>`. */
  readonly nextRunId?: () => string
}

const taskShapeSchema = {
  type: 'object',
  description:
    'Stable descriptor of this class of work (kind, source, constraints) — the lookup key. Not the payload.',
  additionalProperties: true,
}
const graphDataSchema = {
  type: 'object',
  description:
    'A graph as data: { nodes: [{id, profile}], edges: [{kind, from, to, directive, ...}], budget, deliverable: {describe} }. No check function — the environment binds it.',
  additionalProperties: true,
}

export interface GraphDesignerExtraTools {
  readonly extraTools: ReadonlyArray<{
    name: string
    description: string
    parameters: Record<string, unknown>
  }>
  /** The executeExtraTool contract: answers ONLY these tools, null otherwise. */
  readonly executeExtraTool: (name: string, args: unknown) => Promise<unknown> | unknown
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError(`${context}: expected an object`)
  }
  return value as Record<string, unknown>
}

/** The designer's three tools over one registry. Record-every-run is enforced
 *  by construction: running IS recording. */
export function graphDesignerExtraTools(env: DesignerToolsEnv): GraphDesignerExtraTools {
  const registry = graphRegistry(env.registryDir)
  let runCounter = 0
  const runId = env.nextRunId ?? (() => `designer-${++runCounter}`)

  const runAndRecord = async (
    taskShape: Record<string, unknown>,
    graph: AgentGraph,
    mode: string,
  ): Promise<Record<string, unknown>> => {
    const digest = digestOfGraph(graph)
    const startedAt = new Date().toISOString()
    const result = await env.runGraph(graph)
    const winner = result.result.kind === 'winner'
    const spent = winner ? result.result.spentTotal : undefined
    await recordGraphRun(registry, graph, {
      graphDigest: digest,
      taskDigest: taskShapeDigest(taskShape),
      startedAt,
      finishedAt: new Date().toISOString(),
      outcome: winner
        ? { kind: 'delivered' }
        : { kind: 'no-winner', reason: `mode=${mode} result=${result.result.kind}` },
      cost: {
        ...(spent?.iterations !== undefined ? { iterations: spent.iterations } : {}),
        ...(spent?.tokens && typeof spent.tokens === 'object' && 'input' in spent.tokens
          ? {
              tokens: (spent.tokens.input ?? 0) + (spent.tokens.output ?? 0),
            }
          : {}),
        ...(spent?.usd !== undefined ? { usd: spent.usd } : {}),
      },
      traversals: result.ledger.length,
      ...(result.exhaustedEdges.length > 0 ? { exhaustedEdges: result.exhaustedEdges } : {}),
    })
    return {
      runId: runId(),
      outcome: winner ? 'delivered' : `no-winner (${result.result.kind})`,
      graphDigest: digest,
      traversals: result.ledger.length,
      ...(spent?.iterations !== undefined ? { iterations: spent.iterations } : {}),
      ...(spent?.tokens && typeof spent.tokens === 'object' && 'input' in spent.tokens
        ? { tokens: (spent.tokens.input ?? 0) + (spent.tokens.output ?? 0) }
        : {}),
    }
  }

  const summarize = (row: GraphRunRecord): Record<string, unknown> => ({
    graphDigest: row.graphDigest.slice(0, 12),
    outcome: row.outcome.kind,
    cost: row.cost,
    finishedAt: row.finishedAt,
  })

  return {
    extraTools: [
      {
        name: 'designer_lookup_graph',
        description:
          'Look up what this task shape has run before. Returns replay (a known-good graph — run it verbatim with designer_run_graph, near-zero inference) or author (with the reason), plus the recent history for context.',
        parameters: {
          type: 'object',
          properties: { taskShape: taskShapeSchema },
          required: ['taskShape'],
          additionalProperties: false,
        },
      },
      {
        name: 'designer_run_graph',
        description:
          'Run a graph and record it. REPLAY mode: pass the graphDigest from lookup — the stored graph runs verbatim, check re-bound by the environment. AUTHOR mode: pass the graph as data (no check). Every run is recorded with its terminal accounting; the registry is the memory.',
        parameters: {
          type: 'object',
          properties: {
            taskShape: taskShapeSchema,
            mode: { type: 'string', enum: ['replay', 'authored'] },
            graphDigest: {
              type: 'string',
              description: 'Replay mode: the digest lookup returned.',
            },
            graph: graphDataSchema,
            mutationNote: {
              type: 'string',
              description:
                'Author mode after a failed replay lineage: what the prior record says went wrong and the ONE axis this graph changes.',
            },
          },
          required: ['taskShape', 'mode'],
          additionalProperties: false,
        },
      },
      {
        name: 'designer_history',
        description:
          'Every recorded run for a task shape (or all shapes): graph digest, outcome, cost, finish time. The evidence for improvement decisions.',
        parameters: {
          type: 'object',
          properties: { taskShape: taskShapeSchema },
          additionalProperties: false,
        },
      },
    ],
    executeExtraTool: (name, raw) => {
      if (name === 'designer_lookup_graph') {
        return (async () => {
          const args = asRecord(raw, 'designer_lookup_graph')
          const taskShape = asRecord(args.taskShape, 'designer_lookup_graph.taskShape')
          const selection = lookupGraphSyncish(taskShape)
          return selection
        })()
      }
      if (name === 'designer_history') {
        return (async () => {
          const args = asRecord(raw ?? {}, 'designer_history')
          const { listGraphRuns } = await import('./graph-registry')
          const all = await listGraphRuns(registry)
          const rows =
            args.taskShape === undefined
              ? all
              : all.filter(
                  (row) =>
                    row.taskDigest ===
                    taskShapeDigest(asRecord(args.taskShape, 'designer_history.taskShape')),
                )
          return { runs: rows.map(summarize) }
        })()
      }
      if (name === 'designer_run_graph') {
        return (async () => {
          const args = asRecord(raw, 'designer_run_graph')
          const taskShape = asRecord(args.taskShape, 'designer_run_graph.taskShape')
          const mode = args.mode
          if (mode === 'replay') {
            const digest = args.graphDigest
            if (typeof digest !== 'string' || digest.length === 0) {
              throw new ValidationError(
                'designer_run_graph: replay mode requires graphDigest from lookup',
              )
            }
            const { loadGraph } = await import('./graph-registry')
            const stored = await loadGraph(registry, digest)
            if (!stored) {
              throw new ValidationError(
                `designer_run_graph: no stored graph ${digest.slice(0, 12)} — re-lookup`,
              )
            }
            const graph = env.bindCheck(
              graphFromStored(stored, () => {
                throw new Error('designer: environment did not bind the deliverable check')
              }),
            )
            return runAndRecord(taskShape, graph, 'replay')
          }
          if (mode === 'authored') {
            const graph = asRecord(args.graph, 'designer_run_graph.graph') as unknown as AgentGraph
            for (const axis of ['nodes', 'edges', 'budget', 'deliverable'] as const) {
              if (graph[axis] === undefined) {
                throw new ValidationError(`designer_run_graph.graph: ${axis} is required`)
              }
            }
            return runAndRecord(taskShape, env.bindCheck(graph), 'authored')
          }
          throw new ValidationError("designer_run_graph: mode must be 'replay' | 'authored'")
        })()
      }
      return null
    },
  }

  async function lookupGraphSyncish(
    taskShape: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const selection = await lookupGraph(registry, taskShapeDigest(taskShape))
    const history = (await graphRunsFor(registry, taskShapeDigest(taskShape))).map(summarize)
    if (selection.kind === 'replay') {
      return {
        decision: 'replay',
        reason: `a delivered graph exists (${selection.record.cost.iterations ?? '?'} iterations, ${
          selection.record.cost.tokens ?? '?'
        } tokens)`,
        graphDigest: selection.graph.digest,
        history,
      }
    }
    return { decision: 'author', reason: selection.reason, history }
  }
}
