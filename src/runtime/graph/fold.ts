/**
 * The fold (agent-runtime#974): scheduler state is a pure function of the journal, reconstructed
 * by replaying events through the SAME reducer the live scheduler feeds — fold, never checkpoint.
 * Kernel events (`spawned`, `settled`, `waiting`, `woken`) carry what the kernel owns; the engine's
 * events (`node-inputs-resolved`, `edge-verdict`, `join-state`) carry what the scheduler decided,
 * each journaled BEFORE its effect was visible. `edge` stays observability and is skipped here
 * exactly as the kernel's own replay skips it.
 *
 * Events are consumed in APPEND order (the journal file's line order), not by `seq`: kernel and
 * engine events carry independent ordinal counters, and append order is the one total order both
 * share.
 */
import { ValidationError } from '../../errors'
import type { SpawnEvent } from '../supervise/types'
import type { CompiledGraph } from './compile'
import type { GraphNodeSettle } from './scheduler-types'

export type FoldEdgeState = 'pending' | 'satisfied' | 'dead' | 'failed'

export interface FoldEdge {
  state: FoldEdgeState
  /** Set by a `join-state` whose wave this edge was pending inside; cleared when the in-flight
   *  completion it refers to settles (absorbed, never re-released). */
  consumedOnce: boolean
  /** Delivered consumptions — what the per-edge cap counts. */
  traversals: number
  /** How many of the source's settles this edge has accounted for — by a journaled verdict or by
   *  an absorption. The idempotence key: a kill between a settle and its verdicts re-judges ONLY
   *  the unaccounted edges on restart, never a judged or absorbed one twice. */
  judgedSourceSettles: number
  /** The admitted source payload this state reflects (the source settle's outRef). */
  payloadRef?: string
  capped: boolean
}

export type FoldInstanceStatus = 'released' | 'live' | 'done' | 'down' | 'suspended'

export interface FoldInstance {
  readonly node: string
  readonly instance: string
  readonly visit: number
  inputRef?: string
  status: FoldInstanceStatus
  settle?: GraphNodeSettle
}

export interface FoldSuspension {
  readonly token: string
  readonly node: string
  readonly instance: string
  readonly onExpire: 'wait' | 'fail' | 'default'
  readonly expiresAtMs?: number
  readonly defaultRef?: string
  status: 'pending' | 'woken' | 'expired'
}

export interface FoldNode {
  visits: number
  blocked: boolean
  settles: GraphNodeSettle[]
}

export interface GraphFoldState {
  readonly nodes: Map<string, FoldNode>
  readonly edges: Map<string, FoldEdge>
  /** Every node instance the journal knows, keyed by `<node>#<visit>`. */
  readonly instances: Map<string, FoldInstance>
  /** Kernel node id → engine instance label, from `spawned`. */
  readonly spawnedIds: Map<string, string>
  readonly suspensions: Map<string, FoldSuspension>
  readonly exhaustedEdges: Set<string>
}

/** The reducer's zero: every node unvisited, every edge pending, nothing suspended. */
export function emptyFoldState(compiled: CompiledGraph): GraphFoldState {
  const nodes = new Map<string, FoldNode>()
  for (const id of compiled.nodes.keys()) nodes.set(id, { visits: 0, blocked: false, settles: [] })
  const edges = new Map<string, FoldEdge>()
  for (const edge of compiled.edges) {
    edges.set(edge.id, {
      state: 'pending',
      consumedOnce: false,
      traversals: 0,
      judgedSourceSettles: 0,
      capped: false,
    })
  }
  return {
    nodes,
    edges,
    instances: new Map(),
    spawnedIds: new Map(),
    suspensions: new Map(),
    exhaustedEdges: new Set(),
  }
}

function instanceOf(state: GraphFoldState, label: string): FoldInstance | undefined {
  return state.instances.get(label)
}

/**
 * Apply ONE journal event. The live scheduler calls this right after each append; the restart path
 * calls it over the loaded journal. Unknown kernel events are ignored — the engine folds only what
 * it understands, exactly as the kernel's replay skips the engine's events.
 */
export function applyGraphFoldEvent(
  state: GraphFoldState,
  ev: SpawnEvent,
  compiled: CompiledGraph,
): void {
  switch (ev.kind) {
    case 'node-inputs-resolved': {
      const visit = Number(ev.instance.split('#').at(-1))
      if (!Number.isSafeInteger(visit)) {
        throw new ValidationError(`graph fold: instance ${ev.instance} carries no visit ordinal`)
      }
      state.instances.set(ev.instance, {
        node: ev.node,
        instance: ev.instance,
        visit,
        inputRef: ev.inputRef,
        status: 'released',
      })
      const node = state.nodes.get(ev.node)
      if (node) node.visits = Math.max(node.visits, visit)
      return
    }
    case 'spawned': {
      const instance = instanceOf(state, ev.label)
      if (instance) {
        instance.status = 'live'
        state.spawnedIds.set(ev.id, ev.label)
      }
      return
    }
    case 'settled': {
      const label = state.spawnedIds.get(ev.id)
      const instance = label === undefined ? undefined : instanceOf(state, label)
      if (!instance) return
      instance.status = ev.status
      const settle: GraphNodeSettle = {
        node: instance.node,
        visit: instance.visit,
        status: ev.status,
        ...(ev.outRef !== undefined ? { outRef: ev.outRef } : {}),
        ...(ev.reason !== undefined ? { reason: ev.reason } : {}),
      }
      if (ev.trace?.status === 'available') {
        ;(settle as { traceRef?: string }).traceRef = ev.trace.traceRef
      }
      instance.settle = settle
      state.nodes.get(instance.node)?.settles.push(settle)
      // The settle of an in-flight completion a wave already consumed re-arms its edges silently —
      // and counts as ACCOUNTED, so a restart never re-judges an absorbed completion.
      const node = compiled.nodes.get(instance.node)
      for (const edge of node?.outbound ?? []) {
        const folded = state.edges.get(edge.id)
        if (folded?.consumedOnce && folded.state === 'pending') {
          folded.consumedOnce = false
          folded.judgedSourceSettles += 1
        }
      }
      return
    }
    case 'edge-verdict': {
      const folded = state.edges.get(ev.edge)
      if (!folded) return
      if (ev.capped) {
        folded.capped = true
        state.exhaustedEdges.add(ev.edge)
        const target = compiled.edges.find((edge) => edge.id === ev.edge)?.spec.to.node
        const compiledTarget = target === undefined ? undefined : compiled.nodes.get(target)
        if (
          compiledTarget &&
          (compiledTarget.join === 'all' || compiledTarget.join === 'all_done')
        ) {
          const node = state.nodes.get(target as string)
          if (node) node.blocked = true
        }
        return
      }
      folded.judgedSourceSettles += 1
      if (!ev.fired) {
        folded.state = ev.sourceStatus === 'done' ? 'dead' : 'failed'
        folded.payloadRef = undefined
        return
      }
      folded.state = 'satisfied'
      folded.payloadRef = ev.inputRef
      return
    }
    case 'join-state': {
      // A release consumes its wave: delivered consumptions count a traversal and re-arm; every
      // gating edge still pending is consumed-once.
      for (const edgeId of ev.satisfiedBy) {
        const folded = state.edges.get(edgeId)
        if (!folded) continue
        folded.traversals += 1
        folded.state = 'pending'
        folded.payloadRef = undefined
      }
      const target = compiled.nodes.get(ev.node)
      for (const edge of target?.inbound ?? []) {
        const folded = state.edges.get(edge.id)
        if (!folded) continue
        if (ev.consumedPending.includes(edge.id)) folded.consumedOnce = true
        else if (folded.state !== 'pending' && !ev.satisfiedBy.includes(edge.id)) {
          // Settled but not part of the wave (an `any` join's losers): re-arm without a traversal.
          folded.state = 'pending'
          folded.payloadRef = undefined
        }
      }
      return
    }
    case 'waiting': {
      if (ev.spec.kind !== 'token') return
      const instance = instanceOf(state, ev.label)
      if (instance) {
        instance.status = 'suspended'
        // The kernel settle that surfaced the suspension marker is NOT a settle of this node —
        // retract it, so fold state matches what the live scheduler recorded (nothing).
        if (instance.settle !== undefined) {
          const settles = state.nodes.get(instance.node)?.settles
          if (settles && settles.at(-1) === instance.settle) settles.pop()
          instance.settle = undefined
        }
      }
      state.suspensions.set(ev.spec.token, {
        token: ev.spec.token,
        node: instance?.node ?? ev.label.split('#')[0] ?? ev.label,
        instance: ev.label,
        onExpire: ev.spec.onExpire,
        ...(ev.spec.expiresAtMs !== undefined ? { expiresAtMs: ev.spec.expiresAtMs } : {}),
        ...(ev.spec.defaultRef !== undefined ? { defaultRef: ev.spec.defaultRef } : {}),
        status: 'pending',
      })
      return
    }
    case 'woken': {
      // The engine wakes suspensions by token-shaped node id `graphwait:<token>`.
      const token = ev.id.startsWith('graphwait:') ? ev.id.slice('graphwait:'.length) : undefined
      const suspension = token === undefined ? undefined : state.suspensions.get(token)
      if (!suspension) return
      const instance = instanceOf(state, suspension.instance)
      if (ev.by === 'expired') {
        suspension.status = 'expired'
        if (instance) {
          instance.status = 'down'
          const settle: GraphNodeSettle = {
            node: suspension.node,
            visit: instance.visit,
            status: 'down',
            reason: 'suspension expired',
          }
          instance.settle = settle
          state.nodes.get(suspension.node)?.settles.push(settle)
        }
        return
      }
      suspension.status = 'woken'
      if (instance) {
        instance.status = 'done'
        const settle: GraphNodeSettle = {
          node: suspension.node,
          visit: instance.visit,
          status: 'done',
          ...(ev.outRef !== undefined ? { outRef: ev.outRef } : {}),
        }
        instance.settle = settle
        state.nodes.get(suspension.node)?.settles.push(settle)
      }
      return
    }
    default:
      return
  }
}

/** Fold a loaded journal (append order) into scheduler state. */
export function foldGraphJournal(
  events: ReadonlyArray<SpawnEvent>,
  compiled: CompiledGraph,
): GraphFoldState {
  const state = emptyFoldState(compiled)
  for (const ev of events) applyGraphFoldEvent(state, ev, compiled)
  return state
}
