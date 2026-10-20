import type { AgentProfile } from '@tangle-network/agent-interface'
import type { BackendType } from '@tangle-network/sandbox'
import type { AgentExecutionRef, ExecutorNodeContext } from './execution-identity'
import type { Executor, Runtime } from './executor-port'

/**
 * `AgentProfile` is the complete execution authority. Scope parses and snapshots it before calling
 * any registry, including one that resolves caller-supplied factories. The default registry
 * enforces the same rule when called directly. One spec is exempt from the harness-and-model
 * requirement, never from parsing: a verbatim `executor`, which receives only the task and a
 * signal and so can be filled from nothing. Its profile names the node and still digests into the
 * node identity; a leaf whose authority is code (a graph script) carries no model, honestly.
 * `AgentSpec.harness` records routing for one concrete run; where a backend consumes both fields,
 * it must agree with `AgentProfile.harness` and cannot fill or override it.
 *
 * Resolution (in `runtime.ts`):
 *  - `executorFactory` present → BYO: build it after admission with the live context.
 *  - `executor` present        → BYO: use it verbatim (a user's own `Executor`).
 *  - `harness === null`        → router/inline: a direct Router call, no box.
 *  - `harness` is a `BackendType` → sandbox: compose `runAgentRounds` against `profile` on that backend.
 * Fail loud on an unresolvable spec (no executor and an unknown harness).
 */
export interface AgentSpec {
  readonly profile: AgentProfile
  /** `null` selects router/inline; a `BackendType` selects the sandboxed harness. */
  readonly harness: BackendType | null
  /** Trusted candidate/campaign attribution supplied by the caller. Profile/task digests are
   *  computed by Scope from the exact values it executes and cannot be supplied here. */
  readonly execution?: AgentExecutionRef
  /** Per-spawn factory carrying caller configuration. Constructed only after admission, with the
   *  real child signal and nested-scope context. */
  readonly executorFactory?: ExecutorFactory<unknown>
  /** Bring-your-own executor: highest routing precedence after exact-profile intake validation. */
  readonly executor?: Executor<unknown>
  /** Set by spawn authorization when the child runs on another model than its parent authored.
   *  Scope journals it on the `spawned` record; it is not part of the node's identity. */
  readonly modelSubstitution?: SpawnModelSubstitution
}

/**
 * A spawn whose authorized profile names another harness/provider/model route than the parent
 * authored. magnetar-rust-20261017c's root spawned a "cross-family referee" as
 * `claude-code/anthropic/claude-opus-5-5`; authorization ran it as
 * `opencode/zai-coding-plan/glm-5.3`, and the root reported a cross-family review that never ran.
 */
export interface SpawnModelSubstitution {
  /** The route the spawning parent authored, `harness/provider/model`. */
  readonly requested: string
  /** The route the child was authorized to run, `harness/provider/model`. */
  readonly ran: string
}

/**
 * Builds a fresh `Executor` for one spawn from the resolved, immutable spec. Per-spawn (not shared)
 * so each child owns its own box/abort/teardown lifecycle. A BYO factory lets a user supply
 * construction args without pre-instantiating; it never bypasses exact-profile validation.
 */
export type ExecutorFactory<Out> = (spec: AgentSpec, ctx: ExecutorContext) => Executor<Out>

/** Construction context handed to a `ExecutorFactory` — the seams a built-in needs
 *  (sandbox client for the sandbox executor, router config for router/inline) without
 *  the factory reaching into module globals. */
export interface ExecutorContext {
  readonly signal: AbortSignal
  /**
   * Request headers inherited from an enclosing task or conversation.
   * Network executors forward these after their own connection headers so caller authorization,
   * recursion depth, and trace identity survive the profile-to-executor boundary.
   */
  readonly propagatedHeaders?: Readonly<Record<string, string>>
  /** Present when Scope constructs the executor for a supervised node. */
  readonly node?: ExecutorNodeContext
  /** Opaque seams the registry threads through; a built-in narrows what it needs. */
  readonly seams: Readonly<Record<string, unknown>>
}

/**
 * The OPEN resolver maps an already-admitted `AgentSpec` to an `ExecutorFactory`. Scope validates
 * before invoking any implementation; the default registry repeats validation for direct callers,
 * resolves the three built-ins, and accepts a BYO `executor`/factory. Callers may register more
 * runtimes by name, but registration does not waive exact-profile validation.
 */
export interface ExecutorRegistry {
  /** Register a factory for a named runtime. Throws on a duplicate name (fail loud). */
  register<Out>(runtime: Runtime, factory: ExecutorFactory<Out>): void
  /**
   * Resolve a spec to a factory. Precedence: a BYO `spec.executorFactory` → `spec.executor` →
   * `harness === null` → the `'router'` factory; else a registered
   * factory for the harness-derived runtime. Returns a typed outcome — the caller
   * inspects `succeeded` before `value` (no silent fallback).
   */
  resolve<Out>(
    spec: AgentSpec,
  ): { succeeded: true; value: ExecutorFactory<Out> } | { succeeded: false; error: string }
}
