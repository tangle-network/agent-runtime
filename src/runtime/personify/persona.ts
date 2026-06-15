/**
 * @experimental
 *
 * The personify layer impl — `definePersona` (the thin builder) + `runPersonified` (composes
 * the persona + chosen shape onto the keystone `Supervisor`), plus `createShapeContext`, the
 * seam that hands a shape its spawn helpers without it touching the registry.
 *
 * This file adds NO engine: `runPersonified` is `createSupervisor().run(rootAgent, task, …)`
 * where `rootAgent` is the persona's chosen `LoopShape` applied to a `ShapeContext`. All the
 * conserved-budget / journal / abort / typed-result machinery is the keystone's; this layer
 * only wires the persona's CONTENT (root spec + directive + context + seams) into it.
 *
 * One non-obvious invariant it must honor: `createSupervisor().run` builds the root `Scope`
 * with an EMPTY seam bag (`seams: {}`), so the built-in metered runtimes (router/sandbox/cli)
 * cannot read their seams off `ExecutorContext` through the default supervisor path. A persona
 * that supplies raw `seams` is therefore wrapped here into a registry whose resolved factories
 * receive a ctx with the persona seams merged in — so a persona never has to pre-close its
 * factories by hand. A persona may instead supply a fully-built `registry` and skip the wrap.
 */

import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../durable/spawn-journal'
import { ValidationError } from '../../errors'
import { withDriverExecutor } from '../supervise/driver-executor'
import { createExecutorRegistry } from '../supervise/runtime'
import { createSupervisor } from '../supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Budget,
  ExecutorContext,
  ExecutorFactory,
  ExecutorRegistry,
  Runtime,
  SupervisedResult,
  SupervisorOpts,
} from '../supervise/types'
import { builtinShapes } from './registry'
import type {
  DefinePersonaInput,
  LoopShape,
  Outcome,
  Persona,
  RunPersonifiedOptions,
  ShapeBudget,
  ShapeContext,
} from './types'
import type { ScopeAnalyst } from './wave-types'

// ── definePersona ─────────────────────────────────────────────────────────────

/**
 * Build a frozen `Persona`. Fails loud on the executors-supplied invariant: a persona with
 * neither a pre-built registry nor a seam bag cannot resolve its built-in runtimes, so it is
 * unrunnable — refuse it at definition time, not at the first spawn. Pure; no I/O.
 */
export function definePersona<D = unknown>(input: DefinePersonaInput<D>): Persona<D> {
  if (!input.executors.registry && !input.executors.seams) {
    throw new ValidationError(
      `definePersona("${input.name}"): executors must supply a registry or a seams bag ` +
        '(built-in runtimes read their seams off ExecutorContext; neither was provided)',
    )
  }
  if (!input.root || typeof input.root !== 'object' || !('harness' in input.root)) {
    throw new ValidationError(`definePersona("${input.name}"): root must be an AgentSpec`)
  }
  return Object.freeze({
    name: input.name,
    root: input.root,
    directive: input.directive,
    context: input.context,
    executors: input.executors,
    ...(input.extensions ? { extensions: input.extensions } : {}),
  }) as Persona<D>
}

// ── ShapeContext construction ───────────────────────────────────────────────────

/**
 * Build the `ShapeContext` a `LoopShape` factory consumes. `spawnChild` wraps an `AgentSpec`
 * into a leaf `Agent` carrying it as `executorSpec` (the structural field `scope.spawn`
 * reads); `childSpec` derives a narrower child spec from the persona's root by overriding the
 * profile. The shape never touches the registry — resolution stays single-sourced in the
 * scope/registry the supervisor owns.
 */
export function createShapeContext<D>(
  persona: Persona<D>,
  budget: ShapeBudget,
  analyst?: ScopeAnalyst<D>,
): ShapeContext<D> {
  return {
    persona,
    budget,
    ...(analyst ? { analyst } : {}),
    spawnChild(name, spec): Agent<unknown, Outcome<D>> {
      // The wrapped agent is SPAWNED, not run — the resolved Executor drives it. The
      // executor is a LEAF for a plain spec OR the recursive driver-executor for a
      // `role:'driver'` spec (a child that is itself a driver — agents drive agents). `act`
      // is never invoked by the keystone for a spawned child (the executor drives it); it
      // throws if mis-used as a root (fail loud), never a vacuous outcome.
      const agent = {
        name,
        executorSpec: spec,
        act(): Promise<Outcome<D>> {
          throw new ValidationError(
            `personify: spawned child "${name}" was run directly; its executorSpec drives it ` +
              '(a leaf, or — for a driver child — a nested scope through the recursive driver-executor)',
          )
        },
      }
      return agent as Agent<unknown, Outcome<D>> & { executorSpec: AgentSpec }
    },
    childSpec(profile, harness): AgentSpec {
      return {
        profile,
        harness: harness === undefined ? persona.root.harness : harness,
        ...(persona.root.executor ? { executor: persona.root.executor } : {}),
      }
    },
  }
}

// ── runPersonified ──────────────────────────────────────────────────────────────

/**
 * Compose the persona + chosen shape onto a fresh keystone `Supervisor`. Resolves the shape
 * (a factory verbatim, or a registered name through `builtinShapes`), applies it to a
 * `ShapeContext`, and runs the resulting root `Agent` to a typed `SupervisedResult<Outcome>`.
 * Fail loud on an unknown shape name or an unresolvable persona registry — never a silent
 * default-shape fallback.
 */
export async function runPersonified<Task, D>(
  options: RunPersonifiedOptions<Task, D>,
): Promise<SupervisedResult<Outcome<D>>> {
  const { persona } = options
  const shape = resolveShape<Task, D>(options.shape)
  const shapeBudget = resolveShapeBudget(options.budget, options.shapeBudget)
  const ctx = createShapeContext(persona, shapeBudget, options.analyst)
  const rootAgent = shape(ctx)

  const executors = personaRegistry(persona)
  const supervisor = createSupervisor<Task, Outcome<D>>()
  if (options.handle) supervisor.attach(options.handle)

  const supervisorOpts: SupervisorOpts = {
    budget: options.budget,
    runId: options.runId ?? `${persona.name}:${shapeName(options.shape, shape)}`,
    journal: options.journal ?? new InMemorySpawnJournal(),
    blobs: options.blobs ?? new InMemoryResultBlobStore(),
    executors,
    ...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
    ...(options.maxRestarts !== undefined ? { maxRestarts: options.maxRestarts } : {}),
    ...(options.withinMs !== undefined ? { withinMs: options.withinMs } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.hooks ? { hooks: options.hooks } : {}),
  }
  return supervisor.run(rootAgent, options.task, supervisorOpts)
}

// ── Resolution helpers ──────────────────────────────────────────────────────────

function resolveShape<Task, D>(shape: LoopShape<Task, D> | string): LoopShape<Task, D> {
  if (typeof shape !== 'string') return shape
  const resolved = builtinShapes.resolve<Task, D>(shape)
  if (!resolved.succeeded) {
    throw new ValidationError(
      `runPersonified: ${resolved.error} (registered: ${builtinShapes.names().join(', ')})`,
    )
  }
  return resolved.value
}

function shapeName<Task, D>(
  shape: LoopShape<Task, D> | string,
  _resolved: LoopShape<Task, D>,
): string {
  return typeof shape === 'string' ? shape : shape.name || 'shape'
}

/**
 * Default the shape's per-child sizing + fanout width from the root budget when the caller
 * omits them. The per-child token ceiling is the root divided across the fanout so the
 * conserved pool can admit a full round; iterations default to the root's. A caller override
 * wins per-field.
 */
function resolveShapeBudget(root: Budget, over?: Partial<ShapeBudget>): ShapeBudget {
  const fanout = over?.fanout ?? defaultFanout
  const perChild: Budget = over?.perChild ?? {
    maxIterations: Math.max(1, Math.floor(root.maxIterations / fanout)),
    maxTokens: Math.max(1, Math.floor(root.maxTokens / fanout)),
    ...(root.maxUsd !== undefined ? { maxUsd: root.maxUsd / fanout } : {}),
    ...(root.deadlineMs !== undefined ? { deadlineMs: root.deadlineMs } : {}),
  }
  return { perChild, fanout }
}

const defaultFanout = 3

/**
 * Resolve the persona's executor resolution into a single `ExecutorRegistry`. A pre-built
 * `registry` is used verbatim; otherwise the persona's raw `seams` are wrapped so resolved
 * factories receive an `ExecutorContext` with the persona seams merged in — the supervisor
 * threads an empty bag, so this is the one place the persona seams reach the built-ins.
 */
function personaRegistry<D>(persona: Persona<D>): ExecutorRegistry {
  const { registry, seams } = persona.executors
  // `withDriverExecutor` routes a `role:'driver'` child to the recursive driver-executor
  // (a child that drives its own children) BEFORE the base leaf resolution — so a persona
  // shape can spawn a driver child and the recursion composes. A plain leaf child falls
  // through to the base registry unchanged.
  if (registry) return withDriverExecutor(registry)
  if (!seams) {
    throw new ValidationError(
      `personify: persona "${persona.name}" supplies neither a registry nor seams`,
    )
  }
  return withDriverExecutor(withSeams(createExecutorRegistry(), seams))
}

/**
 * Wrap a registry so every resolved `ExecutorFactory` receives a ctx whose `seams` are
 * the persona seams merged over whatever the scope threaded (the scope threads `{}`, so the
 * persona seams win). A BYO `spec.executor` still resolves to a trivial factory that ignores
 * ctx — so this wrap is transparent for BYO and only matters for the metered built-ins.
 */
function withSeams(
  base: ExecutorRegistry,
  seams: Readonly<Record<string, unknown>>,
): ExecutorRegistry {
  return {
    register<Out>(runtime: Runtime, factory: ExecutorFactory<Out>): void {
      base.register(runtime, factory)
    },
    resolve<Out>(spec: AgentSpec) {
      const resolved = base.resolve<Out>(spec)
      if (!resolved.succeeded) return resolved
      const inner = resolved.value
      const wrapped: ExecutorFactory<Out> = (s, ctx) => inner(s, mergeSeams(ctx, seams))
      return { succeeded: true, value: wrapped }
    },
  }
}

function mergeSeams(
  ctx: ExecutorContext,
  seams: Readonly<Record<string, unknown>>,
): ExecutorContext {
  return { signal: ctx.signal, seams: { ...seams, ...ctx.seams } }
}
