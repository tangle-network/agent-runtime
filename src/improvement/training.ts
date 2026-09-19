import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, mkdir, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import {
  type AgentProfile,
  type AgentProfileTraining,
  type AgentTrainingDatasetIdentity,
  type AgentTrainingReceipt,
  type AgentTrainingTask,
  agentProfileEnvironmentSchema,
  agentTrainingDatasetIdentitySchema,
  agentTrainingParametersSchema,
  agentTrainingReceiptSchema,
  agentTrainingTaskKey,
  agentTrainingTaskSchema,
  canonicalAgentProfileDigest,
  canonicalCandidateBytes,
  type Sha256Digest,
  sha256DigestSchema,
  snapshotAgentProfile,
  trainedModelIdForArtifact,
} from '@tangle-network/agent-interface'
import {
  canonicalCandidateDigest,
  immutableCandidateValue,
  sha256Bytes,
} from '../candidate-execution/digest'
import { runAbortable } from '../runtime/supervise/abortable'
import {
  publishExclusiveDurableFile,
  syncDurableDirectory,
} from '../runtime/supervise/durable-file'
import type { ImproveCandidateValidator } from './improve-types'
import type { ReadonlyAgentProfile } from './profile-types'

export interface TrainingDatasetDocument {
  version: 1
  format: 'sft' | 'dpo' | 'grpo'
  /** Existing Eval export rows, without rewriting their payloads. Include every exposed partition. */
  rows: Array<{ task: AgentTrainingTask; partition: 'train' | 'validation'; data: unknown }>
}

export interface ProfileTrainerRequest {
  version: 1
  invocationId: string
  datasetPath: string
  checkpointPath: string
  parentProfilePath: string
  parentProfileDigest: Sha256Digest
  parameters: AgentTrainingReceipt['trainer']['parameters']
  executionRef: Sha256Digest
}

export type TrainingBoundaryResult<T> =
  | { succeeded: true; value: T }
  | { succeeded: false; reason: string }

/** Managed adapters use this same port: cancel the job on abort and download one exact checkpoint file. */
export interface ProfileTrainer {
  identity: Omit<AgentTrainingReceipt['trainer'], 'parameters'>
  execute(
    request: Readonly<ProfileTrainerRequest>,
    signal: AbortSignal,
  ): Promise<TrainingBoundaryResult<void>>
}

export interface CheckpointServingPort {
  /** Verify the immutable Router route independently of the trainer's output. */
  serve(input: {
    artifactPath: string
    artifactDigest: Sha256Digest
    artifactBytes: number
    routerModelId: string
    signal: AbortSignal
  }): Promise<
    TrainingBoundaryResult<{
      routerModelId: string
      artifactDigest: Sha256Digest
      evidenceDigest: Sha256Digest
    }>
  >
}

export interface ImproveTrainingOptions {
  mode: 'training'
  trainer: ProfileTrainer
  dataset: { path: string; digest: Sha256Digest }
  parameters: AgentTrainingReceipt['trainer']['parameters']
  /** Pins trainer, serving adapter and their private dependencies, just like the bound profile harness. */
  executionRef: Sha256Digest
  serving: CheckpointServingPort
  outputDirectory: string
  timeoutMs: number
  maxCheckpointBytes: number
  signal?: AbortSignal
  validateCandidate?: ImproveCandidateValidator
}

export type ImproveTrainingResult =
  | {
      mode: 'training'
      succeeded: true
      profile: ReadonlyAgentProfile
      profileDigest: Sha256Digest
      receipt: AgentTrainingReceipt
      artifactPath: string
      receiptPath: string
      profilePath: string
    }
  | {
      mode: 'training'
      succeeded: false
      stage:
        | 'admission'
        | 'dataset'
        | 'training'
        | 'checkpoint'
        | 'serving'
        | 'profile'
        | 'persistence'
      reason: string
      /** Partial artifacts are retained for diagnosis; they are not a runnable profile. */
      outputDirectory?: string
      /** A serving request began; an interrupted adapter may still own a deployment. */
      servingMayExist: boolean
      /** A timed-out managed adapter may still own a remote training job. */
      trainingMayExist: boolean
      cleanupError?: string
    }

export interface ControlledTrainingCommand {
  id: string
  executable: { path: string; digest: Sha256Digest }
  args: string[]
  /** Script/config files used by the command, verified before and after execution. */
  inputs: Array<{ path: string; digest: Sha256Digest }>
  /** Explicit public environment only. Ambient credentials are never inherited. */
  environment: Record<string, string>
  maxOutputBytes: number
}

function positiveLimit(value: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum)
    throw new Error(`invalid ${label}`)
}

async function hashFile(
  path: string,
  maximum: number,
  signal: AbortSignal,
  capture = false,
): Promise<{
  digest: Sha256Digest
  bytes: number
  content?: Buffer
}> {
  signal.throwIfAborted()
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const before = await file.stat()
    if (!before.isFile() || before.size <= 0 || before.size > maximum)
      throw new Error('artifact must be a bounded nonempty regular file')
    const hash = createHash('sha256')
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of file.createReadStream({ autoClose: false, signal })) {
      bytes += chunk.length
      if (bytes > maximum) throw new Error('artifact exceeded its byte limit')
      hash.update(chunk)
      if (capture) chunks.push(Buffer.from(chunk))
    }
    const after = await file.stat()
    if (
      before.size !== bytes ||
      after.size !== bytes ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      throw new Error('artifact changed while being hashed')
    }
    return {
      digest: `sha256:${hash.digest('hex')}`,
      bytes,
      ...(capture ? { content: Buffer.concat(chunks) } : {}),
    }
  } finally {
    await file.close()
  }
}

/** Execute one pinned command without a shell, in the runtime-owned job directory. POSIX only. */
export function createCommandProfileTrainer(input: ControlledTrainingCommand): ProfileTrainer {
  const command = immutableCandidateValue(input)
  positiveLimit(command.maxOutputBytes, 16 * 1024 * 1024, 'trainer output limit')
  if (
    !command.id ||
    command.id.trim() !== command.id ||
    !Array.isArray(command.args) ||
    !command.args.every((arg) => typeof arg === 'string' && !arg.includes('\0'))
  )
    throw new Error('invalid trainer command')
  for (const file of [command.executable, ...command.inputs]) {
    if (!isAbsolute(file.path)) throw new Error('trainer files must use absolute paths')
    sha256DigestSchema.parse(file.digest)
  }
  for (const [name, value] of Object.entries(command.environment)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || value.includes('\0'))
      throw new Error('invalid trainer environment')
  }
  agentProfileEnvironmentSchema.parse(
    Object.fromEntries(
      Object.entries(command.environment).map(([key, value]) => [key, { kind: 'public', value }]),
    ),
  )
  const identity = immutableCandidateValue({
    mode: 'command' as const,
    id: command.id,
    revision: canonicalCandidateDigest(command),
  })
  agentTrainingReceiptSchema.shape.trainer.parse({ ...identity, parameters: {} })
  return Object.freeze({
    identity,
    async execute(
      request: Readonly<ProfileTrainerRequest>,
      signal: AbortSignal,
    ): Promise<TrainingBoundaryResult<void>> {
      try {
        if (process.platform === 'win32')
          throw new Error('controlled trainers require POSIX process-group cancellation')
        const verifyInputs = async () => {
          for (const file of [command.executable, ...command.inputs]) {
            if ((await hashFile(file.path, 1024 * 1024 * 1024, signal)).digest !== file.digest) {
              throw new Error('trainer executable or input digest mismatch')
            }
          }
        }
        await verifyInputs()
        signal.throwIfAborted()
        await new Promise<void>((resolve, reject) => {
          const child = spawn(command.executable.path, command.args, {
            cwd: join(request.checkpointPath, '..'),
            env: command.environment,
            shell: false,
            detached: true,
            stdio: ['pipe', 'pipe', 'pipe'],
          })
          let failure: Error | undefined
          let outputBytes = 0
          const stop = () => {
            if (!child.pid) return
            try {
              process.kill(-child.pid, 'SIGKILL')
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failure ??= error as Error
            }
          }
          const abort = () => {
            failure ??= new Error('trainer cancelled')
            stop()
          }
          signal.addEventListener('abort', abort, { once: true })
          if (signal.aborted) abort()
          const count = (chunk: Buffer) => {
            outputBytes += chunk.length
            if (outputBytes > command.maxOutputBytes) {
              failure ??= new Error('trainer output limit exceeded')
              stop()
            }
          }
          child.stdout.on('data', count)
          child.stderr.on('data', count)
          child.stdin.on('error', (error) => {
            failure ??= error
            stop()
          })
          child.on('error', (error) => {
            failure ??= error
          })
          // A successful parent may not leave descendants mutating the checkpoint.
          child.on('exit', stop)
          child.on('close', (code, exitSignal) => {
            signal.removeEventListener('abort', abort)
            stop()
            if (failure) reject(failure)
            else if (code !== 0 || exitSignal !== null)
              reject(new Error(`trainer exited unsuccessfully (${code ?? exitSignal})`))
            else resolve()
          })
          child.stdin.end(Buffer.from(canonicalCandidateBytes(request)))
        })
        await verifyInputs()
        return { succeeded: true, value: undefined }
      } catch (error) {
        return {
          succeeded: false,
          reason: error instanceof Error ? error.message : 'trainer failed',
        }
      }
    },
  })
}

function datasetIdentity(bytes: Uint8Array): AgentTrainingDatasetIdentity {
  const dataset = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  ) as TrainingDatasetDocument
  canonicalCandidateBytes(dataset)
  if (
    !dataset ||
    typeof dataset !== 'object' ||
    Object.keys(dataset).sort().join(',') !== 'format,rows,version' ||
    dataset.version !== 1 ||
    !['sft', 'dpo', 'grpo'].includes(dataset.format) ||
    !Array.isArray(dataset.rows) ||
    dataset.rows.length === 0 ||
    dataset.rows.length > 1_000_000
  )
    throw new Error('invalid training dataset')
  const tasks = new Map<string, AgentTrainingTask>()
  const partitions = new Map<string, string>()
  let trainingRows = 0
  for (const row of dataset.rows) {
    if (
      !row ||
      typeof row !== 'object' ||
      Object.keys(row).sort().join(',') !== 'data,partition,task' ||
      !['train', 'validation'].includes(row.partition)
    )
      throw new Error('every dataset row needs its exposure identity and partition')
    if (row.partition === 'train') trainingRows++
    const task = agentTrainingTaskSchema.parse(row.task)
    for (const identity of [JSON.stringify([task.benchmark, task.task]), task.contentDigest]) {
      const previous = partitions.get(identity)
      if (previous !== undefined && previous !== row.partition)
        throw new Error('training and validation task partitions intersect')
      partitions.set(identity, row.partition)
    }
    tasks.set(agentTrainingTaskKey(task), task)
  }
  if (trainingRows === 0) throw new Error('dataset contains no training rows')
  const members = [...tasks.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, task]) => task)
  return agentTrainingDatasetIdentitySchema.parse({
    digest: sha256Bytes(bytes),
    taskSetDigest: canonicalCandidateDigest(members),
    tasks: members,
  })
}

/** Training materializes a candidate; it never emits a ship verdict or changes a live agent. */
export async function runProfileTraining(
  profile: AgentProfile,
  options: ImproveTrainingOptions,
): Promise<ImproveTrainingResult> {
  let stage: Extract<ImproveTrainingResult, { succeeded: false }>['stage'] = 'admission'
  let jobDirectory: string | undefined
  const controller = new AbortController()
  const inputSignal = options.signal
  const outputDirectory = options.outputDirectory
  const timeoutMs = options.timeoutMs
  let servingMayExist = false
  let trainingMayExist = false
  const abort = () => controller.abort(inputSignal?.reason ?? new Error('training cancelled'))
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    if (options.mode !== 'training') throw new Error('training mode is required')
    const parent = snapshotAgentProfile(profile)
    if (!parent.harness || !parent.model?.default?.trim() || !parent.model.provider?.trim()) {
      throw new Error('training requires an explicit parent harness, provider and model')
    }
    const parentProfileDigest = canonicalAgentProfileDigest(parent)
    const parentBytes = Buffer.from(JSON.stringify(parent), 'utf8')
    sha256DigestSchema.parse(options.executionRef)
    sha256DigestSchema.parse(options.dataset.digest)
    positiveLimit(options.timeoutMs, 7 * 24 * 60 * 60 * 1000, 'training timeout')
    positiveLimit(options.maxCheckpointBytes, Number.MAX_SAFE_INTEGER, 'checkpoint byte limit')
    if (
      typeof options.trainer?.execute !== 'function' ||
      typeof options.serving?.serve !== 'function'
    )
      throw new Error('trainer and verified serving ports are required')
    const trainer = immutableCandidateValue(options.trainer.identity)
    const parameters = immutableCandidateValue(
      agentTrainingParametersSchema.parse(options.parameters),
    )
    agentTrainingReceiptSchema.shape.trainer.parse({ ...trainer, parameters })
    if (options.validateCandidate !== undefined && typeof options.validateCandidate !== 'function')
      throw new Error('invalid candidate validator')
    const execute = options.trainer.execute.bind(options.trainer)
    const serve = options.serving.serve.bind(options.serving)
    const executionRef = options.executionRef
    const expectedDatasetDigest = options.dataset.digest
    const sourceDataset = options.dataset.path
    const maxCheckpointBytes = options.maxCheckpointBytes
    const validateCandidate = options.validateCandidate
    const ancestry: AgentProfileTraining['ancestors'] = parent.metadata?.training
      ? [parent.metadata.training.receipt, ...parent.metadata.training.ancestors]
      : []
    if (ancestry.length > 8) throw new Error('training receipt ancestry limit exceeded')
    const validate = (candidate: AgentProfile, isBaseline: boolean) => {
      const result: unknown = validateCandidate?.({
        profile: candidate,
        surface: 'agent-profile',
        candidateSurface: JSON.stringify(candidate),
        value: candidate,
        isBaseline,
      })
      if (result !== undefined) {
        void Promise.resolve(result).catch(() => {})
        throw new Error('candidate validators must return void synchronously or throw')
      }
    }
    validate(parent, true)
    inputSignal?.addEventListener('abort', abort, { once: true })
    if (inputSignal?.aborted) abort()
    timer = setTimeout(() => controller.abort(new Error('training deadline exceeded')), timeoutMs)
    const signal = controller.signal
    signal.throwIfAborted()
    await mkdir(outputDirectory, { recursive: true })
    const outputRoot = await realpath(outputDirectory)
    jobDirectory = await mkdtemp(join(outputRoot, 'training-'))
    await chmod(jobDirectory, 0o700)
    syncDurableDirectory(outputRoot)
    const datasetPath = join(jobDirectory, 'dataset.json')
    const parentProfilePath = join(jobDirectory, 'parent-profile.json')
    const artifactPath = join(jobDirectory, 'checkpoint.bin')
    stage = 'dataset'
    const source = await hashFile(sourceDataset, 128 * 1024 * 1024, signal, true)
    if (source.digest !== expectedDatasetDigest) throw new Error('training dataset digest mismatch')
    const bytes = source.content!
    if (bytes.length !== source.bytes) throw new Error('training dataset snapshot is incomplete')
    const dataset = datasetIdentity(bytes)
    await writeFile(datasetPath, bytes, { flag: 'wx', mode: 0o400 })
    await writeFile(parentProfilePath, parentBytes, { flag: 'wx', mode: 0o400 })
    const request = immutableCandidateValue({
      version: 1 as const,
      invocationId: jobDirectory,
      datasetPath,
      checkpointPath: artifactPath,
      parentProfilePath,
      parentProfileDigest,
      parameters,
      executionRef,
    })
    stage = 'training'
    const trained = await runAbortable(
      () => {
        trainingMayExist = true
        return execute(request, signal)
      },
      signal,
      'training cancelled',
    )
    signal.throwIfAborted()
    if (trained?.succeeded !== true)
      throw new Error(trained?.reason ?? 'trainer did not report success')
    trainingMayExist = false
    stage = 'checkpoint'
    if (
      (await hashFile(datasetPath, 128 * 1024 * 1024, signal)).digest !== dataset.digest ||
      (await hashFile(parentProfilePath, parentBytes.byteLength, signal)).digest !==
        sha256Bytes(parentBytes)
    ) {
      throw new Error('trainer changed its pinned inputs')
    }
    const artifact = await hashFile(artifactPath, maxCheckpointBytes, signal)
    await chmod(artifactPath, 0o400)
    const checkpoint = await open(artifactPath, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      await checkpoint.sync()
    } finally {
      await checkpoint.close()
    }
    stage = 'serving'
    const served = await runAbortable(
      () => {
        servingMayExist = true
        return serve({
          artifactPath,
          artifactDigest: artifact.digest,
          artifactBytes: artifact.bytes,
          routerModelId: trainedModelIdForArtifact(artifact.digest),
          signal,
        })
      },
      signal,
      'checkpoint serving cancelled',
    )
    signal.throwIfAborted()
    if (served?.succeeded !== true)
      throw new Error(served?.reason ?? 'checkpoint serving is unverified')
    if (served.value.artifactDigest !== artifact.digest)
      throw new Error('Router serving evidence names a different checkpoint')
    if ((await hashFile(artifactPath, maxCheckpointBytes, signal)).digest !== artifact.digest)
      throw new Error('checkpoint changed during serving')
    const receipt = immutableCandidateValue(
      agentTrainingReceiptSchema.parse({
        version: 1,
        dataset,
        parentProfileDigest,
        parentReceiptDigest: ancestry[0] ? canonicalCandidateDigest(ancestry[0]) : null,
        executionRef,
        trainer: { ...trainer, parameters },
        checkpoint: {
          artifactDigest: artifact.digest,
          artifactBytes: artifact.bytes,
          routerModelId: served.value.routerModelId,
          servingDigest: served.value.evidenceDigest,
        },
      }),
    )
    stage = 'profile'
    const candidate = snapshotAgentProfile({
      ...parent,
      model: { ...parent.model, default: receipt.checkpoint.routerModelId },
      metadata: { ...parent.metadata, training: { receipt, ancestors: ancestry } },
    })
    validate(candidate, false)
    // The validator is caller code too; publish only the bytes the receipt actually names.
    if ((await hashFile(artifactPath, maxCheckpointBytes, signal)).digest !== artifact.digest)
      throw new Error('checkpoint changed during candidate validation')
    stage = 'persistence'
    const receiptPath = join(jobDirectory, 'receipt.json')
    const profilePath = join(jobDirectory, 'profile.json')
    const profileDigest = canonicalAgentProfileDigest(candidate)
    // Reuse the runtime's no-clobber, fsynced publication primitive. Once the
    // profile is committed, a late cancellation must not retract an observed result.
    for (const [path, value] of [
      [receiptPath, receipt],
      [profilePath, candidate],
    ] as const) {
      signal.throwIfAborted()
      if (!publishExclusiveDurableFile(path, JSON.stringify(value), { mode: 0o400 }))
        throw new Error('training publication path already exists')
    }
    return {
      mode: 'training',
      succeeded: true,
      profile: candidate,
      profileDigest,
      receipt,
      artifactPath,
      receiptPath,
      profilePath,
    }
  } catch (error) {
    let cleanupError: string | undefined
    if (jobDirectory) {
      try {
        await rm(join(jobDirectory, 'profile.json'), { force: true })
        syncDurableDirectory(jobDirectory)
      } catch (failure) {
        cleanupError = failure instanceof Error ? failure.message : 'profile cleanup failed'
      }
    }
    return {
      mode: 'training',
      succeeded: false,
      stage,
      reason: error instanceof Error ? error.message : 'training failed',
      servingMayExist,
      trainingMayExist,
      ...(cleanupError ? { cleanupError } : {}),
      ...(jobDirectory ? { outputDirectory: jobDirectory } : {}),
    }
  } finally {
    if (timer) clearTimeout(timer)
    inputSignal?.removeEventListener('abort', abort)
  }
}
