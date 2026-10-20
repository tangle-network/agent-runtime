import { ValidationError } from '../../errors'
import { type Iteration } from '../types'
import { cloneTokenUsage } from '../util'
import { isLiveNodeStatus, isTerminalNodeStatus } from './node-status'
import { type TeamProgress } from './progress'
import { type LiveTeam, SUBTREE_RESULT_LIMIT, liveTeamReaders } from './scope-capabilities'
import { type LiveChild, type ScopeArgs } from './scope-contract'
import { type Handle, type NodeId, type NodeSnapshot, type ReenteredWorkers, type Scope, type Settled, type SubtreeResult, type SubtreeSummary, type TreeView, type WorkerInteractiveSession, type WorkerInteractiveUnavailableReason } from './types'

/**
 * The direct workers of `parentId` that a resumed journal holds open, and which of them this
 * process re-places through a retained recovery. One function, so the root's `root-reentered`
 * record and its first re-entered drive cannot disagree.
 */
export function reenteredWorkers(
  resumeFrom: NonNullable<ScopeArgs['resumeFrom']>,
  parentId: NodeId,
): ReenteredWorkers {
  const live = resumeFrom.view.nodes
    .filter((node) => node.parent === parentId && isLiveNodeStatus(node.status))
    .map((node) => node.id)
  const recovering = new Set((resumeFrom.recoveries ?? []).map((recovery) => recovery.spawned.id))
  return { live, replaced: live.filter((id) => recovering.has(id)) }
}

/**
 * The step-8 merge-boundary adapter (M4): rehydrate a `Settled.done` into the kernel's
 * `Iteration` shape so `defaultSelectWinner` stays single-sourced — the supervisor selects
 * across settled children with the SAME argmax the loop kernel uses, not a forked copy.
 *
 * `index` is the cursor `seq` (the recorded, replay-stable order); `output`/`verdict`/
 * `tokenUsage`/`costUsd` are read straight off the settlement (already rehydrated from the
 * `outRef` blob by `next()`). Events are empty — a settled child is an opaque leaf result,
 * not a sandbox event stream — and the timing/cost fields project its conserved `Spend`.
 * Fail loud on a `down` settlement: only a `done` child is an iteration.
 */
export function settledToIteration<Out>(settled: Settled<Out>): Iteration<unknown, Out> {
  if (settled.kind === 'down') {
    throw new ValidationError(
      `settledToIteration: cannot adapt a 'down' settlement (node '${settled.handle.id}', seq ${settled.seq}) to an Iteration`,
    )
  }
  return {
    index: settled.seq,
    task: undefined,
    agentRunName: settled.handle.label,
    output: settled.out,
    ...(settled.verdict ? { verdict: settled.verdict } : {}),
    events: [],
    startedAt: 0,
    endedAt: settled.spent.ms,
    costUsd: settled.spent.usd,
    tokenUsage: cloneTokenUsage(settled.spent.tokens),
  }
}


/** The live team a child manager leads, read through the nested scope it owns. */
export function liveTeamOf(child: LiveChild): LiveTeam | undefined {
  let nested: Scope<unknown> | undefined
  try {
    nested = child.readNestedScope?.()
  } catch {
    return undefined
  }
  return nested === undefined ? undefined : liveTeamReaders.get(nested)?.()
}

export function teamProgress(team: LiveTeam): TeamProgress {
  const { lastActivityAt: _lastActivityAt, ownerTurns: _ownerTurns, ...counts } = team
  return Object.freeze(counts)
}

/** Latest activity an executor names, or 0. A throwing read is no evidence of activity. */
function executorActivityAt(child: LiveChild): number {
  try {
    const recent = child.readProgress?.()?.recentActivity
    return recent?.length ? (recent[recent.length - 1]?.at ?? 0) : 0
  } catch {
    return 0
  }
}

/** Count a scope's team at every depth and find its newest activity. Live members are read through
 *  their own nested scopes; settled members contribute the summary their settlement carried. */
export function readLiveTeam(
  children: Iterable<LiveChild>,
  ownerTurns: number,
  ownerLastTurnAt: number,
): LiveTeam {
  let agents = 0
  let depth = 0
  let working = 0
  let queued = 0
  let done = 0
  let down = 0
  let lastActivityAt = ownerLastTurnAt
  for (const child of children) {
    agents += 1
    lastActivityAt = Math.max(
      lastActivityAt,
      child.lastActivityAt,
      child.settledAt ?? 0,
      executorActivityAt(child),
    )
    if (child.status === 'done') done += 1
    else if (child.status === 'failed' || child.status === 'cancelled') down += 1
    else if (child.status === 'queued' || child.status === 'pending') queued += 1
    else working += 1
    const below = isTerminalNodeStatus(child.status) ? child.subtree : liveTeamOf(child)
    if (below === undefined || below.agents === 0) continue
    agents += below.agents
    depth = Math.max(depth, below.depth)
    done += below.done
    down += below.down
    if ('working' in below) {
      working += below.working
      queued += below.queued
      lastActivityAt = Math.max(lastActivityAt, below.lastActivityAt)
    }
  }
  return {
    agents,
    depth: agents === 0 ? 0 : depth + 1,
    working,
    queued,
    done,
    down,
    lastActivityAt,
    ownerTurns,
  }
}

export function summarizeTeam(children: Iterable<LiveChild>): SubtreeSummary | undefined {
  let agents = 0
  let depth = 0
  let done = 0
  let down = 0
  let members = 0
  const results: Array<SubtreeResult & { readonly order: number }> = []
  for (const child of children) {
    members += 1
    const below = child.subtree
    agents += 1 + (below?.agents ?? 0)
    depth = Math.max(depth, 1 + (below?.depth ?? 0))
    done += below?.done ?? 0
    down += below?.down ?? 0
    const status =
      child.status === 'done'
        ? 'done'
        : child.status === 'failed' || child.status === 'cancelled'
          ? 'down'
          : undefined
    if (status === undefined) continue
    if (status === 'done') done += 1
    else down += 1
    const score =
      child.resolved?.kind === 'done' ? child.resolved.verdict?.score : (undefined as undefined)
    results.push({
      id: child.id,
      label: child.label,
      status,
      ...(child.outRef === undefined ? {} : { outRef: child.outRef }),
      ...(score === undefined ? {} : { score }),
      agents: below?.agents ?? 0,
      order: child.settledSeq ?? Number.MAX_SAFE_INTEGER,
    })
  }
  if (members === 0) return undefined
  results.sort(
    (a, b) =>
      (a.status === b.status ? 0 : a.status === 'done' ? -1 : 1) ||
      (b.score ?? Number.NEGATIVE_INFINITY) - (a.score ?? Number.NEGATIVE_INFINITY) ||
      a.order - b.order,
  )
  const listed = results
    .slice(0, SUBTREE_RESULT_LIMIT)
    .map(({ order: _order, ...result }) => Object.freeze(result))
  return Object.freeze({
    agents,
    depth,
    done,
    down,
    results: Object.freeze(listed),
    omitted: members - listed.length,
  })
}

export function makeTreeView(root: NodeId, children: Map<NodeId, LiveChild>): TreeView {
  const nodes: NodeSnapshot[] = [...children.values()].map((c) => ({
    id: c.id,
    parent: root,
    label: c.label,
    status: c.status,
    runtime: c.runtime,
    budget: c.budget,
    ...(c.ownedTreeRoot === undefined ? {} : { ownedTreeRoot: c.ownedTreeRoot }),
    ...(c.assignmentId === undefined ? {} : { assignmentId: c.assignmentId }),
    ...(c.identity ? { identity: c.identity } : {}),
    ...(c.modelSubstitution ? { modelSubstitution: c.modelSubstitution } : {}),
    ...(c.materialization ? { materialization: c.materialization } : {}),
    ...(c.executionBindings.length > 0
      ? { executionBindings: Object.freeze([...c.executionBindings]) }
      : {}),
    spent: c.spent,
    // Finished but not yet drained: `resolved` is set the moment the executor's promise settles
    // (spawn's `.then` above), while `status` flips only inside `next()`. Surface the window.
    ...(c.resolved !== undefined && !c.delivered
      ? { settlementPending: { kind: c.resolved.kind } }
      : {}),
    ...(c.settledAt === undefined ? {} : { settledAt: c.settledAt }),
    ...(c.outRef ? { outRef: c.outRef } : {}),
    ...(c.trace ? { trace: c.trace } : {}),
    ...(c.providerModel ? { providerModel: c.providerModel } : {}),
    ...(c.budgetViolation ? { budgetViolation: c.budgetViolation } : {}),
    ...(c.retainedExecution ? { retainedExecution: c.retainedExecution } : {}),
    ...(c.retainedPendingCause ? { retainedPendingCause: c.retainedPendingCause } : {}),
  }))
  return {
    root,
    nodes,
    inFlight: nodes.filter(
      (n) => n.status === 'running' || n.status === 'acquiring' || n.status === 'queued',
    ).length,
  }
}

export function frozenHandle<C>(child: LiveChild): Handle<C> {
  return {
    id: child.id,
    label: child.label,
    status: child.status,
    ...(child.assignmentId === undefined ? {} : { assignmentId: child.assignmentId }),
    ...(child.identity ? { identity: child.identity } : {}),
    ...(child.modelSubstitution ? { modelSubstitution: child.modelSubstitution } : {}),
    ...(child.materialization ? { materialization: child.materialization } : {}),
    ...(child.executionBindings.length > 0
      ? { executionBindings: Object.freeze([...child.executionBindings]) }
      : {}),
    abort(): void {
      // A settled child is terminal; abort is a no-op (its executor already tore down).
    },
  }
}

/** The one place an absent interactive process is spelled, so every refusal reads the same. */
export function noInteractiveSession(
  reason: WorkerInteractiveUnavailableReason,
): WorkerInteractiveSession {
  return Object.freeze({ status: 'unavailable' as const, reason })
}

/** Read one executor's declared interactive capability without letting a malformed port escape. */
export function readInteractiveSession(child: LiveChild): WorkerInteractiveSession {
  if (!child.readInteractive) {
    return noInteractiveSession('executor-exposes-no-interactive-session')
  }
  let reported: WorkerInteractiveSession
  try {
    reported = child.readInteractive()
  } catch {
    return noInteractiveSession('executor-exposes-no-interactive-session')
  }
  if (reported?.status === 'unavailable' && reported.reason) return reported
  if (reported?.status === 'available' && reported.handle) return reported
  return noInteractiveSession('executor-exposes-no-interactive-session')
}

/** Stop waiting for optional readiness when the worker settles or its lifetime is cancelled. */
export async function readInteractiveReadyUntilWorkerEnds(
  readReady: () => Promise<WorkerInteractiveSession>,
  workerEnded: Promise<unknown>,
  signal: AbortSignal,
): Promise<WorkerInteractiveSession | undefined> {
  if (signal.aborted) return undefined
  let resolveAborted!: () => void
  const aborted = new Promise<void>((resolve) => {
    resolveAborted = resolve
  })
  const onAbort = () => resolveAborted()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const outcome = await Promise.race([
      Promise.resolve()
        .then(readReady)
        .then((session) => ({ kind: 'ready' as const, session })),
      workerEnded.then(
        () => ({ kind: 'ended' as const }),
        () => ({ kind: 'ended' as const }),
      ),
      aborted.then(() => ({ kind: 'ended' as const })),
    ])
    return outcome.kind === 'ready' ? outcome.session : undefined
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}
