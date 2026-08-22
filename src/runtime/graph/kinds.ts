/**
 * The four core node kinds (agent-runtime#970) — the ones universal by the rule "the model cannot
 * decide it with the verbs it has". Everything else (integrations, notifications, sandbox
 * provisioning, human decisions) is registered by a host against the same `NodeKind` contract.
 *
 * Each `run` returns an `Agent` the kernel spawns under `Scope.spawn`; none of these re-implements
 * pooling, journaling, gating or identity. `agent` and `supervisor` are thin wraps over the
 * kernel's own factories; `script` is the one kind with no kernel primitive behind it; `subgraph`
 * is the scheduler's and is refused here until the scheduler lands (#980).
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { contentAddress } from '../../durable/content-address'
import { ValidationError } from '../../errors'
import type { MakeWorkerAgent } from '../../mcp/tools/coordination'
import type { DeliverableSpec } from '../supervise/completion-gate'
import type { ExecutorConfig } from '../supervise/runtime'
import { workerFromBackend } from '../supervise/supervise'
import { type SupervisorAgentDeps, supervisorAgent } from '../supervise/supervisor-agent'
import type { Agent, AgentSpec, Executor, ExecutorResult, Spend } from '../supervise/types'
import type { NodeKind } from './kind'
import { formatRegistryHandle, type RegistryHandle } from './registry'

// ── agent ───────────────────────────────────────────────────────────────────────

export interface AgentKindConfig {
  /** Where this node's profile runs. Omit to inherit the engine's default backend. */
  readonly backend?: ExecutorConfig
  /** This node's completion check. Omit to inherit the graph's terminal check. */
  readonly deliverable?: DeliverableSpec<unknown>
}

/**
 * One profile, one run: the kernel's leaf, exactly as `supervise()` derives it from `backend`.
 * The model cannot decide this — it is what gets run.
 */
export function agentKind(defaults: {
  readonly backend?: ExecutorConfig
  readonly deliverable?: DeliverableSpec<unknown>
}): NodeKind<AgentKindConfig> {
  return {
    id: 'agent',
    version: 1,
    description: 'One AgentProfile run as a leaf on a backend; the kernel derives the executor.',
    validateConfig: (raw, context) => {
      const config = asRecord(raw, `${context}: agent config`)
      return {
        ...(config.backend !== undefined ? { backend: config.backend as ExecutorConfig } : {}),
        ...(config.deliverable !== undefined
          ? { deliverable: config.deliverable as DeliverableSpec<unknown> }
          : {}),
      }
    },
    configSchema: {
      type: 'object',
      properties: { backend: { type: 'object' }, deliverable: { type: 'object' } },
      additionalProperties: false,
    },
    inputs: [],
    outputs: [],
    effects: [],
    onCrash: 'restart',
    budget: 'metered',
    run: ({ config, profile, spawn }) => {
      const backend = config.backend ?? defaults.backend
      if (!backend) {
        throw new ValidationError(
          `agent kind: node ${JSON.stringify(profile.name)} has no backend — set config.backend or the engine default`,
        )
      }
      const make: MakeWorkerAgent = workerFromBackend(
        backend,
        config.deliverable ?? defaults.deliverable,
      )
      return make(profile, spawn)
    },
  }
}

// ── supervisor ──────────────────────────────────────────────────────────────────

export interface SupervisorKindConfig {
  /** Per-child budget reserved from the pool on each spawn this supervisor makes. */
  readonly perWorker: SupervisorAgentDeps['perWorker']
  readonly maxLiveWorkers?: number
}

/**
 * The thing that DECIDES: a nested `supervisorAgent` with the coordination verbs. Its children
 * are its own tree — the graph sees one node in, one `Settled` out. A `subgraph` constrains what
 * it may spawn; without one it is free-form under `profileSecurity` and `allowedModels`.
 */
export function supervisorKind(deps: {
  readonly blobs: SupervisorAgentDeps['blobs']
  readonly makeWorkerAgent: MakeWorkerAgent
  readonly router?: SupervisorAgentDeps['router']
  readonly driveHarness?: SupervisorAgentDeps['driveHarness']
}): NodeKind<SupervisorKindConfig> {
  return {
    id: 'supervisor',
    version: 1,
    description:
      'A nested supervisor: spawns, observes, steers and awaits its own children with the coordination verbs.',
    validateConfig: (raw, context) => {
      const config = asRecord(raw, `${context}: supervisor config`)
      const perWorker = asRecord(config.perWorker, `${context}: supervisor config.perWorker`)
      return {
        perWorker: perWorker as unknown as SupervisorKindConfig['perWorker'],
        ...(config.maxLiveWorkers !== undefined
          ? { maxLiveWorkers: Number(config.maxLiveWorkers) }
          : {}),
      }
    },
    configSchema: {
      type: 'object',
      properties: { perWorker: { type: 'object' }, maxLiveWorkers: { type: 'integer' } },
      required: ['perWorker'],
      additionalProperties: false,
    },
    inputs: [],
    outputs: [],
    effects: [],
    onCrash: 'restart',
    budget: 'metered',
    run: ({ config, profile }) =>
      supervisorAgent(profile, {
        blobs: deps.blobs,
        makeWorkerAgent: deps.makeWorkerAgent,
        perWorker: config.perWorker,
        ...(config.maxLiveWorkers !== undefined ? { maxLiveWorkers: config.maxLiveWorkers } : {}),
        ...(deps.router ? { router: deps.router } : {}),
        ...(deps.driveHarness ? { driveHarness: deps.driveHarness } : {}),
      }),
  }
}

// ── script ──────────────────────────────────────────────────────────────────────

/** The caller code a `script` node runs. Receives the resolved inputs; returns the output. */
export type ScriptBody = (
  inputs: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
) => Promise<unknown> | unknown

export interface ScriptKindConfig {
  readonly body: ScriptBody
  /**
   * `pure: true` is the promise that the output is a function of `(config, inputs)` alone: the
   * node is then budget-exempt, its output restorable on replay by content address, and it runs
   * in-process. A pure script that settles with a different `outRef` for the same inputs has
   * lied, and the first replay mismatch is an engine error.
   */
  readonly pure?: boolean
  /** For a metered script: what it spent. Omit on a pure script. A metered script that reports
   *  nothing is metered as NOTHING-KNOWN, never as free. */
  readonly spent?: Spend
}

/** The script kind's handle; it also names the kind in every script node's identity. */
const SCRIPT: RegistryHandle = { id: 'script', version: 1 }

/**
 * Caller code as a node. The one kind with no kernel primitive behind it: the kernel has no
 * "data→data with no execution" concept (agent-runtime#970 fact-finding), so this is new. It is
 * still a leaf `Agent` carrying an `Executor`, so the journal, the gate and the pool treat it like
 * any other node.
 */
export function scriptKind(): NodeKind<ScriptKindConfig> {
  return {
    ...SCRIPT,
    description:
      'Run caller code over the resolved inputs; pure scripts are exempt and restorable.',
    validateConfig: (raw, context) => {
      const config = asRecord(raw, `${context}: script config`)
      if (typeof config.body !== 'function') {
        throw new ValidationError(`${context}: script config.body must be a function`)
      }
      if (config.pure !== undefined && typeof config.pure !== 'boolean') {
        throw new ValidationError(`${context}: script config.pure must be a boolean`)
      }
      if (config.pure === true && config.spent !== undefined) {
        throw new ValidationError(
          `${context}: a pure script is budget-exempt and cannot report spent`,
        )
      }
      return {
        body: config.body as ScriptBody,
        ...(config.pure !== undefined ? { pure: config.pure } : {}),
        ...(config.spent !== undefined ? { spent: config.spent as Spend } : {}),
      }
    },
    configSchema: {
      type: 'object',
      properties: { pure: { type: 'boolean' }, spent: { type: 'object' } },
      // `body` is a function and has no JSON form; a host that lifts `script` supplies its own
      // executable reference (ADC: a module in a sandbox) under this same kind id.
      additionalProperties: true,
    },
    inputs: [],
    outputs: [],
    effects: [],
    onCrash: 'restart',
    budget: 'metered',
    run: ({ config, profile, inputs }) => scriptAgent(profile, config, inputs, SCRIPT),
  }
}

function scriptAgent(
  profile: AgentProfile,
  config: ScriptKindConfig,
  inputs: Readonly<Record<string, unknown>>,
  kind: RegistryHandle,
): Agent<unknown, unknown> & { executorSpec: AgentSpec } {
  let artifact: ExecutorResult<unknown> | undefined
  const executor: Executor<unknown> = {
    runtime: 'inline',
    // A pure script spends nothing from the pool by construction; the kernel refunds its whole
    // reservation. A metered script with no `spent` is NOT free: it is recorded as unknown.
    ...(config.pure ? { budgetExempt: true } : {}),
    async execute(_task, signal): Promise<ExecutorResult<unknown>> {
      const startedAt = Date.now()
      const out = await config.body(inputs, signal)
      const ms = Date.now() - startedAt
      // Exempt means zero spend on every pool channel, iterations included; only the wall clock is
      // reported, and it is not a pool channel.
      const spent: Spend = config.pure
        ? { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms }
        : (config.spent ?? {
            iterations: 1,
            tokens: { input: 0, output: 0, tokensKnown: false },
            tokensKnown: false,
            usd: 0,
            usdKnown: false,
            ms,
          })
      artifact = { outRef: contentAddress(out), out, spent }
      return artifact
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact(): ExecutorResult<unknown> {
      if (!artifact) throw new ValidationError('script: resultArtifact() read before execute()')
      return artifact
    },
  }
  // The profile names the node; the kind is the behavioral authority, so it joins the node's
  // identity here. A script claims no harness or model: nothing runs one.
  const spec: AgentSpec = {
    profile,
    harness: null,
    executor,
    execution: { correlation: { nodeKind: formatRegistryHandle(kind) } },
  }
  return {
    name: profile.name ?? 'script',
    // `act` is never the path: Scope reads `executorSpec` and runs the executor itself.
    act: () => Promise.reject(new ValidationError('script: act() is not the execution path')),
    executorSpec: spec,
  }
}

// ── subgraph ────────────────────────────────────────────────────────────────────

/**
 * A node carrying its own graph: the constraint on what a supervisor may spawn at depth>1. Its
 * executor is a nested engine run; that needs the scheduler (#980), so until then this kind is
 * registered and REFUSES at run time by name rather than being absent — a graph that names it
 * compiles, and the refusal says exactly what is missing.
 */
export function subgraphKind(): NodeKind<{ readonly graph: unknown }> {
  return {
    id: 'subgraph',
    version: 1,
    description: 'A node that runs its own graph; constrains a supervisor at depth>1.',
    validateConfig: (raw, context) => {
      const config = asRecord(raw, `${context}: subgraph config`)
      if (config.graph === undefined) {
        throw new ValidationError(`${context}: subgraph config.graph is required`)
      }
      return { graph: config.graph }
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
    run: ({ profile }) => {
      throw new ValidationError(
        `subgraph kind: node ${JSON.stringify(profile.name)} cannot run yet — the scheduler that executes a nested graph lands in agent-runtime#980`,
      )
    },
  }
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError(`${context} must be an object`)
  }
  return value as Record<string, unknown>
}
