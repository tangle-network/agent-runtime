import { posix } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import type { TraceStore } from '@tangle-network/agent-eval'
import type { AgentCandidateTermination, Sha256Digest } from '@tangle-network/agent-interface'
import type {
  AgentEnvironmentCapabilities,
  AgentEnvironmentProvider,
  AgentExactProcess,
  AgentExactProcessEnvironment,
  AgentExactProcessLaunch,
  AgentExactProcessResources,
  AgentExactProcessStatus,
} from '@tangle-network/agent-interface/environment-provider'
import {
  canonicalCandidateBytes,
  canonicalCandidateDigest,
  immutableCandidateValue,
  sha256Bytes,
} from './digest'
import { assertAgentCandidateExecutionRoots } from './execution-roots'
import {
  CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG_ENV,
  CANDIDATE_KNOWLEDGE_ROOT_ENV,
  candidateKnowledgeExecutionPaths,
} from './knowledge'
import {
  candidateProfileAgentPaths,
  PI_CANDIDATE_AGENT_DIR_ENV,
  PI_CANDIDATE_SESSION_DIR_ENV,
} from './profile'
import type {
  AgentCandidateExecutorPort,
  AgentCandidateExecutorRequest,
  AgentCandidateExecutorStopRequest,
} from './types'

const DEFAULT_PROVISION_TIMEOUT_MS = 120_000
const DEFAULT_RECOVERY_RETENTION_MS = 15 * 60_000

interface ExactProcessRunState {
  environment: AgentExactProcessEnvironment
  output?: Uint8Array
  termination?: AgentCandidateTermination
  runtimeTermination?: AgentCandidateTermination
  trace?: {
    runId: string
    scenarioId: string
    startedAt: number
    deadlineAtMs: number
    timeoutMs: number
    tags: Record<string, string>
    written: boolean
  }
}

export interface ExactProcessCandidateExecutorOptions {
  provider: AgentEnvironmentProvider
  resources: AgentExactProcessResources
  provisionTimeoutMs?: number
  recoveryRetentionMs?: number
  providerOptions?: Record<string, unknown>
}

/** Adapt one neutral exact-process provider to Runtime's trusted candidate boundary. */
export function exactProcessProviderAsCandidateExecutor(
  options: ExactProcessCandidateExecutorOptions,
): AgentCandidateExecutorPort {
  return new ExactProcessAgentCandidateExecutor(options)
}

class ExactProcessAgentCandidateExecutor implements AgentCandidateExecutorPort {
  private readonly states = new Map<string, ExactProcessRunState>()
  private readonly exactProcess
  private readonly resources: AgentExactProcessResources
  private readonly provisionTimeoutMs: number
  private readonly recoveryRetentionMs: number
  private readonly providerOptions?: Record<string, unknown>
  private capabilitiesPromise?: Promise<AgentEnvironmentCapabilities>

  constructor(private readonly options: ExactProcessCandidateExecutorOptions) {
    if (!options.provider.exactProcess) {
      throw new Error(
        `agent environment provider "${options.provider.name}" does not implement exact processes`,
      )
    }
    this.exactProcess = options.provider.exactProcess
    this.resources = exactResources(options.resources)
    this.provisionTimeoutMs = positiveInteger(
      options.provisionTimeoutMs ?? DEFAULT_PROVISION_TIMEOUT_MS,
      'exact process provision timeout',
    )
    this.recoveryRetentionMs = positiveInteger(
      options.recoveryRetentionMs ?? DEFAULT_RECOVERY_RETENTION_MS,
      'exact process recovery retention',
    )
    this.providerOptions = options.providerOptions
      ? immutableCandidateValue(options.providerOptions)
      : undefined
  }

  async execute(
    request: AgentCandidateExecutorRequest,
    context: Parameters<AgentCandidateExecutorPort['execute']>[1],
  ) {
    assertSupportedRequest(request)
    const outcome = request.benchmark.task.outcome
    if (outcome.kind !== 'output') throw new Error('exact process executor requires an output task')
    const network = request.executionPlan.value.material.model.access.network
    const egress =
      network.mode === 'disabled'
        ? ({ mode: 'blocked' } as const)
        : ({ mode: 'strict', allowDomains: [...network.domains] } as const)
    await this.assertCapability(egress.mode)
    context.signal.throwIfAborted()

    const key = executionKey(request.executionId, request.executionPlan.value.digest)
    if (this.states.has(key)) throw new Error('candidate execution environment is already active')
    const image = exactImage(
      request.executionPlan.value.material.container.image,
      request.executionPlan.value.material.container.manifestDigest,
    )
    const maxLifetimeMs = environmentLifetimeMs(
      request.hardLimits.timeoutMs,
      this.recoveryRetentionMs,
    )
    const createMaterial = immutableCandidateValue({
      kind: 'agent-candidate-exact-process-create',
      provider: this.options.provider.name,
      executionId: request.executionId,
      executionPlanDigest: request.executionPlan.value.digest,
      image,
      egress,
      maxLifetimeMs,
      provisionTimeoutMs: this.provisionTimeoutMs,
      resources: this.resources,
      output: { mediaType: outcome.mediaType, maxBytes: outcome.maxBytes },
      ...(this.providerOptions ? { providerOptions: this.providerOptions } : {}),
    })
    const createInputDigest = canonicalCandidateDigest(createMaterial)
    const metadata = immutableCandidateValue({
      kind: 'agent-candidate-execution',
      provider: this.options.provider.name,
      executionId: request.executionId,
      executionPlanDigest: request.executionPlan.value.digest,
      createInputDigest,
      outputMediaType: outcome.mediaType,
      outputMaxBytes: outcome.maxBytes,
    })
    const environment = await this.exactProcess.create({
      image,
      egress,
      maxLifetimeMs,
      provisionTimeoutMs: this.provisionTimeoutMs,
      resources: this.resources,
      metadata,
      idempotencyKey: executionIdempotencyKey(
        request.executionId,
        request.executionPlan.value.digest,
      ),
      signal: context.signal,
      ...(this.providerOptions ? { providerOptions: this.providerOptions } : {}),
    })
    try {
      assertExecutionEnvironment(environment, metadata, this.options.provider.name)
    } catch (error) {
      try {
        await environment.destroy()
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'exact process validation and cleanup both failed',
        )
      }
      throw error
    }
    const state: ExactProcessRunState = { environment }
    this.states.set(key, state)

    const existing = await environment.process.list()
    if (existing.length !== 0) {
      throw new Error('fresh candidate environment already contains a process')
    }
    await materializeRequest(environment, request, context.signal)
    const launch = exactLaunch(request)
    const startedAt = Date.now()
    state.trace = {
      runId: request.trace.runId,
      scenarioId: request.benchmark.task.scenario.id,
      startedAt,
      deadlineAtMs: context.deadlineAtMs,
      timeoutMs: request.hardLimits.timeoutMs,
      tags: {
        ...request.trace.tags,
        environmentId: environment.id,
        environmentProvider: environment.provider,
      },
      written: false,
    }
    const process = await environment.process.spawn(launch, { signal: context.signal })
    const outputPromise = collectOutput(process, outcome.maxBytes)
    void outputPromise.catch(() => undefined)
    let cancellation: Promise<void> | undefined
    let processExited = false
    const cancel = () => {
      if (!processExited) cancellation ??= stopProcess(process)
    }
    context.signal.addEventListener('abort', cancel, { once: true })
    if (context.signal.aborted) cancel()
    try {
      const termination = await process.wait()
      processExited = true
      context.signal.removeEventListener('abort', cancel)
      if (cancellation) await cancellation
      const status = await process.status()
      assertTerminalStatus(status, termination)
      state.output = await awaitOutput(outputPromise, context.signal, context.deadlineAtMs)
      state.termination = termination
      await appendExactProcessTrace(state, context.traceStore, status)
      return { executionId: request.executionId, termination }
    } finally {
      context.signal.removeEventListener('abort', cancel)
    }
  }

  async stop(
    request: AgentCandidateExecutorStopRequest,
    context: Parameters<AgentCandidateExecutorPort['stop']>[1],
  ): Promise<{ readonly stopped: true }> {
    await this.assertCapability()
    context.signal.throwIfAborted()
    const environment = await this.resolve(request, true)
    if (!environment) return { stopped: true }
    let statuses = await environment.process.list()
    if (statuses.length > 1) {
      throw new Error('candidate exact process environment contains more than one process')
    }
    const status = statuses[0]
    if (status?.running) {
      const process = await environment.process.get(status.pid)
      if (!process) throw new Error('candidate environment lost its running process handle')
      await stopProcess(process)
    }
    context.signal.throwIfAborted()
    statuses = await environment.process.list()
    if (statuses.some((entry) => entry.running)) {
      throw new Error('candidate exact process termination is not proven')
    }
    const finalStatus = statuses[0]
    if (finalStatus) assertTerminalStatus(finalStatus)
    const state = this.states.get(executionKey(request.executionId, request.executionPlanDigest))
    if (state) {
      state.termination = finalStatus?.termination ?? state.termination
      if (context.reason === 'timeout' && state.trace) {
        state.runtimeTermination = {
          kind: 'timeout',
          timeoutMs: state.trace.timeoutMs,
        }
      }
      await appendExactProcessTrace(state, context.traceStore, finalStatus)
    }
    return { stopped: true }
  }

  async capture(
    request: AgentCandidateExecutorStopRequest,
    context: Parameters<AgentCandidateExecutorPort['capture']>[1],
  ) {
    await this.assertCapability()
    context.signal.throwIfAborted()
    const environment = await this.resolve(request, false)
    const statuses = await environment.process.list()
    const status = statuses[0]
    if (statuses.length !== 1 || !status || status.running) {
      throw new Error('candidate environment must contain one stopped process before capture')
    }
    assertTerminalStatus(status)
    const process = await environment.process.get(status.pid)
    if (!process) throw new Error('candidate environment lost its captured process handle')
    const currentStatus = await process.status()
    assertTerminalStatus(currentStatus, status.termination)
    const state = this.states.get(executionKey(request.executionId, request.executionPlanDigest))
    const output =
      state?.output ??
      (await awaitOutput(
        collectOutput(process, outputSpec(environment).maxBytes),
        context.signal,
        Date.now() + this.provisionTimeoutMs,
      ))
    context.signal.throwIfAborted()
    const evidence = canonicalCandidateBytes({
      kind: 'agent-candidate-exact-process-capture',
      provider: environment.provider,
      environmentId: environment.id,
      executionId: request.executionId,
      executionPlanDigest: request.executionPlanDigest,
      createInputDigest: environment.metadata?.createInputDigest,
      process: {
        pid: status.pid,
        exitCode: status.exitCode,
        ...(status.exitSignal ? { exitSignal: status.exitSignal } : {}),
        termination: status.termination,
      },
      ...(state?.runtimeTermination ? { runtimeTermination: state.runtimeTermination } : {}),
      output: { sha256: sha256Bytes(output), byteLength: output.byteLength },
    })
    return {
      taskOutcome: { kind: 'output' as const, bytes: output },
      evidence,
    }
  }

  async dispose(
    request: AgentCandidateExecutorStopRequest,
    context: { signal: AbortSignal },
  ): Promise<{ readonly disposed: true }> {
    await this.assertCapability()
    context.signal.throwIfAborted()
    const environment = await this.resolve(request, true)
    if (!environment) return { disposed: true }
    let destroyError: unknown
    try {
      await environment.destroy()
    } catch (error) {
      destroyError = error
    }
    const remaining = await this.exactProcess.get(environment.id)
    if (remaining) {
      throw new Error('exact process environment disposal is not proven', { cause: destroyError })
    }
    context.signal.throwIfAborted()
    this.states.delete(executionKey(request.executionId, request.executionPlanDigest))
    return { disposed: true }
  }

  private async assertCapability(mode?: 'blocked' | 'strict'): Promise<void> {
    const pending =
      this.capabilitiesPromise ?? Promise.resolve(this.options.provider.capabilities())
    this.capabilitiesPromise = pending
    let capabilities: AgentEnvironmentCapabilities
    try {
      capabilities = await pending
    } catch (error) {
      if (this.capabilitiesPromise === pending) this.capabilitiesPromise = undefined
      throw error
    }
    const exact = capabilities.exactProcess
    if (!exact) {
      throw new Error(
        `agent environment provider "${this.options.provider.name}" does not declare exact process support`,
      )
    }
    if (mode && !exact.egress.includes(mode)) {
      throw new Error(
        `agent environment provider "${this.options.provider.name}" does not declare ${mode} exact egress`,
      )
    }
  }

  private async resolve(
    request: AgentCandidateExecutorStopRequest,
    missingIsDeleted: false,
  ): Promise<AgentExactProcessEnvironment>
  private async resolve(
    request: AgentCandidateExecutorStopRequest,
    missingIsDeleted: true,
  ): Promise<AgentExactProcessEnvironment | undefined>
  private async resolve(
    request: AgentCandidateExecutorStopRequest,
    missingIsDeleted: boolean,
  ): Promise<AgentExactProcessEnvironment | undefined> {
    const key = executionKey(request.executionId, request.executionPlanDigest)
    const active = this.states.get(key)?.environment
    if (active) return active
    const metadata = {
      kind: 'agent-candidate-execution',
      provider: this.options.provider.name,
      executionId: request.executionId,
      executionPlanDigest: request.executionPlanDigest,
    }
    const listed = await this.exactProcess.list({
      metadata,
      ...(this.providerOptions ? { providerOptions: this.providerOptions } : {}),
    })
    const matches = listed.filter(
      (environment) =>
        environment.provider === this.options.provider.name &&
        Object.entries(metadata).every(([name, value]) =>
          isDeepStrictEqual(environment.metadata?.[name], value),
        ),
    )
    if (matches.length > 1) {
      throw new Error('multiple exact process environments match one candidate execution')
    }
    const environment = matches[0]
    if (!environment) {
      if (missingIsDeleted) return undefined
      throw new Error('candidate exact process evidence is unavailable')
    }
    if (!isSha256Digest(environment.metadata?.createInputDigest)) {
      throw new Error('candidate exact process create-input digest is unavailable')
    }
    this.states.set(key, { environment })
    return environment
  }
}

async function appendExactProcessTrace(
  state: ExactProcessRunState,
  traceStore: TraceStore,
  status?: AgentExactProcessStatus,
): Promise<void> {
  const trace = state.trace
  if (!trace || trace.written) return
  const endedAt = Math.max(trace.startedAt, Math.min(Date.now(), trace.deadlineAtMs))
  const termination = state.runtimeTermination ?? state.termination ?? status?.termination
  await traceStore.appendRun({
    runId: trace.runId,
    scenarioId: trace.scenarioId,
    startedAt: trace.startedAt,
    endedAt,
    status: termination?.kind === 'exit' && termination.exitCode === 0 ? 'completed' : 'failed',
    tags: trace.tags,
  })
  trace.written = true
}

function assertSupportedRequest(request: AgentCandidateExecutorRequest): void {
  if (request.benchmark.task.outcome.kind !== 'output') {
    throw new Error(
      'exact process candidate executor does not support workspace outcomes; use Pier',
    )
  }
  if (request.executionPlan.value.material.codeKind !== 'disabled' || request.inputs.candidate) {
    throw new Error('exact process candidate executor does not support code workspaces; use Pier')
  }
  if (request.memory.mode !== 'disabled') {
    throw new Error('exact process candidate executor does not support isolated memory')
  }
  const mediaType = request.benchmark.task.outcome.mediaType.toLowerCase()
  if (
    !(
      mediaType.startsWith('text/') ||
      mediaType === 'application/json' ||
      mediaType.endsWith('+json')
    )
  ) {
    throw new Error('exact process candidate executor supports only UTF-8 text and JSON outputs')
  }
  if (!posix.isAbsolute(request.launch.executable) && !request.launch.env.PATH?.trim()) {
    throw new Error('exact process candidate executable must be absolute or declare a signed PATH')
  }
  if (!request.roots) throw new Error('candidate execution roots are missing')
  assertAgentCandidateExecutionRoots(request.roots)
}

async function materializeRequest(
  environment: AgentExactProcessEnvironment,
  request: AgentCandidateExecutorRequest,
  signal: AbortSignal,
): Promise<void> {
  assertAgentCandidateExecutionRoots(request.roots)
  const knowledgePaths = assertKnowledgeExecutionBinding(request)
  for (const file of request.inputs.task.files) {
    await environment.writeFile(beneath(request.roots.taskRoot, file.path), file.bytes, {
      mode: file.mode,
      signal,
    })
  }
  for (const file of request.inputs.profile.files) {
    await environment.writeFile(profileFileExecutionPath(request, file), file.bytes, {
      mode: file.mode,
      signal,
    })
  }
  if (request.knowledge && knowledgePaths) {
    for (const file of request.knowledge.files) {
      await environment.writeFile(beneath(knowledgePaths.root, file.path), file.bytes, {
        mode: file.mode,
        signal,
      })
    }
    if (request.knowledge.retrievalConfig && knowledgePaths.retrievalConfig) {
      await environment.writeFile(
        knowledgePaths.retrievalConfig,
        request.knowledge.retrievalConfig,
        { mode: 0o644, signal },
      )
    }
  }
  if (request.instruction.delivery.kind === 'utf8-file') {
    await environment.writeFile(request.instruction.delivery.path, request.instruction.bytes, {
      mode: 0o644,
      signal,
    })
  }
}

function assertKnowledgeExecutionBinding(
  request: AgentCandidateExecutorRequest,
): ReturnType<typeof candidateKnowledgeExecutionPaths> | undefined {
  const knowledge = request.knowledge
  if (!knowledge) {
    if (
      request.launch.env[CANDIDATE_KNOWLEDGE_ROOT_ENV] !== undefined ||
      request.launch.env[CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG_ENV] !== undefined
    ) {
      throw new Error('candidate launch declares knowledge paths without verified knowledge')
    }
    return undefined
  }
  const paths = candidateKnowledgeExecutionPaths(
    request.roots.taskRoot,
    knowledge.retrievalConfig !== undefined,
  )
  if (
    request.launch.env[CANDIDATE_KNOWLEDGE_ROOT_ENV] !== paths.root ||
    request.launch.env[CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG_ENV] !== paths.retrievalConfig
  ) {
    throw new Error('candidate knowledge paths do not match the signed launch environment')
  }
  const reserved = [paths.root, paths.retrievalConfig].filter(
    (value): value is string => value !== undefined,
  )
  const otherFiles = [
    ...request.inputs.task.files.map((file) => beneath(request.roots.taskRoot, file.path)),
    ...request.inputs.profile.files.map((file) => profileFileExecutionPath(request, file)),
    ...(request.instruction.delivery.kind === 'utf8-file'
      ? [request.instruction.delivery.path]
      : []),
  ]
  if (
    otherFiles.some((path) =>
      reserved.some(
        (reservedPath) =>
          path === reservedPath ||
          path.startsWith(`${reservedPath}/`) ||
          reservedPath.startsWith(`${path}/`),
      ),
    )
  ) {
    throw new Error('candidate knowledge paths overlap other execution inputs')
  }
  return paths
}

function profileFileExecutionPath(
  request: AgentCandidateExecutorRequest,
  file: AgentCandidateExecutorRequest['inputs']['profile']['files'][number],
): string {
  const workspace = request.executionPlan.value.material.profile.targetWorkspace
  const workspaceRoot = workspace === 'task' ? request.roots.taskRoot : request.roots.candidateRoot
  if (!workspaceRoot) throw new Error('candidate profile targets a missing workspace')
  if (file.root !== 'agent') return beneath(workspaceRoot, file.path)
  const agentDir = profileAgentDirectory(request)
  return beneath(agentDir, file.path)
}

function profileAgentDirectory(request: AgentCandidateExecutorRequest): string {
  const paths = candidateProfileAgentPaths(
    request.profilePlan.value.material,
    request.roots.profileRoot,
  )
  if (!paths) throw new Error('candidate profile agent-root file is missing its private root')
  if (
    request.launch.env[PI_CANDIDATE_AGENT_DIR_ENV] !== paths.agentDir ||
    request.launch.env[PI_CANDIDATE_SESSION_DIR_ENV] !== paths.sessionDir
  ) {
    throw new Error('candidate Pi agent-root files do not match the signed launch environment')
  }
  return paths.agentDir
}

function exactLaunch(request: AgentCandidateExecutorRequest): AgentExactProcessLaunch {
  const instruction = new TextDecoder('utf-8', { fatal: true }).decode(request.instruction.bytes)
  const base = {
    executable: request.launch.executable,
    args: request.launch.args,
    cwd: request.launch.cwd,
    env: request.launch.env,
    timeoutMs: 0,
  }
  switch (request.instruction.delivery.kind) {
    case 'argv-append':
      return { ...base, args: [...base.args, instruction] }
    case 'stdin-utf8':
      return { ...base, stdin: instruction }
    case 'utf8-file':
      return base
  }
}

async function collectOutput(process: AgentExactProcess, maxBytes: number): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  let byteLength = 0
  for await (const chunk of process.stdout()) {
    const bytes = Buffer.from(chunk, 'utf8')
    byteLength += bytes.byteLength
    if (byteLength > maxBytes) {
      let stopError: unknown
      try {
        await stopProcess(process)
      } catch (error) {
        stopError = error
      }
      throw new Error(`candidate output exceeds its ${maxBytes}-byte maximum`, {
        cause: stopError,
      })
    }
    chunks.push(bytes)
  }
  return Uint8Array.from(Buffer.concat(chunks, byteLength))
}

async function awaitOutput(
  output: Promise<Uint8Array>,
  signal: AbortSignal,
  deadlineAtMs: number,
): Promise<Uint8Array> {
  signal.throwIfAborted()
  const remainingMs = deadlineAtMs - Date.now()
  if (remainingMs <= 0) throw new Error('candidate output deadline expired')
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  try {
    return await Promise.race([
      output,
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason ?? new Error('candidate output cancelled'))
        signal.addEventListener('abort', onAbort, { once: true })
        timer = setTimeout(
          () => reject(new Error('candidate output deadline expired')),
          remainingMs,
        )
      }),
    ])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
    if (timer) clearTimeout(timer)
  }
}

async function stopProcess(process: AgentExactProcess): Promise<void> {
  const before = await process.status()
  if (!before.running) return
  try {
    await process.kill()
  } catch (error) {
    if ((await process.status()).running) throw error
  }
  const termination = await process.wait()
  assertTerminalStatus(await process.status(), termination)
}

function assertTerminalStatus(
  status: AgentExactProcessStatus,
  expected?: AgentCandidateTermination,
): asserts status is AgentExactProcessStatus & { termination: AgentCandidateTermination } {
  if (status.running || !status.termination) {
    throw new Error('exact process returned no terminal reason after exit')
  }
  if (expected && !isDeepStrictEqual(status.termination, expected)) {
    throw new Error('exact process wait and status returned different terminal reasons')
  }
}

function assertExecutionEnvironment(
  environment: AgentExactProcessEnvironment,
  metadata: Record<string, unknown>,
  providerName: string,
): void {
  if (!environment.id || environment.provider !== providerName) {
    throw new Error('exact process provider returned the wrong environment identity')
  }
  if (
    !Object.entries(metadata).every(([name, value]) =>
      isDeepStrictEqual(environment.metadata?.[name], value),
    )
  ) {
    throw new Error('exact process provider did not persist candidate execution metadata')
  }
}

function outputSpec(environment: AgentExactProcessEnvironment): { maxBytes: number } {
  const maxBytes = environment.metadata?.outputMaxBytes
  if (!Number.isSafeInteger(maxBytes) || Number(maxBytes) < 1) {
    throw new Error('candidate exact process output bound is unavailable')
  }
  return { maxBytes: Number(maxBytes) }
}

function executionKey(executionId: string, executionPlanDigest: Sha256Digest): string {
  return `${executionId}\0${executionPlanDigest}`
}

function executionIdempotencyKey(executionId: string, executionPlanDigest: Sha256Digest): string {
  return `candidate-${canonicalCandidateDigest({
    kind: 'agent-candidate-execution-identity',
    executionId,
    executionPlanDigest,
  }).slice('sha256:'.length)}`
}

function exactImage(image: string, manifestDigest: Sha256Digest): string {
  if (isSha256Digest(image)) {
    if (image !== manifestDigest) {
      throw new Error('candidate container image conflicts with its resolved manifest')
    }
    return image
  }
  const marker = image.lastIndexOf('@')
  if (marker < 0) return `${image}@${manifestDigest}`
  if (image.slice(marker + 1) !== manifestDigest) {
    throw new Error('candidate container image conflicts with its resolved manifest')
  }
  return image
}

function environmentLifetimeMs(timeoutMs: number, retentionMs: number): number {
  const total = positiveInteger(timeoutMs, 'candidate execution timeout') + retentionMs
  if (!Number.isSafeInteger(total)) throw new Error('candidate environment lifetime is too large')
  return Math.ceil(total / 1_000) * 1_000
}

function exactResources(resources: AgentExactProcessResources): AgentExactProcessResources {
  if (!Number.isFinite(resources.cpu) || resources.cpu <= 0) {
    throw new Error('exact process CPU must be positive and finite')
  }
  return Object.freeze({
    cpu: resources.cpu,
    memoryMb: positiveInteger(resources.memoryMb, 'exact process memory'),
    diskMb: positiveInteger(resources.diskMb, 'exact process disk'),
  })
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${label} must be a positive integer`)
  return value
}

function beneath(root: string, relativePath: string): string {
  if (posix.isAbsolute(relativePath)) throw new Error('candidate input path must be relative')
  const path = posix.normalize(relativePath)
  if (path === '..' || path.startsWith('../')) {
    throw new Error('candidate input path escapes its execution root')
  }
  return posix.join(root, path)
}

function isSha256Digest(value: unknown): value is Sha256Digest {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value)
}
