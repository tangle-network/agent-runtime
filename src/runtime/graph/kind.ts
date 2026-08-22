/**
 * `NodeKind` — what a consumer registers to add a node kind to the graph engine without forking
 * it (agent-runtime#969, #970).
 *
 * The engine owns the graph: scheduling over typed data edges, guards, joins, cycles, the
 * conserved pool, the journal. It does NOT own execution — `run` returns an `Agent`, the
 * kernel's spawn contract (`Scope.spawn` takes an `Agent { name, act }`; a leaf `Agent` carries its
 * `Executor` as `executorSpec: AgentSpec`, and a supervisor `Agent` is `supervisorAgent(...)`). So
 * every node rides `supervise()`'s machinery unchanged: the pool's reserve/reconcile, the
 * content-addressed journal, the completion gate, `Settled`, trace evidence. An engine that
 * re-implemented any of those would be a second kernel.
 *
 * Every kernel-owned extension contract is a TS interface plus a hand-written validator that
 * throws `ValidationError` by name (the kernel has no zod), and this one follows suit. JSON Schema
 * is the PORTABLE form of a config/port shape — a `Record<string, unknown>`, as `McpToolDescriptor`
 * and `DeliveryBinding` already spell it — so a kind's declaration can be published in a manifest
 * and lifted by a host on another stack.
 *
 * The bar this file is measured against: the scheduler's source names no kind that is not
 * universal. A kind the engine ships (`agent`, `supervisor`, `subgraph`, `script`) is universal by
 * the rule "the model cannot decide it with the verbs it has"; everything else — integrations,
 * notifications, sandbox provisioning, human decisions — is registered by a host.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type { WorkerSpawnContext } from '../../mcp/tools/coordination'
import type { Agent } from '../supervise/types'
import type { Registered, RegistryHandle } from './registry'

/** A JSON Schema document as the kernel already spells it: an opaque record, validated by the
 *  consumer's own validator, published verbatim. */
export type JsonSchema = Readonly<Record<string, unknown>>

/**
 * One declared port on a node. Ports are how a `data` edge binds one node's output to another's
 * input with a type the compiler can check structurally before any spend. A node has two implicit
 * output ports beside its declared ones: `out` (its result) and `trace` (its `WorkerTraceEvidence`
 * by `traceRef`); only an `analyzes` edge may bind `trace`.
 */
export interface PortSpec {
  readonly name: string
  readonly schema: JsonSchema
  readonly description?: string
}

/**
 * What a kind declares it needs from the host. The engine never imports a host capability; it
 * knows only that a kind SAID it needs something under this name and the host PROVIDED something
 * under it. The context a kind receives is narrowed to exactly its declaration — an undeclared
 * effect is `undefined`, never a service locator.
 */
/** What a nesting kind needs from its host: run one graph, on the host's own kinds and effects.
 *  Declared here (not imported from the scheduler) so the contract module stays dependency-free. */
export interface GraphHost {
  runNested(
    graph: unknown,
    task: string,
    options: {
      readonly budget: unknown
      readonly perNode?: unknown
      readonly runId: string
      readonly signal?: AbortSignal
    },
  ): Promise<{ readonly kind: string; readonly out?: unknown }>
}

export type EffectName = string

export type EffectContext<Effects extends ReadonlyArray<EffectName>> = Readonly<{
  [K in Effects[number]]: unknown
}>

/**
 * What happens to a node that was IN FLIGHT when the process died. A settled node is never a
 * per-kind choice — it restores from its content-addressed `outRef` on replay. `'restart'` re-runs
 * from the journaled `inputRef`; `'resume'` is legal only for a kind whose executor can re-attach
 * to the live process (the bridge backend's session re-attachment is the existing instance).
 */
export type OnCrash = 'restart' | 'resume'

/**
 * Whether a kind's spend enters the conserved pool. `'metered'`: the executor reports `Spend` and
 * settling without one is an ENGINE ERROR — never "free". `'exempt'`: the whole reservation is
 * refunded on settle, keeping the node out of Σk by construction (the kernel's `budgetExempt`).
 */
export type BudgetMode = 'metered' | 'exempt'

/** The validated declaration every kind provides. `Config` is the per-node config shape;
 *  `Effects` is the tuple of host capabilities it declares, so the context `run` receives is typed
 *  to exactly that tuple. */
export interface NodeKind<
  Config = unknown,
  Effects extends ReadonlyArray<EffectName> = ReadonlyArray<EffectName>,
> extends Registered {
  /** Kind id, e.g. `agent`, `integration.invoke`. With `version`, forms the handle `<id>/v<n>`. */
  readonly id: string
  readonly version: number
  readonly description: string
  /** Validate and narrow one node's config. Throw `ValidationError` to refuse; the compiler
   *  surfaces the message with the node id prefixed. */
  readonly validateConfig: (raw: unknown, context: string) => Config
  /** The portable form of `validateConfig`'s accepted shape, for manifests and hosts. */
  readonly configSchema: JsonSchema
  /** Declared input ports; a `data` edge may bind only these. Empty for a source node. */
  readonly inputs: ReadonlyArray<PortSpec>
  /** Declared output ports beside the implicit `out` and `trace`. */
  readonly outputs: ReadonlyArray<PortSpec>
  /** Host capabilities this kind reaches for, by name. The context is narrowed to exactly these. */
  readonly effects: Effects
  readonly onCrash: OnCrash
  readonly budget: BudgetMode
  /**
   * Build the agent for one node instance. The kernel spawns it under `Scope.spawn`, so it is
   * authorized, classified, journaled, pooled and gated like any child — the kind owns only what
   * the agent DOES. `profile` is the node's pinned profile (an `agent`/`supervisor` kind runs it;
   * a `script` kind may ignore it); `inputs` are the resolved, content-addressed port values;
   * `effects` is the narrowed host context; `spawn` is the kernel's per-spawn context when the
   * kind needs it (a supervisor kind threads it into `nodeContext`).
   */
  readonly run: (args: {
    readonly config: Config
    readonly profile: AgentProfile
    readonly inputs: Readonly<Record<string, unknown>>
    readonly effects: EffectContext<Effects>
    readonly spawn?: WorkerSpawnContext
    /** The engine hosting this node, for a kind that runs a graph of its own (`subgraph`). The
     *  scheduler supplies it; a kind that does not nest ignores it. */
    readonly host?: GraphHost
  }) => Agent<unknown, unknown>
}

/**
 * A kind of ANY config shape — what a registry holds and what every engine signature accepts.
 *
 * `NodeKind<Config>` puts `Config` in a parameter position (`run({ config })`), so it is
 * contravariant: an array of differently-configured kinds is not assignable to
 * `ReadonlyArray<NodeKind<unknown>>`, and every caller composing a heterogeneous kind set would
 * need a cast. That cost belongs here, once, not at each consumer: a registry is heterogeneous by
 * definition, and each kind validates its own config at its own boundary through
 * `validateConfig`, which is where the type is actually enforced.
 */
export type AnyNodeKind = NodeKind<any, ReadonlyArray<EffectName>>

/** Per-node flags a graph author sets; they are node properties, not kinds (agent-runtime#970). */
export interface NodeFlags {
  /** An oracle — a judge, grader, auditor, trace analyst — may be bound only by an `analyzes`
   *  edge. The compiler refuses a `delegates` or `data` edge INTO an oracle: an edge to a grader
   *  leaks the rubric. */
  readonly oracle?: boolean
  /** `script` only: pure over `(config, inputs)` ⇒ budget exempt, output restorable on replay,
   *  runs in-process. A pure script that settles with a different `outRef` for the same inputs
   *  has lied, and the first replay mismatch is an engine error. */
  readonly pure?: boolean
}

/** Validate a kind declaration at registration — so a malformed kind is refused by name once,
 *  not at the first node that uses it. */
export function validateNodeKind(kind: AnyNodeKind, context = 'registerNodeKind'): AnyNodeKind {
  const who = `${context}: kind ${JSON.stringify(`${kind.id}/v${kind.version}`)}`
  if (typeof kind.id !== 'string' || kind.id.length === 0) {
    throw new ValidationError(`${context}: a kind must carry a non-empty id`)
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(kind.id)) {
    throw new ValidationError(`${who}: id may contain only letters, digits, ".", "_" and "-"`)
  }
  if (!Number.isSafeInteger(kind.version) || kind.version < 1) {
    throw new ValidationError(`${who}: version must be a positive integer`)
  }
  if (typeof kind.description !== 'string' || kind.description.trim().length === 0) {
    throw new ValidationError(`${who}: description is required`)
  }
  if (typeof kind.validateConfig !== 'function') {
    throw new ValidationError(`${who}: validateConfig must be a function`)
  }
  if (!isRecord(kind.configSchema)) {
    throw new ValidationError(`${who}: configSchema must be a JSON Schema object`)
  }
  for (const [field, ports] of [
    ['inputs', kind.inputs],
    ['outputs', kind.outputs],
  ] as const) {
    if (!Array.isArray(ports)) throw new ValidationError(`${who}: ${field} must be an array`)
    const seen = new Set<string>()
    for (const port of ports) {
      if (!port || typeof port.name !== 'string' || port.name.length === 0) {
        throw new ValidationError(`${who}: every ${field} port needs a non-empty name`)
      }
      if (field === 'outputs' && (port.name === 'out' || port.name === 'trace')) {
        throw new ValidationError(
          `${who}: output port ${JSON.stringify(port.name)} is implicit on every node and cannot be declared`,
        )
      }
      if (seen.has(port.name)) {
        throw new ValidationError(`${who}: duplicate ${field} port ${JSON.stringify(port.name)}`)
      }
      seen.add(port.name)
      if (!isRecord(port.schema)) {
        throw new ValidationError(
          `${who}: ${field} port ${JSON.stringify(port.name)} needs a JSON Schema`,
        )
      }
    }
  }
  if (
    !Array.isArray(kind.effects) ||
    kind.effects.some((e) => typeof e !== 'string' || e.length === 0)
  ) {
    throw new ValidationError(`${who}: effects must be an array of non-empty names`)
  }
  if (new Set(kind.effects).size !== kind.effects.length) {
    throw new ValidationError(`${who}: effects must not repeat a name`)
  }
  if (kind.onCrash !== 'restart' && kind.onCrash !== 'resume') {
    throw new ValidationError(`${who}: onCrash must be "restart" or "resume"`)
  }
  if (kind.budget !== 'metered' && kind.budget !== 'exempt') {
    throw new ValidationError(`${who}: budget must be "metered" or "exempt"`)
  }
  if (typeof kind.run !== 'function') {
    throw new ValidationError(`${who}: run must be a function`)
  }
  return kind
}

/** The handle a graph writes to name this kind. */
export function kindHandle(kind: Pick<NodeKind, 'id' | 'version'>): RegistryHandle {
  return { id: kind.id, version: kind.version }
}

/**
 * Narrow a host's effect table to exactly what one kind declared. Anything the kind did not
 * declare is absent — `undefined` on read — so a kind cannot reach past its declaration, and the
 * engine can list a graph's required effects before spending a token.
 */
export function narrowEffects<Effects extends ReadonlyArray<EffectName>>(
  declared: Effects,
  provided: Readonly<Record<string, unknown>>,
  context: string,
): EffectContext<Effects> {
  const out: Record<string, unknown> = {}
  const missing: string[] = []
  for (const name of declared) {
    if (!(name in provided)) {
      missing.push(name)
      continue
    }
    out[name] = provided[name]
  }
  if (missing.length > 0) {
    throw new ValidationError(
      `${context}: host provides no effect for ${missing.map((m) => JSON.stringify(m)).join(', ')}; provided: ${
        Object.keys(provided).sort().join(', ') || 'none'
      }`,
    )
  }
  return Object.freeze(out) as EffectContext<Effects>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
