import { randomUUID } from 'node:crypto'
import {
  type AgentExactRunControlRef,
  AgentExactRunControlRefSchema,
  type AgentInteractiveSession,
  type AgentInteractiveSessionRef,
  AgentInteractiveSessionRefSchema,
  type AgentInteractiveSessionStart,
  AgentInteractiveSessionStartSchema,
  type AgentProfile,
  type AgentProfileValidationResult,
  type AgentRunCancellationAcknowledgement,
  type AgentRunCancellationRequest,
  AgentRunCancellationRequestSchema,
  type AgentRunControlRef,
  agentInteractiveSessionRefMatchesStart,
  canonicalCandidateDigest,
  canonicalWorkspaceCwd,
  harnessSystemPromptIntents,
  type InteractionAcknowledgement,
  type InteractionResponseCommand,
  type TokenUsage,
  WorkspaceRequestSchema,
  workspaceCwdPathForBase,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentEnvironmentQuery,
  AgentEnvironmentStatus,
  AgentEnvironmentSummary,
  AgentProfileRef,
  AgentSession,
  AgentSessionRef,
  AgentSessionStatus,
  AgentTurnInput,
  AgentTurnResult,
  CheckpointRef,
  CheckpointRequest,
  CreateAgentEnvironmentInput,
  ExecRequest,
  ExecResult,
  ForkRequest,
  PlacementInfo,
  ResourceRequest,
} from '@tangle-network/agent-interface/environment-provider'
import type {
  BackendType,
  CreateSandboxOptions,
  InteractiveSessionHandle,
  PromptInputPart,
  PromptOptions,
  PromptResult,
  SandboxEvent,
  ExecResult as SandboxExecResult,
  SandboxInstance,
  SandboxRuntimeCapabilities,
} from '@tangle-network/sandbox'
import { awaitAbortable, sameControlCoordinates } from './retained-run-binding'
import {
  canonicalStreamEventFromSandboxEvent,
  createSandboxToolPartState,
  isSandboxTerminalEvent,
  sandboxProgressEvents,
  sandboxTerminalUsageField,
} from './sandbox-events'
import { linkAbort } from './supervise/abortable'
import {
  attestRuntimeOwnedPendingExecutor,
  finalizeRuntimeOwnedPendingExecutor,
  newExecutionAttemptId,
} from './supervise/materialization'
import {
  concreteProfileModel,
  enforceTokenLimits,
  profileModelExecutionSettings,
} from './supervise/model-policy'
import { detachedSnapshot } from './supervise/snapshot'
import type {
  Executor,
  ExecutorCancellation,
  ExecutorContext,
  ExecutorExecutionBinding,
  ExecutorFactory,
  ExecutorMaterialization,
  ExecutorResult,
  Runtime,
  Spend,
  UsageEvent,
} from './supervise/types'
import { promptFromAgentTurnInput, promptOptionsFromAgentTurnInput } from './turn-input'
import type { LoopSandboxPlacement, SandboxClient, Validator } from './types'
import { zeroTokenUsage } from './util'

// Keep this file loadable from the lean `./environment-provider` export without agent-eval installed.
class ValidationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ValidationError'
  }
}

export type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentEnvironmentQuery,
  AgentEnvironmentStatus,
  AgentEnvironmentSummary,
  AgentProfileRef,
  AgentSession,
  AgentSessionRef,
  AgentSessionStatus,
  AgentTurnInput,
  AgentTurnResult,
  CheckpointRef,
  CheckpointRequest,
  CreateAgentEnvironmentInput,
  ExecRequest,
  ExecResult,
  ForkRequest,
  PlacementInfo,
  ResourceRequest,
  WorkspaceRequest,
} from '@tangle-network/agent-interface/environment-provider'

export {
  type CreateTangleSandboxExactProcessProviderOptions,
  createTangleSandboxExactProcessProvider,
} from './tangle-sandbox-exact-process-provider'

/** Provider object or registry name accepted by runtime provider adapters.
 * @experimental */
export type AgentEnvironmentProviderRef = AgentEnvironmentProvider | string

/** In-memory registry for named `AgentEnvironmentProvider` instances.
 * @experimental */
export interface AgentEnvironmentProviderRegistry {
  register(provider: AgentEnvironmentProvider, options?: { replace?: boolean }): void
  has(name: string): boolean
  get(name: string): AgentEnvironmentProvider | undefined
  require(name: string): AgentEnvironmentProvider
  names(): string[]
  providers(): AgentEnvironmentProvider[]
  capabilities(name: string): Promise<AgentEnvironmentCapabilities>
}

/** Create a registry that resolves provider names to concrete provider instances.
 * @experimental */
export function createAgentEnvironmentProviderRegistry(
  providers: Iterable<AgentEnvironmentProvider> = [],
): AgentEnvironmentProviderRegistry {
  const entries = new Map<string, AgentEnvironmentProvider>()

  const registry: AgentEnvironmentProviderRegistry = {
    register(provider, options = {}): void {
      if (!provider.name) {
        throw new ValidationError('agent environment provider registry: provider.name required')
      }
      if (!options.replace && entries.has(provider.name)) {
        throw new ValidationError(
          `agent environment provider registry: provider "${provider.name}" already registered`,
        )
      }
      entries.set(provider.name, provider)
    },
    has(name): boolean {
      return entries.has(name)
    },
    get(name): AgentEnvironmentProvider | undefined {
      return entries.get(name)
    },
    require(name): AgentEnvironmentProvider {
      const provider = entries.get(name)
      if (!provider) {
        const available = Array.from(entries.keys()).sort()
        const suffix = available.length > 0 ? `; available: ${available.join(', ')}` : ''
        throw new ValidationError(
          `agent environment provider registry: provider "${name}" is not registered${suffix}`,
        )
      }
      return provider
    },
    names(): string[] {
      return Array.from(entries.keys()).sort()
    },
    providers(): AgentEnvironmentProvider[] {
      return registry.names().map((name) => registry.require(name))
    },
    async capabilities(name): Promise<AgentEnvironmentCapabilities> {
      return registry.require(name).capabilities()
    },
  }

  for (const provider of providers) registry.register(provider)
  return registry
}

/** Resolve a provider instance or registry name, failing loudly when a name is unknown.
 * @experimental */
export function resolveAgentEnvironmentProvider(
  provider: AgentEnvironmentProviderRef,
  registry?: AgentEnvironmentProviderRegistry,
): AgentEnvironmentProvider {
  if (typeof provider !== 'string') return provider
  if (!registry) {
    throw new ValidationError(
      `agent environment provider "${provider}" requires an AgentEnvironmentProviderRegistry`,
    )
  }
  return registry.require(provider)
}

/** Options for exposing an `AgentEnvironmentProvider` through the legacy sandbox client port.
 * @experimental */
export interface ProviderAsSandboxClientOptions {
  defaults?: Partial<CreateAgentEnvironmentInput>
  requireTerminalEvent?: boolean
  /** Require declared live continuation plus concrete session controls. */
  requireSession?: boolean
  mapCreateOptions?: (
    options: CreateSandboxOptions | undefined,
  ) => Partial<CreateAgentEnvironmentInput>
}

/** Adapt a neutral environment provider to the `SandboxClient` interface used by existing loop paths.
 * @experimental */
export function providerAsSandboxClient(
  provider: AgentEnvironmentProvider,
  options: ProviderAsSandboxClientOptions = {},
): SandboxClient {
  return {
    async create(createOptions?: CreateSandboxOptions): Promise<SandboxInstance> {
      const defaults = options.defaults ?? {}
      const sandboxInput = createInputFromSandboxOptions(createOptions)
      const customInput = options.mapCreateOptions?.(createOptions) ?? {}
      const mapped = {
        ...defaults,
        ...sandboxInput,
        ...customInput,
        providerOptions: {
          ...(defaults.providerOptions ?? {}),
          ...(sandboxInput.providerOptions ?? {}),
          ...(customInput.providerOptions ?? {}),
        },
      }
      if (mapped.backend === undefined) delete mapped.backend
      if (mapped.profile === undefined) {
        throw new ValidationError(
          `providerAsSandboxClient(${provider.name}): profile required in defaults or CreateSandboxOptions.backend.profile`,
        )
      }
      if (options.requireSession) {
        const capabilities = await provider.capabilities()
        if (!capabilities.streaming.live || !capabilities.sessions.continue) {
          throw new ValidationError(
            `providerAsSandboxClient(${provider.name}): live session continuation is required`,
          )
        }
      }
      const environment = await provider.create(mapped as CreateAgentEnvironmentInput)
      if (options.requireSession && !environment.session) {
        await environment.destroy?.()
        throw new ValidationError(
          `providerAsSandboxClient(${provider.name}): session() is required`,
        )
      }
      return environmentAsSandboxInstance(environment, {
        requireTerminalEvent: options.requireTerminalEvent ?? true,
      })
    },
  }
}

/** Options for wrapping the current Tangle sandbox client as an environment provider.
 * @experimental */
export interface SandboxClientProviderOptions {
  name?: string
  defaultBackend?: BackendType
  capabilities?:
    | AgentEnvironmentCapabilities
    | (() => AgentEnvironmentCapabilities | Promise<AgentEnvironmentCapabilities>)
  validateProfile?: (
    profile: AgentProfileRef,
  ) => AgentProfileValidationResult | Promise<AgentProfileValidationResult>
  /** Resolve a named profile before calling Sandbox, which accepts inline profiles only. */
  resolveProfile?: (profileId: string) => AgentProfile | Promise<AgentProfile>
  mapCreateInput?: (input: CreateAgentEnvironmentInput) => CreateSandboxOptions
}

/**
 * Adapt a `SandboxClient` into the shared `AgentEnvironmentProvider` contract.
 * The provider declares the public SDK contract before it creates an environment.
 * Each environment exposes interactive methods only when its deployment declares every required capability.
 * @experimental */
export function sandboxClientAsProvider(
  client: SandboxClient,
  options: SandboxClientProviderOptions = {},
): AgentEnvironmentProvider {
  const providerName = options.name ?? 'tangle-sandbox'
  const providerCapabilities = async (): Promise<AgentEnvironmentCapabilities> => {
    const capabilities = options.capabilities
      ? typeof options.capabilities === 'function'
        ? options.capabilities()
        : options.capabilities
      : defaultTangleSandboxCapabilities({
          namedProfiles: options.resolveProfile !== undefined,
          rediscover: hasGet(client),
        })
    const resolved = await capabilities
    if (hasGet(client)) return resolved
    const { interactiveAgent: _interactiveAgent, ...withoutInteractive } = resolved
    return withoutInteractive
  }
  return {
    name: providerName,
    capabilities: providerCapabilities,
    ...(options.validateProfile ? { validateProfile: options.validateProfile } : {}),
    async create(input: CreateAgentEnvironmentInput): Promise<AgentEnvironment> {
      const createOptions =
        options.mapCreateInput?.(input) ??
        (await sandboxOptionsFromCreateInput(
          input,
          options.defaultBackend ?? 'opencode',
          options.resolveProfile,
          providerName,
        ))
      const capabilities = await providerCapabilities()
      const box = await client.create(
        createOptions,
        input.signal === undefined ? undefined : { signal: input.signal },
      )
      return sandboxInstanceAsEnvironment(box, providerName, client, capabilities)
    },
    ...(hasGet(client)
      ? {
          async get(id: string): Promise<AgentEnvironment | null> {
            const capabilities = await providerCapabilities()
            const box = await client.get(id)
            return box
              ? sandboxInstanceAsEnvironment(box, providerName, client, capabilities)
              : null
          },
        }
      : {}),
    ...(hasList(client)
      ? {
          async list(query?: AgentEnvironmentQuery): Promise<AgentEnvironmentSummary[]> {
            const boxes = await client.list(query?.providerOptions)
            return boxes.map((box) => ({
              id: String(box.id),
              provider: providerName,
              name: typeof box.name === 'string' ? box.name : undefined,
              status: statusFromUnknown(readBoxStatus(box)),
              metadata: readBoxMetadata(box),
            }))
          },
        }
      : {}),
  }
}

/**
 * What one provider-executed turn settles on: the visible answer plus the complete event archive
 * the environment streamed. It is the value a `ProviderExecutorOptions.validator` scores.
 *
 * @experimental
 */
export interface ProviderLeafOut {
  content: string
  events: AgentEnvironmentEvent[]
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

/** Turn fields the seam's prompt options configure. The kernel owns every other coordinate. */
type ProviderTurnDefaults = Omit<
  AgentTurnInput,
  'model' | 'parts' | 'prompt' | 'sessionId' | 'signal'
>

/**
 * Lower the seam's prompt options onto turn fields, through the one mapper this module already
 * uses to raise a sandbox prompt into a provider turn. Reusing it is what keeps the two directions
 * from drifting: whatever `turnInputFromPrompt` decides a prompt option configures, the seam
 * declares the same way.
 */
function providerTurnDefaults(
  options: ProviderPromptOptions | undefined,
  context: string,
): ProviderTurnDefaults | undefined {
  if (options === undefined) return undefined
  if ((options as { model?: unknown }).model !== undefined) {
    throw new ValidationError(
      `${context}: promptOptions.model is refused — this executor's materialization names AgentProfile's model, so a turn-level override would record a model the provider did not run`,
    )
  }
  const {
    prompt: _prompt,
    parts: _parts,
    model: _model,
    sessionId: _sessionId,
    signal: _signal,
    ...turn
  } = turnInputFromPrompt('', options)
  return turn
}

/** Options for running a provider as a supervise-mode executor.
 * @experimental */
export interface ProviderExecutorOptions {
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
   *
   * The verdict becomes the settled artifact's verdict. Absent, nothing changes and the leaf falls
   * back to its own settle verdict.
   */
  validator?: Validator<ProviderLeafOut>
  /** Transform only the profile sent to `provider.create`. The original profile
   * remains the input to `taskToTurn`, so execution-only normalization cannot
   * rewrite the caller's task mapping. */
  profileForCreate?: (profile: AgentProfile) => AgentProfile
  taskToTurn?: (task: unknown, specProfile: AgentProfile) => AgentTurnInput
}

/**
 * Merge the declared turn defaults under one mapped turn.
 *
 * `providerOptions` is merged one level rather than replaced: the defaults carry the caller's
 * session credential and a `taskToTurn` that sets an unrelated provider option would otherwise
 * remove it, and a run that silently loses its credential fails inside the environment as an
 * authorization error that names nothing.
 */
function providerTurnWithDefaults(
  defaults: ProviderTurnDefaults | undefined,
  turn: AgentTurnInput,
  signal: AbortSignal,
): AgentTurnInput {
  if (defaults === undefined) return { ...turn, signal }
  const providerOptions =
    defaults.providerOptions === undefined && turn.providerOptions === undefined
      ? undefined
      : { ...(defaults.providerOptions ?? {}), ...(turn.providerOptions ?? {}) }
  return {
    ...defaults,
    ...turn,
    ...(providerOptions === undefined ? {} : { providerOptions }),
    signal,
  }
}

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
  return (spec, ctx) => createProviderExecutor(provider, spec.profile, ctx, options)
}

function createProviderExecutor(
  provider: AgentEnvironmentProvider,
  profile: AgentProfile,
  ctx: ExecutorContext,
  options: ProviderExecutorOptions,
): Executor<unknown> {
  const controller = linkAbort(ctx.signal)

  let environment: AgentEnvironment | undefined
  let artifact: ExecutorResult<unknown> | undefined
  // The stream destroys the environment on settle by default, so a later `teardown` would issue a
  // SECOND delete against a resource that is already gone. That second call is what the provider
  // answered 409 to.
  let destroyed = false

  const runtime = options.runtime ?? (provider.name as Runtime)
  // The exact bytes this executor hands to `provider.create`. A `profileForCreate` overlay changes
  // them, so the declaration carries the overlaid profile and exact turn execution refuses the run
  // rather than presenting the authored profile as what the provider received.
  const createProfile = options.profileForCreate?.(profile) ?? profile
  const executionId = ctx.node?.nodeId ?? `provider-run-${randomUUID()}`
  const attemptId = ctx.node?.attemptId ?? newExecutionAttemptId(executionId)
  const providerModel = concreteProfileModel(createProfile)
  // The provider owns the model call inside its environment and the create input carries no
  // completion cap, so a requested ceiling is refused before the environment is paid for.
  const tokenLimits = enforceTokenLimits(
    profileModelExecutionSettings(createProfile, `providerAsExecutor(${provider.name})`)
      .tokenLimits,
    'provider',
    `providerAsExecutor(${provider.name})`,
  )
  // The environment identity is server-issued, so before `create` resolves this declaration is a
  // planned authority check, never a receipt.
  const plannedDeclaration: ExecutorMaterialization = {
    effectiveProfile: createProfile,
    backend: provider.name,
    model: providerModel
      ? { status: 'known', id: providerModel }
      : { status: 'unknown', reason: 'provider environment selected its default model' },
    execution: { kind: 'environment', id: executionId },
    materializer: 'environment-provider-create',
    plan: {
      kind: 'agent-environment',
      provider: provider.name,
      destroyOnSettle: options.destroyOnSettle ?? true,
      requireTerminalEvent: options.requireTerminalEvent ?? true,
      tokenLimits,
      environmentId: null,
    },
  }
  const plannedBinding: ExecutorExecutionBinding = {
    attemptId,
    binding: {
      provider: provider.name,
      executionId,
      model: providerModel ?? null,
    },
    descriptor: { kind: 'agent-environment', transport: 'provider', backend: provider.name },
  }

  let executor!: Executor<unknown>
  executor = {
    runtime,
    execute(task, signal): AsyncIterable<UsageEvent> {
      return streamProviderExecutor({
        provider,
        profile,
        createProfile,
        task,
        signal,
        controller,
        options,
        onEnvironment: (env) => {
          environment = env
          // `create` resolved, so the environment identity the provider issued is now evidence.
          finalizeRuntimeOwnedPendingExecutor(
            executor,
            {
              ...plannedDeclaration,
              execution: { kind: 'environment', id: env.id },
              plan: { ...(plannedDeclaration.plan as object), environmentId: env.id },
            },
            plannedBinding,
          )
        },
        onArtifact: (next) => {
          artifact = next
        },
        onDestroyed: () => {
          destroyed = true
        },
      })
    },
    async cancel(request): Promise<ExecutorCancellation> {
      // The provider streams a turn rather than dispatching a durable run, so this executor holds
      // no exact control reference the provider could cancel against. Aborting the local stream is
      // all Runtime can prove; the environment stays alive for `teardown` to release.
      controller.abort()
      return {
        status: 'unknown',
        effect: 'cancel_requested',
        observedAt: new Date().toISOString(),
        detail: `providerAsExecutor(${provider.name}): the streamed turn carries no durable run reference, so the provider acknowledged nothing`,
        evidence: {
          operationId: request.operationId,
          ...(environment ? { environmentId: environment.id } : {}),
        },
      }
    },
    async teardown(_grace): Promise<{ destroyed: boolean; detail?: string }> {
      controller.abort()
      // Already released by the stream's own settle path: re-deleting is the double call that
      // produced the 409, and the resource is provably gone, so this is a confirmed teardown.
      if (destroyed || environment === undefined) return { destroyed: true }
      try {
        await environment.destroy?.()
        destroyed = true
        return { destroyed: true }
      } catch (error) {
        // A cleanup this process could not complete is UNCONFIRMED, not a run failure. `destroyed:
        // false` is exactly what the barrier journals as `teardown-unconfirmed`; throwing here
        // would instead surface as a failure of the work the executor already finished.
        return {
          destroyed: false,
          detail: `providerAsExecutor(${provider.name}): environment.destroy() failed — ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },
    resultArtifact(): ExecutorResult<unknown> {
      if (!artifact) {
        throw new ValidationError(
          `providerAsExecutor(${provider.name}): resultArtifact() read before stream drained`,
        )
      }
      return artifact
    },
  }
  return attestRuntimeOwnedPendingExecutor(executor, runtime, plannedDeclaration, plannedBinding)
}

interface StreamProviderExecutorArgs {
  provider: AgentEnvironmentProvider
  profile: AgentProfile
  /** The exact profile handed to `provider.create` — the authored profile unless the caller
   *  installed a `profileForCreate` overlay. */
  createProfile: AgentProfile
  task: unknown
  signal: AbortSignal
  controller: AbortController
  options: ProviderExecutorOptions
  onEnvironment: (environment: AgentEnvironment) => void
  onArtifact: (artifact: ExecutorResult<unknown>) => void
  /** The environment was destroyed here, so `teardown` must not DELETE it a second time — the
   *  double delete is what produced the 409 that used to fail a completed run. */
  onDestroyed: () => void
}

async function* streamProviderExecutor(
  args: StreamProviderExecutorArgs,
): AsyncIterable<UsageEvent> {
  const started = Date.now()
  const linked = linkAbort(args.signal, args.controller.signal).signal
  // READINESS IS THE PROVIDER'S CONTRACT. `create` resolves with an environment that can take a
  // turn, so this streams straight into it and adds no wait of its own. The sandbox seam's
  // `acquireSandbox` exists because a raw `SandboxClient.create` returns before the box is ready;
  // wrapping a second readiness poll around a provider that already honors the contract would hide
  // a provider that does not, and a provider that does not is an upstream defect to report.
  const environment = await args.provider.create({
    ...(args.options.defaults ?? {}),
    profile: args.createProfile,
    signal: linked,
  })
  args.onEnvironment(environment)

  const turn = providerTurnWithDefaults(
    providerTurnDefaults(args.options.promptOptions, `providerAsExecutor(${args.provider.name})`),
    args.options.taskToTurn?.(args.task, args.profile) ?? taskToTurnInput(args.task, linked),
    linked,
  )
  const events: AgentEnvironmentEvent[] = []
  const tokens = zeroTokenUsage()
  let usd = 0
  let text = ''
  let terminal = false
  // The artifact this turn settled with, once it exists. Its presence is what separates "the work
  // finished and the resource would not release" from "the work never finished".
  let settled: ExecutorResult<unknown> | undefined
  // The body's own failure, held so the `finally` cannot REPLACE it. A `finally` that throws
  // discards the in-flight exception, so a teardown error would otherwise mask the real cause of a
  // turn that failed for its own reasons.
  let failure: unknown
  let failed = false
  try {
    const toolParts = createSandboxToolPartState()
    for await (const event of environment.stream(turn)) {
      events.push(event)
      text += textFromEnvironmentEvent(event)
      // One projection for every sandbox-shaped stream: the provider event is adapted to the
      // sandbox wire the mappers already read, so live output needs no provider-specific parser.
      for (const progress of sandboxProgressEvents(
        sandboxEventFromEnvironmentEvent(event),
        toolParts,
      )) {
        yield { kind: 'progress', progress }
      }
      const usage = usageFromEnvironmentEvent(event)
      if (usage.input || usage.output) {
        tokens.input += usage.input
        tokens.output += usage.output
        yield { kind: 'tokens', input: usage.input, output: usage.output }
      }
      if (usage.usd) {
        usd += usage.usd
        // A provider-reported dollar figure carries no receipt, so it is an observed floor.
        yield { kind: 'cost', usdKnown: false, usd: usage.usd, provenance: 'uncaptured' }
      }
      if (isTerminalEnvironmentEvent(event)) terminal = true
    }
    if ((args.options.requireTerminalEvent ?? true) && !terminal) {
      throw new ValidationError(
        `providerAsExecutor(${args.provider.name}): stream ended without a terminal result/done/status event`,
      )
    }
    yield { kind: 'iteration' }
    const result = resultFromEvents(events, text)
    const spent: Spend = {
      iterations: 1,
      tokens,
      usd,
      // No provider event carries a billing receipt, so the dollar channel stays unproven even
      // when the provider reported a number. A dollar cap must refuse rather than compare.
      usdKnown: false,
      ms: Date.now() - started,
    }
    // Scored HERE, before the `finally` destroys the environment: a validator that reads a file or
    // runs a command needs the environment it is scoring to still exist. Every other supervised
    // hook fires after teardown and can only read the artifact.
    const verdict = await args.options.validator?.validate(result, {
      iteration: 0,
      box: environmentAsSandboxInstance(environment, {
        requireTerminalEvent: args.options.requireTerminalEvent ?? true,
      }),
      signal: linked,
    })
    settled = {
      outRef: contentRef(`provider:${args.provider.name}`, result),
      out: result,
      ...(verdict ? { verdict } : {}),
      spent,
    }
    args.onArtifact(settled)
  } catch (error) {
    failure = error
    failed = true
  } finally {
    if (args.options.destroyOnSettle ?? true) {
      try {
        await environment.destroy?.()
        args.onDestroyed()
      } catch (error) {
        // ONCE THE TURN HAS SETTLED, TEARDOWN CANNOT CHANGE THE OUTCOME. Measured: a second DELETE
        // answered 409, the rejection escaped this `finally`, and a run whose turn had completed
        // (`spent.iterations: 1`, artifact produced) was reported as a failure. The resource fact is
        // recorded beside the result; the result stands.
        //
        // Before the turn settles there is no outcome to protect, so the failure IS the outcome and
        // is rethrown — a create-then-fail-then-leak path must still fail loudly.
        if (settled !== undefined) {
          args.onArtifact({
            ...settled,
            teardown: {
              failed: true,
              error: error instanceof Error ? error.message : String(error),
              at: new Date().toISOString(),
            },
          })
        } else if (!failed) {
          // Nothing settled and the body did not fail on its own: the teardown failure IS the
          // outcome, so a create-then-leak path still fails loudly.
          failure = error
          failed = true
        } else {
          // The body already failed. ITS error is the cause a reader needs; the teardown failure
          // rides along as `cause` rather than displacing it.
          failure =
            failure instanceof Error
              ? Object.assign(failure, { cause: failure.cause ?? error })
              : failure
        }
      }
    }
  }
  if (failed) throw failure
}

function createInputFromSandboxOptions(
  options: CreateSandboxOptions | undefined,
): Partial<CreateAgentEnvironmentInput> {
  const profile = options?.backend?.profile
  const backend = options?.backend?.type
  const cwd =
    options?.cwd === undefined
      ? undefined
      : canonicalWorkspaceCwd({ base: 'repository', path: options.cwd })
  const workspace = {
    ...(options?.environment ? { environment: options.environment } : {}),
    ...(options?.git?.url ? { repoUrl: options.git.url } : {}),
    ...(options?.git?.ref ? { gitRef: options.git.ref } : {}),
    ...(cwd === undefined ? {} : { cwd }),
  }
  return {
    ...(profile !== undefined ? { profile } : {}),
    ...(backend ? { backend } : {}),
    ...(Object.keys(workspace).length > 0 ? { workspace } : {}),
    ...(options?.resources ? { resources: options.resources as ResourceRequest } : {}),
    ...(options?.env ? { env: options.env } : {}),
    // Sandbox 0.34 adds the provider-owned "all" selector. Keep it in the
    // passthrough options below because the neutral input contract accepts names only.
    ...(Array.isArray(options?.secrets) ? { secrets: options.secrets } : {}),
    ...(options?.metadata ? { metadata: options.metadata } : {}),
    ...(options?.name ? { name: options.name } : {}),
    ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    providerOptions: { sandboxCreateOptions: options ?? {} },
  }
}

async function sandboxOptionsFromCreateInput(
  input: CreateAgentEnvironmentInput,
  defaultBackend: BackendType,
  resolveProfile?: SandboxClientProviderOptions['resolveProfile'],
  providerName = 'tangle-sandbox',
): Promise<CreateSandboxOptions> {
  const backendType = (input.backend ?? defaultBackend) as BackendType
  const workspace = WorkspaceRequestSchema.parse(input.workspace ?? {})
  const environment = sandboxEnvironmentFromWorkspace(workspace)
  const cwd = workspaceCwdPathForBase(workspace.cwd, 'repository', providerName)
  const providerOptions = input.providerOptions?.sandboxCreateOptions
  const base =
    providerOptions && typeof providerOptions === 'object'
      ? ({ ...(providerOptions as CreateSandboxOptions) } as CreateSandboxOptions)
      : ({} satisfies CreateSandboxOptions)
  assertSandboxSecretNames(input.secrets)
  assertSandboxSecretNames((base as { secrets?: unknown }).secrets)
  const profile = await sandboxProfileFromReference(input.profile, resolveProfile)
  const { profile: _baseProfile, ...baseBackend } = base.backend ?? {}
  return {
    ...base,
    ...(environment ? { environment } : {}),
    ...(workspace.repoUrl ? { git: { url: workspace.repoUrl, ref: workspace.gitRef } } : {}),
    ...(cwd === undefined ? {} : { cwd }),
    ...(input.resources ? { resources: input.resources as CreateSandboxOptions['resources'] } : {}),
    ...(input.env ? { env: input.env } : {}),
    ...(Array.isArray(input.secrets) ? { secrets: input.secrets } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    ...(input.name ? { name: input.name } : {}),
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    backend: {
      ...baseBackend,
      type: backendType,
      profile,
    },
  }
}

function assertSandboxSecretNames(
  secrets: unknown,
): asserts secrets is string[] | 'all' | undefined {
  if (
    secrets !== undefined &&
    secrets !== 'all' &&
    (!Array.isArray(secrets) ||
      secrets.some((secret) => typeof secret !== 'string' || secret.trim().length === 0))
  ) {
    throw new ValidationError(
      'Tangle Sandbox secret names must be non-empty strings; secret values are unsupported',
    )
  }
}

function sandboxEnvironmentFromWorkspace(
  workspace: NonNullable<CreateAgentEnvironmentInput['workspace']>,
): string | undefined {
  if (
    workspace.environment !== undefined &&
    workspace.image !== undefined &&
    workspace.environment !== workspace.image
  ) {
    throw new ValidationError(
      'Tangle Sandbox accepts one environment value; workspace.environment and workspace.image must match',
    )
  }
  return workspace.environment ?? workspace.image
}

async function sandboxProfileFromReference(
  profile: AgentProfileRef,
  resolveProfile: SandboxClientProviderOptions['resolveProfile'],
): Promise<AgentProfile> {
  if (typeof profile !== 'string') return profile
  if (!resolveProfile) {
    throw new ValidationError(
      `Tangle Sandbox requires an inline AgentProfile; named profile "${profile}" needs SandboxClientProviderOptions.resolveProfile`,
    )
  }
  return resolveProfile(profile)
}

function environmentAsSandboxInstance(
  environment: AgentEnvironment,
  options: { requireTerminalEvent: boolean },
): SandboxInstance {
  const box = {
    id: environment.id,
    name: environment.name,
    status: 'running',
    async refresh(): Promise<void> {
      await environment.refresh?.()
    },
    async *streamPrompt(
      message: string | PromptInputPart[],
      promptOptions?: PromptOptions,
    ): AsyncGenerator<SandboxEvent> {
      let terminal = false
      const input = turnInputFromPrompt(message, promptOptions)
      let cancellation: Promise<void> | undefined
      let cancellationStarted = false
      let cancellationFailed = false
      let cancellationError: unknown
      const cancel = () => {
        if (cancellationStarted || !input.sessionId || !environment.session) return
        cancellationStarted = true
        try {
          const session = environment.session(input.sessionId, {
            ...(input.controlRef === undefined ? {} : { controlRef: input.controlRef }),
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          })
          assertScopedSessionForInput(session, input)
          cancellation = session.cancel().catch((error: unknown) => {
            cancellationFailed = true
            cancellationError = error
          })
        } catch (error) {
          cancellationFailed = true
          cancellationError = error
        }
      }
      input.signal?.addEventListener('abort', cancel, { once: true })
      if (input.signal?.aborted) cancel()
      let streamFailed = false
      let streamError: unknown
      try {
        for await (const event of environment.stream(input)) {
          if (isTerminalEnvironmentEvent(event)) terminal = true
          const usageEvent = usageSandboxEvent(event)
          if (usageEvent) yield usageEvent
          yield sandboxEventFromEnvironmentEvent(event)
        }
      } catch (error) {
        streamFailed = true
        streamError = error
      } finally {
        input.signal?.removeEventListener('abort', cancel)
        if (input.signal?.aborted) {
          cancel()
          await cancellation
        }
      }
      if (input.signal?.aborted) {
        const abortError = new DOMException('Provider session stream aborted', 'AbortError')
        const causes = [
          ...(streamFailed ? [streamError] : []),
          ...(cancellationFailed ? [cancellationError] : []),
        ]
        if (causes.length > 0) {
          Object.defineProperty(abortError, 'cause', {
            value:
              causes.length === 1
                ? causes[0]
                : new AggregateError(causes, 'Provider stream and cancellation failed'),
          })
        }
        throw abortError
      }
      if (streamFailed) throw streamError
      if (cancellationFailed) throw cancellationError
      if (options.requireTerminalEvent && !terminal) {
        throw new ValidationError(
          `providerAsSandboxClient(${environment.provider}): stream ended without a terminal result/done/status event`,
        )
      }
    },
    async prompt(
      message: string | PromptInputPart[],
      promptOptions?: PromptOptions,
    ): Promise<PromptResult> {
      const events: AgentEnvironmentEvent[] = []
      let text = ''
      let usage: TokenUsage | undefined
      let terminal = false
      for await (const event of environment.stream(turnInputFromPrompt(message, promptOptions))) {
        events.push(event)
        if (isTerminalEnvironmentEvent(event)) terminal = true
        text += textFromEnvironmentEvent(event)
        usage = mergeTokenUsage(usage, event.usage)
      }
      if (options.requireTerminalEvent && !terminal) {
        throw new ValidationError(
          `providerAsSandboxClient(${environment.provider}): prompt ended without a terminal result/done/status event`,
        )
      }
      return {
        response: resultFromEvents(events, text).content,
        success: true,
        status: 'success',
        durationMs: 0,
        ...(usage ? { usage } : {}),
      }
    },
    ...(environment.dispatch && environment.session
      ? {
          async dispatchPrompt(message: string | PromptInputPart[], promptOptions?: PromptOptions) {
            const session = await environment.dispatch?.(
              turnInputFromPrompt(message, promptOptions),
            )
            if (!session)
              throw new ValidationError('providerAsSandboxClient: dispatch returned no session')
            return sandboxDispatchResultFromSessionRef(session)
          },
        }
      : {}),
    ...(environment.session
      ? {
          session(id: string, sessionOptions?: { controlRef?: AgentRunControlRef }) {
            return sandboxSessionFromAgentSession(
              environment.session?.(id, sessionOptions),
              sessionOptions?.controlRef,
            )
          },
        }
      : {}),
    ...(environment.read ? { read: environment.read.bind(environment) } : {}),
    ...(environment.write ? { write: environment.write.bind(environment) } : {}),
    ...(environment.exec
      ? {
          exec: environment.exec.bind(environment),
        }
      : {}),
    ...(environment.checkpoint
      ? {
          async checkpoint(checkpointOptions?: CheckpointRequest) {
            const checkpoint = await environment.checkpoint?.(checkpointOptions)
            return { checkpointId: checkpoint?.id, id: checkpoint?.id }
          },
        }
      : {}),
    ...(environment.fork
      ? {
          async fork(checkpointId: string, forkOptions?: ForkRequest) {
            const forked = await environment.fork?.({ id: checkpointId }, forkOptions)
            if (!forked)
              throw new ValidationError('providerAsSandboxClient: fork returned no environment')
            return environmentAsSandboxInstance(forked, options)
          },
        }
      : {}),
    async delete(): Promise<void> {
      await environment.destroy?.()
    },
  }
  return box as unknown as SandboxInstance
}

async function sandboxInstanceAsEnvironment(
  box: SandboxInstance,
  providerName: string,
  client: SandboxClient,
  providerCapabilities: AgentEnvironmentCapabilities,
): Promise<AgentEnvironment> {
  const capabilities = await sandboxEnvironmentCapabilities(box, providerCapabilities)
  const interactiveAgent = capabilities.interactiveAgent
  const environment: AgentEnvironment = {
    id: String(box.id),
    provider: providerName,
    capabilities,
    ...(typeof box.name === 'string' ? { name: box.name } : {}),
    ...(readBoxMetadata(box) ? { metadata: readBoxMetadata(box) } : {}),
    async status(): Promise<AgentEnvironmentStatus> {
      await maybeRefresh(box)
      return statusFromUnknown(readBoxStatus(box))
    },
    async *stream(input: AgentTurnInput): AsyncIterable<AgentEnvironmentEvent> {
      for await (const event of box.streamPrompt(
        promptFromAgentTurnInput(input),
        promptOptionsFromAgentTurnInput(input),
      )) {
        yield environmentEventFromSandboxEvent(event)
      }
    },
    ...(hasDispatchPrompt(box)
      ? {
          async dispatch(input: AgentTurnInput): Promise<AgentSessionRef> {
            const dispatched = await box.dispatchPrompt(
              promptFromAgentTurnInput(input),
              promptOptionsFromAgentTurnInput(input),
            )
            return sessionRefFromSandboxDispatch(dispatched, providerName)
          },
        }
      : {}),
    ...(hasSession(box)
      ? {
          session(id: string, sessionOptions?: { controlRef?: AgentRunControlRef }): AgentSession {
            return sandboxSessionAsAgentSession(box.session(id), sessionOptions?.controlRef)
          },
          async respondToInteraction(
            command: InteractionResponseCommand,
            options?: { signal?: AbortSignal },
          ): Promise<InteractionAcknowledgement> {
            const response = await box
              .session(command.binding.sessionId)
              .respondToInteraction(command, options)
            return response.acknowledgement
          },
        }
      : {}),
    ...(interactiveAgent
      ? {
          async startInteractive(
            request: AgentInteractiveSessionStart,
            options?: { signal?: AbortSignal },
          ): Promise<AgentInteractiveSessionRef> {
            const exactRequest = AgentInteractiveSessionStartSchema.parse(request)
            assertSandboxInteractiveBinding(exactRequest.run, box, providerName)
            const result = await box
              .session(exactRequest.run.sessionId)
              .interactive()
              .start(exactRequest, options)
            if (result.state !== 'running') {
              throw new ValidationError('sandbox interactive process settled before attachment')
            }
            const ref = detachedSnapshot(
              AgentInteractiveSessionRefSchema.parse(result.ref),
              'sandbox interactive start reference',
            )
            if (!agentInteractiveSessionRefMatchesStart(exactRequest, ref)) {
              throw new ValidationError(
                'sandbox interactive start returned a different exact process',
              )
            }
            return ref
          },
          interactive(ref: AgentInteractiveSessionRef): AgentInteractiveSession {
            const exactRef = detachedSnapshot(
              AgentInteractiveSessionRefSchema.parse(ref),
              'sandbox interactive reference',
            )
            assertSandboxInteractiveBinding(exactRef.run, box, providerName)
            const session = box.session(exactRef.run.sessionId).interactive({ ref: exactRef })
            const controlledSessions = new Map<string, InteractiveSessionHandle>()
            const controlledSession = (
              control: Parameters<AgentInteractiveSession['attach']>[0]['control'],
            ) => {
              const key = canonicalCandidateDigest(control)
              const existing = controlledSessions.get(key)
              if (existing) return existing
              const created = box
                .session(exactRef.run.sessionId)
                .interactive({ ref: exactRef, control })
              controlledSessions.set(key, created)
              return created
            }
            return {
              ref: exactRef,
              claimControl: (request, options) => session.claimControl(request, options),
              async status(options) {
                const status = await session.status(options)
                if (status === null) {
                  throw new ValidationError(
                    `sandbox interactive session "${exactRef.run.sessionId}" is unavailable`,
                  )
                }
                return status
              },
              attach: (request, options) => {
                const controlled = controlledSession(request.control)
                if (typeof controlled.attachAgentTerminal !== 'function') {
                  return Promise.reject(
                    new ValidationError(
                      'sandbox interactive session does not expose the exact terminal adapter',
                    ),
                  )
                }
                return controlled.attachAgentTerminal(request, options)
              },
              sendPrompt: (command, options) =>
                controlledSession(command.control).sendPrompt(command, options),
              stop: (command, options) => controlledSession(command.control).stop(command, options),
            }
          },
        }
      : {}),
    ...(hasRead(box) ? { read: box.read.bind(box) } : {}),
    ...(hasWrite(box) ? { write: box.write.bind(box) } : {}),
    ...(hasExec(box)
      ? {
          async exec(command: string, options?: ExecRequest): Promise<ExecResult> {
            return execResultFromSandboxExecResult(await box.exec(command, options as never))
          },
        }
      : {}),
    async checkpoint(options?: CheckpointRequest): Promise<CheckpointRef> {
      const result = await box.snapshot({
        ...(options?.name ? { tags: [options.name] } : {}),
      })
      return {
        id: result.snapshotId,
        provider: providerName,
        ...(options?.metadata ? { metadata: options.metadata } : {}),
      }
    },
    async fork(checkpoint: CheckpointRef, options?: ForkRequest): Promise<AgentEnvironment> {
      const forked = await client.create({
        fromSnapshot: checkpoint.id,
        fromSandboxId: String(box.id),
        ...(options?.name ? { name: options.name } : {}),
        ...(options?.metadata ? { metadata: options.metadata } : {}),
      })
      return sandboxInstanceAsEnvironment(forked, providerName, client, providerCapabilities)
    },
    async placement(): Promise<PlacementInfo> {
      return placementInfoFromLoopPlacement(client.describePlacement?.(box), box)
    },
    async refresh(): Promise<void> {
      await maybeRefresh(box)
    },
    async destroy(): Promise<void> {
      await destroyBox(box)
    },
  }
  return environment
}

function sandboxSessionAsAgentSession(
  session: SandboxSessionLike,
  expectedControlRef?: AgentRunControlRef,
): AgentSession {
  // SandboxSession has no synchronous controlRef property. The exact ref
  // returned by dispatch is therefore the wrapper's persisted binding, while
  // any ref later exposed by status is still validated below.
  const controlRef = resolveSessionControlRef(session.controlRef, expectedControlRef, {
    allowExpectedWhenActualAbsent: true,
  })
  return {
    id: session.id,
    ...(controlRef === undefined ? {} : { controlRef }),
    async status(): Promise<AgentSessionStatus | null> {
      const status = await session.status()
      if (!status) return null
      assertSandboxStatusBinding(status, controlRef)
      return sessionStatusFromUnknown((status as { status?: unknown }).status)
    },
    async *events(options?: {
      since?: string
      executionId?: string
      signal?: AbortSignal
    }): AsyncIterable<AgentEnvironmentEvent> {
      const executionId = scopedExecutionId(controlRef, options?.executionId)
      for await (const event of session.events({
        ...(options?.since === undefined ? {} : { since: options.since }),
        ...(executionId === undefined ? {} : { executionId }),
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      }))
        yield environmentEventFromSandboxEvent(event)
    },
    async result(options?: { signal?: AbortSignal }): Promise<AgentTurnResult> {
      return agentTurnResultFromPromptResult(
        await awaitAbortable(
          Promise.resolve().then(() =>
            session.result({
              ...(controlRef?.executionId === undefined
                ? {}
                : { executionId: controlRef.executionId }),
            }),
          ),
          options?.signal,
        ),
      )
    },
    async prompt(input: AgentTurnInput): Promise<AgentTurnResult> {
      return agentTurnResultFromPromptResult(
        await session.prompt(
          promptFromAgentTurnInput(input),
          promptOptionsFromAgentTurnInput(input),
        ),
      )
    },
    ...(session.respondToInteraction
      ? {
          async respondToInteraction(
            command: InteractionResponseCommand,
            options?: { signal?: AbortSignal },
          ): Promise<InteractionAcknowledgement> {
            assertInteractionCommandScope(command, controlRef)
            const response = await session.respondToInteraction!(command, options)
            return response.acknowledgement
          },
        }
      : {}),
    ...(session.cancelRun
      ? {
          async cancelRun(
            request: AgentRunCancellationRequest,
            options?: { signal?: AbortSignal },
          ): Promise<AgentRunCancellationAcknowledgement> {
            assertCancellationScope(request, controlRef)
            return session.cancelRun!(request, options)
          },
        }
      : {}),
    cancel(): Promise<void> {
      return session
        .interrupt(
          controlRef?.executionId === undefined
            ? undefined
            : { executionId: controlRef.executionId },
        )
        .then(() => undefined)
    },
  }
}

function sandboxSessionFromAgentSession(
  session: AgentSession | undefined,
  expectedControlRef?: AgentRunControlRef,
): SandboxSessionLike {
  if (!session) throw new ValidationError('providerAsSandboxClient: session is unavailable')
  const controlRef = resolveSessionControlRef(session.controlRef, expectedControlRef)
  return {
    id: session.id,
    ...(controlRef === undefined ? {} : { controlRef }),
    async status() {
      const status = await session.status()
      if (!status) return null
      return {
        id: session.id,
        status: sandboxSessionStatusFromAgentSessionStatus(status),
      }
    },
    async *events(options?: {
      since?: string
      executionId?: string
      signal?: AbortSignal
    }): AsyncGenerator<SandboxEvent> {
      const executionId = scopedExecutionId(controlRef, options?.executionId)
      for await (const event of session.events({
        ...(options?.since === undefined ? {} : { since: options.since }),
        ...(executionId === undefined ? {} : { executionId }),
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      }))
        yield sandboxEventFromEnvironmentEvent(event)
    },
    async result(options?: { executionId?: string }): Promise<PromptResult> {
      scopedExecutionId(controlRef, options?.executionId)
      return promptResultFromAgentTurnResult(await session.result())
    },
    async prompt(
      message: string | PromptInputPart[],
      options?: PromptOptions,
    ): Promise<PromptResult> {
      return promptResultFromAgentTurnResult(
        await session.prompt(turnInputFromPrompt(message, options)),
      )
    },
    ...(session.respondToInteraction
      ? {
          async respondToInteraction(
            command: InteractionResponseCommand,
            options?: { signal?: AbortSignal },
          ) {
            assertInteractionCommandScope(command, controlRef)
            return {
              acknowledgement: await session.respondToInteraction!(command, options),
            }
          },
        }
      : {}),
    ...(session.cancelRun
      ? {
          async cancelRun(
            request: AgentRunCancellationRequest,
            options?: { signal?: AbortSignal },
          ): Promise<AgentRunCancellationAcknowledgement> {
            assertCancellationScope(request, controlRef)
            return session.cancelRun!(request, options)
          },
        }
      : {}),
    async interrupt(options?: { executionId?: string }) {
      scopedExecutionId(controlRef, options?.executionId)
      await session.cancel()
      return { cancelled: true }
    },
  }
}

function sandboxSessionStatusFromAgentSessionStatus(
  status: AgentSessionStatus,
): 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' {
  switch (status) {
    case 'pending':
    case 'provisioning':
      return 'queued'
    case 'running':
      return 'running'
    case 'completed':
      return 'completed'
    case 'cancelled':
      return 'cancelled'
    // Sandbox has no neutral stopped state; do not report completion without success proof.
    case 'stopped':
    case 'failed':
    case 'expired':
    case 'unknown':
      return 'failed'
  }
}

function promptResultFromAgentTurnResult(result: AgentTurnResult): PromptResult {
  return {
    response: result.text,
    success: result.success,
    status: result.success ? 'success' : 'failed',
    durationMs: 0,
    ...(result.error ? { error: result.error } : {}),
    ...(result.usage
      ? {
          usage: {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
          },
          ...(result.usage.cost === undefined ? {} : { costUsd: result.usage.cost }),
        }
      : {}),
  }
}

function environmentEventFromSandboxEvent(event: SandboxEvent): AgentEnvironmentEvent {
  const data =
    event.data && typeof event.data === 'object'
      ? (event.data as Record<string, unknown>)
      : ({} as Record<string, unknown>)
  const normalized = canonicalStreamEventFromSandboxEvent(event)
  return {
    type: String(event.type),
    data,
    ...(event.id ? { id: event.id } : {}),
    ...(normalized ? { normalized } : {}),
    usage: tokenUsageFromData(data),
    providerEvent: event,
  }
}

function sandboxEventFromEnvironmentEvent(event: AgentEnvironmentEvent): SandboxEvent {
  const normalized = event.normalized
  const type = normalized?.type ?? event.type
  const baseData = normalized ? sandboxDataFromNormalizedEvent(event.data, normalized) : event.data
  const usage = event.usage ? tokenUsageData(event.usage) : undefined
  const data = (() => {
    if (!usage) return baseData
    if (isUsageType(type))
      return {
        ...baseData,
        tokensIn: event.usage?.inputTokens,
        tokensOut: event.usage?.outputTokens,
        ...(event.usage?.cost !== undefined ? { costUsd: event.usage.cost } : {}),
        ...usage,
      }
    if (isNestedUsageType(type)) return { ...baseData, usage }
    if (type === 'done') {
      return {
        ...baseData,
        tokenUsage: usage,
        ...(usage.totalCostUsd !== undefined ? { totalCostUsd: usage.totalCostUsd } : {}),
      }
    }
    return baseData
  })()
  return {
    type,
    data,
    ...(event.id ? { id: event.id } : {}),
  }
}

function usageSandboxEvent(event: AgentEnvironmentEvent): SandboxEvent | undefined {
  const type = event.normalized?.type ?? event.type
  if (!event.usage || isUsageType(type) || isNestedUsageType(type) || type === 'done') {
    return undefined
  }
  const usage = tokenUsageData(event.usage)
  if (
    usage.inputTokens === undefined &&
    usage.outputTokens === undefined &&
    usage.totalCostUsd === undefined
  ) {
    return undefined
  }
  return { type: 'llm_call', data: usage }
}

function sandboxDataFromNormalizedEvent(
  rawData: Record<string, unknown>,
  normalized: NonNullable<AgentEnvironmentEvent['normalized']>,
): Record<string, unknown> {
  const { type: _type, ...normalizedData } = normalized
  return {
    ...rawData,
    ...normalizedData,
    ...(normalized.type === 'message.part.updated' && normalized.part.type === 'text'
      ? { text: normalized.part.text }
      : {}),
  }
}

function tokenUsageData(usage: TokenUsage): Record<string, number> {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    ...(usage.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
    ...(usage.cacheReadInputTokens !== undefined
      ? { cacheReadInputTokens: usage.cacheReadInputTokens }
      : {}),
    ...(usage.cacheCreationInputTokens !== undefined
      ? { cacheCreationInputTokens: usage.cacheCreationInputTokens }
      : {}),
    ...(usage.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
    ...(usage.cost !== undefined ? { totalCostUsd: usage.cost } : {}),
  }
}

function turnInputFromPrompt(
  message: string | PromptInputPart[],
  options?: PromptOptions,
): AgentTurnInput {
  return {
    ...(typeof message === 'string' ? { prompt: message } : { parts: message }),
    ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options?.model ? { model: options.model } : {}),
    ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.executionId ? { executionId: options.executionId } : {}),
    ...(options?.lastEventId ? { lastEventId: options.lastEventId } : {}),
    ...(options?.turnId ? { turnId: options.turnId } : {}),
    ...(options?.detach !== undefined ? { detach: options.detach } : {}),
    ...(options?.context ? { context: options.context } : {}),
    ...(options?.runControlRef ? { controlRef: options.runControlRef } : {}),
    ...(options?.backend?.interactions ? { interactions: options.backend.interactions } : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
    ...(options?.backend ? { providerOptions: { backend: options.backend } } : {}),
  }
}

function resolveSessionControlRef(
  actual: AgentRunControlRef | undefined,
  expected: AgentRunControlRef | undefined,
  options: { allowExpectedWhenActualAbsent?: boolean } = {},
): AgentExactRunControlRef | undefined {
  if (expected === undefined) {
    if (actual === undefined) return undefined
    return AgentExactRunControlRefSchema.parse(actual)
  }
  const expectedExact = AgentExactRunControlRefSchema.parse(expected)
  if (actual === undefined) {
    if (options.allowExpectedWhenActualAbsent === true) return expectedExact
    throw new ValidationError('provider session omitted the required exact run control reference')
  }
  const actualExact = AgentExactRunControlRefSchema.safeParse(actual)
  if (!actualExact.success) {
    throw new ValidationError('provider session returned an invalid exact run control reference')
  }
  if (!sameControlCoordinates(actualExact.data, expectedExact)) {
    throw new ValidationError('provider session returned a different exact run control reference')
  }
  return actualExact.data
}

function assertSandboxStatusBinding(
  status: unknown,
  controlRef: AgentExactRunControlRef | undefined,
): void {
  if (!status || typeof status !== 'object' || controlRef === undefined) return
  const record = status as Record<string, unknown>
  if (record.runControlRef !== undefined) {
    const statusControlRef = AgentExactRunControlRefSchema.parse(record.runControlRef)
    if (!sameControlCoordinates(statusControlRef, controlRef)) {
      throw new ValidationError('sandbox status returned a different exact run control reference')
    }
  }
  for (const key of ['activeExecutionId', 'latestExecutionId']) {
    const executionId = record[key]
    if (executionId !== undefined && executionId !== controlRef.executionId) {
      throw new ValidationError('sandbox status returned a different execution')
    }
  }
}

function assertInteractionCommandScope(
  command: InteractionResponseCommand,
  controlRef: AgentRunControlRef | undefined,
): void {
  if (controlRef === undefined) return
  if (
    command.binding.runId !== controlRef.runId ||
    command.binding.provider !== controlRef.provider ||
    command.binding.environmentId !== controlRef.environmentId ||
    command.binding.sessionId !== controlRef.sessionId ||
    command.binding.executionId !== controlRef.executionId
  ) {
    throw new ValidationError('interaction response targeted a different execution')
  }
}

function assertCancellationScope(
  request: AgentRunCancellationRequest,
  controlRef: AgentExactRunControlRef | undefined,
): void {
  if (controlRef === undefined) {
    throw new ValidationError(
      'durable cancellation requires an exact wrapper run control reference',
    )
  }
  const exactRequest = AgentRunCancellationRequestSchema.parse(request)
  if (!sameControlCoordinates(exactRequest.run, controlRef)) {
    throw new ValidationError('cancellation targeted a different execution')
  }
}

function scopedExecutionId(
  controlRef: AgentRunControlRef | undefined,
  requested: string | undefined,
): string | undefined {
  if (
    controlRef?.executionId !== undefined &&
    requested !== undefined &&
    controlRef.executionId !== requested
  ) {
    throw new ValidationError('session operation targeted a different execution')
  }
  return controlRef?.executionId ?? requested
}

function assertScopedSessionForInput(session: AgentSession, input: AgentTurnInput): void {
  if (input.executionId === undefined && input.controlRef === undefined) return
  const sessionControlRef = AgentExactRunControlRefSchema.safeParse(session.controlRef)
  if (!sessionControlRef.success) {
    throw new ValidationError(
      'provider session did not expose an exact run control reference for scoped cancellation',
    )
  }
  const expectedControlRef =
    input.controlRef === undefined
      ? undefined
      : AgentExactRunControlRefSchema.parse(input.controlRef)
  if (
    (input.executionId !== undefined && sessionControlRef.data.executionId !== input.executionId) ||
    (expectedControlRef !== undefined &&
      !sameControlCoordinates(sessionControlRef.data, expectedControlRef))
  ) {
    throw new ValidationError('provider session returned a different exact run control reference')
  }
}

function taskToTurnInput(task: unknown, signal: AbortSignal): AgentTurnInput {
  return { prompt: taskToPrompt(task), signal }
}

function taskToPrompt(task: unknown): string {
  if (typeof task === 'string') return task
  if (task && typeof task === 'object') {
    const record = task as Record<string, unknown>
    for (const key of ['prompt', 'content', 'task', 'message']) {
      if (typeof record[key] === 'string') return record[key]
    }
  }
  return JSON.stringify(task)
}

function resultFromEvents(events: AgentEnvironmentEvent[], fallbackText: string): ProviderLeafOut {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    const text = event ? resultTextFromData(event.data) : undefined
    if (text !== undefined) return { content: text, events }
  }
  return { content: fallbackText, events }
}

function textFromEnvironmentEvent(event: AgentEnvironmentEvent): string {
  if (
    typeof event.normalized === 'object' &&
    event.normalized &&
    event.normalized.type === 'message.part.updated'
  ) {
    return typeof event.normalized.delta === 'string' ? event.normalized.delta : ''
  }
  const data = event.data
  for (const key of ['delta', 'chunk', 'content', 'text']) {
    if (typeof data[key] === 'string' && !isTerminalEnvironmentEvent(event)) return data[key]
  }
  return ''
}

function resultTextFromData(data: Record<string, unknown>): string | undefined {
  for (const key of ['finalText', 'text', 'response', 'resultSummary', 'content']) {
    if (typeof data[key] === 'string') return data[key]
  }
  return undefined
}

function isTerminalEnvironmentEvent(event: AgentEnvironmentEvent): boolean {
  if (isTerminalEventShape(event.type, event.data)) return true
  const normalized = event.normalized
  return (
    normalized?.type === 'status' &&
    (normalized.status === 'completed' || normalized.status === 'failed')
  )
}

function isTerminalEventShape(type: string, data: Record<string, unknown>): boolean {
  if (isSandboxTerminalEvent(type)) return true
  // A namespaced completion this provider transport may emit under any prefix. Broader than the
  // named sandbox list on purpose: an unknown `<x>.completed` still ends the stream.
  if (type.endsWith('.completed') || type.endsWith('.failed')) return true
  if (type !== 'status') return false
  return data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled'
}

function isUsageType(type: string): boolean {
  return type === 'llm_call' || type === 'usage' || type === 'cost.usage'
}

/** A terminal event whose usage rides `data.usage` — the nested shape this transport unwraps. */
function isNestedUsageType(type: string): boolean {
  return isSandboxTerminalEvent(type) && sandboxTerminalUsageField(type) === 'usage'
}

function usageFromEnvironmentEvent(event: AgentEnvironmentEvent): {
  input: number
  output: number
  usd: number
} {
  const usage = event.usage ?? tokenUsageFromData(event.data)
  return {
    input: finiteNumber(usage?.inputTokens) ?? 0,
    output: (finiteNumber(usage?.outputTokens) ?? 0) + (finiteNumber(usage?.reasoningTokens) ?? 0),
    usd:
      finiteNumber(usage?.cost) ??
      finiteNumber(event.data.costUsd) ??
      finiteNumber(event.data.totalCostUsd) ??
      0,
  }
}

function tokenUsageFromData(data: Record<string, unknown>): TokenUsage | undefined {
  const usageRecord =
    data.usage && typeof data.usage === 'object'
      ? (data.usage as Record<string, unknown>)
      : data.tokenUsage && typeof data.tokenUsage === 'object'
        ? (data.tokenUsage as Record<string, unknown>)
        : data
  const inputTokens =
    finiteNumber(usageRecord.inputTokens) ??
    finiteNumber(usageRecord.tokensIn) ??
    finiteNumber(usageRecord.prompt_tokens)
  const outputTokens =
    finiteNumber(usageRecord.outputTokens) ??
    finiteNumber(usageRecord.tokensOut) ??
    finiteNumber(usageRecord.completion_tokens)
  const totalTokens = finiteNumber(usageRecord.totalTokens)
  const cacheReadInputTokens = finiteNumber(usageRecord.cacheReadInputTokens)
  const cacheCreationInputTokens = finiteNumber(usageRecord.cacheCreationInputTokens)
  const reasoningTokens = finiteNumber(usageRecord.reasoningTokens)
  const cost =
    finiteNumber(usageRecord.cost) ??
    finiteNumber(usageRecord.costUsd) ??
    finiteNumber(usageRecord.totalCostUsd) ??
    finiteNumber(data.costUsd) ??
    finiteNumber(data.totalCostUsd)
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    cacheReadInputTokens === undefined &&
    cacheCreationInputTokens === undefined &&
    reasoningTokens === undefined &&
    cost === undefined
  )
    return undefined
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
    ...(cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(cost !== undefined ? { cost } : {}),
  }
}

function mergeTokenUsage(
  left: TokenUsage | undefined,
  right: TokenUsage | undefined,
): TokenUsage | undefined {
  if (!left) return right
  if (!right) return left
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    ...(left.totalTokens !== undefined || right.totalTokens !== undefined
      ? { totalTokens: (left.totalTokens ?? 0) + (right.totalTokens ?? 0) }
      : {}),
    ...(left.cacheReadInputTokens !== undefined || right.cacheReadInputTokens !== undefined
      ? {
          cacheReadInputTokens:
            (left.cacheReadInputTokens ?? 0) + (right.cacheReadInputTokens ?? 0),
        }
      : {}),
    ...(left.cacheCreationInputTokens !== undefined || right.cacheCreationInputTokens !== undefined
      ? {
          cacheCreationInputTokens:
            (left.cacheCreationInputTokens ?? 0) + (right.cacheCreationInputTokens ?? 0),
        }
      : {}),
    ...(left.reasoningTokens !== undefined || right.reasoningTokens !== undefined
      ? { reasoningTokens: (left.reasoningTokens ?? 0) + (right.reasoningTokens ?? 0) }
      : {}),
    ...(left.cost !== undefined || right.cost !== undefined
      ? { cost: (left.cost ?? 0) + (right.cost ?? 0) }
      : {}),
  }
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function agentTurnResultFromPromptResult(result: PromptResult): AgentTurnResult {
  const record = result as unknown as Record<string, unknown>
  const text =
    typeof record.response === 'string'
      ? record.response
      : typeof record.text === 'string'
        ? record.text
        : typeof record.finalText === 'string'
          ? record.finalText
          : ''
  const success = typeof record.success === 'boolean' ? record.success : true
  return {
    text,
    success,
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
    usage: tokenUsageFromData(record),
  }
}

function sandboxDispatchResultFromSessionRef(session: AgentSessionRef): Record<string, unknown> {
  const controlRef =
    session.controlRef === undefined
      ? undefined
      : AgentExactRunControlRefSchema.parse(session.controlRef)
  const metadataExecutionId = optionalDispatchIdentity(session.metadata?.executionId, 'executionId')
  if (controlRef !== undefined) {
    if (controlRef.sessionId !== session.id) {
      throw new ValidationError(
        'provider dispatch returned a control reference for another session',
      )
    }
    if (session.provider !== undefined && controlRef.provider !== session.provider) {
      throw new ValidationError(
        'provider dispatch returned a control reference for another provider',
      )
    }
    if (metadataExecutionId !== undefined && metadataExecutionId !== controlRef.executionId) {
      throw new ValidationError('provider dispatch returned conflicting execution identities')
    }
  }
  const hasStatus = session.metadata && Object.hasOwn(session.metadata, 'status')
  const status = hasStatus ? sessionStatusFromUnknown(session.metadata?.status) : 'running'
  return {
    sessionId: session.id,
    status,
    alreadyExisted: session.metadata?.alreadyExisted === true,
    ...(session.metadata?.dispatched === undefined
      ? {}
      : { dispatched: session.metadata.dispatched === true }),
    ...(controlRef === undefined
      ? metadataExecutionId === undefined
        ? {}
        : { executionId: metadataExecutionId }
      : { executionId: controlRef.executionId, runControlRef: controlRef }),
  }
}

function sessionRefFromSandboxDispatch(dispatched: unknown, providerName: string): AgentSessionRef {
  const record =
    dispatched && typeof dispatched === 'object'
      ? (dispatched as Record<string, unknown>)
      : undefined
  const id = record?.sessionId ?? record?.id
  if (typeof id !== 'string' || id.length === 0) {
    throw new ValidationError('sandboxClientAsProvider: dispatch returned no session id')
  }
  if (!record) {
    throw new ValidationError('sandboxClientAsProvider: dispatch returned no session record')
  }
  const executionId = optionalDispatchIdentity(record.executionId, 'executionId')
  const controlRef =
    record.runControlRef === undefined
      ? undefined
      : AgentExactRunControlRefSchema.parse(record.runControlRef)
  if (controlRef !== undefined) {
    if (controlRef.sessionId !== id || controlRef.provider !== providerName) {
      throw new ValidationError('sandbox dispatch returned a control reference for another session')
    }
    if (executionId !== undefined && controlRef.executionId !== executionId) {
      throw new ValidationError('sandbox dispatch returned conflicting execution identities')
    }
  }
  if (record.alreadyExisted !== undefined && typeof record.alreadyExisted !== 'boolean') {
    throw new ValidationError('sandbox dispatch returned an invalid alreadyExisted flag')
  }
  if (record.dispatched !== undefined && typeof record.dispatched !== 'boolean') {
    throw new ValidationError('sandbox dispatch returned an invalid dispatched flag')
  }
  if (record.status !== undefined && !isSandboxSessionStatus(record.status)) {
    throw new ValidationError('sandbox dispatch returned an invalid session status')
  }
  return {
    id,
    provider: providerName,
    ...(controlRef === undefined ? {} : { controlRef }),
    metadata: {
      ...(record.status ? { status: record.status } : {}),
      ...(executionId === undefined ? {} : { executionId }),
      ...(record.alreadyExisted !== undefined ? { alreadyExisted: record.alreadyExisted } : {}),
      ...(record.dispatched !== undefined ? { dispatched: record.dispatched } : {}),
    },
  }
}

function optionalDispatchIdentity(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`sandbox dispatch returned an invalid ${label}`)
  }
  return value
}

function isSandboxSessionStatus(value: unknown): boolean {
  return (
    value === 'queued' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
  )
}

function execResultFromSandboxExecResult(result: SandboxExecResult): ExecResult {
  const record = result as unknown as Record<string, unknown>
  const exitCode = finiteNumber(record.exitCode) ?? finiteNumber(record.code)
  if (exitCode === undefined) {
    throw new ValidationError('sandboxClientAsProvider: exec returned no exit code')
  }
  return {
    exitCode,
    stdout: typeof record.stdout === 'string' ? record.stdout : '',
    stderr: typeof record.stderr === 'string' ? record.stderr : '',
  }
}

function statusFromUnknown(status: unknown): AgentEnvironmentStatus {
  if (status === 'pending' || status === 'provisioning' || status === 'running') return status
  if (status === 'stopped' || status === 'failed' || status === 'expired') return status
  if (status === 'completed') return 'stopped'
  if (status === 'cancelled') return 'stopped'
  return 'unknown'
}

function sessionStatusFromUnknown(status: unknown): AgentSessionStatus | null {
  if (status === 'completed' || status === 'cancelled') return status
  return statusFromUnknown(status)
}

function readBoxStatus(box: SandboxInstance): unknown {
  return (box as unknown as { status?: unknown }).status
}

function readBoxMetadata(box: SandboxInstance): Record<string, unknown> | undefined {
  const metadata = (box as unknown as { metadata?: unknown }).metadata
  return metadata && typeof metadata === 'object'
    ? (metadata as Record<string, unknown>)
    : undefined
}

async function maybeRefresh(box: SandboxInstance): Promise<void> {
  const refresh = (box as unknown as { refresh?: () => Promise<void> }).refresh
  if (typeof refresh === 'function') await refresh.call(box)
}

async function destroyBox(box: SandboxInstance): Promise<void> {
  const deleteBox = (box as unknown as { delete?: () => Promise<void> }).delete
  if (typeof deleteBox === 'function') await deleteBox.call(box)
}

function placementInfoFromLoopPlacement(
  placement: LoopSandboxPlacement | undefined,
  box: SandboxInstance,
): PlacementInfo {
  if (!placement) return { kind: 'sandbox', sandboxId: String(box.id) }
  return {
    // `in-process` runs in the caller's own process tree, which `PlacementInfo` names `local`.
    kind:
      placement.kind === 'fleet' ? 'fleet' : placement.kind === 'in-process' ? 'local' : 'sandbox',
    ...(placement.sandboxId ? { sandboxId: placement.sandboxId } : { sandboxId: String(box.id) }),
    ...(placement.fleetId ? { fleetId: placement.fleetId } : {}),
    ...(placement.machineId ? { machineId: placement.machineId } : {}),
  }
}

type InteractiveAgentCapabilities = NonNullable<AgentEnvironmentCapabilities['interactiveAgent']>

const completeInteractiveAgentCapabilities: InteractiveAgentCapabilities = {
  start: true,
  control: true,
  status: true,
  attach: true,
  reattach: true,
  sendPrompt: true,
  input: true,
  resize: true,
  stop: true,
}

async function sandboxEnvironmentCapabilities(
  box: SandboxInstance,
  providerCapabilities: AgentEnvironmentCapabilities,
): Promise<AgentEnvironmentCapabilities> {
  const { interactiveAgent: providerInteractive, ...baseCapabilities } = providerCapabilities
  if (!hasCompleteInteractiveAgentCapabilities(providerInteractive)) return baseCapabilities
  let deployed: SandboxRuntimeCapabilities | null
  try {
    deployed = await box.capabilities()
  } catch {
    return baseCapabilities
  }
  if (!hasCompleteInteractiveAgentCapabilities(deployed?.interactiveAgent)) {
    return baseCapabilities
  }
  if (!hasExactInteractiveTerminalAdapter(box)) return baseCapabilities
  return {
    ...baseCapabilities,
    interactiveAgent: { ...completeInteractiveAgentCapabilities },
  }
}

function hasExactInteractiveTerminalAdapter(box: SandboxInstance): boolean {
  if (!hasSession(box)) return false
  try {
    const session = box.session('__runtime-capability-probe__')
    const interactive = (session as { interactive?: (options?: unknown) => unknown }).interactive
    if (typeof interactive !== 'function') return false
    const handle = interactive.call(session)
    return typeof (handle as { attachAgentTerminal?: unknown }).attachAgentTerminal === 'function'
  } catch {
    return false
  }
}

function hasCompleteInteractiveAgentCapabilities(
  value: Partial<InteractiveAgentCapabilities> | undefined,
): value is InteractiveAgentCapabilities {
  return (
    value?.start === true &&
    value.control === true &&
    value.status === true &&
    value.attach === true &&
    value.reattach === true &&
    value.sendPrompt === true &&
    value.input === true &&
    value.resize === true &&
    value.stop === true
  )
}

function assertSandboxInteractiveBinding(
  run: { provider: string; environmentId: string },
  box: SandboxInstance,
  providerName: string,
): void {
  if (run.provider !== providerName || run.environmentId !== String(box.id)) {
    throw new ValidationError('sandbox interactive request targets another environment')
  }
}

function defaultTangleSandboxCapabilities(options: {
  namedProfiles: boolean
  rediscover: boolean
}): AgentEnvironmentCapabilities {
  return {
    profile: {
      namedProfiles: options.namedProfiles,
      systemPrompt: { ...harnessSystemPromptIntents(undefined) },
      instructions: true,
      tools: true,
      permissions: true,
      mcp: true,
      subagents: true,
      resources: {
        files: true,
        instructions: true,
        tools: true,
        skills: true,
        agents: true,
        commands: true,
      },
      hooks: true,
      modes: true,
      runtimeUpdate: true,
      validation: true,
    },
    streaming: { live: true, replay: true, detach: true, turnIdempotency: true },
    sessions: { continue: true, list: true, messages: true },
    workspace: {
      read: true,
      write: true,
      exec: true,
      git: true,
      upload: true,
      download: true,
      cwdBases: { repository: true, host: false },
    },
    branching: { checkpoint: false, fork: false },
    ...(options.rediscover
      ? { interactiveAgent: { ...completeInteractiveAgentCapabilities } }
      : {}),
    placement: true,
    usage: true,
    confidential: false,
  }
}

function contentRef(prefix: string, value: unknown): string {
  let str: string
  try {
    str = JSON.stringify(value) ?? String(value)
  } catch {
    str = String(value)
  }
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${prefix}:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function hasGet(
  client: SandboxClient,
): client is SandboxClient & { get(id: string): Promise<SandboxInstance | null> } {
  return typeof (client as { get?: unknown }).get === 'function'
}

function hasList(
  client: SandboxClient,
): client is SandboxClient & { list(options?: unknown): Promise<SandboxInstance[]> } {
  return typeof (client as { list?: unknown }).list === 'function'
}

function hasDispatchPrompt(box: SandboxInstance): box is SandboxInstance & {
  dispatchPrompt(message: string | PromptInputPart[], options?: PromptOptions): Promise<unknown>
} {
  return typeof (box as { dispatchPrompt?: unknown }).dispatchPrompt === 'function'
}

function hasSession(
  box: SandboxInstance,
): box is SandboxInstance & { session(id: string): SandboxSessionLike } {
  return typeof (box as { session?: unknown }).session === 'function'
}

function hasRead(box: SandboxInstance): box is SandboxInstance & {
  read(path: string, options?: { sessionId?: string }): Promise<string>
} {
  return typeof (box as { read?: unknown }).read === 'function'
}

function hasWrite(
  box: SandboxInstance,
): box is SandboxInstance & { write(path: string, content: string): Promise<void> } {
  return typeof (box as { write?: unknown }).write === 'function'
}

function hasExec(box: SandboxInstance): box is SandboxInstance & {
  exec(command: string, options?: unknown): Promise<SandboxExecResult>
} {
  return typeof (box as { exec?: unknown }).exec === 'function'
}

interface SandboxSessionLike {
  readonly id: string
  readonly controlRef?: AgentRunControlRef
  status(): Promise<unknown | null>
  events(options?: {
    since?: string
    executionId?: string
    signal?: AbortSignal
  }): AsyncIterable<SandboxEvent>
  result(options?: { executionId?: string }): Promise<PromptResult>
  prompt(message: string | PromptInputPart[], options?: PromptOptions): Promise<PromptResult>
  respondToInteraction?(
    command: InteractionResponseCommand,
    options?: { signal?: AbortSignal },
  ): Promise<{ acknowledgement: InteractionAcknowledgement }>
  cancelRun?(
    request: AgentRunCancellationRequest,
    options?: { signal?: AbortSignal },
  ): Promise<AgentRunCancellationAcknowledgement>
  interrupt(options?: { executionId?: string }): Promise<unknown>
}
