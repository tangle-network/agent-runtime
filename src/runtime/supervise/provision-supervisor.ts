/**
 * Public one-call composition for a durable Runtime supervisor proof run.
 *
 * This is intentionally a thin owner of existing Runtime primitives. The supervisor owns the
 * root abort channel and join barrier, Scope owns worker admission and lifecycle, and the provider
 * owns the environment and interactive process. Braid receives identifiers and opaque handles; it
 * does not receive a second supervisor protocol or a copy of provider state.
 *
 * @experimental
 */

import { randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  type AgentProfile,
  agentProfileSchema,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
  harnessTypeSchema,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironmentCapabilities,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import type { McpToolDescriptor } from '../../mcp/server'
import { createCoordinationTools } from '../../mcp/tools/coordination'
import { sandboxClientAsProvider } from '../environment-provider'
import type { SandboxClient } from '../types'
import { createCancelAcknowledger, createSteerAcknowledger } from './coordination-driver'
import { workerFromInteractiveProvider } from './interactive-worker'
import { createFileRunContext } from './run-context'
import { supervisorRunDir } from './run-layout'
import { createRootHandle, createSupervisor } from './supervisor'
import type { Agent, Budget, Scope, SpawnEvent, SupervisedResult } from './types'
import { readWorkerInteractiveBinding } from './worker-interactive'

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_POLL_MS = 25
const ROOT_MAX_ITERATIONS = 100
const ROOT_MAX_TOKENS = 100_000
const WORKER_MAX_ITERATIONS = 25
const WORKER_MAX_TOKENS = 25_000
const DEFAULT_SANDBOX_ENDPOINT = 'https://sandbox.tangle.tools'
const WORKER_TASK = 'Start the assigned interactive worker and remain available for supervision.'

/** Caller-supplied provider or the Sandbox SDK connection used by the default resolver. */
export interface ProvisionSupervisorConnection {
  /** A fully constructed provider. This is the preferred programmatic seam and is testable. */
  readonly provider?: AgentEnvironmentProvider
  /** A Sandbox SDK-compatible client. Runtime adapts it to the public provider contract. */
  readonly client?: SandboxClient
  /** Alias for `client`, accepted so callers can pass their existing connection object. */
  readonly sandboxClient?: SandboxClient
  /** Sandbox API endpoint. Runtime never persists this value in the run receipt. */
  readonly endpoint?: string
  /** Transient Sandbox API key. Runtime never persists this value. */
  readonly apiKey?: string
  /** Connection kind is descriptive only and does not select a hidden implementation. */
  readonly kind?: string
  /** Opaque credential reference. It is not resolved or persisted by Runtime. */
  readonly credentialRef?: string
}

/** Input to the public Runtime supervisor provisioner. */
export interface ProvisionSupervisorRequest {
  readonly invocationId: string
  /** Braid's safe selector map. Credential values are deliberately not accepted here. */
  readonly environment?: Readonly<Record<string, string>>
  /** Root directory for Runtime-owned `.agent/supervisor` state. */
  readonly workspaceDir?: string
  /** Maximum time to wait for worker admission and terminal readiness. */
  readonly timeoutMs?: number
  /** Poll cadence for lifecycle/control readiness. */
  readonly pollMs?: number
  /** Canonical worker profile. Runtime creates one when omitted. */
  readonly profile?: AgentProfile
  /** Optional provider connection. Runtime resolves a Sandbox client when omitted. */
  readonly connection?: ProvisionSupervisorConnection
}

/** Exact owner-scoped cleanup receipt returned after Runtime releases the run resources. */
export interface SupervisorCleanupReceipt {
  readonly status: 'completed'
  readonly rootDir: string
  readonly supervisorId: string
  readonly workerId: string
  readonly supervisorStatus: string
  readonly workerStatus: 'running' | 'done' | 'down' | 'cancelled'
  readonly resourcesReleased: true
  readonly remainingResources: readonly []
}

/** Handles for one Runtime-owned supervisor and its first interactive worker. */
export interface ProvisionedSupervisor {
  readonly rootDir: string
  readonly supervisorId: string
  readonly workerId: string
  /** Provider source for `attachWorker`; omitted only when resolution did not produce one. */
  readonly providers?: AgentEnvironmentProvider
  /** Capability-derived terminal takeover requirement. */
  readonly terminalTakeover: 'required' | 'unsupported' | 'unspecified'
  cleanup(): Promise<SupervisorCleanupReceipt>
}

class SupervisorProvisionUnavailableError extends Error {
  readonly unavailable = true as const

  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'SupervisorProvisionUnavailableError'
  }
}

interface MutableState {
  readonly id: string
  status: string
  readonly task: string
  readonly workspaceDir: string
  readonly budget: number
  readonly workerModel?: string
  readonly startedAt: string
  completedAt?: string
}

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
  readonly settled: () => boolean
}

/**
 * Provision one real provider-backed worker and keep its owning manager alive for controls.
 *
 * The root manager does not use a model. It runs the same coordination tools used by a driver in a
 * small deterministic loop, so durable steer and cancel requests are acknowledged by the owning
 * Runtime turn loop and never by a test-only shortcut.
 */
export async function provisionSupervisor(
  request: ProvisionSupervisorRequest,
): Promise<ProvisionedSupervisor> {
  const input = normalizeRequest(request)
  const provider = await resolveProvider(input)
  const capabilities = await readCapabilities(provider)
  const terminalTakeover = terminalCapability(capabilities)
  const profile = resolveProfile(input)
  const rootDir = resolve(input.workspaceDir ?? makeWorkspaceDir())
  mkdirSync(rootDir, { recursive: true })
  const supervisorId = supervisorIdFor(input.invocationId)
  const eventDir = supervisorRunDir(rootDir, supervisorId)
  const statePath = join(eventDir, 'state.json')
  mkdirSync(dirname(eventDir), { recursive: true })
  try {
    // The run directory is the cross-process invocation lock. A non-recursive mkdir closes the
    // duplicate-start race before any journal or provider resource is created.
    mkdirSync(eventDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw unavailable(
        `Runtime supervisor '${supervisorId}' already exists at '${eventDir}'; use a new invocationId`,
      )
    }
    throw error
  }

  const context = createFileRunContext(eventDir)
  const startedAtMs = Date.now()
  const state: MutableState = {
    id: supervisorId,
    status: 'running',
    task: WORKER_TASK,
    workspaceDir: rootDir,
    budget: ROOT_MAX_TOKENS,
    ...(profile.model?.default === undefined ? {} : { workerModel: profile.model.default }),
    startedAt: new Date(startedAtMs).toISOString(),
  }
  writeState(statePath, state)

  const rootHandle = createRootHandle<unknown>()
  const supervisor = createSupervisor<unknown, unknown>()
  supervisor.attach(rootHandle)
  const workerSpawned = deferred<string>()
  const workerRunning = deferred<void>()
  const workerProfile = profile
  const workerEnvironment = {
    metadata: {
      runtime: 'agent-runtime',
      invocationId: input.invocationId,
      ...(input.environment?.BRAID_SUPERVISOR_WORKSPACE === undefined
        ? {}
        : { requestedWorkspace: input.environment.BRAID_SUPERVISOR_WORKSPACE }),
    },
    name: `runtime-${supervisorId}`,
  }
  const makeWorkerAgent = workerFromInteractiveProvider(provider, {
    environment: workerEnvironment,
    pollIntervalMs: input.pollMs,
    destroyEnvironmentOnTeardown: true,
  })

  const rootAgent: Agent<unknown, unknown> = {
    name: 'runtime-supervisor-root',
    async act(_task: unknown, scope: Scope<unknown>): Promise<unknown> {
      const coord = createCoordinationTools({
        scope,
        blobs: context.blobs,
        makeWorkerAgent,
        perWorker: workerBudget(),
      })
      await coord.ready()
      const spawn = findTool(coord.tools, 'spawn_agent')
      const result = await spawn.handler({
        profile: workerProfile,
        task: WORKER_TASK,
        label: 'interactive-worker',
      })
      const childId = workerIdFromSpawn(result)
      workerSpawned.resolve(childId)

      for (;;) {
        const child = scope.view.nodes.find((node) => node.id === childId)
        if (child?.status === 'running') break
        if (
          child === undefined ||
          child.status === 'done' ||
          child.status === 'failed' ||
          child.status === 'cancelled'
        ) {
          throw new Error(`Runtime supervisor worker '${childId}' ended before becoming live`)
        }
        await delay(input.pollMs)
      }
      workerRunning.resolve()

      const steerAcknowledger = createSteerAcknowledger({
        dir: eventDir,
        coord,
        now: Date.now,
        ownerId: scope.view.root,
      })
      const cancelAcknowledger = createCancelAcknowledger({
        dir: eventDir,
        coord,
        scope,
        now: Date.now,
        ownerId: scope.view.root,
        controlScope: 'run',
      })
      const settled = scope.next()
      try {
        while (true) {
          await steerAcknowledger.pass('turn')
          cancelAcknowledger.pass('turn')
          const outcome = await raceSettlement(settled, input.pollMs, scope.signal)
          if (outcome !== undefined && outcome !== null) {
            await coord.drainResolved()
            await steerAcknowledger.pass('final')
            cancelAcknowledger.pass('final')
            return outcome.kind === 'done' ? outcome.out : undefined
          }
        }
      } finally {
        // The final pass closes requests that landed after the last turn. It is idempotent with the
        // normal path and prevents an admitted operation from remaining open after root teardown.
        await steerAcknowledger.pass('final')
        cancelAcknowledger.pass('final')
        cancelAcknowledger.finish()
      }
    },
  }
  const runBudget = rootBudget(input.timeoutMs)
  let runResult: SupervisedResult<unknown> | undefined
  let runError: unknown
  let runSettled = false
  const runPromise = supervisor
    .run(rootAgent, WORKER_TASK, {
      budget: runBudget,
      rootIdentity: {
        profileDigest: canonicalAgentProfileDigest(profile),
        taskDigest: canonicalCandidateDigest(WORKER_TASK),
      },
      runId: supervisorId,
      ...context,
      interactiveBindingDir: eventDir,
      maxDepth: 1,
      maxLiveWorkers: 1,
    })
    .then(
      (result) => {
        runResult = result
        runSettled = true
        updateStateFromResult(state, result)
        writeState(statePath, state)
        return result
      },
      (error) => {
        runError = error
        runSettled = true
        state.status = 'down'
        state.completedAt = new Date().toISOString()
        writeState(statePath, state)
        throw error
      },
    )
  void runPromise.catch(() => undefined)

  let workerId: string
  try {
    workerId = await waitForWorkerSpawn(workerSpawned.promise, runPromise, input.timeoutMs)
    await waitForWorkerRunning(workerRunning.promise, runPromise, input.timeoutMs)
    if (terminalTakeover === 'required') {
      await waitForInteractiveBinding(eventDir, workerId, runPromise, input.timeoutMs, input.pollMs)
    }
  } catch (error) {
    if (!runSettled) {
      try {
        rootHandle.abort('supervisor provisioning failed')
      } catch {
        // The supervisor may have released the handle between the state read and this abort.
      }
    }
    await runPromise.catch(() => undefined)
    throw error
  }

  let cleanupPromise: Promise<SupervisorCleanupReceipt> | undefined
  const cleanup = async (): Promise<SupervisorCleanupReceipt> => {
    cleanupPromise ??= (async () => {
      if (!runSettled) {
        try {
          rootHandle.abort('supervisor cleanup')
        } catch {
          // A concurrent run completion already released the handle.
        }
      }
      const result = await runPromise.catch((error) => {
        runError = error
        return undefined
      })
      if (result !== undefined) runResult = result
      if (runError !== undefined) throw runError
      const finalEvents = await waitForWorkerTerminal(
        context.journal,
        supervisorId,
        workerId,
        input.timeoutMs,
        input.pollMs,
      )
      const workerStatus = workerStatusFromEvents(finalEvents, workerId)
      if (workerStatus === 'running') {
        throw new Error(`Runtime supervisor worker '${workerId}' did not reach a terminal state`)
      }
      if (runResult?.teardownUnconfirmed?.length) {
        throw new Error(
          `Runtime supervisor cleanup could not confirm ${runResult.teardownUnconfirmed.length} resource(s) released`,
        )
      }
      const supervisorStatus = state.status
      state.completedAt ??= new Date().toISOString()
      writeState(statePath, state)
      return Object.freeze({
        status: 'completed' as const,
        rootDir,
        supervisorId,
        workerId,
        supervisorStatus,
        workerStatus,
        resourcesReleased: true as const,
        remainingResources: Object.freeze([]) as readonly [],
      })
    })()
    return cleanupPromise
  }

  return Object.freeze({
    rootDir,
    supervisorId,
    workerId,
    providers: provider,
    terminalTakeover,
    cleanup,
  })
}

function normalizeRequest(
  request: ProvisionSupervisorRequest,
): Required<Pick<ProvisionSupervisorRequest, 'invocationId' | 'timeoutMs' | 'pollMs'>> &
  ProvisionSupervisorRequest {
  const invocationId = request.invocationId.trim()
  if (!invocationId) throw new SupervisorProvisionUnavailableError('invocationId is required')
  const timeoutMs = positiveNumber(request.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs')
  const pollMs = positiveNumber(request.pollMs ?? DEFAULT_POLL_MS, 'pollMs')
  return { ...request, invocationId, timeoutMs, pollMs }
}

function positiveNumber(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new SupervisorProvisionUnavailableError(`${name} must be a positive safe integer`)
  }
  return value
}

function makeWorkspaceDir(): string {
  return join(tmpdir(), `agent-runtime-supervisor-${randomUUID()}`)
}

function supervisorIdFor(invocationId: string): string {
  const digest = canonicalCandidateDigest({ kind: 'runtime-supervisor', invocationId })
  return `runtime-supervisor-${digest.slice('sha256:'.length)}`
}

function rootBudget(timeoutMs: number): Budget {
  return {
    maxIterations: ROOT_MAX_ITERATIONS,
    maxTokens: ROOT_MAX_TOKENS,
    deadlineMs: timeoutMs,
  }
}

function workerBudget(): Budget {
  return {
    maxIterations: WORKER_MAX_ITERATIONS,
    maxTokens: WORKER_MAX_TOKENS,
  }
}

function resolveProfile(request: ProvisionSupervisorRequest): AgentProfile {
  if (request.profile !== undefined) {
    const parsed = agentProfileSchema.safeParse(request.profile)
    if (!parsed.success) {
      throw unavailable(
        `Runtime supervisor profile is invalid: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      )
    }
    return parsed.data
  }
  const environment = request.environment ?? {}
  const runner =
    environment.BRAID_SUPERVISOR_RUNNER?.trim() ||
    process.env.BRAID_SUPERVISOR_RUNNER?.trim() ||
    'opencode'
  const parsedRunner = harnessTypeSchema.safeParse(runner)
  if (!parsedRunner.success)
    throw unavailable(`Runtime supervisor runner '${runner}' is unsupported`)
  const model =
    environment.BRAID_SUPERVISOR_MODEL?.trim() || process.env.BRAID_SUPERVISOR_MODEL?.trim()
  return agentProfileSchema.parse({
    name: 'runtime-provisioned-worker',
    harness: parsedRunner.data,
    ...(model === undefined ? {} : { model: { default: model } }),
  })
}

async function resolveProvider(
  request: ProvisionSupervisorRequest,
): Promise<AgentEnvironmentProvider> {
  const connection = request.connection
  if (connection?.provider !== undefined) return requireReconnectProvider(connection.provider)
  const client = connection?.client ?? connection?.sandboxClient
  if (client !== undefined) {
    return requireReconnectProvider(sandboxClientAsProvider(client))
  }
  const apiKey = connection?.apiKey?.trim() || process.env.TANGLE_API_KEY?.trim()
  if (!apiKey) {
    throw unavailable(
      'Runtime supervisor needs a provider or TANGLE_API_KEY; opaque credential references are not resolved by Runtime',
    )
  }
  let module: typeof import('@tangle-network/sandbox')
  try {
    module = await import('@tangle-network/sandbox')
  } catch (error) {
    throw unavailable('Runtime supervisor could not load the Sandbox SDK peer dependency', error)
  }
  const SandboxCtor = (module as { Sandbox?: new (config: unknown) => SandboxClient }).Sandbox
  if (SandboxCtor === undefined) throw unavailable('Sandbox SDK does not export a Sandbox client')
  const endpoint =
    connection?.endpoint?.trim() ||
    request.environment?.BRAID_SUPERVISOR_ENDPOINT?.trim() ||
    process.env.SANDBOX_BASE_URL?.trim() ||
    DEFAULT_SANDBOX_ENDPOINT
  const provider = sandboxClientAsProvider(new SandboxCtor({ apiKey, baseUrl: endpoint }))
  return requireReconnectProvider(provider)
}

function requireReconnectProvider(provider: AgentEnvironmentProvider): AgentEnvironmentProvider {
  if (!provider.name.trim()) throw unavailable('Runtime supervisor provider has no name')
  if (typeof provider.get !== 'function') {
    throw unavailable(
      `Runtime supervisor provider '${provider.name}' cannot reconnect environments`,
    )
  }
  return provider
}

async function readCapabilities(
  provider: AgentEnvironmentProvider,
): Promise<AgentEnvironmentCapabilities> {
  try {
    return await provider.capabilities()
  } catch (error) {
    throw unavailable(`Runtime supervisor could not read '${provider.name}' capabilities`, error)
  }
}

function terminalCapability(
  capabilities: AgentEnvironmentCapabilities,
): 'required' | 'unsupported' | 'unspecified' {
  const interactive = capabilities.interactiveAgent
  if (interactive === undefined) return 'unsupported'
  const complete = [
    interactive.start,
    interactive.control,
    interactive.status,
    interactive.attach,
    interactive.reattach,
    interactive.sendPrompt,
    interactive.input,
    interactive.resize,
    interactive.stop,
  ].every((value) => value === true)
  return complete ? 'required' : 'unsupported'
}

function findTool(tools: readonly McpToolDescriptor[], name: string): McpToolDescriptor {
  const tool = tools.find((candidate) => candidate.name === name)
  if (tool === undefined)
    throw new Error(`Runtime supervisor coordination tool '${name}' is missing`)
  return tool
}

function workerIdFromSpawn(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Runtime supervisor spawn did not return a worker id')
  }
  const workerId = (value as { workerId?: unknown }).workerId
  if (typeof workerId !== 'string' || !workerId.trim()) {
    throw new Error('Runtime supervisor spawn did not return a worker id')
  }
  return workerId
}

async function raceSettlement(
  promise: ReturnType<Scope<unknown>['next']>,
  pollMs: number,
  signal: AbortSignal,
): Promise<Awaited<ReturnType<Scope<unknown>['next']>> | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const poll = new Promise<undefined>((resolvePoll) => {
    timer = setTimeout(() => resolvePoll(undefined), pollMs)
    if (typeof timer.unref === 'function') timer.unref()
    onAbort = () => resolvePoll(undefined)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([promise, poll])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
  }
}

async function waitForWorkerSpawn(
  worker: Promise<string>,
  run: Promise<SupervisedResult<unknown>>,
  timeoutMs: number,
): Promise<string> {
  return await withTimeout(
    Promise.race([
      worker,
      run.then(() => {
        throw new Error('Runtime supervisor ended before it spawned a worker')
      }),
    ]),
    timeoutMs,
    'worker spawn',
  )
}

async function waitForWorkerRunning(
  running: Promise<void>,
  run: Promise<SupervisedResult<unknown>>,
  timeoutMs: number,
): Promise<void> {
  await withTimeout(
    Promise.race([
      running,
      run.then(() => {
        throw new Error('Runtime supervisor ended before the worker became live')
      }),
    ]),
    timeoutMs,
    'worker readiness',
  )
}

async function waitForInteractiveBinding(
  eventDir: string,
  workerId: string,
  run: Promise<SupervisedResult<unknown>>,
  timeoutMs: number,
  pollMs: number,
): Promise<void> {
  await withTimeout(
    pollUntil(
      async () => {
        const binding = readWorkerInteractiveBinding(eventDir, workerId)
        if (binding?.status === 'available') return true
        if (binding?.status === 'unavailable') {
          throw unavailable(`Runtime worker '${workerId}' could not publish an interactive binding`)
        }
        return false
      },
      run,
      pollMs,
    ),
    timeoutMs,
    'interactive terminal binding',
  )
}

async function pollUntil(
  read: () => Promise<boolean> | boolean,
  run: Promise<SupervisedResult<unknown>>,
  pollMs: number,
): Promise<void> {
  for (;;) {
    if (await read()) return
    await Promise.race([
      delay(pollMs),
      run.then(() => {
        throw new Error('Runtime supervisor ended before readiness was observed')
      }),
    ])
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(unavailable(`Runtime supervisor timed out waiting for ${label}`)),
      timeoutMs,
    )
    if (typeof timer.unref === 'function') timer.unref()
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    const timer = setTimeout(resolveDelay, ms)
    if (typeof timer.unref === 'function') timer.unref()
  })
}

function updateStateFromResult(state: MutableState, result: SupervisedResult<unknown>): void {
  state.status =
    result.kind === 'winner' ? 'done' : result.reason === 'aborted' ? 'cancelled' : 'down'
  state.completedAt = new Date().toISOString()
}

function workerStatusFromEvents(
  events: readonly SpawnEvent[],
  workerId: string,
): SupervisorCleanupReceipt['workerStatus'] {
  let status: SupervisorCleanupReceipt['workerStatus'] = 'running'
  let terminal = false
  for (const event of events) {
    if (event.id !== workerId) continue
    if (terminal) continue
    if (event.kind === 'spawned' || event.kind === 'progress') status = 'running'
    else if (event.kind === 'settled') {
      status = event.status === 'done' ? 'done' : 'down'
      terminal = true
    } else if (event.kind === 'cancelled') {
      status = 'cancelled'
      terminal = true
    }
  }
  return status
}

async function waitForWorkerTerminal(
  journal: import('./types').SpawnJournal,
  root: string,
  workerId: string,
  timeoutMs: number,
  pollMs: number,
): Promise<SpawnEvent[]> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const events = await journal.loadTree(root)
    if (events !== undefined && workerStatusFromEvents(events, workerId) !== 'running') {
      return events
    }
    if (Date.now() >= deadline) {
      throw unavailable(`Runtime supervisor timed out waiting for worker '${workerId}' to settle`)
    }
    await delay(pollMs)
  }
}

function deferred<T>(): Deferred<T> {
  let done = false
  let resolveValue!: (value: T) => void
  let rejectValue!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolveValue = (value) => {
      if (done) return
      done = true
      resolvePromise(value)
    }
    rejectValue = (error) => {
      if (done) return
      done = true
      rejectPromise(error)
    }
  })
  return {
    promise,
    resolve: resolveValue,
    reject: rejectValue,
    settled: () => done,
  }
}

function unavailable(message: string, cause?: unknown): SupervisorProvisionUnavailableError {
  return new SupervisorProvisionUnavailableError(message, cause)
}

function writeState(path: string, state: MutableState): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporary, `${JSON.stringify(state)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  })
  const file = openSync(temporary, 'r')
  try {
    fsyncSync(file)
  } finally {
    closeSync(file)
  }
  renameSync(temporary, path)
  const directory = openSync(dirname(path), 'r')
  try {
    fsyncSync(directory)
  } finally {
    closeSync(directory)
  }
}
