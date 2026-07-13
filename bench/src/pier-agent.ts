/** Pier transport for a runtime-prepared immutable candidate execution. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import type {
  AgentCandidateBenchmarkGraderPort,
  AgentCandidateExecutionClaimStore,
  AgentCandidateExecutorRequest,
  AgentCandidateExecutorStopRequest,
  AgentCandidateExecutorPort,
  AgentCandidateOutputArtifactPort,
  AgentCandidateProtectedRunCapture,
  AgentCandidateRunFinalization,
  PreparedAgentCandidateExecution,
} from '@tangle-network/agent-runtime'
import { executePreparedAgentCandidate } from '@tangle-network/agent-runtime'
import type { TraceStore } from '@tangle-network/agent-eval'

import { capturePierTaskOutcome } from './pier-task-outcome'

const adapterImportPath = 'pier_agents.tangle_candidate:TangleCandidateAgent'
const sha256Pattern = /^sha256:[a-f0-9]{64}$/

interface StagePreparedPierCandidateOptions {
  readonly prepared: PreparedAgentCandidateExecution
  /** Evaluator-owned directory persisted with the Pier trial. */
  readonly directory: string
  /** Exact Pier package version pinned by the experiment contract. */
  readonly pierVersion: string
}

export interface StagedPierCandidateExecution {
  readonly executionId: string
  readonly directory: string
  readonly taskDirectory: string
  readonly candidateDirectory?: string
  readonly profileDirectory: string
  readonly planPath: string
  readonly receiptPath: string
  readonly agentArgs: readonly string[]
  /** Executor-only model and trace bindings; never present on the prepared object or disk. */
  readonly evaluatorEnv: Readonly<Record<string, string>>
  /** One prepared execution is exactly one Pier trial attempt. */
  readonly attemptArgs: readonly ['--n-attempts', '1', '--max-retries', '0']
}

export interface PierCandidateTerminationAcknowledgement {
  /** The Pier process has exited and has been reaped. */
  readonly processExited: true
  /** Every task container created for this one trial has been removed. */
  readonly containersRemoved: true
}

export interface PierCandidateTrialHandle {
  /** Non-secret durable identity shared with a fresh evaluator process. */
  readonly identity: PierCandidateTrialIdentity
  /** Resolves only after the Pier process exits and its task container is gone. */
  readonly result: Promise<PierCandidateTrialResult>
  /** Idempotently kill/reap Pier and remove its task container, then acknowledge their death. */
  readonly terminateAndWait: () => Promise<PierCandidateTerminationAcknowledgement>
}

export type PierCandidateTrialIdentity = Readonly<AgentCandidateExecutorStopRequest>

/**
 * Evaluator-owned lifecycle whose stop path works without the process-local
 * handle returned by `start`.
 */
export interface PierCandidateTrialController {
  start(
    staged: StagedPierCandidateExecution,
    context: {
      readonly request: AgentCandidateExecutorRequest
      readonly traceStore: TraceStore
      readonly signal: AbortSignal
      readonly deadlineAtMs: number
    },
  ): PierCandidateTrialHandle
  terminateAndWait(
    identity: PierCandidateTrialIdentity,
  ): Promise<PierCandidateTerminationAcknowledgement>
}

/** Evaluator-owned bytes captured from one completed official Pier trial. */
export interface PierCandidateTrialResult {
  /** Parsed value of the exact `result.json` bytes. */
  readonly value: unknown
  /** Exact official `result.json` bytes used as grader evidence. */
  readonly resultBytes: Uint8Array
  /** Exact `/logs/artifacts/model.patch` bytes emitted before official tests. */
  readonly taskPatch: Uint8Array
}

export interface PierCandidateOfficialResult {
  readonly value: unknown
  readonly bytes: Uint8Array
}

type RuntimeGraderInput = Parameters<AgentCandidateBenchmarkGraderPort['run']>[0]
type RuntimeGraderResult = Awaited<ReturnType<AgentCandidateBenchmarkGraderPort['run']>>

/** Executes the exact admitted grader bytes against the official Pier result. */
export interface PierCandidateGraderPort {
  readonly name: string
  readonly version: string
  readonly artifact: AgentCandidateBenchmarkGraderPort['artifact']
  run(input: RuntimeGraderInput & {
    readonly officialResult: PierCandidateOfficialResult
  }): Promise<RuntimeGraderResult>
}

export interface ExecutePreparedPierCandidateOptions extends StagePreparedPierCandidateOptions {
  readonly traceStore: TraceStore
  /** Durable one-shot store shared by every process capable of running this benchmark. */
  readonly claimStore: AgentCandidateExecutionClaimStore
  readonly outputArtifacts: AgentCandidateOutputArtifactPort
  readonly grader: PierCandidateGraderPort
  /**
   * Starts exactly one Pier trial synchronously and persists its non-secret
   * process/container identity before returning.
   */
  readonly controller: PierCandidateTrialController
}

/** Recovery-only runtime executor for an expired attempt owned by another process. */
export function createPierCandidateRecoveryExecutor(
  controller: PierCandidateTrialController,
): AgentCandidateExecutorPort {
  return {
    execute: async () => {
      throw new Error('recovery-only Pier executor cannot start a candidate')
    },
    stopAndCapture: async (request) => {
      assertTerminationAcknowledged(
        await controller.terminateAndWait({
          executionId: request.executionId,
          executionPlanDigest: request.executionPlanDigest,
        }),
      )
      return { stopped: true }
    },
  }
}

interface PierResultLike {
  exception_info?: unknown
  agent_result?: unknown
}

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function nonEmpty(value: string, label: string): string {
  if (!value || value.includes('\0')) throw new Error(`${label} must be non-empty without NUL`)
  return value
}

function absoluteHostPath(value: string, label: string): string {
  if (!isAbsolute(value)) throw new Error(`${label} must be an absolute host path`)
  return resolve(value)
}

function digest(value: string, label: string): string {
  if (!sha256Pattern.test(value)) throw new Error(`${label} is not a SHA-256 digest`)
  return value
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function parseExactJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch (error) {
    throw new Error(`${label} bytes are not UTF-8 JSON`, { cause: error })
  }
}

function safeRelativePath(value: string, label: string): string {
  const parts = value.split('/')
  if (
    !value ||
    value.includes('\0') ||
    value.includes('\\') ||
    isAbsolute(value) ||
    parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`${label} must be a canonical relative POSIX path`)
  }
  return value
}

async function assertRealDirectory(path: string, label: string): Promise<void> {
  const stats = await lstat(path)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory`)
  }
  if ((await realpath(path)) !== path) {
    throw new Error(`${label} has a symlinked path component`)
  }
}

interface ExpectedExecutorFile {
  readonly path: string
  readonly mode: number
  readonly sha256: string
  readonly byteLength?: number
}

async function materializeExecutorFiles(
  root: string,
  files: AgentCandidateExecutorRequest['inputs']['profile']['files'],
  expected: readonly ExpectedExecutorFile[],
  label: string,
): Promise<void> {
  const expectedByPath = new Map(expected.map((file) => [file.path, file]))
  if (expectedByPath.size !== expected.length || files.length !== expected.length) {
    throw new Error(`${label} file set differs from signed evidence`)
  }

  await mkdir(root, { mode: 0o700 })
  await assertRealDirectory(root, label)
  for (const file of files) {
    const relative = safeRelativePath(file.path, `${label} file path`)
    const identity = expectedByPath.get(relative)
    if (!identity) throw new Error(`${label} contains unsigned file ${relative}`)
    if (
      file.mode !== identity.mode ||
      sha256(file.bytes) !== identity.sha256 ||
      (identity.byteLength !== undefined && file.bytes.byteLength !== identity.byteLength)
    ) {
      throw new Error(`${label} file ${relative} differs from signed evidence`)
    }

    const target = join(root, relative)
    const parent = dirname(target)
    if (parent !== root) await mkdir(parent, { recursive: true, mode: 0o700 })
    await writeFile(target, file.bytes, { flag: 'wx', mode: 0o600 })
    await chmod(target, file.mode)
    const stats = await lstat(target)
    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      stats.nlink !== 1 ||
      (stats.mode & 0o777) !== file.mode
    ) {
      throw new Error(`${label} file ${relative} is not a singly-linked regular file`)
    }
  }
}

function protectedEnvironment(
  prepared: PreparedAgentCandidateExecution,
  request: AgentCandidateExecutorRequest,
): Readonly<Record<string, string>> {
  const protectedEntries: Array<readonly [string, string]> = []
  for (const [name, value] of Object.entries(request.launch.env)) {
    const publicValue = prepared.launch.env[name]
    if (publicValue === undefined) {
      protectedEntries.push([name, value])
    } else if (publicValue !== value) {
      throw new Error(`executor request changed signed public environment ${name}`)
    }
  }
  for (const name of Object.keys(prepared.launch.env)) {
    if (!(name in request.launch.env)) {
      throw new Error(`executor request omitted signed public environment ${name}`)
    }
  }
  return Object.freeze(Object.fromEntries(protectedEntries))
}

/**
 * Persist the runtime's exact canonical bytes and return only Pier transport
 * arguments. No benchmark-specific plan or candidate-authored telemetry exists.
 */
/** @internal Package-private transport seam exercised by adapter tests. */
export async function stagePreparedPierCandidateExecution(
  options: StagePreparedPierCandidateOptions,
  request: AgentCandidateExecutorRequest,
): Promise<StagedPierCandidateExecution> {
  const { prepared } = options
  nonEmpty(options.pierVersion, 'pierVersion')
  const directory = absoluteHostPath(options.directory, 'directory')
  await mkdir(directory, { mode: 0o700 })
  await assertRealDirectory(directory, 'directory')
  if (request.memory.mode !== 'disabled') {
    throw new Error('Pier transport does not yet implement protected isolated memory')
  }
  if (request.knowledge !== undefined) {
    throw new Error('Pier transport does not yet implement immutable knowledge mounts')
  }
  const taskDirectory = join(directory, 'task')
  const candidateDirectory = request.inputs.candidate ? join(directory, 'candidate') : undefined
  const profileDirectory = join(directory, 'profile')
  await materializeExecutorFiles(
    taskDirectory,
    request.inputs.task.files,
    request.inputs.task.snapshot.material.files,
    'task executor input',
  )
  if (request.inputs.candidate && candidateDirectory) {
    await materializeExecutorFiles(
      candidateDirectory,
      request.inputs.candidate.files,
      request.inputs.candidate.snapshot.material.files,
      'candidate executor input',
    )
  }
  await materializeExecutorFiles(
    profileDirectory,
    request.inputs.profile.files,
    request.profilePlan.value.material.files.map((file) => ({
      path: file.relPath,
      mode: file.mode,
      sha256: file.contentSha256,
    })),
    'profile executor input',
  )

  const planDigest = digest(request.executionPlan.value.digest, 'execution plan digest')
  if (sha256(request.executionPlan.bytes) !== planDigest) {
    throw new Error('prepared execution-plan bytes do not match their runtime digest')
  }
  assert.deepEqual(
    parseExactJson(request.executionPlan.bytes, 'execution plan'),
    request.executionPlan.value.material,
    'prepared execution-plan bytes differ from runtime material',
  )

  const receiptDigest = digest(
    request.materializationReceipt.digest,
    'materialization receipt digest',
  )
  if (sha256(request.materializationReceipt.bytes) !== receiptDigest) {
    throw new Error('prepared materialization-receipt bytes do not match their runtime digest')
  }
  const { digest: _receiptDigest, ...receiptMaterial } = request.materializationReceipt.value
  assert.deepEqual(
    parseExactJson(request.materializationReceipt.bytes, 'materialization receipt'),
    receiptMaterial,
    'prepared receipt bytes differ from runtime material',
  )

  const planPath = join(directory, 'execution-plan.json')
  const receiptPath = join(directory, 'materialization-receipt.json')
  await Promise.all([
    writeFile(planPath, request.executionPlan.bytes, { mode: 0o600, flag: 'wx' }),
    writeFile(receiptPath, request.materializationReceipt.bytes, { mode: 0o600, flag: 'wx' }),
  ])

  const agentArgs = [
    '--agent-import-path',
    adapterImportPath,
    '--model',
    nonEmpty(request.resolvedModel.requested, 'resolved requested model'),
    '--agent-kwarg',
    `plan_path=${planPath}`,
    '--agent-kwarg',
    `receipt_path=${receiptPath}`,
    '--agent-kwarg',
    `expected_receipt_digest=${receiptDigest}`,
    '--agent-kwarg',
    `trace_run_id=${nonEmpty(request.trace.runId, 'trace run id')}`,
    '--agent-kwarg',
    `task_dir=${taskDirectory}`,
    '--agent-kwarg',
    `profile_dir=${profileDirectory}`,
    '--agent-kwarg',
    `pier_version=${options.pierVersion}`,
  ]
  if (candidateDirectory !== undefined) {
    agentArgs.push('--agent-kwarg', `candidate_dir=${candidateDirectory}`)
  }

  return {
    executionId: request.executionId,
    directory,
    taskDirectory,
    ...(candidateDirectory ? { candidateDirectory } : {}),
    profileDirectory,
    planPath,
    receiptPath,
    agentArgs,
    evaluatorEnv: protectedEnvironment(prepared, request),
    attemptArgs: ['--n-attempts', '1', '--max-retries', '0'],
  }
}

function exceptionType(value: unknown): string | undefined {
  const info = value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
  for (const key of ['exception_type', 'type', 'name']) {
    if (typeof info?.[key] === 'string') return info[key]
  }
  return undefined
}

/** Read only identity and termination from Pier; usage always comes from agent-eval. */
/** @internal Package-private result parser exercised by adapter tests. */
export function protectedCaptureFromPierResult(
  request: AgentCandidateExecutorRequest,
  value: unknown,
): AgentCandidateProtectedRunCapture {
  const result = record(value, 'Pier trial result') as PierResultLike
  const agentResult = record(result.agent_result, 'Pier agent_result')
  const metadata = record(agentResult.metadata, 'Pier agent_result.metadata')
  const expected = {
    executionId: request.executionId,
    bundleDigest: request.executionPlan.value.material.bundleDigest,
    executionPlanDigest: request.executionPlan.value.digest,
    materializationReceiptDigest: request.materializationReceipt.digest,
  }
  for (const [name, identity] of Object.entries(expected)) {
    if (metadata[name] !== identity) {
      throw new Error(`Pier result ${name} does not match the prepared execution`)
    }
  }

  const reported = record(metadata.termination, 'Pier termination')
  const type = exceptionType(result.exception_info)
  if (type?.includes('AgentTimeout')) {
    return {
      executionId: request.executionId,
      termination: {
        kind: 'timeout',
        timeoutMs: request.hardLimits.timeoutMs,
      },
    }
  }
  if (type?.includes('Cancelled') || reported.kind === 'cancelled') {
    return { executionId: request.executionId, termination: { kind: 'cancelled' } }
  }
  if (reported.kind === 'exit' && Number.isInteger(reported.exitCode)) {
    return {
      executionId: request.executionId,
      termination: { kind: 'exit', exitCode: reported.exitCode as number },
    }
  }
  throw new Error(`Pier result has no recognized truthful termination${type ? ` (${type})` : ''}`)
}

function sealPierTrialResult(value: PierCandidateTrialResult): PierCandidateTrialResult {
  if (!(value.resultBytes instanceof Uint8Array) || !(value.taskPatch instanceof Uint8Array)) {
    throw new Error('Pier trial result must contain raw result and patch bytes')
  }
  const parsed = parseExactJson(value.resultBytes, 'Pier result.json')
  assert.deepEqual(parsed, value.value, 'Pier parsed result differs from result.json bytes')
  const resultBytes = Uint8Array.from(value.resultBytes)
  const taskPatch = Uint8Array.from(value.taskPatch)
  return Object.freeze({
    value: parsed,
    get resultBytes(): Uint8Array {
      return Uint8Array.from(resultBytes)
    },
    get taskPatch(): Uint8Array {
      return Uint8Array.from(taskPatch)
    },
  })
}

function abortReason(signal: AbortSignal): Error {
  const reason = signal.reason
  if (reason instanceof Error) return reason
  return new Error(`Pier candidate execution aborted${reason ? `: ${String(reason)}` : ''}`)
}

function assertTerminationAcknowledged(
  acknowledgement: PierCandidateTerminationAcknowledgement,
): void {
  if (acknowledgement.processExited !== true || acknowledgement.containersRemoved !== true) {
    throw new Error('Pier termination did not acknowledge process and container death')
  }
}

/** @internal Package-private cancellation seam exercised by adapter tests. */
export async function awaitAbortableTrial<T>(
  trial: Omit<PierCandidateTrialHandle, 'result'> & { readonly result: Promise<T> },
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    assertTerminationAcknowledged(await trial.terminateAndWait())
    throw abortReason(signal)
  }

  return await new Promise<T>((resolveResult, reject) => {
    let settled = false
    let aborting = false
    const settle = (callback: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = (): void => {
      aborting = true
      void trial.terminateAndWait().then(
        (acknowledgement) => {
          try {
            assertTerminationAcknowledged(acknowledgement)
            settle(() => reject(abortReason(signal)))
          } catch (error) {
            settle(() => reject(error))
          }
        },
        (error) => settle(() => reject(new Error('Pier termination failed', { cause: error }))),
      )
    }
    signal.addEventListener('abort', onAbort, { once: true })
    trial.result.then(
      (result) => {
        if (!aborting && !signal.aborted) settle(() => resolveResult(result))
      },
      (error) => {
        if (!aborting && !signal.aborted) settle(() => reject(error))
      },
    )
  })
}

/** Execute and finalize through the runtime's only gradable candidate path. */
export async function executePreparedPierCandidate(
  options: ExecutePreparedPierCandidateOptions,
): Promise<AgentCandidateRunFinalization> {
  const trials = new Map<
    string,
    { readonly handle: PierCandidateTrialHandle; result?: PierCandidateTrialResult }
  >()
  const officialResults = new Map<string, PierCandidateTrialResult>()
  const trialIdentity = (executionId: string, executionPlanDigest: string): string =>
    JSON.stringify([executionId, executionPlanDigest])
  const executor: AgentCandidateExecutorPort = {
    execute: async (request, context) => {
      context.signal.throwIfAborted()
      const staged = await stagePreparedPierCandidateExecution(options, request)
      context.signal.throwIfAborted()
      const identity = trialIdentity(request.executionId, request.executionPlan.value.digest)
      if (trials.has(identity)) throw new Error('Pier trial identity is already active')
      const trial = options.controller.start(staged, {
        request,
        traceStore: context.traceStore,
        signal: context.signal,
        deadlineAtMs: context.deadlineAtMs,
      })
      if (
        trial.identity.executionId !== request.executionId ||
        trial.identity.executionPlanDigest !== request.executionPlan.value.digest
      ) {
        assertTerminationAcknowledged(await trial.terminateAndWait())
        throw new Error('Pier controller returned a different durable trial identity')
      }
      const active = { handle: trial } as {
        readonly handle: PierCandidateTrialHandle
        result?: PierCandidateTrialResult
      }
      trials.set(identity, active)
      const result = sealPierTrialResult(await awaitAbortableTrial(trial, context.signal))
      active.result = result
      officialResults.set(request.executionId, result)
      return protectedCaptureFromPierResult(request, result.value)
    },
    stopAndCapture: async (request) => {
      const identity = trialIdentity(request.executionId, request.executionPlanDigest)
      const active = trials.get(identity)
      assertTerminationAcknowledged(
        await options.controller.terminateAndWait({
          executionId: request.executionId,
          executionPlanDigest: request.executionPlanDigest,
        }),
      )
      if (!active) return { stopped: true }
      let result = active.result
      if (!result) {
        try {
          result = sealPierTrialResult(await active.handle.result)
        } catch {
          result = undefined
        }
      }
      trials.delete(identity)
      if (!result) return { stopped: true }
      officialResults.set(request.executionId, result)
      const repository = options.prepared.executionPlan.value.material.task.repository
      const taskOutcome = await capturePierTaskOutcome({
        repositoryRoot: options.prepared.roots.staging.taskRoot,
        baseCommit: repository.baseCommit,
        baseTree: repository.baseTree,
        patch: result.taskPatch,
        artifactPersistence: {
          executionId: request.executionId,
          outputArtifacts: options.outputArtifacts,
        },
      })
      return { stopped: true, taskOutcome }
    },
  }
  const grader: AgentCandidateBenchmarkGraderPort = {
    name: options.grader.name,
    version: options.grader.version,
    artifact: options.grader.artifact,
    run: async (input) => {
      const official = officialResults.get(input.executionId)
      if (!official) throw new Error('Pier official result is missing for executable grading')
      return await options.grader.run({
        ...input,
        officialResult: {
          value: parseExactJson(official.resultBytes, 'Pier result.json'),
          bytes: Uint8Array.from(official.resultBytes),
        },
      })
    },
  }
  try {
    return await executePreparedAgentCandidate(options.prepared, {
      executor,
      grader,
      outputArtifacts: options.outputArtifacts,
      traceStore: options.traceStore,
      claimStore: options.claimStore,
    })
  } finally {
    officialResults.clear()
    trials.clear()
  }
}
