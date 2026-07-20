import { posix } from 'node:path'
import type { TraceStore } from '@tangle-network/agent-eval'
import type { CandidateExperimentExecutionInput } from '@tangle-network/agent-eval/contract'
import type {
  AgentCandidateTermination,
  CandidateExecutionEvidence,
  Sha256Digest,
} from '@tangle-network/agent-interface'
import type {
  CreateSandboxOptions,
  ListSandboxOptions,
  Process,
  ProcessStatus,
  SandboxClient,
  SandboxInstance,
  SandboxResources,
} from '@tangle-network/sandbox'

import type { AgentCandidateExecutionClaimStore } from '../candidate-execution/claim'
import { canonicalCandidateBytes } from '../candidate-execution/digest'
import {
  CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG_ENV,
  CANDIDATE_KNOWLEDGE_ROOT_ENV,
  candidateKnowledgeExecutionPaths,
} from '../candidate-execution/knowledge'
import type { PrepareAgentCandidateExecutionOptions } from '../candidate-execution/prepare'
import type {
  AgentCandidateBenchmarkGraderPort,
  AgentCandidateExecutionPorts,
  AgentCandidateExecutorPort,
  AgentCandidateExecutorRequest,
  AgentCandidateExecutorStopRequest,
  AgentCandidateOutputArtifactPort,
} from '../candidate-execution/types'
import { AGENT_CANDIDATE_EXECUTION_SUPPORT } from '../candidate-execution/verify'
import {
  type AgentCandidateExperimentCellPlacement,
  executeAgentCandidateExperimentCell,
} from './improvement-cycle'

type SandboxClientPort = Pick<SandboxClient, 'create' | 'get' | 'list'>

type SandboxExecutorOptions = NonNullable<
  CreateSandboxCandidateExperimentExecutorOptions['sandbox']
>

interface SandboxRunState {
  sandbox: SandboxInstance
  output?: Uint8Array
  termination?: AgentCandidateTermination
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

/** Declares the exact candidate surfaces the sandbox executor can run. */
export const sandboxCandidateExperimentExecutionSupport = Object.freeze({
  outcomes: Object.freeze(['output'] as const),
  outputMediaTypes: Object.freeze(['text/*', 'application/json', '*+json'] as const),
  code: Object.freeze(['disabled'] as const),
  memory: Object.freeze(['disabled'] as const),
  knowledge: true,
  profile: AGENT_CANDIDATE_EXECUTION_SUPPORT.profile,
  isolation: Object.freeze({
    freshSandbox: true,
    exactProcess: true,
    egress: Object.freeze(['blocked', 'strict'] as const),
  }),
})

export interface CreateSandboxCandidateExperimentExecutorOptions {
  client: SandboxClientPort
  ports: AgentCandidateExecutionPorts
  grader: AgentCandidateBenchmarkGraderPort
  outputArtifacts: AgentCandidateOutputArtifactPort
  traceStore: TraceStore
  claimStore: AgentCandidateExecutionClaimStore
  sandbox?: {
    teamId?: string
    resources?: SandboxResources
    createTimeoutMs?: number
    evidenceRetentionSeconds?: number
  }
  cleanupTimeoutMs?: number
  resultTimeoutMs?: number
}

export interface SandboxCandidateExperimentExecution extends CandidateExperimentExecutionInput {
  executionId: string
  attempt?: number
  executionRoots: AgentCandidateExperimentCellPlacement['executionRoots']
  stagingRoots: AgentCandidateExperimentCellPlacement['stagingRoots']
  preparation?: PrepareAgentCandidateExecutionOptions
}

export interface SandboxCandidateExperimentExecutor {
  /** The same port is usable by Runtime's expired-claim recovery path. */
  readonly executor: AgentCandidateExecutorPort
  execute(input: SandboxCandidateExperimentExecution): Promise<CandidateExecutionEvidence>
}

/** Execute one signed experiment cell inside a fresh Tangle sandbox. */
export function createSandboxCandidateExperimentExecutor(
  options: CreateSandboxCandidateExperimentExecutorOptions,
): SandboxCandidateExperimentExecutor {
  const executor = new SandboxAgentCandidateExecutor(
    options.client,
    options.sandbox,
    options.resultTimeoutMs,
  )
  return Object.freeze({
    executor,
    async execute(input: SandboxCandidateExperimentExecution): Promise<CandidateExecutionEvidence> {
      return await executeAgentCandidateExperimentCell({
        ...input,
        attempt: input.attempt ?? 1,
        executionId: input.executionId,
        executionRoots: input.executionRoots,
        stagingRoots: input.stagingRoots,
        ports: options.ports,
        ...(input.preparation ? { preparation: input.preparation } : {}),
        execution: {
          executor,
          grader: options.grader,
          outputArtifacts: options.outputArtifacts,
          traceStore: options.traceStore,
          claimStore: options.claimStore,
          ...(options.cleanupTimeoutMs === undefined
            ? {}
            : { cleanupTimeoutMs: options.cleanupTimeoutMs }),
          ...(options.resultTimeoutMs === undefined
            ? {}
            : { resultTimeoutMs: options.resultTimeoutMs }),
        },
      })
    },
  })
}

class SandboxAgentCandidateExecutor implements AgentCandidateExecutorPort {
  private readonly states = new Map<string, SandboxRunState>()

  constructor(
    private readonly client: SandboxClientPort,
    private readonly options: SandboxExecutorOptions = {},
    private readonly captureTimeoutMs = 120_000,
  ) {}

  async execute(
    request: AgentCandidateExecutorRequest,
    context: Parameters<AgentCandidateExecutorPort['execute']>[1],
  ) {
    assertSupportedRequest(request)
    const outcome = request.benchmark.task.outcome
    if (outcome.kind !== 'output') throw new Error('sandbox executor requires an output task')
    const key = executionKey(request.executionId, request.executionPlan.value.digest)
    const sandbox = await this.client.create(sandboxCreateOptions(request, this.options), {
      signal: context.signal,
      timeoutMs: this.options.createTimeoutMs ?? 120_000,
    })
    const state: SandboxRunState = { sandbox }
    this.states.set(key, state)
    if ((await sandbox.process.list()).length !== 0) {
      throw new Error('fresh candidate sandbox already contains a process')
    }
    await materializeRequest(sandbox, request)
    const launch = exactLaunch(request)
    const startedAt = Date.now()
    state.trace = {
      runId: request.trace.runId,
      scenarioId: request.benchmark.task.scenario.id,
      startedAt,
      deadlineAtMs: context.deadlineAtMs,
      timeoutMs: request.hardLimits.timeoutMs,
      tags: { ...request.trace.tags, sandboxId: sandbox.id },
      written: false,
    }
    const process = await sandbox.process.spawnExact(launch.executable, launch.args, {
      cwd: request.launch.cwd,
      env: { ...request.launch.env },
      ...(launch.stdin === undefined ? {} : { stdin: launch.stdin }),
      timeoutMs: request.hardLimits.timeoutMs,
    })
    const outputPromise = collectOutput(process, outcome.maxBytes)
    let cancellation: Promise<void> | undefined
    let cancellationTermination: AgentCandidateTermination | undefined
    let processExited = false
    const cancel = () => {
      if (processExited) return
      cancellationTermination =
        Date.now() >= context.deadlineAtMs
          ? { kind: 'timeout', timeoutMs: request.hardLimits.timeoutMs }
          : { kind: 'cancelled' }
      cancellation ??= killProcess(process)
    }
    context.signal.addEventListener('abort', cancel, { once: true })
    if (context.signal.aborted) cancel()
    try {
      const waitedExitCode = await process.wait()
      processExited = true
      context.signal.removeEventListener('abort', cancel)
      if (cancellation) await cancellation
      const status = await process.status()
      if (status.running || status.exitCode !== waitedExitCode) {
        throw new Error('sandbox process returned an inconsistent terminal status')
      }
      state.output = await awaitOutput(outputPromise, context.signal, context.deadlineAtMs)
      state.termination = cancellationTermination ?? processTermination(status)
      await appendSandboxTrace(state, context.traceStore, status)
      return { executionId: request.executionId, termination: state.termination }
    } finally {
      context.signal.removeEventListener('abort', cancel)
      void outputPromise.catch(() => undefined)
    }
  }

  async stop(
    request: AgentCandidateExecutorStopRequest,
    context: Parameters<AgentCandidateExecutorPort['stop']>[1],
  ): Promise<{ readonly stopped: true }> {
    context.signal.throwIfAborted()
    const sandbox = await this.resolve(request, true)
    if (!sandbox) return { stopped: true }
    const statuses = await sandbox.process.list()
    if (statuses.length > 1) throw new Error('candidate sandbox contains more than one process')
    const status = statuses[0]
    if (status?.running) {
      const process = await sandbox.process.get(status.pid)
      if (!process) throw new Error('candidate sandbox lost its running process handle')
      await killProcess(process)
    }
    context.signal.throwIfAborted()
    const remaining = await sandbox.process.list()
    if (remaining.some((entry) => entry.running)) {
      throw new Error('candidate sandbox process termination is not proven')
    }
    const state = this.states.get(executionKey(request.executionId, request.executionPlanDigest))
    if (state) {
      if (context.reason === 'timeout') {
        state.termination = { kind: 'timeout', timeoutMs: state.trace?.timeoutMs ?? 0 }
      }
      await appendSandboxTrace(state, context.traceStore, remaining[0])
    }
    return { stopped: true }
  }

  async capture(
    request: AgentCandidateExecutorStopRequest,
    context: Parameters<AgentCandidateExecutorPort['capture']>[1],
  ) {
    context.signal.throwIfAborted()
    const sandbox = await this.resolve(request, false)
    const statuses = await sandbox.process.list()
    if (statuses.length > 1 || statuses.some((entry) => entry.running)) {
      throw new Error('candidate sandbox must contain one stopped process before capture')
    }
    const state = this.states.get(executionKey(request.executionId, request.executionPlanDigest))
    let output = state?.output
    let termination = state?.termination
    const status = statuses[0]
    if (status && !output) {
      const process = await sandbox.process.get(status.pid)
      if (!process) throw new Error('candidate sandbox lost its captured process handle')
      const expected = sandboxOutputSpec(sandbox)
      output = await awaitOutput(
        collectOutput(process, expected.maxBytes),
        context.signal,
        Date.now() + this.captureTimeoutMs,
      )
    }
    if (status && !termination) {
      termination = processTermination(status)
    }
    context.signal.throwIfAborted()
    const evidence = canonicalCandidateBytes({
      kind: 'sandbox-agent-candidate-capture',
      sandboxId: sandbox.id,
      executionId: request.executionId,
      executionPlanDigest: request.executionPlanDigest,
      ...(status
        ? {
            process: {
              pid: status.pid,
              exitCode: status.exitCode,
              ...(status.exitSignal ? { exitSignal: status.exitSignal } : {}),
            },
          }
        : {}),
      ...(termination ? { termination } : {}),
    })
    return {
      ...(output ? { taskOutcome: { kind: 'output' as const, bytes: output } } : {}),
      evidence,
    }
  }

  async dispose(
    request: AgentCandidateExecutorStopRequest,
    context: { signal: AbortSignal },
  ): Promise<{ readonly disposed: true }> {
    context.signal.throwIfAborted()
    const sandbox = await this.resolve(request, true)
    if (!sandbox) return { disposed: true }
    try {
      await sandbox.delete()
    } catch (error) {
      if (await this.client.get(sandbox.id)) throw error
    }
    context.signal.throwIfAborted()
    this.states.delete(executionKey(request.executionId, request.executionPlanDigest))
    return { disposed: true }
  }

  private async resolve(
    request: AgentCandidateExecutorStopRequest,
    missingIsDeleted: false,
  ): Promise<SandboxInstance>
  private async resolve(
    request: AgentCandidateExecutorStopRequest,
    missingIsDeleted: true,
  ): Promise<SandboxInstance | undefined>
  private async resolve(
    request: AgentCandidateExecutorStopRequest,
    missingIsDeleted: boolean,
  ): Promise<SandboxInstance | undefined> {
    const key = executionKey(request.executionId, request.executionPlanDigest)
    const active = this.states.get(key)?.sandbox
    if (active) return active
    const matches: SandboxInstance[] = []
    const scope: ListSandboxOptions['scope'] = this.options.teamId
      ? `team:${this.options.teamId}`
      : 'personal'
    for (let offset = 0; ; offset += 100) {
      const page = await this.client.list({ scope, limit: 100, offset })
      for (const candidate of page) {
        if (matchesExecution(candidate, request)) matches.push(candidate)
      }
      if (page.length < 100) break
    }
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) throw new Error('multiple sandboxes match one candidate execution')
    if (missingIsDeleted) return undefined
    throw new Error('candidate sandbox evidence is unavailable')
  }
}

async function appendSandboxTrace(
  state: SandboxRunState,
  traceStore: TraceStore,
  status?: ProcessStatus,
): Promise<void> {
  const trace = state.trace
  if (!trace || trace.written) return
  const endedAt = Math.max(trace.startedAt, Math.min(Date.now(), trace.deadlineAtMs))
  await traceStore.appendRun({
    runId: trace.runId,
    scenarioId: trace.scenarioId,
    startedAt: trace.startedAt,
    endedAt,
    status:
      state.termination?.kind !== 'timeout' && status?.running === false && status.exitCode === 0
        ? 'completed'
        : 'failed',
    tags: trace.tags,
  })
  trace.written = true
}

function assertSupportedRequest(request: AgentCandidateExecutorRequest): void {
  if (request.benchmark.task.outcome.kind !== 'output') {
    throw new Error('sandbox candidate executor does not support workspace outcomes; use Pier')
  }
  if (request.executionPlan.value.material.codeKind !== 'disabled' || request.inputs.candidate) {
    throw new Error('sandbox candidate executor does not support code workspaces; use Pier')
  }
  if (request.memory.mode !== 'disabled') {
    throw new Error('sandbox candidate executor does not support isolated memory')
  }
  const mediaType = request.benchmark.task.outcome.mediaType.toLowerCase()
  if (
    !(
      mediaType.startsWith('text/') ||
      mediaType === 'application/json' ||
      mediaType.endsWith('+json')
    )
  ) {
    throw new Error('sandbox candidate executor supports only UTF-8 text and JSON outputs')
  }
}

function sandboxCreateOptions(
  request: AgentCandidateExecutorRequest,
  options: SandboxExecutorOptions = {},
): CreateSandboxOptions {
  const material = request.executionPlan.value.material
  const retentionSeconds = options.evidenceRetentionSeconds ?? 900
  if (!Number.isSafeInteger(retentionSeconds) || retentionSeconds < 60) {
    throw new Error('sandbox evidence retention must be at least 60 seconds')
  }
  const maxLifetimeSeconds = Math.ceil(request.hardLimits.timeoutMs / 1_000) + retentionSeconds
  const network = material.model.access.network
  const egressPolicy =
    network.mode === 'disabled'
      ? { mode: 'blocked' as const }
      : {
          mode: 'strict' as const,
          allowDomains: [...network.domains],
          includeImplicitDomains: false,
        }
  const value = {
    image: exactImage(material.container.image, material.container.manifestDigest),
    bare: true,
    publicEdge: false,
    ephemeral: true,
    sshEnabled: false,
    webTerminalEnabled: false,
    secrets: [],
    capabilities: [],
    egressPolicy,
    maxLifetimeSeconds,
    idempotencyKey: `candidate-${request.executionPlan.value.digest.slice('sha256:'.length)}`,
    metadata: {
      kind: 'agent-candidate-execution',
      executionId: request.executionId,
      executionPlanDigest: request.executionPlan.value.digest,
      outputMediaType:
        request.benchmark.task.outcome.kind === 'output'
          ? request.benchmark.task.outcome.mediaType
          : '',
      outputMaxBytes:
        request.benchmark.task.outcome.kind === 'output'
          ? request.benchmark.task.outcome.maxBytes
          : 0,
    },
    ...(options.teamId ? { teamId: options.teamId } : {}),
    ...(options.resources ? { resources: options.resources } : {}),
  }
  return value
}

async function materializeRequest(
  sandbox: SandboxInstance,
  request: AgentCandidateExecutorRequest,
): Promise<void> {
  const knowledgePaths = assertKnowledgeExecutionBinding(request)
  for (const file of request.inputs.task.files) {
    await writeExactFile(sandbox, beneath(request.roots.taskRoot, file.path), file.bytes, file.mode)
  }
  const profileRoot =
    request.executionPlan.value.material.profile.targetWorkspace === 'task'
      ? request.roots.taskRoot
      : request.roots.candidateRoot
  if (!profileRoot) throw new Error('candidate profile targets a missing workspace')
  for (const file of request.profileActivation.files) {
    await writeExactFile(
      sandbox,
      beneath(profileRoot, file.path),
      Buffer.from(file.content, 'utf8'),
      file.mode,
    )
  }
  if (request.knowledge && knowledgePaths) {
    for (const file of request.knowledge.files) {
      await writeExactFile(sandbox, beneath(knowledgePaths.root, file.path), file.bytes, file.mode)
    }
    if (request.knowledge.retrievalConfig && knowledgePaths.retrievalConfig) {
      await writeExactFile(
        sandbox,
        knowledgePaths.retrievalConfig,
        request.knowledge.retrievalConfig,
        0o644,
      )
    }
  }
  if (request.instruction.delivery.kind === 'utf8-file') {
    await writeExactFile(
      sandbox,
      request.instruction.delivery.path,
      request.instruction.bytes,
      0o644,
    )
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
  const profileRoot =
    request.executionPlan.value.material.profile.targetWorkspace === 'task'
      ? request.roots.taskRoot
      : request.roots.candidateRoot
  const otherFiles = [
    ...request.inputs.task.files.map((file) => beneath(request.roots.taskRoot, file.path)),
    ...(profileRoot
      ? request.profileActivation.files.map((file) => beneath(profileRoot, file.path))
      : []),
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

function exactLaunch(request: AgentCandidateExecutorRequest): {
  executable: string
  args: readonly string[]
  stdin?: string
} {
  const instruction = new TextDecoder('utf-8', { fatal: true }).decode(request.instruction.bytes)
  switch (request.instruction.delivery.kind) {
    case 'argv-append':
      return { executable: request.launch.executable, args: [...request.launch.args, instruction] }
    case 'stdin-utf8':
      return {
        executable: request.launch.executable,
        args: request.launch.args,
        stdin: instruction,
      }
    case 'utf8-file':
      return { executable: request.launch.executable, args: request.launch.args }
  }
}

async function writeExactFile(
  sandbox: SandboxInstance,
  path: string,
  bytes: Uint8Array,
  mode: number,
): Promise<void> {
  await sandbox.fs.write(path, Buffer.from(bytes).toString('base64'), {
    encoding: 'base64',
    mode,
  })
}

async function collectOutput(process: Process, maxBytes: number): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  let byteLength = 0
  for await (const chunk of process.stdout()) {
    const bytes = Buffer.from(chunk, 'utf8')
    byteLength += bytes.byteLength
    if (byteLength > maxBytes) {
      await killProcess(process)
      throw new Error(`sandbox candidate output exceeds its ${maxBytes}-byte maximum`)
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
  if (remainingMs <= 0) throw new Error('sandbox candidate output deadline expired')
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  try {
    return await Promise.race([
      output,
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason ?? new Error('sandbox candidate output cancelled'))
        signal.addEventListener('abort', onAbort, { once: true })
        timer = setTimeout(
          () => reject(new Error('sandbox candidate output deadline expired')),
          remainingMs,
        )
      }),
    ])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
    if (timer) clearTimeout(timer)
  }
}

async function killProcess(process: Process): Promise<void> {
  const before = await process.status()
  if (!before.running) return
  try {
    await process.kill('SIGKILL', { tree: true })
  } catch (error) {
    if ((await process.status()).running) throw error
  }
}

function processTermination(status: ProcessStatus): AgentCandidateTermination {
  if (status.running) throw new Error('candidate process is still running')
  if (status.exitSignal) {
    if (!/^SIG[A-Z0-9]+$/.test(status.exitSignal)) {
      throw new Error('sandbox returned an invalid process signal')
    }
    return { kind: 'signal', signal: status.exitSignal }
  }
  return { kind: 'exit', exitCode: status.exitCode }
}

function matchesExecution(
  sandbox: { metadata?: Record<string, unknown> },
  request: AgentCandidateExecutorStopRequest,
): boolean {
  return (
    sandbox.metadata?.kind === 'agent-candidate-execution' &&
    sandbox.metadata.executionId === request.executionId &&
    sandbox.metadata.executionPlanDigest === request.executionPlanDigest
  )
}

function sandboxOutputSpec(sandbox: { metadata?: Record<string, unknown> }): { maxBytes: number } {
  const maxBytes = sandbox.metadata?.outputMaxBytes
  if (!Number.isSafeInteger(maxBytes) || Number(maxBytes) < 1) {
    throw new Error('candidate sandbox output bound is unavailable')
  }
  return { maxBytes: Number(maxBytes) }
}

function executionKey(executionId: string, executionPlanDigest: Sha256Digest): string {
  return `${executionId}\0${executionPlanDigest}`
}

function exactImage(image: string, manifestDigest: Sha256Digest): string {
  const marker = image.lastIndexOf('@')
  if (marker < 0) return `${image}@${manifestDigest}`
  if (image.slice(marker + 1) !== manifestDigest) {
    throw new Error('candidate container image conflicts with its resolved manifest')
  }
  return image
}

function beneath(root: string, relativePath: string): string {
  if (posix.isAbsolute(relativePath)) throw new Error('candidate input path must be relative')
  const path = posix.normalize(relativePath)
  if (path === '..' || path.startsWith('../')) {
    throw new Error('candidate input path escapes its execution root')
  }
  return posix.join(root, path)
}
