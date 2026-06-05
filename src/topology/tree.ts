/**
 * @experimental
 *
 * TOPOLOGY VIEW — the live recursive agent tree, folded from the ONE lifecycle stream
 * (`src/runtime-hooks.ts`). It is a pure projection: feed it the `RuntimeHookEvent`s that
 * `runLoop`, `toolLoop`, and the keystone `Scope` already emit, and it maintains the tree of
 * agents + renders it. Attach `view.hooks` to a `Supervisor`/`runLoop` and the tree updates live.
 *
 * Two node sources, ONE stream:
 *  - an agent node is born from `agent.spawn` (id = `childId`, parent = the spawner) or the root
 *    `agent.run` (id = `runId`); `agent.child`/`agent.run:after` settle it (status + score/reason).
 *  - a STEP (`agent.{turn,tool_call,plan,decision}`) is not a node — it advances the step count of
 *    the agent it belongs to (matched by `runId`/`parentId`).
 *
 * No I/O, no timers, no backend coupling — the same projection drives a CLI render, a TUI, or a
 * web tree. Rendering is deterministic given the event order (the stream is the source of truth).
 */

import type { RuntimeHookEvent, RuntimeHooks } from '../runtime-hooks'

export type TopologyStatus = 'running' | 'done' | 'down'

/** One agent in the tree. A leaf never spawns; a driver's `childIds` is non-empty. */
export interface TopologyNode {
  readonly id: string
  /** Display label (spawn `label`, or the driver name on the root). */
  label: string
  /** Leaf runtime (`router`/`sandbox`/`cli`) when known. */
  runtime?: string
  /** Parent agent id; undefined ⇒ a root. */
  parentId?: string
  /** Recursion depth (root = 0). */
  depth: number
  status: TopologyStatus
  /** Count of in-agent steps (turns + tool calls + plan/decision rounds) folded so far. */
  steps: number
  /** Deployable score in [0,1] once settled `done`. */
  score?: number
  /** Failure reason once settled `down`. */
  reason?: string
  /** Children in spawn order. */
  readonly childIds: string[]
}

export interface RenderOptions {
  /** Cap the rendered depth (deeper nodes collapse to a `… N more` line). Default: no cap. */
  readonly maxDepth?: number
  /** Drop the per-node detail suffix (steps/children/score) — labels only. Default: false. */
  readonly compact?: boolean
}

export interface TopologyView {
  /** The `RuntimeHooks` sink — attach to `SupervisorOpts.hooks` / `runLoop` options. */
  readonly hooks: RuntimeHooks
  /** Fold one event into the tree (the same call `hooks.onEvent` makes — exposed for replay). */
  ingest(event: RuntimeHookEvent): void
  /** Every node, insertion order. */
  nodes(): TopologyNode[]
  /** Nodes with no in-tree parent (the run roots). */
  roots(): TopologyNode[]
  /** One node by id. */
  node(id: string): TopologyNode | undefined
  /** Render the tree as an aligned ASCII forest. */
  render(opts?: RenderOptions): string
}

const stepTargets = new Set(['agent.turn', 'agent.tool_call', 'agent.plan', 'agent.decision'])

/** Build a live topology view. Stateful — one per run (or per replay). */
export function createTopologyView(): TopologyView {
  // Insertion-ordered so render is stable and roots() reflects spawn order.
  const byId = new Map<string, TopologyNode>()

  const ensure = (id: string, seed: Partial<TopologyNode> = {}): TopologyNode => {
    const existing = byId.get(id)
    if (existing) return existing
    const node: TopologyNode = {
      id,
      label: seed.label ?? id,
      depth: seed.depth ?? 0,
      status: 'running',
      steps: 0,
      childIds: [],
      ...seed,
    }
    byId.set(id, node)
    return node
  }

  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)

  const ingest = (event: RuntimeHookEvent): void => {
    const p = (event.payload ?? {}) as Record<string, unknown>

    if (event.target === 'agent.spawn' && event.phase === 'after') {
      const id = str(p.childId)
      if (!id) return
      const parent = event.parentId ? ensure(event.parentId) : undefined
      const node = ensure(id, {
        label: str(p.label) ?? id,
        runtime: str(p.runtime),
        parentId: event.parentId,
        depth: num(p.depth) ?? (parent ? parent.depth + 1 : 0),
      })
      if (parent && !parent.childIds.includes(id)) parent.childIds.push(id)
      node.status = 'running'
      return
    }

    if (event.target === 'agent.child' && event.phase === 'after') {
      const id = str(p.childId)
      if (!id) return
      const node = ensure(id, { parentId: event.parentId })
      node.status = str(p.status) === 'down' ? 'down' : 'done'
      node.score = num(p.score)
      node.reason = str(p.reason)
      return
    }

    if (event.target === 'agent.run') {
      const node = ensure(event.runId, {
        label: str(p.driver) ?? event.runId,
        parentId: event.parentId,
      })
      if (event.phase === 'before') node.status = 'running'
      else if (event.phase === 'error') node.status = 'down'
      else if (event.phase === 'after' && node.status === 'running') node.status = 'done'
      return
    }

    // A step advances the agent it belongs to: tool-loop/run-loop key the agent by `runId`,
    // a within-agent sub-event names it via `parentId`. Only count `after`/`event` phases so a
    // before/after pair is one step, not two. An unknown owner is dropped (no phantom node).
    if (stepTargets.has(event.target) && (event.phase === 'after' || event.phase === 'event')) {
      const owner =
        (event.parentId && byId.get(event.parentId)) || byId.get(event.runId) || undefined
      if (owner) owner.steps += 1
    }
  }

  const nodes = (): TopologyNode[] => [...byId.values()]
  const roots = (): TopologyNode[] =>
    nodes().filter((n) => n.parentId === undefined || !byId.has(n.parentId))

  return {
    hooks: { onEvent: (e) => ingest(e) },
    ingest,
    nodes,
    roots,
    node: (id) => byId.get(id),
    render: (opts) => renderTopologyTree({ roots: roots(), node: (id) => byId.get(id) }, opts),
  }
}

const glyph: Record<TopologyStatus, string> = { running: '◐', done: '✓', down: '✗' }

/** Render a forest of `TopologyNode`s to an aligned ASCII tree. Pure — given the same roots +
 *  node lookup it returns the same string. Exposed so a caller can render a tree it folded
 *  itself (e.g. from a journal replay) without the live view. */
export function renderTopologyTree(
  tree: { roots: TopologyNode[]; node: (id: string) => TopologyNode | undefined },
  opts: RenderOptions = {},
): string {
  const lines: string[] = []

  const detail = (n: TopologyNode): string => {
    if (opts.compact) return ''
    const parts: string[] = []
    if (n.runtime) parts.push(n.runtime)
    if (n.steps > 0) parts.push(`${n.steps} ${n.steps === 1 ? 'step' : 'steps'}`)
    if (n.childIds.length > 0) parts.push(`${n.childIds.length} children`)
    if (n.status === 'done' && n.score !== undefined) parts.push(`score ${n.score.toFixed(2)}`)
    if (n.status === 'down' && n.reason) parts.push(`down: ${n.reason}`)
    return parts.length ? `  (${parts.join(' · ')})` : ''
  }

  const walk = (n: TopologyNode, prefix: string, isLast: boolean, depth: number): void => {
    const branch = depth === 0 ? '' : isLast ? '└─ ' : '├─ '
    lines.push(`${prefix}${branch}${glyph[n.status]} ${n.label}${detail(n)}`)

    if (opts.maxDepth !== undefined && depth >= opts.maxDepth && n.childIds.length > 0) {
      const childPrefix = prefix + (depth === 0 ? '' : isLast ? '   ' : '│  ')
      lines.push(`${childPrefix}└─ … ${n.childIds.length} more`)
      return
    }
    const childPrefix = prefix + (depth === 0 ? '' : isLast ? '   ' : '│  ')
    const kids = n.childIds.map((id) => tree.node(id)).filter((c): c is TopologyNode => !!c)
    kids.forEach((c, i) => {
      walk(c, childPrefix, i === kids.length - 1, depth + 1)
    })
  }

  tree.roots.forEach((r, i) => {
    walk(r, '', i === tree.roots.length - 1, 0)
  })
  return lines.join('\n')
}
