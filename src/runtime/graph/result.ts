/**
 * Turning a finished run into its result: rehydrate each settle's output, reduce the terminals
 * through the kernel's finalizer seam, and name the honest cause when nothing delivered
 * (agent-runtime#973). Separate from the loop so "what happened" is readable without reading
 * "what ran".
 */
import {
  bestDelivered,
  collectDelivered,
  type FinalizerSettled,
  runFinalizer,
  type SupervisorFinalizer,
} from '../supervise/finalizer'
import { GraphEdgeCapError } from '../supervise/graph'
import type { ResultBlobStore, Scope } from '../supervise/types'
import { admitPayload } from './admit'
import type { CompiledGraph } from './compile'
import type { GraphFoldState } from './fold'
import type {
  GraphEdgeTraversal,
  GraphNodeSettle,
  GraphRunReason,
  GraphRunResult,
} from './scheduler-types'

export type FinalizerChoice = 'bestDelivered' | 'collectDelivered' | SupervisorFinalizer

function resolveFinalizer(choice: FinalizerChoice | undefined): SupervisorFinalizer {
  if (choice === undefined || choice === 'bestDelivered') return bestDelivered
  if (choice === 'collectDelivered') return collectDelivered
  return choice
}

/** Every node settlement with its output rehydrated and its completion check applied. */
export async function materializeSettles(
  compiled: CompiledGraph,
  state: GraphFoldState,
  blobs: ResultBlobStore,
  outCache: ReadonlyMap<string, unknown>,
): Promise<GraphNodeSettle[]> {
  const rehydrate = async (settle: GraphNodeSettle): Promise<GraphNodeSettle> => {
    if (settle.out !== undefined || settle.outRef === undefined) return settle
    const out = outCache.get(settle.outRef) ?? admitPayload(await blobs.get(settle.outRef))
    const node = compiled.nodes.get(settle.node)
    let valid = settle.valid
    if (valid === undefined && node?.deliverable !== undefined && settle.status === 'done') {
      try {
        valid = await node.deliverable.check(out)
      } catch {
        valid = false
      }
    }
    return { ...settle, out, ...(valid !== undefined ? { valid } : {}) }
  }
  return Promise.all(
    [...compiled.nodes.keys()].flatMap((id) => state.nodes.get(id)?.settles ?? []).map(rehydrate),
  )
}

/** Turn a finished run into its result: rehydrate, reduce the terminals, classify a no-winner. */
export async function assembleGraphResult(args: {
  readonly compiled: CompiledGraph
  readonly state: GraphFoldState
  readonly blobs: ResultBlobStore
  readonly scope: Scope<unknown>
  readonly outCache: ReadonlyMap<string, unknown>
  readonly ledger: ReadonlyArray<GraphEdgeTraversal>
  readonly finalizer?: FinalizerChoice
  readonly failure?: {
    readonly reason: GraphRunReason
    readonly error?: { name: string; message: string }
  }
  readonly aborted: boolean
}): Promise<GraphRunResult> {
  const settles = await materializeSettles(args.compiled, args.state, args.blobs, args.outCache)
  const terminals = settles.filter((settle) => args.compiled.nodes.get(settle.node)?.terminal)
  const ledger = args.ledger

  // A capped edge that left the run winnerless is a NAMED failure, not a quiet no-winner (#973).
  const finish = (result: GraphRunResult): GraphRunResult => {
    if (result.kind === 'no-winner' && args.state.exhaustedEdges.size > 0) {
      throw new GraphEdgeCapError(
        Object.freeze([...args.state.exhaustedEdges]),
        Object.freeze([...ledger]) as never,
        result as never,
      )
    }
    return result
  }

  if (args.failure) {
    return finish({
      kind: 'no-winner',
      reason: args.failure.reason,
      ...(args.failure.error ? { error: args.failure.error } : {}),
      terminals,
      settles,
      ledger,
      unreachable: [],
    })
  }
  const allTerminalsSettled = args.compiled.terminals.every(
    (id) => (args.state.nodes.get(id)?.settles.length ?? 0) > 0,
  )
  const pendingTokens = [...args.state.suspensions.values()]
    .filter((suspension) => suspension.status === 'pending')
    .map((suspension) => suspension.token)
  if (pendingTokens.length > 0 && !allTerminalsSettled) {
    return { kind: 'suspended', tokens: pendingTokens, terminals, settles, ledger }
  }
  if (args.aborted) {
    return finish({
      kind: 'no-winner',
      reason: 'aborted',
      terminals,
      settles,
      ledger,
      unreachable: [],
    })
  }
  const delivered = terminals.filter((settle) => settle.status === 'done' && settle.valid !== false)
  const out =
    delivered.length === 0
      ? undefined
      : await runFinalizer(resolveFinalizer(args.finalizer), {
          settled: terminals.map(
            (settle): FinalizerSettled => ({
              id: settle.node,
              status: settle.status,
              valid: settle.status === 'done' && settle.valid !== false,
              ...(settle.outRef !== undefined ? { outRef: settle.outRef } : {}),
            }),
          ),
          blobs: args.blobs,
          tree: args.scope.view,
          budget: args.scope.budget,
        })
  if (out !== undefined) return { kind: 'winner', out, terminals, settles, ledger }

  const unreachable = [...args.compiled.nodes.keys()].filter(
    (id) => (args.state.nodes.get(id)?.settles.length ?? 0) === 0,
  )
  const reason: GraphRunReason = args.compiled.terminals.some((id) => unreachable.includes(id))
    ? unreachable.length === args.compiled.nodes.size
      ? 'budget-exhausted'
      : 'unreachable-terminal'
    : 'all-children-down'
  return finish({ kind: 'no-winner', reason, terminals, settles, ledger, unreachable })
}
