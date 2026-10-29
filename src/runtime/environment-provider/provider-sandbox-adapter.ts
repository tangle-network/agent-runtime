import {
  type AgentExactRunControlRef,
  AgentExactRunControlRefSchema,
  type AgentProfile,
  type AgentRunCancellationAcknowledgement,
  type AgentRunCancellationRequest,
  AgentRunCancellationRequestSchema,
  type AgentRunControlRef,
  canonicalWorkspaceCwd,
  type InteractionAcknowledgement,
  type InteractionResponseCommand,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
  AgentEnvironmentStatus,
  AgentSession,
  AgentSessionRef,
  AgentSessionStatus,
  AgentTurnInput,
  AgentTurnResult,
  CheckpointRequest,
  CreateAgentEnvironmentInput,
  ForkRequest,
  ResourceRequest,
} from '@tangle-network/agent-interface/environment-provider'
import type {
  CreateSandboxOptions,
  PromptInputPart,
  PromptOptions,
  PromptResult,
  SandboxEvent,
  SandboxInstance,
} from '@tangle-network/sandbox'
import {
  assertProviderWorkspaceRetentionPort,
  captureProviderWorkspaceSnapshot,
  type ProviderWorkspaceCaptureReceipt,
  type ProviderWorkspaceRetentionPort,
  workspaceCaptureReceipt,
} from '../provider-workspace-retention'
import { freezeControlRef, sameControlCoordinates } from '../retained-run-binding'
import { createSandboxUsageLedger } from '../sandbox-events'
import { concreteProfileModel } from '../supervise/model-policy'
import type { ExecutorNodeContext } from '../supervise/types'
import type { SandboxClient } from '../types'
import {
  createProviderFailureLedger,
  isTerminalEnvironmentEvent,
  resultTextFromData,
  sandboxEventFromEnvironmentEvent,
  textFromEnvironmentEvent,
  usageSandboxEvent,
} from './provider-event-projection'
import {
  assertRuntimeMcpAttachments,
  hasRuntimeMcpAttachments,
  turnInputFromPrompt,
} from './provider-turn-input'
import { ValidationError } from './provider-validation-error'

/** Adapt a neutral environment provider to the `SandboxClient` interface used by existing loop paths.
 * @experimental */
export function providerAsSandboxClient(
  provider: AgentEnvironmentProvider,
  options: ProviderAsSandboxClientOptions = {},
): SandboxClient {
  if (options.workspaceRetention !== undefined) {
    assertProviderWorkspaceRetentionPort(
      options.workspaceRetention,
      `providerAsSandboxClient(${provider.name})`,
    )
    if (options.retentionIdentity === undefined) {
      throw new ValidationError(
        'providerAsSandboxClient: retentionIdentity is required with workspaceRetention',
      )
    }
  }
  return {
    async create(createOptions?: CreateSandboxOptions): Promise<SandboxInstance> {
      const defaults = options.defaults ?? {}
      const sandboxInput = createInputFromSandboxOptions(
        createOptions,
        options.mapCreateOptions !== undefined,
      )
      const customInput = options.mapCreateOptions?.(createOptions) ?? {}
      const mapped = {
        ...defaults,
        ...sandboxInput,
        ...customInput,
        ...(defaults.env === undefined &&
        sandboxInput.env === undefined &&
        customInput.env === undefined
          ? {}
          : {
              env: { ...defaults.env, ...sandboxInput.env, ...customInput.env },
            }),
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
      const needsMcp = hasRuntimeMcpAttachments(mapped)
      const capabilities =
        options.requireSession || needsMcp ? await provider.capabilities() : undefined
      assertRuntimeMcpAttachments(provider.name, mapped, capabilities)
      if (
        options.requireSession &&
        (!capabilities?.streaming.live || !capabilities.sessions.continue)
      ) {
        throw new ValidationError(
          `providerAsSandboxClient(${provider.name}): live session continuation is required`,
        )
      }
      const environment = await provider.create(mapped as CreateAgentEnvironmentInput)
      if (options.requireSession && !environment.session) {
        if (options.workspaceRetention === undefined) await environment.destroy?.()
        throw new ValidationError(
          `providerAsSandboxClient(${provider.name}): session() is required`,
        )
      }
      return environmentAsSandboxInstance(environment, {
        ...(typeof mapped.profile === 'string' ? {} : { profile: mapped.profile }),
        requireTerminalEvent: options.requireTerminalEvent ?? true,
        ...(options.workspaceRetention === undefined
          ? {}
          : { workspaceRetention: options.workspaceRetention }),
        ...(options.retentionIdentity === undefined
          ? {}
          : { retentionIdentity: options.retentionIdentity }),
        ...(options.onWorkspaceCaptured === undefined
          ? {}
          : { onWorkspaceCaptured: options.onWorkspaceCaptured }),
      })
    },
  }
}

function createInputFromSandboxOptions(
  options: CreateSandboxOptions | undefined,
  customMapping: boolean,
): Partial<CreateAgentEnvironmentInput> {
  if (!customMapping) {
    const mapped = new Set([
      'backend',
      'environment',
      'git',
      'cwd',
      'resources',
      'env',
      'secrets',
      'metadata',
      'name',
      'idempotencyKey',
    ])
    const unsupported = Object.entries(options ?? {})
      .filter(([key, value]) => value !== undefined && !mapped.has(key))
      .map(([key]) => key)
    for (const [prefix, value, keys] of [
      ['backend', options?.backend, ['type', 'profile', 'model']],
      ['git', options?.git, ['url', 'ref']],
    ] as const) {
      for (const [key, field] of Object.entries(value ?? {})) {
        if (field !== undefined && !(keys as readonly string[]).includes(key))
          unsupported.push(`${prefix}.${key}`)
      }
    }
    const model = options?.backend?.model
    if (model !== undefined) {
      for (const [key, value] of Object.entries(model)) {
        if (value !== undefined && !['provider', 'model'].includes(key)) {
          unsupported.push(`backend.model.${key}`)
        }
      }
      const profile = options?.backend?.profile
      if (model.provider !== undefined && model.provider !== profile?.model?.provider?.trim()) {
        unsupported.push('backend.model.provider')
      }
      if (model.model !== undefined && model.model !== concreteProfileModel(profile ?? {})) {
        unsupported.push('backend.model.model')
      }
    }
    if (options?.secrets === 'all') unsupported.push('secrets=all')
    if (unsupported.length > 0) {
      throw new ValidationError(
        `providerAsSandboxClient: Sandbox create controls require mapCreateOptions: ${unsupported.join(', ')}`,
      )
    }
  }
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
    ...(Array.isArray(options?.secrets) ? { secrets: options.secrets } : {}),
    ...(options?.metadata ? { metadata: options.metadata } : {}),
    ...(options?.name ? { name: options.name } : {}),
    ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
  }
}

export function environmentAsSandboxInstance(
  environment: AgentEnvironment,
  options: {
    profile?: AgentProfile
    requireTerminalEvent: boolean
    workspaceRetention?: ProviderWorkspaceRetentionPort
    retentionIdentity?: { executionId: string; profile: AgentProfile; node?: ExecutorNodeContext }
    onWorkspaceCaptured?: (receipt: ProviderWorkspaceCaptureReceipt) => void | Promise<void>
  },
): SandboxInstance {
  let providerSessionId: string | null = null
  let controlRef: AgentExactRunControlRef | undefined
  const noteControlRef = (candidate: unknown): void => {
    if (options.workspaceRetention === undefined) return
    const parsed = AgentExactRunControlRefSchema.safeParse(candidate)
    if (!parsed.success) return
    if (
      parsed.data.environmentId !== environment.id ||
      parsed.data.provider !== environment.provider
    )
      throw new ValidationError(
        'providerAsSandboxClient: capture control reference names another environment',
      )
    controlRef = freezeControlRef(parsed.data)
    providerSessionId = controlRef.sessionId
  }
  let capture: Promise<ProviderWorkspaceCaptureReceipt> | undefined
  let publication: Promise<void> | undefined
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
      const input = turnInputFromPrompt(message, promptOptions, options.profile)
      providerSessionId = input.sessionId ?? null
      noteControlRef(input.controlRef)
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
      let lastResultText: string | undefined
      let text = ''
      const usageLedger = createSandboxUsageLedger()
      let terminal = false
      const failures = createProviderFailureLedger()
      const input = turnInputFromPrompt(message, promptOptions, options.profile)
      providerSessionId = input.sessionId ?? null
      noteControlRef(input.controlRef)
      for await (const event of environment.stream(input)) {
        lastResultText = resultTextFromData(event.data) ?? lastResultText
        if (isTerminalEnvironmentEvent(event)) terminal = true
        const sandboxEvent = sandboxEventFromEnvironmentEvent(event)
        failures.observe(event, sandboxEvent)
        const usageEvent = usageSandboxEvent(event)
        if (usageEvent) usageLedger.observe(usageEvent, environment.id)
        usageLedger.observe(sandboxEvent, environment.id)
        text += textFromEnvironmentEvent(event)
      }
      if (options.requireTerminalEvent && !terminal) {
        throw new ValidationError(
          `providerAsSandboxClient(${environment.provider}): prompt ended without a terminal result/done/status event`,
        )
      }
      usageLedger.settleTurn(environment.id)
      const usage = usageLedger.settledUsage()
      const outcome = failures.finish()
      return {
        response: lastResultText ?? text,
        success: outcome?.success ?? true,
        status: outcome?.status ?? 'success',
        durationMs: 0,
        ...(outcome?.error ? { error: outcome.error } : {}),
        ...(usage ? { usage } : {}),
      }
    },
    ...(environment.dispatch && environment.session
      ? {
          async dispatchPrompt(message: string | PromptInputPart[], promptOptions?: PromptOptions) {
            const session = await environment.dispatch?.(
              turnInputFromPrompt(message, promptOptions, options.profile),
            )
            if (!session)
              throw new ValidationError('providerAsSandboxClient: dispatch returned no session')
            noteControlRef(session.controlRef)
            return sandboxDispatchResultFromSessionRef(session)
          },
        }
      : {}),
    ...(environment.session
      ? {
          session(id: string, sessionOptions?: { controlRef?: AgentRunControlRef }) {
            noteControlRef(sessionOptions?.controlRef)
            return sandboxSessionFromAgentSession(
              environment.session?.(id, sessionOptions),
              sessionOptions?.controlRef,
              options.profile,
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
      if (options.workspaceRetention !== undefined) {
        const identity = options.retentionIdentity
        if (identity === undefined)
          throw new ValidationError(
            'providerAsSandboxClient: retention identity missing before delete',
          )
        capture ??= captureProviderWorkspaceSnapshot(options.workspaceRetention, {
          environment,
          executionId: identity.executionId,
          ...(controlRef === undefined ? {} : { controlRef }),
          ...(identity.node === undefined ? {} : { node: identity.node }),
          providerSessionId,
          nativeSessionId: null,
          profile: identity.profile,
        }).then((captured) =>
          workspaceCaptureReceipt(
            {
              environment,
              executionId: identity.executionId,
              ...(controlRef === undefined ? {} : { controlRef }),
              ...(identity.node === undefined ? {} : { node: identity.node }),
              profile: identity.profile,
              providerSessionId,
            },
            captured,
          ),
        )
        const receipt = await capture
        publication ??= Promise.resolve().then(async () => {
          await options.onWorkspaceCaptured?.(receipt)
        })
        const publishing = publication
        try {
          await publishing
        } catch (error) {
          if (publication === publishing) publication = undefined
          throw error
        }
        if (options.workspaceRetention.requireCompleteProvenance && !receipt.coverageComplete) {
          throw new Error(
            receipt.incompleteReason ?? 'provider workspace retention coverage incomplete',
          )
        }
      }
      await environment.destroy?.()
    },
  }
  return box as unknown as SandboxInstance
}

function sandboxSessionFromAgentSession(
  session: AgentSession | undefined,
  expectedControlRef?: AgentRunControlRef,
  profile?: AgentProfile,
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
        await session.prompt(turnInputFromPrompt(message, options, profile)),
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

function assertInteractionCommandScope(
  command: InteractionResponseCommand,
  controlRef: AgentRunControlRef | undefined,
): void {
  if (controlRef === undefined) return
  // Keep the inner provider unchanged for the deployment's durable binding check.
  if (
    command.binding.runId !== controlRef.runId ||
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

function optionalDispatchIdentity(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`sandbox dispatch returned an invalid ${label}`)
  }
  return value
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

/** Options for exposing an `AgentEnvironmentProvider` through the legacy sandbox client port.
 * @experimental */
export interface ProviderAsSandboxClientOptions {
  defaults?: Partial<CreateAgentEnvironmentInput>
  requireTerminalEvent?: boolean
  /** Require declared live continuation plus concrete session controls. */
  requireSession?: boolean
  /** Verified workspace capture before every environment delete, including steerable sessions. */
  workspaceRetention?: ProviderWorkspaceRetentionPort
  /** Supervised identity assigned before the environment is created. */
  retentionIdentity?: { executionId: string; profile: AgentProfile; node?: ExecutorNodeContext }
  /** Called after verification and before deletion so the run result can retain the exact join. */
  onWorkspaceCaptured?: (receipt: ProviderWorkspaceCaptureReceipt) => void | Promise<void>
  /** Translate Sandbox-specific controls that have no neutral representation. Without this
   * callback, unsupported fields are refused before any environment is created. */
  mapCreateOptions?: (
    options: CreateSandboxOptions | undefined,
  ) => Partial<CreateAgentEnvironmentInput>
}
