/** Restart-safe evaluator ownership for one Pier process and its Docker projects. */
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Writable } from 'node:stream'

import type { AgentCandidateExecutorRequest } from '@tangle-network/agent-runtime'
import type { TraceStore } from '@tangle-network/agent-eval'

import type {
  PierCandidateTerminationAcknowledgement,
  PierCandidateTrialController,
  PierCandidateTrialHandle,
  PierCandidateTrialIdentity,
  PierCandidateTrialResult,
  StagedPierCandidateExecution,
} from './pier-agent'

const identityFile = 'identity.json'
const terminalFile = 'terminal.json'
const stopFile = 'stop-requested'
const sha256Pattern = /^sha256:[a-f0-9]{64}$/
const defaultDockerConnectionId = 'local-default'

interface ProcessIdentity {
  readonly pid: number
  readonly processGroupId: number
  readonly sessionId: number
  readonly startTicks: string
}

interface PersistedTrialIdentity {
  readonly schemaVersion: 1
  readonly kind: 'pier-trial-identity'
  readonly state: 'allocating' | 'starting' | 'running'
  readonly executionId: string
  readonly executionPlanDigest: `sha256:${string}`
  readonly supervisor?: ProcessIdentity
  readonly pier?: ProcessIdentity
  readonly jobsDirectory: string
  readonly jobName: string
  readonly dockerCommand: string
  readonly dockerConnectionId: string
}

interface PersistedTrialTerminal {
  readonly schemaVersion: 1
  readonly kind: 'pier-trial-terminal'
  readonly status: 'completed' | 'stopped' | 'failed'
  readonly processExited: boolean
  readonly containersRemoved: boolean
  readonly removedContainers?: number
  readonly exitCode?: number | null
  readonly signal?: NodeJS.Signals | null
  readonly error?: string
  readonly recoveredByPid?: number
}

export interface PierCandidateProcessSpec {
  /** Returns launch data only. The controller, not this callback, starts the process. */
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  /** Exact Pier child environment. The controller adds its Docker connection variables. */
  readonly env: Readonly<Record<string, string | undefined>>
  readonly jobsDirectory: string
  /** Must be unique: the controller atomically reserves this Pier job directory. */
  readonly jobName: string
  readonly dockerCommand?: string
  /** Called only by the originating process after the supervisor reports clean exit. */
  readonly readResult: () => Promise<PierCandidateTrialResult>
}

export interface PierDockerConnection {
  /** Stable, non-secret name that every recovery worker maps to the same Docker endpoint. */
  readonly id: string
  /** Exact variables needed by both Pier and Docker cleanup; values are never persisted. */
  readonly env: Readonly<Record<string, string | undefined>>
}

export interface FilePierCandidateTrialControllerOptions {
  /** Shared evaluator-owned control root, available to crash-recovery workers. */
  readonly directory: string
  readonly launch?: (
    staged: StagedPierCandidateExecution,
    context: {
      readonly request: AgentCandidateExecutorRequest
      readonly traceStore: TraceStore
      readonly signal: AbortSignal
      readonly deadlineAtMs: number
    },
  ) => PierCandidateProcessSpec
  /** Omit only for the default local Docker socket with no environment variables. */
  readonly dockerConnection?: PierDockerConnection
  readonly supervisorPath?: string
  readonly pollIntervalMs?: number
}

function nonEmpty(value: string, label: string): string {
  if (!value || value.includes('\0')) throw new Error(`${label} must be non-empty without NUL`)
  return value
}

function stableDockerConnectionId(value: string): string {
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(value)) {
    throw new Error('Docker connection id must be a non-secret stable name')
  }
  return value
}

function absolutePath(value: string, label: string): string {
  if (!isAbsolute(value)) throw new Error(`${label} must be an absolute path`)
  return resolve(value)
}

function validateEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  label: string,
): void {
  for (const [name, value] of Object.entries(environment)) {
    if (!name || name.includes('\0') || value?.includes('\0')) {
      throw new Error(`${label} contains an invalid name or value`)
    }
  }
}

function resolveExecutable(command: string, searchPath: string | undefined, label: string): string {
  nonEmpty(command, label)
  const candidates = command.includes('/')
    ? [absolutePath(command, label)]
    : (searchPath ?? '')
        .split(':')
        .filter(Boolean)
        .map((directory) => join(directory, command))
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK)
      return realpathSync(candidate)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'EACCES') {
        throw error
      }
    }
  }
  throw new Error(`${label} is not executable on the evaluator PATH`)
}

function syncDirectory(directory: string): void {
  const fd = openSync(directory, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function writeJsonAtomic(directory: string, name: string, value: unknown): void {
  const target = join(directory, name)
  const temporary = join(directory, `.${name}.${process.pid}.${Date.now()}.tmp`)
  const fd = openSync(temporary, 'wx', 0o600)
  try {
    writeFileSync(fd, `${JSON.stringify(value)}\n`, 'utf8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temporary, target)
  syncDirectory(directory)
}

function touchDurable(directory: string, name: string): void {
  try {
    const fd = openSync(join(directory, name), 'wx', 0o600)
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    syncDirectory(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

function readJson(path: string, label: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function parseProcessIdentity(value: unknown, label: string): ProcessIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  const record = value as Record<string, unknown>
  if (
    !Number.isSafeInteger(record.pid) ||
    !Number.isSafeInteger(record.processGroupId) ||
    !Number.isSafeInteger(record.sessionId) ||
    typeof record.startTicks !== 'string' ||
    !/^\d+$/.test(record.startTicks)
  ) {
    throw new Error(`${label} is malformed`)
  }
  return {
    pid: record.pid as number,
    processGroupId: record.processGroupId as number,
    sessionId: record.sessionId as number,
    startTicks: record.startTicks,
  }
}

function parsePersistedIdentity(path: string): PersistedTrialIdentity {
  const record = readJson(path, 'Pier trial identity')
  if (
    record.schemaVersion !== 1 ||
    record.kind !== 'pier-trial-identity' ||
    !['allocating', 'starting', 'running'].includes(record.state as string) ||
    typeof record.executionId !== 'string' ||
    typeof record.executionPlanDigest !== 'string' ||
    !sha256Pattern.test(record.executionPlanDigest) ||
    typeof record.jobsDirectory !== 'string' ||
    typeof record.jobName !== 'string' ||
    typeof record.dockerCommand !== 'string' ||
    typeof record.dockerConnectionId !== 'string'
  ) {
    throw new Error('Pier trial identity is malformed')
  }
  return {
    schemaVersion: 1,
    kind: 'pier-trial-identity',
    state: record.state as PersistedTrialIdentity['state'],
    executionId: record.executionId,
    executionPlanDigest: record.executionPlanDigest as `sha256:${string}`,
    ...(record.supervisor
      ? { supervisor: parseProcessIdentity(record.supervisor, 'Pier supervisor identity') }
      : {}),
    ...(record.pier ? { pier: parseProcessIdentity(record.pier, 'Pier process identity') } : {}),
    jobsDirectory: absolutePath(record.jobsDirectory, 'persisted jobs directory'),
    jobName: nonEmpty(record.jobName, 'persisted job name'),
    dockerCommand: nonEmpty(record.dockerCommand, 'persisted Docker command'),
    dockerConnectionId: stableDockerConnectionId(record.dockerConnectionId),
  }
}

function parseTerminal(path: string): PersistedTrialTerminal {
  const record = readJson(path, 'Pier trial terminal')
  const allowedKeys = new Set([
    'schemaVersion',
    'kind',
    'status',
    'processExited',
    'containersRemoved',
    'removedContainers',
    'exitCode',
    'signal',
    'error',
    'recoveredByPid',
  ])
  const hasMalformedOptionalField =
    (record.removedContainers !== undefined &&
      (!Number.isSafeInteger(record.removedContainers) || (record.removedContainers as number) < 0)) ||
    (record.exitCode !== undefined &&
      record.exitCode !== null &&
      !Number.isSafeInteger(record.exitCode)) ||
    (record.signal !== undefined &&
      record.signal !== null &&
      (typeof record.signal !== 'string' || !/^SIG[A-Z0-9]+$/.test(record.signal))) ||
    (record.error !== undefined && typeof record.error !== 'string') ||
    (record.recoveredByPid !== undefined &&
      (!Number.isSafeInteger(record.recoveredByPid) || (record.recoveredByPid as number) < 1))
  if (
    Object.keys(record).some((key) => !allowedKeys.has(key)) ||
    record.schemaVersion !== 1 ||
    record.kind !== 'pier-trial-terminal' ||
    !['completed', 'stopped', 'failed'].includes(record.status as string) ||
    typeof record.processExited !== 'boolean' ||
    typeof record.containersRemoved !== 'boolean' ||
    hasMalformedOptionalField
  ) {
    throw new Error('Pier trial terminal is malformed')
  }
  return {
    schemaVersion: 1,
    kind: 'pier-trial-terminal',
    status: record.status as PersistedTrialTerminal['status'],
    processExited: record.processExited,
    containersRemoved: record.containersRemoved,
    ...(record.removedContainers !== undefined
      ? { removedContainers: record.removedContainers as number }
      : {}),
    ...(record.exitCode !== undefined ? { exitCode: record.exitCode as number | null } : {}),
    ...(record.signal !== undefined ? { signal: record.signal as NodeJS.Signals | null } : {}),
    ...(record.error !== undefined ? { error: record.error as string } : {}),
    ...(record.recoveredByPid !== undefined
      ? { recoveredByPid: record.recoveredByPid as number }
      : {}),
  }
}

function processIdentity(pid: number): ProcessIdentity {
  const text = readFileSync(`/proc/${pid}/stat`, 'utf8')
  const closing = text.lastIndexOf(')')
  if (closing < 0) throw new Error(`cannot parse process identity for ${pid}`)
  const fields = text.slice(closing + 2).trim().split(/\s+/)
  const processGroupId = Number(fields[2])
  const sessionId = Number(fields[3])
  const startTicks = fields[19]
  if (
    !Number.isSafeInteger(processGroupId) ||
    !Number.isSafeInteger(sessionId) ||
    !/^\d+$/.test(startTicks ?? '')
  ) {
    throw new Error(`cannot parse process identity for ${pid}`)
  }
  return { pid, processGroupId, sessionId, startTicks }
}

function processMatches(identity: ProcessIdentity): boolean {
  try {
    const current = processIdentity(identity.pid)
    return (
      current.startTicks === identity.startTicks &&
      current.processGroupId === identity.processGroupId &&
      current.sessionId === identity.sessionId
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function signalProcess(identity: ProcessIdentity, signal: NodeJS.Signals, group: boolean): void {
  if (!processMatches(identity)) return
  try {
    process.kill(group ? -identity.processGroupId : identity.pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

function sessionMembers(sessionId: number): ProcessIdentity[] {
  const members: ProcessIdentity[] = []
  for (const entry of readdirSync('/proc', { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
    try {
      const identity = processIdentity(Number(entry.name))
      if (identity.sessionId === sessionId) members.push(identity)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return members
}

async function signalSessionUntilEmpty(
  identity: ProcessIdentity,
  signal: NodeJS.Signals,
  timeoutMs: number,
  intervalMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const members = sessionMembers(identity.sessionId)
    if (members.length === 0) return true
    for (const member of members) signalProcess(member, signal, false)
    if (Date.now() >= deadline) return false
    await sleep(intervalMs)
  }
}

function sanitizeProject(value: string): string {
  let project = value.toLowerCase()
  if (!/^[a-z0-9]/.test(project)) project = `0${project}`
  return project.replace(/[^a-z0-9_-]/g, '-')
}

function trialProjects(identity: PersistedTrialIdentity): string[] {
  const jobRoot = join(identity.jobsDirectory, identity.jobName)
  if (!existsSync(jobRoot)) return []
  return readdirSync(jobRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => sanitizeProject(entry.name))
}

function matchingContainers(
  identity: PersistedTrialIdentity,
  dockerEnvironment: Readonly<Record<string, string | undefined>>,
): string[] {
  const projects = trialProjects(identity)
  if (projects.length === 0) return []
  const output = execFileSync(
    identity.dockerCommand,
    ['ps', '-a', '--format', '{{.ID}}\t{{.Label "com.docker.compose.project"}}'],
    {
      encoding: 'utf8',
      env: dockerEnvironment,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  )
  return output
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      const tab = line.indexOf('\t')
      if (tab < 1) return []
      const id = line.slice(0, tab)
      const project = line.slice(tab + 1)
      return projects.some(
        (expected) =>
          project === expected || project.startsWith(`${expected}__verifier__`),
      )
        ? [id]
        : []
    })
}

function removeTrialContainers(
  identity: PersistedTrialIdentity,
  dockerEnvironment: Readonly<Record<string, string | undefined>>,
): number {
  const containers = matchingContainers(identity, dockerEnvironment)
  if (containers.length > 0) {
    try {
      execFileSync(identity.dockerCommand, ['rm', '-f', ...containers], {
        encoding: 'utf8',
        env: dockerEnvironment,
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
      })
    } catch (error) {
      if (matchingContainers(identity, dockerEnvironment).length > 0) throw error
    }
  }
  const remaining = matchingContainers(identity, dockerEnvironment)
  if (remaining.length > 0) {
    throw new Error(`Pier task containers survived removal: ${remaining.join(', ')}`)
  }
  return containers.length
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds))
}

async function waitUntil(predicate: () => boolean, timeoutMs: number, intervalMs: number) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) return false
    await sleep(intervalMs)
  }
  return true
}

function trialKey(identity: PierCandidateTrialIdentity): string {
  if (!sha256Pattern.test(identity.executionPlanDigest)) {
    throw new Error('executionPlanDigest must be a SHA-256 digest')
  }
  return createHash('sha256')
    .update(JSON.stringify([nonEmpty(identity.executionId, 'executionId'), identity.executionPlanDigest]))
    .digest('hex')
}

function assertRealDirectory(path: string, label: string): void {
  const stats = lstatSync(path)
  if (!stats.isDirectory() || stats.isSymbolicLink() || realpathSync(path) !== path) {
    throw new Error(`${label} must be a real canonical directory`)
  }
}

export class FilePierCandidateTrialController implements PierCandidateTrialController {
  private readonly directory: string
  private readonly launch?: NonNullable<FilePierCandidateTrialControllerOptions['launch']>
  private readonly dockerConnection: PierDockerConnection
  private readonly supervisorPath: string
  private readonly pollIntervalMs: number

  constructor(options: FilePierCandidateTrialControllerOptions) {
    this.directory = absolutePath(options.directory, 'Pier controller directory')
    this.launch = options.launch
    const configuredDocker = options.dockerConnection
    if (configuredDocker?.id === defaultDockerConnectionId) {
      throw new Error(`${defaultDockerConnectionId} is reserved for the implicit local connection`)
    }
    const dockerConnection = configuredDocker ?? {
      id: defaultDockerConnectionId,
      env: {},
    }
    const connectionId = stableDockerConnectionId(dockerConnection.id)
    validateEnvironment(dockerConnection.env, 'Docker connection environment')
    this.dockerConnection = Object.freeze({
      id: connectionId,
      env: Object.freeze({ ...dockerConnection.env }),
    })
    this.supervisorPath = absolutePath(
      options.supervisorPath ??
        fileURLToPath(new URL('./pier-trial-supervisor.mjs', import.meta.url)),
      'Pier supervisor path',
    )
    this.pollIntervalMs = options.pollIntervalMs ?? 25
    if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs < 1) {
      throw new Error('pollIntervalMs must be a positive integer')
    }
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    assertRealDirectory(this.directory, 'Pier controller directory')
  }

  start(
    staged: StagedPierCandidateExecution,
    context: {
      readonly request: AgentCandidateExecutorRequest
      readonly traceStore: TraceStore
      readonly signal: AbortSignal
      readonly deadlineAtMs: number
    },
  ): PierCandidateTrialHandle {
    if (!this.launch) throw new Error('this Pier controller is recovery-only')
    const identity: PierCandidateTrialIdentity = {
      executionId: context.request.executionId,
      executionPlanDigest: context.request.executionPlan.value.digest,
    }
    if (staged.executionId !== identity.executionId) {
      throw new Error('staged Pier execution does not match the runtime request')
    }

    // The launch callback is a pure spec builder. Resolve every fallible input
    // before reserving durable identities or starting a process.
    const spec = this.launch(staged, context)
    this.validateSpec(spec)
    for (const [name, value] of Object.entries(this.dockerConnection.env)) {
      if (
        Object.prototype.hasOwnProperty.call(spec.env, name) &&
        spec.env[name] !== value
      ) {
        throw new Error(`Pier child environment conflicts with Docker connection variable ${name}`)
      }
    }
    const pierEnvironment = Object.freeze({
      ...spec.env,
      ...this.dockerConnection.env,
    })
    mkdirSync(spec.jobsDirectory, { recursive: true, mode: 0o700 })
    assertRealDirectory(spec.jobsDirectory, 'Pier jobs directory')
    const dockerCommand = resolveExecutable(
      spec.dockerCommand ?? 'docker',
      process.env.PATH,
      'Docker command',
    )
    const pierCommand = resolveExecutable(spec.command, pierEnvironment.PATH, 'Pier command')

    const controlDirectory = this.controlDirectory(identity)
    try {
      mkdirSync(controlDirectory, { mode: 0o700 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error('Pier trial identity already has durable control state')
      }
      throw error
    }
    assertRealDirectory(controlDirectory, 'Pier trial control directory')

    // Pier creates each trial directory before starting its environment. An
    // atomically reserved, one-execution job directory therefore makes every
    // Compose project discovered below exclusive to this execution.
    const jobRoot = join(spec.jobsDirectory, spec.jobName)
    let jobRootCreated = false
    try {
      mkdirSync(jobRoot, { mode: 0o700 })
      jobRootCreated = true
      assertRealDirectory(jobRoot, 'Pier job directory')
    } catch (error) {
      // No identity or process exists yet; leave the execution reusable.
      rmSync(controlDirectory, { recursive: true, force: true })
      if (jobRootCreated) rmSync(jobRoot, { recursive: true, force: true })
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error('Pier job name must be unique; its job directory already exists')
      }
      throw error
    }
    const allocating: PersistedTrialIdentity = {
      schemaVersion: 1,
      kind: 'pier-trial-identity',
      state: 'allocating',
      ...identity,
      jobsDirectory: absolutePath(spec.jobsDirectory, 'Pier jobs directory'),
      jobName: nonEmpty(spec.jobName, 'Pier job name'),
      dockerCommand: nonEmpty(dockerCommand, 'Docker command'),
      dockerConnectionId: this.dockerConnection.id,
    }
    try {
      writeJsonAtomic(controlDirectory, identityFile, allocating)
    } catch (error) {
      // The supervisor can only start after this durable write succeeds.
      rmSync(controlDirectory, { recursive: true, force: true })
      rmSync(jobRoot, { recursive: true, force: true })
      throw error
    }

    const supervisor = spawn(process.execPath, [this.supervisorPath, controlDirectory], {
      detached: true,
      // Launch data arrives over fd 3. The trusted supervisor receives only
      // explicitly declared process variables, never the evaluator environment.
      env: { ...this.dockerConnection.env },
      stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
    })
    if (supervisor.pid === undefined) throw new Error('Pier supervisor started without a pid')
    const controlPipe = supervisor.stdio[3] as (Writable & { unref?: () => void }) | null
    let supervisorIdentity: ProcessIdentity | undefined
    try {
      supervisorIdentity = processIdentity(supervisor.pid)
      const persisted: PersistedTrialIdentity = {
        ...allocating,
        state: 'starting',
        supervisor: supervisorIdentity,
      }
      writeJsonAtomic(controlDirectory, identityFile, persisted)
      if (!controlPipe) throw new Error('Pier supervisor has no protected control pipe')
      controlPipe.on('error', () => undefined)
      controlPipe.end(
        JSON.stringify({
          command: pierCommand,
          args: spec.args,
          cwd: spec.cwd,
          env: pierEnvironment,
          jobsDirectory: spec.jobsDirectory,
          jobName: spec.jobName,
          dockerCommand,
        }),
      )
    } catch (error) {
      controlPipe?.destroy()
      if (supervisorIdentity) signalProcess(supervisorIdentity, 'SIGKILL', false)
      else {
        try {
          process.kill(supervisor.pid, 'SIGKILL')
        } catch (killError) {
          if ((killError as NodeJS.ErrnoException).code !== 'ESRCH') throw killError
        }
      }
      throw error
    }
    supervisor.unref()
    controlPipe.unref?.()

    const result = this.waitForResult(controlDirectory, spec, context.deadlineAtMs)
    return {
      identity,
      result,
      terminateAndWait: async () => await this.terminateAndWait(identity),
    }
  }

  async terminateAndWait(
    requested: PierCandidateTrialIdentity,
  ): Promise<PierCandidateTerminationAcknowledgement> {
    const controlDirectory = this.controlDirectory(requested)
    assertRealDirectory(controlDirectory, 'Pier trial control directory')
    const persisted = parsePersistedIdentity(join(controlDirectory, identityFile))
    if (
      persisted.executionId !== requested.executionId ||
      persisted.executionPlanDigest !== requested.executionPlanDigest
    ) {
      throw new Error('persisted Pier trial identity differs from the stop request')
    }
    this.assertDockerConnection(persisted)

    touchDurable(controlDirectory, stopFile)
    if (!existsSync(join(controlDirectory, terminalFile))) {
      if (persisted.supervisor) signalProcess(persisted.supervisor, 'SIGTERM', false)
    }
    const terminalAppeared = await waitUntil(
      () => existsSync(join(controlDirectory, terminalFile)),
      persisted.supervisor ? 10_000 : 1,
      this.pollIntervalMs,
    )
    if (!terminalAppeared) await this.forceRecovery(controlDirectory)

    let terminal = parseTerminal(join(controlDirectory, terminalFile))
    const latest = parsePersistedIdentity(join(controlDirectory, identityFile))
    const liveProcesses = latest.pier ? sessionMembers(latest.pier.sessionId).length : 0
    this.assertDockerConnection(latest)
    const liveContainers = matchingContainers(latest, this.dockerConnection.env).length
    if (liveProcesses > 0 || liveContainers > 0) {
      await this.forceRecovery(controlDirectory)
      terminal = parseTerminal(join(controlDirectory, terminalFile))
    }
    if (!terminal.processExited || !terminal.containersRemoved) {
      throw new Error(
        `Pier recovery did not prove process/container death${terminal.error ? `: ${terminal.error}` : ''}`,
      )
    }
    return { processExited: true, containersRemoved: true }
  }

  private controlDirectory(identity: PierCandidateTrialIdentity): string {
    return join(this.directory, trialKey(identity))
  }

  private assertDockerConnection(identity: PersistedTrialIdentity): void {
    if (identity.dockerConnectionId !== this.dockerConnection.id) {
      throw new Error(
        `Pier trial requires Docker connection ${identity.dockerConnectionId}; configured ${this.dockerConnection.id}`,
      )
    }
  }

  private validateSpec(spec: PierCandidateProcessSpec): void {
    nonEmpty(spec.command, 'Pier command')
    if (!Array.isArray(spec.args) || spec.args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) {
      throw new Error('Pier arguments must be strings without NUL')
    }
    absolutePath(spec.cwd, 'Pier cwd')
    absolutePath(spec.jobsDirectory, 'Pier jobs directory')
    if (!/^[A-Za-z0-9._-]{1,200}$/.test(spec.jobName)) {
      throw new Error('Pier job name must be filesystem-neutral')
    }
    validateEnvironment(spec.env, 'Pier child environment')
  }

  private async waitForResult(
    controlDirectory: string,
    spec: PierCandidateProcessSpec,
    deadlineAtMs: number,
  ): Promise<PierCandidateTrialResult> {
    const waitMs = Math.max(0, deadlineAtMs - Date.now())
    const appeared = await waitUntil(
      () => existsSync(join(controlDirectory, terminalFile)),
      waitMs,
      this.pollIntervalMs,
    )
    if (!appeared) throw new Error('Pier supervisor emitted no terminal acknowledgement')
    const terminal = parseTerminal(join(controlDirectory, terminalFile))
    if (!terminal.processExited || !terminal.containersRemoved) {
      throw new Error('Pier supervisor did not prove process and container death')
    }
    if (terminal.status !== 'completed') {
      throw new Error(terminal.error ? `Pier process failed: ${terminal.error}` : 'Pier process stopped')
    }
    return await spec.readResult()
  }

  private async forceRecovery(
    controlDirectory: string,
  ): Promise<void> {
    const latest = parsePersistedIdentity(join(controlDirectory, identityFile))
    this.assertDockerConnection(latest)
    const errors: string[] = []
    if (latest.pier) {
      try {
        await signalSessionUntilEmpty(latest.pier, 'SIGTERM', 2_000, this.pollIntervalMs)
      } catch (error) {
        errors.push(`could not signal Pier session: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (latest.supervisor) {
      try {
        signalProcess(latest.supervisor, 'SIGKILL', false)
        if (!(await waitUntil(() => !processMatches(latest.supervisor!), 5_000, this.pollIntervalMs))) {
          errors.push(`Pier supervisor ${latest.supervisor.pid} survived SIGKILL`)
        }
      } catch (error) {
        errors.push(`could not kill Pier supervisor: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (latest.pier) {
      try {
        if (
          !(await signalSessionUntilEmpty(
            latest.pier,
            'SIGKILL',
            5_000,
            this.pollIntervalMs,
          ))
        ) {
          errors.push(`Pier process session ${latest.pier.sessionId} survived SIGKILL`)
        }
      } catch (error) {
        errors.push(`could not kill Pier session: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    let removedContainers = 0
    try {
      removedContainers = removeTrialContainers(latest, this.dockerConnection.env)
    } catch (error) {
      errors.push(`could not remove Pier containers: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (errors.length > 0) {
      throw new Error(`Pier recovery incomplete: ${errors.join('; ')}`)
    }
    writeJsonAtomic(controlDirectory, terminalFile, {
      schemaVersion: 1,
      kind: 'pier-trial-terminal',
      status: 'stopped',
      processExited: true,
      containersRemoved: true,
      removedContainers,
      recoveredByPid: process.pid,
    })
  }
}
