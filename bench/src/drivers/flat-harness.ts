/**
 * Plane-A flat harness — the GATE's control, recovered as the simplest possible
 * `Agent.act` over the recursive execution atom (docs/research/recursive-execution-atom.md,
 * "Plane A as the simplest act"; "Decision: Plane B contains Plane A").
 *
 * The driver spawns ONE child per profile at a FIXED, equal budget, joins them via
 * `scope.next()` as each settles, adapts each settled child to the kernel's `Iteration`,
 * and selects the best with `defaultSelectWinner` — the single-sourced argmax the loop
 * kernel itself uses, so the control's selection is not a forked copy of the kernel's.
 * No steering, no widening, no spawn-on-completion: a flat fan-out at equal compute.
 *
 * The equal-k assertion (critique B3) is the gate's validity guard, exported alongside:
 * a treatment cell is admitted only when `Σ iterations(treatment) ≡ Σ iterations(blind)`
 * per task (excluding `budgetExempt` runtimes, which are out of the conserved Σk by
 * construction). A mismatch FAILS LOUD — the cell is excluded, never silently scored 0
 * (mirroring `experiment.ts`'s infra-error exclusion: a confounded cell is dropped, not
 * counted). Without this guard a "diverse@k beat blind@k" claim could be confounded by
 * the treatment having spent more compute than the control.
 */

import {
  type AgentProfile,
  type AgentSpec,
  type Budget,
  type DefaultVerdict,
  type ExecutorContext,
  type ExecutorRegistry,
  type Iteration,
  type LeafExecutorFactory,
  type ResultBlobStore,
  type RootHandle,
  type Settled,
  type SpawnJournal,
  type Supervisor,
  type SupervisedResult,
  type TreeView,
  type UsageEvent,
  type Agent as Atom,
  type Scope as AtomScope,
  createExecutorRegistry,
  createRootHandle,
  createSupervisor,
  defaultSelectWinner,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  settledToIteration,
} from '@tangle-network/agent-runtime/loops'
import type { BackendType } from '@tangle-network/sandbox'

/**
 * One arm's agent profile + how it maps to a leaf runtime. `harness === null` resolves to
 * the router/inline executor (a direct Router call, no box); a `BackendType` resolves to
 * the sandbox executor (composes `runLoop` as a leaf). A BYO `AgentSpec.executor` overrides
 * both — a user agent (mastra/agno/raw HTTP) is first-class the moment it implements the
 * `LeafExecutor` interface. This is the executor's only knob the flat harness needs.
 */
export interface FlatProfile {
  /** Stable arm label — becomes the child node's `label` and the selected winner's name. */
  readonly label: string
  /** The portable agent profile handed to the resolved executor. */
  readonly profile: AgentProfile
  /** Executor mapping: `null` → router/inline, a `BackendType` → sandbox. */
  readonly harness: BackendType | null
}

/** The flat-harness task: a shared prompt fanned out across one child per profile. */
export interface FlatTask {
  /** The task statement every spawned child receives verbatim. */
  readonly prompt: string
  /** One arm per profile; each is spawned once at the fixed equal budget. */
  readonly profiles: ReadonlyArray<FlatProfile>
}

/**
 * The flat-harness result: the selected winner (or `undefined` when every child was a
 * `down` / produced no output) plus the realized settled set so the caller can run the
 * equal-k assertion and report the realized tree shape per cell (residual risk R1: equal-k
 * is enforceable, equal-topology is not, so the realized shape is reported, not assumed).
 */
export interface FlatResult {
  /** The single-sourced argmax over the settled children, or `undefined` (no usable child). */
  readonly winner:
    | {
        readonly output: unknown
        readonly verdict?: DefaultVerdict
        readonly label: string
        readonly seq: number
      }
    | undefined
  /** Every settlement `next()` delivered, in recorded `seq` order (replay-stable). */
  readonly settled: ReadonlyArray<Settled<unknown>>
}

/** A leaf coder agent carries its executor mapping as `executorSpec` (the field
 *  `scope.spawn` reads to resolve a `LeafExecutor`). Its `act` is never invoked — the
 *  scope drives the resolved executor, not the leaf's `act` — so reaching it is a wiring
 *  bug (fail loud). */
interface LeafAtom extends Atom<unknown, unknown> {
  readonly executorSpec: AgentSpec
}

function leafCoder(p: FlatProfile): LeafAtom {
  const executorSpec: AgentSpec = { profile: p.profile, harness: p.harness }
  return {
    name: p.label,
    executorSpec,
    act(): Promise<unknown> {
      throw new Error(
        `flat-harness leaf "${p.label}": act() was invoked — a leaf is executed via its LeafExecutor, never its act (wiring bug)`,
      )
    },
  }
}

/**
 * The flat-harness driver: an `Agent` whose `act` spawns one child per profile at the
 * fixed `childBudget`, joins them all via `scope.next()`, and selects the best.
 *
 * Replay-safe by construction: it reads only what `Settled` delivers (`out`, `verdict`,
 * `seq`) — never `Date.now`, `Math.random`, or an unordered collection — and joins strictly
 * in the `seq` order `next()` yields, so a replay re-derives the identical winner.
 *
 * Selection is `defaultSelectWinner` over the `settledToIteration` adaptation of each `done`
 * child (M4 / build step 8) — the supervisor never re-ranks behind the driver (selector ≠
 * judge): the driver returns the synthesized winner and the supervisor content-addresses it.
 */
export function flatHarness(childBudget: Budget): Atom<FlatTask, FlatResult> {
  return {
    name: 'flat-harness',
    async act(task: FlatTask, scope: AtomScope<FlatResult>): Promise<FlatResult> {
      const open = scope as unknown as AtomScope<unknown>
      if (task.profiles.length === 0) {
        throw new Error('flat-harness: task.profiles is empty — nothing to fan out')
      }

      for (const p of task.profiles) {
        const spawned = open.spawn(leafCoder(p), task.prompt, {
          budget: childBudget,
          label: p.label,
        })
        // Fail loud on a fail-closed admission: a flat-harness cell that cannot afford its
        // full fan-out under the conserved pool is a misconfigured budget, not a partial run.
        if (!spawned.ok) {
          throw new Error(
            `flat-harness: spawn of "${p.label}" rejected (${spawned.reason}) — the root budget cannot cover one equal-budget child per profile`,
          )
        }
      }

      const settled: Settled<unknown>[] = []
      const iterations: Iteration<unknown, unknown>[] = []
      for (;;) {
        const s = await open.next()
        if (s === null) break
        settled.push(s)
        // Only a `done` child is an iteration; a `down` child is excluded from selection
        // (and from the equal-k Σ) exactly as an infra-errored cell is in experiment.ts.
        if (s.kind === 'done') iterations.push(settledToIteration(s))
      }

      const won = defaultSelectWinner(iterations)
      const winner = won
        ? {
            output: won.output,
            ...(won.verdict ? { verdict: won.verdict } : {}),
            label: won.agentRunName,
            seq: won.iterationIndex,
          }
        : undefined
      return { winner, settled }
    },
  }
}

// ── The equal-k assertion (critique B3) ──────────────────────────────────────────

/** Per-arm realized iteration count, tagged so a mismatch names the offending arm. */
export interface ArmRealizedK {
  /** Arm label (the control is named explicitly by the caller, not inferred here). */
  readonly label: string
  /** Σ of conserved iterations across this arm's `done` children, EXCLUDING any whose
   *  runtime is `budgetExempt` (e.g. a `cli`/RLM subprocess without token accounting). */
  readonly k: number
  /** Count of `down` (failed/infra) children — reported so a caller can see why an arm's
   *  realized k differs even when both arms were spawned identically (residual risk R1). */
  readonly downCount: number
}

/**
 * The equal-k outcome: either every arm spent the SAME conserved compute (the cell is
 * admissible) or it did not (the cell is excluded). Typed — the caller inspects `ok`
 * before trusting the cell, never a silent zero (fail-loud per B3).
 */
export type EqualKOutcome =
  | { readonly ok: true; readonly k: number; readonly arms: ReadonlyArray<ArmRealizedK> }
  | {
      readonly ok: false
      readonly reason: 'unequal-k' | 'no-arms'
      readonly arms: ReadonlyArray<ArmRealizedK>
    }

/** Σ of conserved iterations across an arm's `done` children. Reads `spent.iterations`
 *  (the conserved pool's iteration channel) off each settled child — the same evidence
 *  replay reads — never a wall-clock or re-derived count. A `budgetExempt` runtime (a
 *  `cli`/RLM subprocess without token accounting) reports zero conserved spend by contract,
 *  so its iterations fall out of this Σ automatically — no per-runtime special case needed. */
export function realizedK(label: string, settled: ReadonlyArray<Settled<unknown>>): ArmRealizedK {
  let k = 0
  let downCount = 0
  for (const s of settled) {
    if (s.kind === 'down') {
      downCount += 1
      continue
    }
    k += s.spent.iterations
  }
  return { label, k, downCount }
}

/**
 * The equal-k assertion (critique B3): a treatment cell is admissible only when every arm
 * realized the SAME conserved compute as the blind control — `Σ iterations(treatment) ≡
 * Σ iterations(blind)` per task, excluding `budgetExempt` runtimes. Returns a typed
 * `EqualKOutcome`; the caller EXCLUDES the cell on `!ok` (never scores it 0), so a
 * compute-confounded cell is dropped, exactly as an infra-errored cell is in `experiment.ts`.
 *
 * `arms` is `[control, ...treatments]` — the blind control FIRST (the same discipline
 * `runSteeringExperiment` enforces structurally). Every arm's k is compared to the
 * control's; one differing arm excludes the whole cell (the gate compares arms pairwise per
 * task, so a single confounded arm contaminates the pairing).
 */
export function assertEqualK(
  arms: ReadonlyArray<{ label: string; settled: ReadonlyArray<Settled<unknown>> }>,
): EqualKOutcome {
  if (arms.length === 0) return { ok: false, reason: 'no-arms', arms: [] }
  const realized = arms.map((a) => realizedK(a.label, a.settled))
  const controlK = realized[0]!.k
  const equal = realized.every((r) => r.k === controlK)
  if (!equal) return { ok: false, reason: 'unequal-k', arms: realized }
  return { ok: true, k: controlK, arms: realized }
}

/**
 * Strict equal-k guard for an in-driver invariant: throws on a mismatch instead of
 * returning a typed outcome. Use where the cell MUST be equal-k by construction (a unit
 * test or a same-budget self-comparison); the experiment harness prefers `assertEqualK`
 * so it can EXCLUDE rather than abort the whole run on one confounded cell.
 */
export function assertEqualKOrThrow(
  arms: ReadonlyArray<{ label: string; settled: ReadonlyArray<Settled<unknown>> }>,
): { k: number; arms: ReadonlyArray<ArmRealizedK> } {
  const outcome = assertEqualK(arms)
  if (!outcome.ok) {
    const detail = outcome.arms.map((a) => `${a.label}=${a.k}`).join(' ')
    throw new Error(
      `equal-k assertion failed (${outcome.reason}): arms spent unequal conserved compute [${detail}] — the cell is confounded and must be excluded`,
    )
  }
  return { k: outcome.k, arms: outcome.arms }
}

// ── Running the flat harness through the Supervisor (the gate's control runner) ───

/** Seams every spawned executor reads off `ExecutorContext.seams`, keyed by the seam name a
 *  built-in narrows (`router` → router/inline base+key+model, `sandbox` → the loop sandbox
 *  client). Opaque here; each built-in reads its own key and fails loud when its seam is
 *  absent — so a flat-harness cell that names a sandbox/router arm MUST supply that seam. */
export interface FlatHarnessSeams {
  readonly router?: { routerBaseUrl: string; routerKey: string; model?: string }
  readonly sandbox?: { sandboxClient: unknown; maxIterations?: number; loopCtx?: unknown }
  readonly [seam: string]: unknown
}

/**
 * Bind seams onto an `ExecutorRegistry` so every resolved factory builds its executor with
 * THIS cell's seams. The supervisor constructs the root scope with an empty `seams` map (it
 * is task-agnostic), so the seams must ride on the registry instead: the wrapper overrides
 * the `ExecutorContext.seams` the scope passes through, preserving the caller's `signal`.
 * A BYO `AgentSpec.executor` resolves to a factory that ignores `ctx` entirely, so binding
 * is a no-op for it — exactly right. This is a real composition, not a passthrough stub.
 */
function bindSeams(base: ExecutorRegistry, seams: Readonly<Record<string, unknown>>): ExecutorRegistry {
  return {
    register<Out>(runtime: string, factory: LeafExecutorFactory<Out>): void {
      base.register(runtime, factory)
    },
    resolve<Out>(spec: AgentSpec) {
      const resolved = base.resolve<Out>(spec)
      if (!resolved.succeeded) return resolved
      const inner = resolved.value
      const bound: LeafExecutorFactory<Out> = (s, ctx: ExecutorContext) =>
        inner(s, { signal: ctx.signal, seams })
      return { succeeded: true as const, value: bound }
    },
  }
}

export interface RunFlatHarnessConfig {
  /** The fan-out task: the shared prompt + one profile per arm. */
  readonly task: FlatTask
  /** The FIXED, equal per-child budget — every arm gets the identical ceiling (the
   *  equal-k precondition: equal reservations make `Σk` equal by construction when no
   *  child is `budgetExempt` and none goes `down`). */
  readonly childBudget: Budget
  /** The root conserved-pool ceiling. Must cover one `childBudget` per profile or the
   *  flat-harness `act` fails loud on the first un-affordable spawn. */
  readonly rootBudget: Budget
  /** Trace-correlation + journal/blob root key. */
  readonly runId: string
  /** Per-runtime executor seams threaded into every spawned child. */
  readonly seams: FlatHarnessSeams
  /** Open executor registry; defaults to the built-ins (router/inline · sandbox · cli)
   *  plus any BYO `AgentSpec.executor`. Inject to register additional runtimes. */
  readonly executors?: ExecutorRegistry
  /** Event source; defaults to the in-memory journal (durable JSONL/FS is injectable). */
  readonly journal?: SpawnJournal
  /** Result-blob store backing `outRef` rehydration; defaults to in-memory. */
  readonly blobs?: ResultBlobStore
  /** Optional live root handle (the Q2 chat/pi-viz substrate) attached before `run`. */
  readonly rootHandle?: RootHandle<FlatResult>
  /** Caller abort signal — cascades into every live child's executor. */
  readonly signal?: AbortSignal
  /** Injected clock for deterministic journal timestamps (tests). */
  readonly now?: () => number
}

/**
 * One flat-harness cell: spawn one child per profile at `childBudget` under a conserved
 * `rootBudget` pool, join, select. Returns the typed `SupervisedResult` (a no-winner is
 * never coerced to a best-effort output, M2).
 *
 * Seams ride on the registry, not the supervisor: `bindSeams` overrides the
 * `ExecutorContext.seams` each resolved factory receives with this cell's `cfg.seams`, so a
 * router/sandbox child reads its seam even though the supervisor builds the root scope with
 * an empty seams map. A BYO `AgentSpec.executor` ignores seams and resolves unchanged.
 */
export async function runFlatHarness(cfg: RunFlatHarnessConfig): Promise<SupervisedResult<FlatResult>> {
  const supervisor: Supervisor<FlatTask, FlatResult> = createSupervisor<FlatTask, FlatResult>()
  if (cfg.rootHandle) supervisor.attach(cfg.rootHandle)
  const executors = bindSeams(cfg.executors ?? createExecutorRegistry(), cfg.seams)
  return supervisor.run(flatHarness(cfg.childBudget), cfg.task, {
    budget: cfg.rootBudget,
    runId: cfg.runId,
    journal: cfg.journal ?? new InMemorySpawnJournal(),
    blobs: cfg.blobs ?? new InMemoryResultBlobStore(),
    executors,
    ...(cfg.signal ? { signal: cfg.signal } : {}),
    ...(cfg.now ? { now: cfg.now } : {}),
  })
}

/** Re-exported so a caller building the live root substrate gets it from one place. */
export { createRootHandle }
export type { TreeView, UsageEvent }
