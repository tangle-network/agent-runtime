import type {
  AgentCandidateWorkspaceSnapshotEvidence,
  AgentProfile,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentTurnInput,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import type { PromptOptions } from '@tangle-network/sandbox'
import { type ProviderPlacement, selectProviderPlacement } from '../provider-placement'
import type {
  ProviderWorkspaceCaptureReceipt,
  ProviderWorkspaceRetentionPort,
} from '../provider-workspace-retention'
import { detachedSnapshot } from '../supervise/snapshot'
import type { ExecutorFactory, Runtime } from '../supervise/types'
import type { UnavailablePausePolicy } from '../supervise/upstream-unavailable'
import type { Validator } from '../types'
import { createProviderExecutor } from './provider-executor-lifecycle'
import { ValidationError } from './provider-validation-error'

/** Adapt an environment provider into an `ExecutorFactory` for `createExecutor`.
 *
 * `createExecutor({ backend: 'provider', provider })` is the composition most callers want; it
 * builds this factory and injects the seam. See `examples/provider-executor/`.
 *
 * Still `@experimental`: the entry point that consumes it, `createExecutor`, carries no stability
 * tag and is therefore experimental by default, so a stable promise here would be reachable only
 * through an experimental symbol.
 *
 * @experimental */
export function providerAsExecutor(
  provider: AgentEnvironmentProvider,
  options: ProviderExecutorOptions = {},
): ExecutorFactory<unknown> {
  const captured =
    options.placements === undefined
      ? options
      : {
          ...options,
          placements: detachedSnapshot(options.placements, 'provider placements'),
          defaults: detachedSnapshot(options.defaults, 'provider placement defaults'),
        }
  return (spec, ctx) => {
    const profile =
      captured.placements === undefined
        ? spec.profile
        : detachedSnapshot(spec.profile, 'provider placement profile')
    const selected = selectProviderPlacement(profile, captured)
    return createProviderExecutor(provider, profile, ctx, selected.options, selected.identity)
  }
}

/**
 * Run a provider under a placement Runtime chose for the whole execution, such as a shared box.
 * The identity lands in the execution's materialization plan and binding, exactly where a
 * declared {@link ProviderPlacement} lands, so a record says which placement served it.
 * @internal
 */
export function placedProviderExecutor(
  provider: AgentEnvironmentProvider,
  options: ProviderExecutorOptions,
  identity: { id: string; digest: string },
): ExecutorFactory<unknown> {
  if (options.placements !== undefined) {
    throw new ValidationError('placedProviderExecutor: placements select within one provider')
  }
  return (spec, ctx) => createProviderExecutor(provider, spec.profile, ctx, options, identity)
}

/**
 * What one provider-executed turn settles on: the visible answer plus the event archive the
 * environment streamed. It is the value a `ProviderExecutorOptions.validator` scores.
 *
 * The archive is the streamed sequence, in order, without superseded part updates. A harness
 * streams a text or reasoning part cumulatively: every `message.part.updated` frame restates the
 * part's whole text so far. When a later frame of the same part extends a frame's text, the
 * earlier frame is left out, so each such part is archived once, at its latest frame. Keeping
 * every frame retains frames times text length, and the settled archive is hashed and stored.
 * A frame that does not extend the part's text is kept, and every other event is kept verbatim.
 * Read a part's text from `part.text`; a retained frame's `delta` is only that frame's increment.
 *
 * @experimental
 */
export interface ProviderLeafOut {
  content: string
  events: AgentEnvironmentEvent[]
  /** Portable executable workspace evidence accepted before the source environment was deleted. */
  workspaceSnapshot?: AgentCandidateWorkspaceSnapshotEvidence
  /** Exact provider and supervisor identities bound to the retained bytes. */
  workspaceCapture?: ProviderWorkspaceCaptureReceipt
  /**
   * Why workspace retention produced no receipt for this settled turn. The source environment is
   * preserved as evidence and the turn's result stands.
   */
  workspaceCaptureFailure?: string
  /** How many streamed part updates the archive left out because a later frame superseded them. */
  supersededPartUpdates?: number
}

/**
 * Per-run Sandbox prompt options for the provider path — the same field, the same name, and the
 * same kernel-owned exclusions as `ExecCtx.promptOptions` on the sandbox path.
 *
 * The kernel owns `sessionId` and `signal`, so neither is declarable: a caller-chosen session id
 * would make every worker share one server session, and the abort channel belongs to the run.
 * `model` is excluded too, and for a different reason: this executor's materialization record
 * names the model from `AgentProfile`, so a turn-level override would make the record state a
 * model the provider did not run. Declare the instrument on `AgentProfile.model`.
 *
 * Everything else is the per-call configuration a portable profile cannot carry. `backend` is the
 * load-bearing one: `backend.model.authMode` plus `authFiles` is how a caller-owned subscription
 * seat reaches the harness inside the environment. Runtime lowers these onto the turn with the one
 * mapper it already uses in the other direction, so a sandbox-shaped provider reads them from
 * `AgentTurnInput.providerOptions.backend` exactly as it reads a sandbox box's prompt options.
 *
 * @experimental
 */
export type ProviderPromptOptions = Omit<PromptOptions, 'model' | 'sessionId' | 'signal'>

/** Options for running a provider as a supervise-mode executor.
 * @experimental */
export interface ProviderExecutorOptions {
  /** Select exactly one caller-declared placement from each child's unchanged profile. */
  placements?: readonly ProviderPlacement[]
  defaults?: Partial<CreateAgentEnvironmentInput>
  runtime?: Runtime
  destroyOnSettle?: boolean
  requireTerminalEvent?: boolean
  /**
   * Per-run prompt options merged UNDER every streamed turn: a mapped turn's own field wins, and
   * the runtime's abort signal is applied last. `providerOptions` merges one level, so a
   * `taskToTurn` that sets its own provider option cannot silently drop the session credential
   * declared here.
   */
  promptOptions?: ProviderPromptOptions
  /**
   * OPT-IN executable score for this worker, with the SAME contract the sandbox seam's validator
   * has: `validate` runs while the environment is still alive, so `ValidationCtx.box` can read
   * files and run commands in the environment it is scoring. Every other supervised hook fires
   * after teardown and can only read the artifact.
   * `ValidationCtx.node` identifies the supervised node, including its recursion depth, so a
   * shared validator can apply a root-only contract without applying it to nested managers.
   *
   * The verdict becomes the settled artifact's verdict. Absent, nothing changes and the leaf falls
   * back to its own settle verdict.
   */
  validator?: Validator<ProviderLeafOut>
  /** Capture and verify a portable executable workspace before Runtime destroys the environment. */
  workspaceRetention?: ProviderWorkspaceRetentionPort
  /** Transform only the profile sent to `provider.create`. The original profile
   * remains the input to `taskToTurn`, so execution-only normalization cannot
   * rewrite the caller's task mapping. */
  profileForCreate?: (profile: AgentProfile) => AgentProfile
  /** Map the task while retaining the kernel's canonical prompt mapping by default. */
  taskToTurn?: (
    task: unknown,
    specProfile: AgentProfile,
    defaultTurn: AgentTurnInput,
  ) => AgentTurnInput
  /**
   * How a supervised leaf waits out an upstream that cannot serve now.
   *
   * When the model provider refuses a leaf's turn for capacity (a quota, a rate limit, an
   * overload, or the router's own refused credential; see `upstreamUnavailableSignal`), the leaf
   * keeps its environment, pauses, and continues in the same environment and session with a
   * short instruction to pick up where it stopped. The pause starts at `unavailablePauseMs`
   * (15 s) and doubles to `maxUnavailablePauseMs` (5 min), the same rule a driver follows. Only
   * the leaf's deadline, cancellation and budget end it. Each pause is journaled as a `paused`
   * spawn event, and each continuation as the node's next `execution-input`.
   *
   * Applies to a retained execution under a Scope, the path a supervised leaf takes on a provider
   * that declares `retainedControl`. Workspace retention verifies each invocation separately;
   * failed capture or required incomplete coverage preserves the source and stops continuation.
   * `false` ends the execution on the refused turn.
   */
  unavailablePause?: UnavailablePausePolicy | false
}
