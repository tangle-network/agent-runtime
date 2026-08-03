import type {
  AgentProfile,
  AgentProfileValidationResult,
  InputPart,
  TokenUsage,
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
  PromptInputPart,
  PromptOptions,
  PromptResult,
  SandboxEvent,
  ExecResult as SandboxExecResult,
  SandboxInstance,
} from '@tangle-network/sandbox'
import type {
  Executor,
  ExecutorContext,
  ExecutorFactory,
  ExecutorResult,
  Runtime,
  Spend,
  UsageEvent,
} from './supervise/types'
import type { LoopSandboxPlacement, SandboxClient } from './types'
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

/** Adapt a `SandboxClient` into the shared `AgentEnvironmentProvider` contract.
 * @experimental */
export function sandboxClientAsProvider(
  client: SandboxClient,
  options: SandboxClientProviderOptions = {},
): AgentEnvironmentProvider {
  const providerName = options.name ?? 'tangle-sandbox'
  return {
    name: providerName,
    capabilities: async () => {
      if (options.capabilities) {
        return typeof options.capabilities === 'function'
          ? options.capabilities()
          : options.capabilities
      }
      return defaultTangleSandboxCapabilities({
        namedProfiles: options.resolveProfile !== undefined,
      })
    },
    ...(options.validateProfile ? { validateProfile: options.validateProfile } : {}),
    async create(input: CreateAgentEnvironmentInput): Promise<AgentEnvironment> {
      const createOptions =
        options.mapCreateInput?.(input) ??
        (await sandboxOptionsFromCreateInput(
          input,
          options.defaultBackend ?? 'opencode',
          options.resolveProfile,
        ))
      const box = await client.create(createOptions)
      return sandboxInstanceAsEnvironment(box, providerName, client)
    },
    ...(hasGet(client)
      ? {
          async get(id: string): Promise<AgentEnvironment | null> {
            const box = await client.get(id)
            return box ? sandboxInstanceAsEnvironment(box, providerName, client) : null
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

/** Options for running a provider as a supervise-mode executor.
 * @experimental */
export interface ProviderExecutorOptions {
  defaults?: Partial<CreateAgentEnvironmentInput>
  runtime?: Runtime
  destroyOnSettle?: boolean
  requireTerminalEvent?: boolean
  /** Transform only the profile sent to `provider.create`. The original profile
   * remains the input to `taskToTurn`, so execution-only normalization cannot
   * rewrite the caller's task mapping. */
  profileForCreate?: (profile: AgentProfile) => AgentProfile
  taskToTurn?: (task: unknown, specProfile: AgentProfile) => AgentTurnInput
}

/** Adapt an environment provider into an `ExecutorFactory` for `createExecutor`.
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
  const controller = new AbortController()
  const abortIfSignalled = () => {
    if (ctx.signal.aborted) controller.abort()
  }
  abortIfSignalled()
  if (!ctx.signal.aborted) ctx.signal.addEventListener('abort', abortIfSignalled, { once: true })

  let environment: AgentEnvironment | undefined
  let artifact: ExecutorResult<unknown> | undefined

  return {
    runtime: options.runtime ?? (provider.name as Runtime),
    execute(task, signal): AsyncIterable<UsageEvent> {
      return streamProviderExecutor({
        provider,
        profile,
        task,
        signal,
        controller,
        options,
        onEnvironment: (env) => {
          environment = env
        },
        onArtifact: (next) => {
          artifact = next
        },
      })
    },
    async teardown(_grace): Promise<{ destroyed: boolean }> {
      controller.abort()
      await environment?.destroy?.()
      return { destroyed: true }
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
}

interface StreamProviderExecutorArgs {
  provider: AgentEnvironmentProvider
  profile: AgentProfile
  task: unknown
  signal: AbortSignal
  controller: AbortController
  options: ProviderExecutorOptions
  onEnvironment: (environment: AgentEnvironment) => void
  onArtifact: (artifact: ExecutorResult<unknown>) => void
}

async function* streamProviderExecutor(
  args: StreamProviderExecutorArgs,
): AsyncIterable<UsageEvent> {
  const started = Date.now()
  const linked = mergeAbortSignals(args.signal, args.controller.signal)
  const createProfile = args.options.profileForCreate?.(args.profile) ?? args.profile
  const environment = await args.provider.create({
    ...(args.options.defaults ?? {}),
    profile: createProfile,
    signal: linked,
  })
  args.onEnvironment(environment)

  const turn =
    args.options.taskToTurn?.(args.task, args.profile) ?? taskToTurnInput(args.task, linked)
  const events: AgentEnvironmentEvent[] = []
  const tokens = zeroTokenUsage()
  let usd = 0
  let text = ''
  let terminal = false
  try {
    for await (const event of environment.stream({ ...turn, signal: linked })) {
      events.push(event)
      text += textFromEnvironmentEvent(event)
      const usage = usageFromEnvironmentEvent(event)
      if (usage.input || usage.output) {
        tokens.input += usage.input
        tokens.output += usage.output
        yield { kind: 'tokens', input: usage.input, output: usage.output }
      }
      if (usage.usd) {
        usd += usage.usd
        yield { kind: 'cost', usd: usage.usd }
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
      ms: Date.now() - started,
    }
    args.onArtifact({
      outRef: contentRef(`provider:${args.provider.name}`, result),
      out: result,
      spent,
    })
  } finally {
    if (args.options.destroyOnSettle ?? true) await environment.destroy?.()
  }
}

function createInputFromSandboxOptions(
  options: CreateSandboxOptions | undefined,
): Partial<CreateAgentEnvironmentInput> {
  const profile = options?.backend?.profile
  const backend = options?.backend?.type
  const workspace = {
    ...(options?.environment ? { environment: options.environment } : {}),
    ...(options?.git?.url ? { repoUrl: options.git.url } : {}),
    ...(options?.git?.ref ? { gitRef: options.git.ref } : {}),
  }
  return {
    ...(profile !== undefined ? { profile } : {}),
    ...(backend ? { backend } : {}),
    ...(Object.keys(workspace).length > 0 ? { workspace } : {}),
    ...(options?.resources ? { resources: options.resources as ResourceRequest } : {}),
    ...(options?.env ? { env: options.env } : {}),
    ...(options?.secrets ? { secrets: options.secrets } : {}),
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
): Promise<CreateSandboxOptions> {
  const backendType = (input.backend ?? defaultBackend) as BackendType
  const workspace = input.workspace ?? {}
  const environment = sandboxEnvironmentFromWorkspace(workspace)
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

function assertSandboxSecretNames(secrets: unknown): asserts secrets is string[] | undefined {
  if (
    secrets !== undefined &&
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
          cancellation = environment
            .session(input.sessionId)
            .cancel()
            .catch((error: unknown) => {
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
          session(id: string) {
            return sandboxSessionFromAgentSession(environment.session?.(id))
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

function sandboxInstanceAsEnvironment(
  box: SandboxInstance,
  providerName: string,
  client: SandboxClient,
): AgentEnvironment {
  const environment: AgentEnvironment = {
    id: String(box.id),
    provider: providerName,
    ...(typeof box.name === 'string' ? { name: box.name } : {}),
    async status(): Promise<AgentEnvironmentStatus> {
      await maybeRefresh(box)
      return statusFromUnknown(readBoxStatus(box))
    },
    async *stream(input: AgentTurnInput): AsyncIterable<AgentEnvironmentEvent> {
      for await (const event of box.streamPrompt(
        promptFromTurnInput(input),
        promptOptionsFromTurnInput(input),
      )) {
        yield environmentEventFromSandboxEvent(event)
      }
    },
    ...(hasDispatchPrompt(box)
      ? {
          async dispatch(input: AgentTurnInput): Promise<AgentSessionRef> {
            const dispatched = await box.dispatchPrompt(
              promptFromTurnInput(input),
              promptOptionsFromTurnInput(input),
            )
            return sessionRefFromSandboxDispatch(dispatched, providerName)
          },
        }
      : {}),
    ...(hasSession(box)
      ? {
          session(id: string): AgentSession {
            return sandboxSessionAsAgentSession(box.session(id))
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
      return sandboxInstanceAsEnvironment(forked, providerName, client)
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

function sandboxSessionAsAgentSession(session: SandboxSessionLike): AgentSession {
  return {
    id: session.id,
    async status(): Promise<AgentSessionStatus | null> {
      const status = await session.status()
      if (!status) return null
      return sessionStatusFromUnknown((status as { status?: unknown }).status)
    },
    async *events(options?: {
      since?: string
      signal?: AbortSignal
    }): AsyncIterable<AgentEnvironmentEvent> {
      for await (const event of session.events(options))
        yield environmentEventFromSandboxEvent(event)
    },
    async result(): Promise<AgentTurnResult> {
      return agentTurnResultFromPromptResult(await session.result())
    },
    async prompt(input: AgentTurnInput): Promise<AgentTurnResult> {
      return agentTurnResultFromPromptResult(
        await session.prompt(promptFromTurnInput(input), promptOptionsFromTurnInput(input)),
      )
    },
    cancel(): Promise<void> {
      return session.interrupt().then(() => undefined)
    },
  }
}

function sandboxSessionFromAgentSession(session: AgentSession | undefined): SandboxSessionLike {
  if (!session) throw new ValidationError('providerAsSandboxClient: session is unavailable')
  return {
    id: session.id,
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
      signal?: AbortSignal
    }): AsyncGenerator<SandboxEvent> {
      for await (const event of session.events(options))
        yield sandboxEventFromEnvironmentEvent(event)
    },
    async result(): Promise<PromptResult> {
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
    async interrupt() {
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
  return {
    type: String(event.type),
    data,
    ...(event.id ? { id: event.id } : {}),
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
    ...(options?.signal ? { signal: options.signal } : {}),
    ...(options?.backend ? { providerOptions: { backend: options.backend } } : {}),
  }
}

function promptFromTurnInput(input: AgentTurnInput): string | PromptInputPart[] {
  if (input.parts) return input.parts.map(promptPartFromInputPart)
  return input.prompt ?? ''
}

function promptPartFromInputPart(part: InputPart): PromptInputPart {
  if (part.type === 'text' || part.type === 'image') return part
  if (part.content !== undefined || part.path !== undefined) {
    throw new ValidationError(
      'Tangle Sandbox file prompt parts require a URL; inline content and local paths are not representable',
    )
  }
  if (!part.filename || !part.url) {
    throw new ValidationError('Tangle Sandbox file prompt parts require both filename and URL')
  }
  return {
    type: 'file',
    filename: part.filename,
    ...(part.mediaType ? { mediaType: part.mediaType } : {}),
    url: part.url,
  }
}

function promptOptionsFromTurnInput(input: AgentTurnInput): PromptOptions {
  return {
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.context ? { context: input.context } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.executionId ? { executionId: input.executionId } : {}),
    ...(input.lastEventId ? { lastEventId: input.lastEventId } : {}),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.detach !== undefined ? { detach: input.detach } : {}),
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

function resultFromEvents(
  events: AgentEnvironmentEvent[],
  fallbackText: string,
): { content: string; events: AgentEnvironmentEvent[] } {
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
  if (type === 'result' || type === 'done' || type === 'final') return true
  if (type.endsWith('.completed') || type.endsWith('.failed')) return true
  if (type !== 'status') return false
  return data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled'
}

function isUsageType(type: string): boolean {
  return type === 'llm_call' || type === 'usage' || type === 'cost.usage'
}

function isNestedUsageType(type: string): boolean {
  return type === 'message.completed' || type === 'result' || type === 'final'
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
  const hasStatus = session.metadata && Object.hasOwn(session.metadata, 'status')
  const status = hasStatus ? sessionStatusFromUnknown(session.metadata?.status) : 'running'
  return {
    sessionId: session.id,
    status,
    alreadyExisted: session.metadata?.alreadyExisted === true,
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
  return {
    id,
    provider: providerName,
    metadata: {
      ...(record.status ? { status: record.status } : {}),
      ...(record.alreadyExisted !== undefined ? { alreadyExisted: record.alreadyExisted } : {}),
    },
  }
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
    kind: placement.kind === 'fleet' ? 'fleet' : 'sandbox',
    ...(placement.sandboxId ? { sandboxId: placement.sandboxId } : { sandboxId: String(box.id) }),
    ...(placement.fleetId ? { fleetId: placement.fleetId } : {}),
    ...(placement.machineId ? { machineId: placement.machineId } : {}),
  }
}

function defaultTangleSandboxCapabilities(options: {
  namedProfiles: boolean
}): AgentEnvironmentCapabilities {
  return {
    profile: {
      namedProfiles: options.namedProfiles,
      systemPrompt: true,
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
    workspace: { read: true, write: true, exec: true, git: true, upload: true, download: true },
    branching: { checkpoint: true, fork: true },
    placement: true,
    usage: true,
    confidential: true,
  }
}

function mergeAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (a.aborted || b.aborted) controller.abort()
  else {
    a.addEventListener('abort', abort, { once: true })
    b.addEventListener('abort', abort, { once: true })
  }
  return controller.signal
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
  status(): Promise<unknown | null>
  events(options?: { since?: string; signal?: AbortSignal }): AsyncIterable<SandboxEvent>
  result(): Promise<PromptResult>
  prompt(message: string | PromptInputPart[], options?: PromptOptions): Promise<PromptResult>
  interrupt(): Promise<unknown>
}
