import { executorFailureReason } from '../../runtime/supervise/executor-outcome'
import { assertValidSpend } from '../../runtime/supervise/spend-validation'
import type { NodeId, SpawnEvent } from '../../runtime/supervise/types'

/** Minimal state needed to validate a node; progress and trace payloads are never retained here. */
interface JournalNodeIndex {
  spawned: boolean
  closed: boolean
  materialized: boolean
  authoredProfileDigest?: string
  latestSeatMaterialization: number
  bindings: Set<string>
  inputs: Set<number>
  input: boolean
  /** The sequence of the latest `execution-input`. */
  latestInput?: number
  result: boolean
  /** The latest invocation was abandoned: nothing of it is accepted, and a new input may follow. */
  abandoned: boolean
  admissions: Map<
    Extract<SpawnEvent, { kind: 'execution-admitted' }>['admission']['phase'],
    Extract<SpawnEvent, { kind: 'execution-admitted' }>['admission']
  >
  /** The environment this node's retained invocations last ran in, across invocations. */
  lastEnvironmentId?: string
  /** Environments that can run no more turns, from teardown or provider terminal observation. */
  unusableEnvironments: Set<string>
}

/**
 * A trace root is valid only beside the output it commits to, with a well-formed root, artifact
 * reference and leaf count (at least the summary leaf). Records written before trace roots carry
 * none and stay valid.
 */
function assertTraceRoot(event: SpawnEvent, root: NodeId): void {
  if (!('traceRoot' in event) || event.traceRoot === undefined) return
  const receipt: unknown = event.traceRoot
  const fields =
    receipt !== null && typeof receipt === 'object' ? (receipt as Record<string, unknown>) : {}
  if (
    typeof event.outRef !== 'string' ||
    typeof fields.root !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(fields.root) ||
    typeof fields.ref !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(fields.ref) ||
    typeof fields.leafCount !== 'number' ||
    !Number.isSafeInteger(fields.leafCount) ||
    fields.leafCount < 1
  ) {
    throw new Error(
      `spawn journal corrupted: ${event.kind} for node '${event.id}' carries a malformed trace root in tree '${root}'`,
    )
  }
}

/** One validation implementation for memory, durable append, and cold replay. */
/** @internal shared with the SQL-backed store. */
export class SpawnEventIndex {
  private readonly nodes = new Map<NodeId, JournalNodeIndex>()
  private readonly cursors = new Set<number>()

  constructor(private readonly root: NodeId) {}

  assert(event: SpawnEvent): void {
    const node = this.nodes.get(event.id)
    this.assertRetained(node, event)
    assertTraceRoot(event, this.root)
    if (event.kind === 'execution-evidence') {
      if (!node?.spawned || !/^sha256:[0-9a-f]{64}$/.test(event.outRef)) {
        throw new Error(
          'spawn journal corrupted: executor evidence has no spawned node or valid content reference',
        )
      }
    }
    if (event.kind === 'materialized') {
      if (node?.materialized) {
        throw new Error(
          `spawn journal corrupted: duplicate materialization receipt for node '${event.id}' in tree '${this.root}'`,
        )
      }
      if (!node?.spawned) {
        throw new Error(
          `spawn journal corrupted: materialization for node '${event.id}' precedes its spawn in tree '${this.root}'`,
        )
      }
    }
    if (event.kind === 'seat-materialized') {
      if (
        !node?.materialized ||
        node.authoredProfileDigest === undefined ||
        event.receipt.status !== 'known' ||
        event.receipt.authoredProfileDigest !== node.authoredProfileDigest ||
        !Number.isSafeInteger(event.segmentIndex) ||
        event.segmentIndex <= node.latestSeatMaterialization
      ) {
        throw new Error(
          `spawn journal corrupted: invalid seat materialization for node '${event.id}' in tree '${this.root}'`,
        )
      }
    }
    if (event.kind === 'execution-bound') {
      if (node?.bindings.has(event.binding.attemptId)) {
        throw new Error(
          `spawn journal corrupted: duplicate execution binding for node '${event.id}' attempt '${event.binding.attemptId}' in tree '${this.root}'`,
        )
      }
      if (!node?.materialized) {
        throw new Error(
          `spawn journal corrupted: execution binding for node '${event.id}' precedes materialization in tree '${this.root}'`,
        )
      }
    }
    if (!outsideCursorNamespace(event) && this.cursors.has(event.seq)) {
      throw new Error(
        `spawn journal corrupted: duplicate cursor seq ${event.seq} in tree '${this.root}'; ` +
          'the cursor order replay relies on is not unique',
      )
    }
  }

  /** Called after validation; a file writer discards staged state if grouped publication fails. */
  add(event: SpawnEvent): void {
    if (!outsideCursorNamespace(event)) this.cursors.add(event.seq)
    if (
      event.kind !== 'spawned' &&
      event.kind !== 'materialized' &&
      event.kind !== 'seat-materialized' &&
      event.kind !== 'execution-bound' &&
      event.kind !== 'execution-input' &&
      event.kind !== 'execution-admitted' &&
      event.kind !== 'execution-result' &&
      event.kind !== 'execution-abandoned' &&
      event.kind !== 'environment-teardown' &&
      event.kind !== 'environment-terminal' &&
      !closesCursorSlot(event)
    )
      return
    let node = this.nodes.get(event.id)
    if (!node) {
      node = {
        spawned: false,
        closed: false,
        materialized: false,
        latestSeatMaterialization: 0,
        bindings: new Set(),
        inputs: new Set(),
        input: false,
        result: false,
        abandoned: false,
        admissions: new Map(),
        unusableEnvironments: new Set(),
      }
      this.nodes.set(event.id, node)
    }
    if (event.kind === 'environment-teardown') {
      if (event.destroyed) node.unusableEnvironments.add(event.environmentId)
      return
    }
    if (event.kind === 'environment-terminal') {
      node.unusableEnvironments.add(event.environmentId)
      return
    }
    if (event.kind === 'execution-admitted' && event.admission.phase === 'environment') {
      node.lastEnvironmentId = event.admission.environmentId
    }
    if (event.kind === 'spawned') node.spawned = true
    else if (event.kind === 'materialized') {
      node.materialized = true
      node.authoredProfileDigest = event.receipt.authoredProfileDigest
    } else if (event.kind === 'seat-materialized')
      node.latestSeatMaterialization = event.segmentIndex
    else if (event.kind === 'execution-bound') node.bindings.add(event.binding.attemptId)
    else if (event.kind === 'execution-input') {
      node.inputs.add(event.seq)
      node.input = true
      node.latestInput = event.seq
      node.result = false
      node.abandoned = false
      node.admissions.clear()
    } else if (event.kind === 'execution-admitted') {
      node.admissions.set(event.admission.phase, event.admission)
    } else if (event.kind === 'execution-result') node.result = true
    else if (event.kind === 'execution-abandoned') node.abandoned = true
    if (closesCursorSlot(event)) node.closed = true
  }

  private assertRetained(node: JournalNodeIndex | undefined, event: SpawnEvent): void {
    if (
      event.kind !== 'execution-input' &&
      event.kind !== 'execution-admitted' &&
      event.kind !== 'execution-result' &&
      event.kind !== 'execution-abandoned'
    )
      return
    function fail(reason: string): never {
      throw new Error(`spawn journal corrupted: retained execution '${event.id}' ${reason}`)
    }
    if (!node?.spawned) fail('precedes its spawn')
    if (node.closed) fail('follows its terminal settlement')
    if (event.kind === 'execution-input') {
      if (!/^sha256:[0-9a-f]{64}$/.test(event.taskRef)) fail('has an invalid task reference')
      if (node.inputs.has(event.seq)) fail('has duplicate input sequence')
      // An unfinished invocation may be replaced only once its environment is gone, the provider
      // reports its compute terminal, or Runtime abandoned it: then nothing of the old turn can
      // be accepted, because every later admission or result of it is refused below.
      const environment = node.admissions.get('environment')
      const ranIn =
        environment?.phase === 'environment' ? environment.environmentId : node.lastEnvironmentId
      const closed = node.abandoned || (ranIn !== undefined && node.unusableEnvironments.has(ranIn))
      if (node.input && !node.result && !closed) fail('input replaces an unfinished invocation')
      return
    }
    if (event.kind === 'execution-abandoned') {
      if (!node.input || node.latestInput !== event.inputSeq)
        fail('abandons an invocation that is not its latest')
      if (node.result) fail('abandons an invocation that has a result')
      if (node.abandoned) fail('abandons an invocation twice')
      if (!Number.isSafeInteger(event.failures) || event.failures < 1)
        fail('abandons without a failure count')
      return
    }
    // Nothing of an abandoned invocation is accepted: its replacement is the only invocation.
    if (node.abandoned) fail(`${event.kind} follows its abandonment`)
    if (event.kind === 'execution-result') {
      if (node.result) fail('has duplicate result')
      if (!node.admissions.has('dispatched')) fail('result precedes dispatch')
      if (!/^sha256:[0-9a-f]{64}$/.test(event.outRef)) fail('has an invalid result reference')
      if (event.outputFormat !== undefined && event.outputFormat !== 'json')
        fail('has an invalid output format')
      assertValidSpend(event.spent, 'retained execution result')
      executorFailureReason(event)
      return
    }
    const admission = event.admission
    if (!admission || !['intent', 'environment', 'dispatched'].includes(admission.phase))
      fail('has an invalid admission phase')
    if (node.admissions.has(admission.phase)) fail('has duplicate admission phase')
    if (node.result) fail('admission follows result')
    if (!node.input) fail('admission precedes input')
    if (admission.phase === 'intent') {
      if (node.admissions.size !== 0) fail('intent follows another admission')
      return
    }
    const intent = node.admissions.get('intent')
    if (intent?.phase !== 'intent') fail('admission precedes intent')
    if (admission.idempotencyKey !== intent.idempotencyKey || admission.turnId !== intent.turnId)
      fail('changes its admitted request identity')
    if (admission.phase === 'environment') {
      if (
        admission.provider !== intent.provider ||
        admission.sessionId !== intent.sessionId ||
        admission.executionId !== intent.executionId
      )
        fail('changes its admitted execution identity')
      return
    }
    const environment = node.admissions.get('environment')
    if (environment?.phase !== 'environment') fail('dispatch precedes environment')
    const control = admission.controlRef
    if (
      !control ||
      control.provider !== intent.provider ||
      control.environmentId !== environment.environmentId ||
      control.sessionId !== intent.sessionId ||
      control.executionId !== intent.executionId
    )
      fail('dispatch changes its admitted execution identity')
  }
}

/**
 * The records that CLOSE a node's cursor slot: a settlement or a cancellation. The complement question to {@link outsideCursorNamespace}, and the one a resume needs —
 * a kind missing here leaves a finished node looking live, so its budget is never reclaimed and
 * its reservation is replayed as still in doubt.
 */
export function closesCursorSlot(ev: SpawnEvent): boolean {
  return ev.kind === 'settled' || ev.kind === 'cancelled'
}

/**
 * The kinds that sit OUTSIDE the cursor namespace: node-CREATION and informational records. The
 * cursor namespace is the one whose per-node uniqueness replay ordering rests on, so every side of
 * that guard reads this one list — the seq guard, `materializeTreeView`'s settlement split, and
 * `trajectory`'s close list.
 *
 * Declared once as data. `SpawnEvent` is a discriminated union, so the complement below is
 * COMPUTED rather than hand-written: a twelfth kind lands in the cursor namespace by construction
 * instead of by whichever copies its author remembered to update.
 */
const outsideCursorNamespaceKinds = [
  'spawned',
  'metered',
  'materialized',
  'execution-bound',
  'execution-input',
  'execution-admitted',
  'execution-result',
  'execution-abandoned',
  'execution-evidence',
  'evidence-pending',
  'progress',
  'reconciled',
  'edge',
  'teardown-unconfirmed',
  'teardown-pending',
  'teardown-confirmed',
  'environment-teardown',
  'environment-terminal',
  'workspace-checkpoint-requested',
  'workspace-checkpoint',
  'workspace-checkpoint-fork-requested',
  'workspace-checkpoint-fork-ready',
  'workspace-checkpoint-fork-teardown',
  'workspace-checkpoint-capture',
  'workspace-checkpoint-cleanup',
  'workspace-restored',
  'workspace-capture-started',
  'workspace-capture',
  'trace-unpropagated',
  'seat-segment',
  'seat-materialized',
  'seat-paused',
  'run-parked',
  'root-segment',
  'root-reentered',
  'reopened',
  'paused',
  'barren-pause',
  'driver-attempt',
  'node-inputs-resolved',
  'edge-verdict',
  'join-state',
] as const satisfies ReadonlyArray<SpawnEvent['kind']>

type OutsideCursorNamespaceKind = (typeof outsideCursorNamespaceKinds)[number]

/** A record that closes or advances a node's cursor slot — the complement of
 *  {@link outsideCursorNamespace}, computed from the union rather than restated. */
type CursorNamespaceEvent = Exclude<SpawnEvent, { kind: OutsideCursorNamespaceKind }>

const outsideKinds: ReadonlySet<string> = new Set<string>(outsideCursorNamespaceKinds)

/** True for a node-CREATION or informational record. Narrows, so a caller keeps the union's arms. */
export function outsideCursorNamespace(
  ev: SpawnEvent,
): ev is Extract<SpawnEvent, { kind: OutsideCursorNamespaceKind }> {
  return outsideKinds.has(ev.kind)
}

/** True for a record inside the cursor namespace. Narrows to {@link CursorNamespaceEvent}. */
export function insideCursorNamespace(ev: SpawnEvent): ev is CursorNamespaceEvent {
  return !outsideKinds.has(ev.kind)
}
