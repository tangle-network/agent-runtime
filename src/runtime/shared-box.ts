/**
 * Shared-box placement: many harness workers in one Sandbox box, each as its own process.
 *
 * The default provider placement gives every worker its own Sandbox box. A box costs a create
 * call, a sidecar, an egress proxy, a preview link and a memory reservation sized for the box,
 * while one opencode worker uses about half a gigabyte. This module packs workers into a small
 * pool of boxes instead. Each worker runs `opencode run` as a separate process with its own
 * working directory and its own HOME, so each worker has its own harness session, its own
 * materialized profile and its own transcript files.
 *
 * Why processes and not sidecar sessions: the sidecar serves every session in one box from one
 * workspace and writes each session's profile into the same files. Measured 2026-09-24 on
 * sandbox-ff52a989e7c9: eight concurrent sessions with different instructions, and seven of eight
 * answered with another session's instructions. A process with its own directory, its own HOME and
 * `OPENCODE_DISABLE_PROJECT_CONFIG` reads only its own configuration: sixteen of sixteen concurrent
 * workers answered with their own instructions and wrote only into their own directory.
 *
 * The boundary is cooperative, not a security boundary. Every worker runs as the same Linux user,
 * so a worker can read a co-tenant's files through its shell. A profile that writes a repository,
 * runs untrusted code, holds a credential of its own, or must stay blind to its siblings keeps a
 * dedicated box: {@link SharedBoxPlacement.refusal} names the profile features this placement
 * cannot carry, and Runtime then uses the dedicated provider.
 *
 * The workers of one box share the box's router key. Each worker names itself to the router with
 * the `x-tangle-client` header, which the router stores as `clientName` on every usage row, so a
 * keeper can price one worker from the key's per-client rows (`tangle-admin router-spend --key
 * <box key>`). A request without the header stays charged to the box.
 *
 * `workersPerBox` is the one structural cap, and it protects the box. A Tangle box has a fixed
 * 512-task pids limit. An idle box uses about 118 tasks and one opencode worker about 34, so
 * twelve workers reach the limit. At that limit the sidecar's own process spawn fails with EAGAIN
 * and the sidecar restarts, which ends every worker in the box (measured on the same box: 28
 * workers crashed the sidecar twice; 16 workers crashed it once).
 */

import { randomUUID } from 'node:crypto'
import {
  type AgentProfile,
  agentProfileSchema,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironmentCapabilities,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { harnessSystemPromptIntents } from '@tangle-network/agent-interface/harness-capabilities'
import { materializeProfile } from '@tangle-network/agent-profile-materialize'
import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { ValidationError } from '../errors'
import { harnessInvocation } from '../mcp/local-harness'
import { sandboxClientAsProvider } from './environment-provider'
import { concreteProfileModel, profileProviderModel } from './supervise/model-policy'
import type { SandboxClient } from './types'
import { sleep } from './util'

/**
 * The most workers one default box carries at once.
 *
 * It keeps a worker count that the 512-task pids limit of a Tangle box can hold with headroom
 * for the sidecar's own processes and the workers' tool shells: 118 idle tasks plus 8 workers at
 * about 34 tasks each is 390. Memory is not the binding limit: 8 workers used about 4 GB in a
 * 16 GB box. Raise it only for a box whose pids limit was raised with it.
 */
export const DEFAULT_SHARED_BOX_WORKERS = 8

/** The box shape the default placement creates: memory for 8 workers at about 0.5 GB each plus
 *  the sidecar, and 4 cores, because the workers wait on the model most of the time. */
export const DEFAULT_SHARED_BOX_RESOURCES = Object.freeze({ cpuCores: 4, memoryMB: 8192 })

const DEFAULT_WORKER_ROOT = '/home/agent/workers'
const HARNESS = 'opencode'
const SHARED_PROVIDER_NAME = 'tangle-shared-box'
const DEFAULT_EXEC_TIMEOUT_MS = 120_000

/** The request header the router records as a usage row's `clientName`. */
export const ROUTER_CLIENT_HEADER = 'x-tangle-client'

/**
 * The router client name of the worker that runs supervised node `nodeId`.
 *
 * The node id is already in the spawn journal, so a keeper joins a router row to a node without
 * a new record: the row whose `clientName` is `agent-runtime-node/<nodeId>` is that node's spend.
 */
export function sharedWorkerClientName(nodeId: string): string {
  // A header value the router stores as sent: visible ASCII, no spaces.
  if (!/^[!-~]+$/u.test(nodeId)) {
    throw new ValidationError('sharedWorkerClientName: a node id must be visible ASCII')
  }
  return `agent-runtime-node/${nodeId}`
}

/**
 * Attempts for one Sandbox API call that failed on the way to the box.
 *
 * Every call re-verifies the API key with the platform, and a burst of workers makes that check
 * time out: 8 of 64 workers failed with `502 platform_unavailable` (reason `platform_timeout`) in
 * one burst on 2026-09-24, and 3 more lost their transcript enumeration the same way. The check
 * refuses the request before it reaches the box, so repeating it is safe; five attempts over about
 * fifteen seconds rode out every such failure measured.
 */
const TRANSIENT_ATTEMPTS = 5
const TRANSIENT_BASE_DELAY_MS = 1_000

/** A failure that a repeated request can change: the platform, the gateway or the network. */
export function isTransientSandboxFailure(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const record = error as { status?: unknown; code?: unknown; name?: unknown; message?: unknown }
  if (
    typeof record.status === 'number' &&
    [408, 425, 429, 500, 502, 503, 504].includes(record.status)
  ) {
    return true
  }
  const text = `${String(record.code ?? '')} ${String(record.name ?? '')} ${String(record.message ?? '')}`
  return /platform_unavailable|platform_timeout|platform_unreachable|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|UND_ERR|bad gateway|gateway timeout/iu.test(
    text,
  )
}

async function transientRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: { signal?: AbortSignal; delayMs?: number } = {},
): Promise<T> {
  const delayMs = options.delayMs ?? TRANSIENT_BASE_DELAY_MS
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation(attempt)
    } catch (error) {
      if (attempt >= TRANSIENT_ATTEMPTS || !isTransientSandboxFailure(error)) throw error
      options.signal?.throwIfAborted()
      await sleep(delayMs * 2 ** (attempt - 1), options.signal)
    }
  }
}

/** The Sandbox box surface a shared box uses. The Sandbox SDK's `SandboxInstance` satisfies it. */
export interface SharedBoxHandle {
  readonly id: string
  exec(
    command: string,
    options?: { timeoutMs?: number },
  ): Promise<{ exitCode?: number | null; stdout?: string; stderr?: string }>
  readonly fs: {
    read(path: string): Promise<string>
    write(path: string, content: string): Promise<unknown>
  }
  readonly process: {
    spawnExact(
      executable: string,
      args: readonly string[],
      options?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number },
    ): Promise<SharedBoxProcess>
    list(): Promise<ReadonlyArray<{ pid: number; command?: string; cwd?: string }>>
    get(pid: number): Promise<SharedBoxProcess | null>
  }
  delete(): Promise<unknown>
}

/** One process in a shared box, as the Sandbox SDK's process manager returns it. */
export interface SharedBoxProcess {
  readonly pid: number
  wait(): Promise<number>
  kill(signal?: 'SIGTERM' | 'SIGKILL', options?: { tree?: boolean }): Promise<void>
  stdout(): AsyncIterable<string>
  stderr(): AsyncIterable<string>
}

/** Options for {@link sharedBoxPlacement}. */
export interface SharedBoxPlacementOptions {
  /** The Sandbox client that creates and deletes the shared boxes. */
  client: SandboxClient
  /**
   * Create options for every shared box: resources, egress, secrets, lifetime and billing.
   * Runtime owns `backend`, so the box's sidecar never serves a worker turn.
   */
  box?: Omit<CreateSandboxOptions, 'backend'>
  /** The most workers one box carries at once. Defaults to {@link DEFAULT_SHARED_BOX_WORKERS}. */
  workersPerBox?: number
  /** Absolute directory in each box that holds one directory per worker. */
  workerRoot?: string
  /** First wait before repeating a Sandbox call that failed transiently; doubles per attempt. */
  retryDelayMs?: number
}

/** Counts that show how the pool placed its workers. */
export interface SharedBoxStats {
  readonly boxesCreated: number
  readonly boxesLive: number
  readonly workersPlaced: number
  readonly workersLive: number
  /** The most workers any one box carried at the same time. */
  readonly peakWorkersPerBox: number
  /** Every box this pool created, with the workers it served. */
  readonly boxes: ReadonlyArray<{
    readonly id: string
    readonly workersServed: number
    readonly deleted: boolean
    /** Milliseconds from the create request to a box that runs processes. */
    readonly createMs: number
  }>
}

/** What {@link SharedBoxPlacement.close} did to each box. */
export interface SharedBoxCloseReceipt {
  readonly boxId: string
  readonly deleted: boolean
  readonly error?: string
}

/** Who a shared worker is, for the router rows its model calls leave on the box's key. */
export interface SharedWorkerIdentity {
  /** The supervised node the worker runs. Absent for a worker outside a supervised tree. */
  readonly nodeId?: string
}

/** A shared-box placement: the provider Runtime uses for a profile the placement accepts. */
export interface SharedBoxPlacement {
  /**
   * The environment provider that places one accepted worker in a shared box. A worker with a
   * `nodeId` sends `x-tangle-client: agent-runtime-node/<nodeId>` on its router calls; without
   * one, its calls carry no client name and stay charged to the box.
   */
  providerFor(worker?: SharedWorkerIdentity): AgentEnvironmentProvider
  /** Public identity of this placement, recorded on every execution it serves. */
  readonly identity: { readonly id: string; readonly digest: string }
  /** Why a shared box cannot carry this profile, or `undefined` when it can. */
  refusal(profile: AgentProfile): string | undefined
  stats(): SharedBoxStats
  /** Delete every box this placement created and still holds. Call it when the run settles. */
  close(): Promise<ReadonlyArray<SharedBoxCloseReceipt>>
}

/**
 * Why a shared box cannot carry `profile`, or `undefined` when it can.
 *
 * A shared box carries a profile whose whole behavior reaches an opencode process through its own
 * working directory, its own configuration and the box's own model credential. Everything else
 * keeps a dedicated box: another harness, a model the box credential cannot reach, a replaced
 * system prompt, MCP servers, connections, hooks, subagents, extensions, tool grants, and any
 * resource the materializer does not lower into the worker's directory.
 */
export function sharedBoxRefusal(profile: AgentProfile): string | undefined {
  if (profile.harness !== HARNESS) return `harness ${String(profile.harness)} is not ${HARNESS}`
  const model = concreteProfileModel(profile)
  if (model === undefined) return 'profile names no concrete model'
  if (profile.model?.provider === undefined) return 'profile names no model provider'
  if (profile.model?.reasoningEffort !== undefined) {
    const invocation = tryInvocation(profile)
    if (invocation === undefined) return 'model.reasoningEffort has no opencode variant'
  }
  if (profile.prompt?.systemPrompt !== undefined)
    return 'prompt.systemPrompt replaces a system prompt'
  for (const field of [
    'mcp',
    'connections',
    'hooks',
    'subagents',
    'extensions',
    'confidential',
    'modes',
  ] as const) {
    if ((profile as Record<string, unknown>)[field] !== undefined)
      return `profile declares ${field}`
  }
  if (profile.tools !== undefined && Object.keys(profile.tools).length > 0) {
    return 'profile grants tools'
  }
  const resources = profile.resources
  if (resources !== undefined) {
    for (const field of ['skills', 'agents', 'commands', 'tools'] as const) {
      if ((resources as Record<string, unknown>)[field] !== undefined) {
        return `profile declares resources.${field}`
      }
    }
    for (const file of resources.files ?? []) {
      if (file.resource.kind !== 'inline') return `resource file ${file.path} is not inline`
    }
    if (
      resources.instructions !== undefined &&
      typeof resources.instructions !== 'string' &&
      resources.instructions.kind !== 'inline'
    ) {
      return 'resources.instructions is not inline'
    }
  }
  let plan: ReturnType<typeof materializeProfile>
  try {
    plan = materializeProfile(profile, HARNESS)
  } catch (error) {
    return `opencode materialization failed: ${error instanceof Error ? error.message : String(error)}`
  }
  if (plan.unsupported.length > 0) {
    return `opencode cannot carry ${plan.unsupported.map((row) => row.dimension).join(', ')}`
  }
  if (Object.keys(plan.env).length > 0 || plan.flags.length > 0) {
    return 'profile needs launch environment or flags'
  }
  for (const file of plan.files) {
    if (file.root === 'agent') return `profile writes ${file.relPath} into the harness home`
    if ((file.secretSlots?.length ?? 0) > 0) return `profile file ${file.relPath} carries a secret`
    if (isUnsafeRelativePath(file.relPath))
      return `profile file ${file.relPath} leaves its directory`
  }
  return undefined
}

function tryInvocation(profile: AgentProfile): string[] | undefined {
  try {
    return harnessInvocation(HARNESS, invocationProfile(profile), 'probe').args
  } catch {
    return undefined
  }
}

/**
 * The profile the invocation table reads. The prompt reaches opencode through its configuration
 * and the model through the provider this placement declares, so only the reasoning effort is
 * left for the table to lower into `--variant`.
 */
function invocationProfile(profile: AgentProfile): AgentProfile {
  const { prompt: _prompt, model, ...rest } = profile
  return {
    ...rest,
    ...(model?.reasoningEffort === undefined
      ? {}
      : { model: { reasoningEffort: model.reasoningEffort } }),
  } as AgentProfile
}

function isUnsafeRelativePath(path: string): boolean {
  return (
    path.length === 0 ||
    path.startsWith('/') ||
    path.split('/').some((segment) => segment === '..' || segment === '')
  )
}

/**
 * Place accepted workers as processes in a pool of shared Sandbox boxes.
 *
 * The pool fills a box before it creates the next one and deletes a box when its last worker
 * releases it. Runtime reaches this placement through `createExecutor({ backend: 'provider',
 * shared })`: a profile that {@link SharedBoxPlacement.refusal} accepts runs here, and every other
 * profile keeps the dedicated provider.
 */
export function sharedBoxPlacement(options: SharedBoxPlacementOptions): SharedBoxPlacement {
  const workersPerBox = options.workersPerBox ?? DEFAULT_SHARED_BOX_WORKERS
  if (!Number.isSafeInteger(workersPerBox) || workersPerBox < 1) {
    throw new ValidationError('sharedBoxPlacement: workersPerBox must be a positive integer')
  }
  const workerRoot = options.workerRoot ?? DEFAULT_WORKER_ROOT
  if (!workerRoot.startsWith('/') || isUnsafeRelativePath(workerRoot.slice(1))) {
    throw new ValidationError('sharedBoxPlacement: workerRoot must be an absolute, normalized path')
  }
  const boxOptions: CreateSandboxOptions = {
    resources: { ...DEFAULT_SHARED_BOX_RESOURCES },
    ...(options.box ?? {}),
  }
  if ((boxOptions as { backend?: unknown }).backend !== undefined) {
    throw new ValidationError('sharedBoxPlacement: box.backend is owned by Runtime')
  }
  const identity = {
    id: 'shared-box',
    digest: canonicalCandidateDigest({
      kind: 'shared-box-placement.v1',
      harness: HARNESS,
      workersPerBox,
      workerRoot,
      box: publicBoxOptions(boxOptions),
    }),
  }
  const retryDelayMs = options.retryDelayMs ?? TRANSIENT_BASE_DELAY_MS
  const pool = createBoxPool(options.client, boxOptions, workersPerBox, retryDelayMs)
  const providerFor = (worker: SharedWorkerIdentity = {}): AgentEnvironmentProvider => {
    const clientName =
      worker.nodeId === undefined ? undefined : sharedWorkerClientName(worker.nodeId)
    const client: SandboxClient = {
      async create(createOptions?: CreateSandboxOptions): Promise<SandboxInstance> {
        const profile = workerProfile(createOptions)
        const refusal = sharedBoxRefusal(profile)
        if (refusal !== undefined) {
          throw new ValidationError(`sharedBoxPlacement: ${refusal}`)
        }
        assertWorkerCreateOptions(createOptions)
        const lease = await pool.acquire()
        try {
          const created = await createWorker(lease, workerRoot, profile, retryDelayMs, clientName)
          return created as unknown as SandboxInstance
        } catch (error) {
          await lease.release()
          throw error
        }
      },
    }
    return sandboxClientAsProvider(client, {
      name: SHARED_PROVIDER_NAME,
      capabilities: sharedBoxCapabilities(),
    })
  }
  return {
    providerFor,
    identity,
    refusal: sharedBoxRefusal,
    stats: () => pool.stats(),
    close: () => pool.close(),
  }
}

function publicBoxOptions(box: CreateSandboxOptions): unknown {
  const { env, secrets, ...rest } = box as CreateSandboxOptions & {
    env?: Record<string, string>
    secrets?: unknown
  }
  return {
    ...rest,
    ...(env === undefined ? {} : { environmentVariableNames: Object.keys(env).sort() }),
    ...(secrets === undefined ? {} : { secrets }),
  }
}

function sharedBoxCapabilities(): AgentEnvironmentCapabilities {
  return {
    profile: {
      namedProfiles: false,
      systemPrompt: { ...harnessSystemPromptIntents(HARNESS), replace: false },
      instructions: true,
      tools: false,
      permissions: true,
      mcp: false,
      subagents: false,
      resources: { files: true, instructions: true },
      runtimeUpdate: false,
      validation: false,
    },
    streaming: { live: true, replay: false, detach: false, turnIdempotency: false },
    sessions: { continue: false, list: false, messages: false },
    workspace: { read: true, write: true, exec: true, git: false, upload: false, download: false },
    branching: { checkpoint: false, fork: false },
    placement: true,
    usage: true,
    confidential: false,
  }
}

function workerProfile(createOptions: CreateSandboxOptions | undefined): AgentProfile {
  const raw = (createOptions?.backend as { profile?: unknown } | undefined)?.profile
  const parsed = agentProfileSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ValidationError('sharedBoxPlacement: an exact AgentProfile is required at create')
  }
  return parsed.data
}

/**
 * A worker create carries only what a slot in a shared box can honor. Box-level settings belong
 * to the placement's own box options, and a per-worker request for them is refused rather than
 * dropped: a worker that asked for an environment variable, a repository or its own resources
 * would otherwise run without them and report nothing.
 */
function assertWorkerCreateOptions(createOptions: CreateSandboxOptions | undefined): void {
  const options = (createOptions ?? {}) as Record<string, unknown>
  for (const key of ['git', 'fromSnapshot', 'fromSandboxId', 'environment', 'cwd', 'resources']) {
    if (options[key] !== undefined) {
      throw new ValidationError(`sharedBoxPlacement: a shared worker cannot set ${key}`)
    }
  }
  const env = options.env as Record<string, string> | undefined
  if (env !== undefined && Object.keys(env).length > 0) {
    throw new ValidationError('sharedBoxPlacement: a shared worker cannot set env')
  }
  const secrets = options.secrets as unknown[] | undefined
  if (Array.isArray(secrets) && secrets.length > 0) {
    throw new ValidationError('sharedBoxPlacement: a shared worker cannot request secrets')
  }
  const backend = options.backend as { runtimeAttachments?: unknown; type?: unknown } | undefined
  if (backend?.runtimeAttachments !== undefined) {
    throw new ValidationError(
      'sharedBoxPlacement: a shared worker cannot carry runtime attachments',
    )
  }
  if (backend?.type !== undefined && backend.type !== HARNESS) {
    throw new ValidationError(
      `sharedBoxPlacement: backend ${String(backend.type)} is not ${HARNESS}`,
    )
  }
}

// ── The box pool ─────────────────────────────────────────────────────────────────────────────

interface PooledBox {
  readonly seq: number
  readonly ready: Promise<SharedBoxHandle>
  id?: string
  createMs?: number
  workers: number
  served: number
  retired: boolean
  deleted: boolean
}

interface BoxLease {
  readonly box: SharedBoxHandle
  release(): Promise<void>
}

function createBoxPool(
  client: SandboxClient,
  boxOptions: CreateSandboxOptions,
  workersPerBox: number,
  retryDelayMs: number,
) {
  // One key per box, so a create repeated after a lost answer returns the same box.
  const poolId = randomUUID()
  const boxes: PooledBox[] = []
  const history: PooledBox[] = []
  let seq = 0
  let placed = 0
  let peak = 0
  let closing = false

  const retire = async (entry: PooledBox): Promise<SharedBoxCloseReceipt | undefined> => {
    if (entry.retired) return undefined
    entry.retired = true
    const index = boxes.indexOf(entry)
    if (index >= 0) boxes.splice(index, 1)
    let handle: SharedBoxHandle
    try {
      handle = await entry.ready
    } catch {
      return undefined
    }
    try {
      await transientRetry(() => handle.delete(), { delayMs: retryDelayMs })
      entry.deleted = true
      return { boxId: handle.id, deleted: true }
    } catch (error) {
      return {
        boxId: handle.id,
        deleted: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  return {
    async acquire(): Promise<BoxLease> {
      if (closing) throw new ValidationError('sharedBoxPlacement: the placement is closed')
      let entry = boxes.find((candidate) => !candidate.retired && candidate.workers < workersPerBox)
      if (entry === undefined) {
        const boxSeq = seq++
        const request = {
          ...boxOptions,
          name: boxOptions.name ?? `shared-box-${poolId.slice(0, 8)}-${boxSeq}`,
          idempotencyKey: `shared-box-${poolId}-${boxSeq}`,
          // The box's own sidecar never serves a worker turn. It still needs a harness to
          // start, and a minimal profile keeps its workspace free of worker instructions.
          backend: { type: HARNESS, profile: { name: 'shared-box', harness: HARNESS } },
        } as CreateSandboxOptions
        const requestedAt = Date.now()
        const created: PooledBox = {
          seq: boxSeq,
          ready: transientRetry(() => client.create(request), { delayMs: retryDelayMs }).then(
            (box) => box as unknown as SharedBoxHandle,
          ),
          workers: 0,
          served: 0,
          retired: false,
          deleted: false,
        }
        created.ready.then(
          (box) => {
            created.id = box.id
            created.createMs = Date.now() - requestedAt
          },
          () => {
            // Every waiting lease sees the same rejection through `ready`.
            const index = boxes.indexOf(created)
            if (index >= 0) boxes.splice(index, 1)
            created.retired = true
          },
        )
        boxes.push(created)
        history.push(created)
        entry = created
      }
      const leased = entry
      leased.workers += 1
      leased.served += 1
      placed += 1
      peak = Math.max(peak, leased.workers)
      let box: SharedBoxHandle
      try {
        box = await leased.ready
      } catch (error) {
        leased.workers -= 1
        throw error
      }
      let released = false
      return {
        box,
        async release(): Promise<void> {
          if (released) return
          released = true
          leased.workers -= 1
          if (leased.workers === 0 && !closing) await retire(leased)
        },
      }
    },
    stats(): SharedBoxStats {
      return {
        boxesCreated: history.length,
        boxesLive: history.filter((entry) => !entry.retired).length,
        workersPlaced: placed,
        workersLive: history.reduce((sum, entry) => sum + entry.workers, 0),
        peakWorkersPerBox: peak,
        boxes: history
          .filter((entry) => entry.id !== undefined)
          .map((entry) => ({
            id: entry.id!,
            workersServed: entry.served,
            deleted: entry.deleted,
            createMs: entry.createMs ?? 0,
          })),
      }
    },
    async close(): Promise<ReadonlyArray<SharedBoxCloseReceipt>> {
      closing = true
      const receipts = await Promise.all(history.map((entry) => retire(entry)))
      return receipts.filter((receipt): receipt is SharedBoxCloseReceipt => receipt !== undefined)
    },
  }
}

// ── One worker ───────────────────────────────────────────────────────────────────────────────

interface WorkerPaths {
  readonly dir: string
  readonly home: string
  readonly cache: string
}

/** The environment one worker's processes see: its own directory, HOME and XDG roots. */
function workerEnv(paths: WorkerPaths): string[] {
  return [
    // A worker directory sits under the sidecar's workspace, and opencode merges every
    // project configuration it finds above its directory. Without this, a worker loads the
    // box's own opencode.json and instructions.
    'OPENCODE_DISABLE_PROJECT_CONFIG=1',
    `OPENCODE_CONFIG_DIR=${paths.dir}/.opencode`,
    // opencode takes its project directory from PWD, not from the process working directory.
    `PWD=${paths.dir}`,
    `HOME=${paths.home}`,
    `XDG_DATA_HOME=${paths.home}/.local/share`,
    `XDG_CONFIG_HOME=${paths.home}/.config`,
    `XDG_STATE_HOME=${paths.home}/.local/state`,
    // The package cache holds downloaded model-provider packages and no session state, so the
    // workers of one box share it and download each package once.
    `XDG_CACHE_HOME=${paths.cache}`,
  ]
}

async function createWorker(
  lease: BoxLease,
  root: string,
  createProfile: AgentProfile,
  retryDelayMs: number,
  clientName: string | undefined,
) {
  const box = resilientBox(lease.box, retryDelayMs)
  const workerId = `w-${randomUUID()}`
  const paths: WorkerPaths = {
    dir: `${root}/${workerId}`,
    home: `${root}/${workerId}/.home`,
    cache: `${root}/.cache`,
  }
  const made = await box.exec(`mkdir -p '${paths.home}' '${paths.cache}'`, {
    timeoutMs: DEFAULT_EXEC_TIMEOUT_MS,
  })
  if ((made.exitCode ?? 1) !== 0) {
    throw new Error(`sharedBoxPlacement: could not create ${paths.dir}: ${made.stderr ?? ''}`)
  }
  const env = workerEnv(paths)
  let running: SharedBoxProcess | undefined
  let released = false

  // Every process this worker started, so a repeated launch never adopts one of them.
  const started = new Set<number>()
  const run = async (
    args: readonly string[],
    timeoutMs: number,
    extraEnv?: Record<string, string>,
  ): Promise<SharedBoxProcess> => {
    const process = await box.spawnInDirectory(
      '/usr/bin/env',
      [...env, ...args],
      {
        cwd: paths.dir,
        ...(extraEnv === undefined ? {} : { env: extraEnv }),
        timeoutMs,
      },
      started,
    )
    started.add(process.pid)
    return process
  }

  const collect = async (
    process: SharedBoxProcess,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
    const [stdout, stderr, exitCode] = await Promise.all([
      drain(box.output(process, 'stdout')),
      drain(box.output(process, 'stderr')),
      box.wait(process),
    ])
    return { exitCode, stdout, stderr }
  }

  const resolvePath = (path: string): string => {
    if (path.startsWith('/')) return path
    if (isUnsafeRelativePath(path)) {
      throw new ValidationError(`sharedBoxPlacement: path ${path} leaves the worker directory`)
    }
    return `${paths.dir}/${path}`
  }

  const worker = {
    id: `${box.id}/${workerId}`,
    name: workerId,
    status: 'running',
    metadata: { sharedBoxId: box.id, workerId, workerDir: paths.dir },
    async *streamPrompt(
      message: string,
      options?: {
        signal?: AbortSignal
        timeoutMs?: number
        backend?: { type?: string; profile?: unknown; model?: Record<string, unknown> }
      },
    ): AsyncGenerator<SandboxEvent> {
      if (released) throw new ValidationError('sharedBoxPlacement: this worker was released')
      if (running !== undefined) {
        throw new ValidationError('sharedBoxPlacement: a worker runs one turn at a time')
      }
      const turnProfile =
        options?.backend?.profile === undefined
          ? createProfile
          : agentProfileSchema.parse(options.backend.profile)
      if (
        canonicalCandidateDigest(turnProfile) !== canonicalCandidateDigest(createProfile) &&
        sharedBoxRefusal(turnProfile) !== undefined
      ) {
        throw new ValidationError(`sharedBoxPlacement: ${sharedBoxRefusal(turnProfile)}`)
      }
      if (options?.backend?.type !== undefined && options.backend.type !== HARNESS) {
        throw new ValidationError(
          `sharedBoxPlacement: backend ${options.backend.type} is not ${HARNESS}`,
        )
      }
      const launch = await materializeWorker(
        box,
        paths,
        turnProfile,
        message,
        options?.backend?.model,
        clientName,
      )
      options?.signal?.throwIfAborted()
      const process = await run(launch.args, options?.timeoutMs ?? 0, {
        OPENCODE_CONFIG_CONTENT: launch.config,
      })
      running = process
      const onAbort = () => {
        void process.kill('SIGKILL', { tree: true }).catch(() => undefined)
      }
      options?.signal?.addEventListener('abort', onAbort, { once: true })
      const stderr = drain(box.output(process, 'stderr'))
      const lines = lineReader()
      const parsed = createOpencodeEventParser(launch.model)
      try {
        for await (const chunk of box.output(process, 'stdout')) {
          for (const line of lines.push(chunk)) yield* parsed.line(line)
        }
        for (const line of lines.end()) yield* parsed.line(line)
        const exitCode = await box.wait(process)
        const errorText = (await stderr).slice(-4_000)
        const sessionId = parsed.sessionId()
        if (sessionId !== undefined) await exportSession(run, collect, paths, sessionId)
        // Each harness subagent ran in a session of its own, which the parent's export does not
        // hold: without these, its steps are in no record (#1264).
        for (const child of parsed.subagentSessionIds()) {
          if (child !== sessionId) await exportSession(run, collect, paths, child)
        }
        options?.signal?.throwIfAborted()
        yield* parsed.finish(exitCode, errorText)
      } finally {
        options?.signal?.removeEventListener('abort', onAbort)
        running = undefined
      }
    },
    async exec(
      command: string,
      options?: { timeoutMs?: number },
    ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
      const process = await run(
        ['/bin/sh', '-c', command],
        options?.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS,
      )
      return await collect(process)
    },
    async read(path: string): Promise<string> {
      return await box.fs.read(resolvePath(path))
    },
    async write(path: string, content: string): Promise<void> {
      await box.fs.write(resolvePath(path), content)
    },
    async refresh(): Promise<void> {},
    async delete(): Promise<void> {
      if (released) return
      released = true
      try {
        await running?.kill('SIGKILL', { tree: true })
        await box.exec(`rm -rf '${paths.dir}'`, { timeoutMs: DEFAULT_EXEC_TIMEOUT_MS })
      } finally {
        await lease.release()
      }
    },
  }
  return worker
}

/**
 * The Sandbox calls one worker makes, each repeated on a transient failure.
 *
 * A launch is repeated only after the pool confirms the box did not start it: a failed request
 * may have reached the box before its answer was lost, so the repeat first looks for a process
 * in the worker's own directory that this worker did not start yet, and adopts it. A process log
 * that breaks mid-stream is read again from the start, because the box replays a process's
 * buffered output, and the part already delivered is skipped.
 */
function resilientBox(box: SharedBoxHandle, delayMs: number) {
  const retry = <T>(operation: () => Promise<T>) => transientRetry(operation, { delayMs })
  return {
    id: box.id,
    exec: (command: string, options?: { timeoutMs?: number }) =>
      retry(() => box.exec(command, options)),
    fs: {
      read: (path: string) => retry(() => box.fs.read(path)),
      write: (path: string, content: string) => retry(() => box.fs.write(path, content)),
    },
    async spawnInDirectory(
      executable: string,
      args: readonly string[],
      options: { cwd: string; env?: Record<string, string>; timeoutMs?: number },
      known: ReadonlySet<number>,
    ): Promise<SharedBoxProcess> {
      return await transientRetry(
        async (attempt) => {
          if (attempt > 1) {
            const listed = await box.process.list()
            const launched = listed.find(
              (entry) =>
                entry.cwd === options.cwd && entry.command === executable && !known.has(entry.pid),
            )
            const adopted = launched === undefined ? null : await box.process.get(launched.pid)
            if (adopted !== null) return adopted
          }
          return await box.process.spawnExact(executable, args, options)
        },
        { delayMs },
      )
    },
    async wait(process: SharedBoxProcess): Promise<number> {
      return await retry(async () => {
        try {
          return await process.wait()
        } catch (error) {
          if (!isTransientSandboxFailure(error)) throw error
          const again = await box.process.get(process.pid)
          if (again === null) throw error
          return await again.wait()
        }
      })
    },
    async *output(process: SharedBoxProcess, stream: 'stdout' | 'stderr'): AsyncGenerator<string> {
      let delivered = 0
      let source: SharedBoxProcess = process
      for (let attempt = 1; ; attempt += 1) {
        let seen = 0
        try {
          for await (const chunk of source[stream]()) {
            const fresh =
              seen + chunk.length <= delivered ? '' : chunk.slice(Math.max(0, delivered - seen))
            seen += chunk.length
            if (fresh.length > 0) {
              delivered += fresh.length
              yield fresh
            }
          }
          return
        } catch (error) {
          if (attempt >= TRANSIENT_ATTEMPTS || !isTransientSandboxFailure(error)) throw error
          await sleep(delayMs * 2 ** (attempt - 1))
          source = (await retry(() => box.process.get(process.pid))) ?? source
        }
      }
    },
    delete: () => retry(() => box.delete()),
  }
}

async function drain(stream: AsyncIterable<string>): Promise<string> {
  let text = ''
  for await (const chunk of stream) text += chunk
  return text
}

function lineReader(): { push(chunk: string): string[]; end(): string[] } {
  let pending = ''
  return {
    push(chunk) {
      pending += chunk
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      return lines.filter((line) => line.trim().length > 0)
    },
    end() {
      const rest = pending.trim()
      pending = ''
      return rest.length > 0 ? [rest] : []
    },
  }
}

/**
 * Write the worker's materialized profile into its directory and build its launch.
 *
 * The files come from the same materializer the Sandbox sidecar uses, so a shared worker gets the
 * same instruction file, permissions and resource files a dedicated box would. The generated
 * `opencode.json` is passed as `OPENCODE_CONFIG_CONTENT` with its instruction paths made absolute,
 * because opencode resolves an instruction path in that variable against nothing.
 */
async function materializeWorker(
  box: ReturnType<typeof resilientBox>,
  paths: WorkerPaths,
  profile: AgentProfile,
  task: string,
  turnModel: Record<string, unknown> | undefined,
  clientName: string | undefined,
): Promise<{ args: string[]; config: string; model: string }> {
  const refusal = sharedBoxRefusal(profile)
  if (refusal !== undefined) throw new ValidationError(`sharedBoxPlacement: ${refusal}`)
  if (turnModel?.authFiles !== undefined || turnModel?.authMode === 'oauth') {
    throw new ValidationError('sharedBoxPlacement: a shared worker cannot carry auth files')
  }
  const plan = materializeProfile(profile, HARNESS)
  let generated: Record<string, unknown> = {}
  for (const file of plan.files) {
    if (file.relPath === 'opencode.json' && file.source === 'generated') {
      generated = JSON.parse(file.content) as Record<string, unknown>
      continue
    }
    await box.fs.write(`${paths.dir}/${file.relPath}`, file.content)
  }
  const instructions = Array.isArray(generated.instructions)
    ? (generated.instructions as unknown[]).map((entry) =>
        typeof entry === 'string' && !entry.startsWith('/') ? `${paths.dir}/${entry}` : entry,
      )
    : undefined
  const providerId = profile.model!.provider!
  const modelId = profileProviderModel(profile)!
  const apiKeyEnv =
    typeof turnModel?.apiKeyEnv === 'string' ? turnModel.apiKeyEnv : 'OPENCODE_MODEL_API_KEY'
  const baseURL =
    typeof turnModel?.baseUrl === 'string' ? turnModel.baseUrl : '{env:OPENCODE_MODEL_BASE_URL}'
  const config = {
    $schema: 'https://opencode.ai/config.json',
    ...generated,
    ...(instructions === undefined ? {} : { instructions }),
    permission: {
      // The Sandbox sidecar's default: file tools stay inside the worker's own directory.
      external_directory: { '*': 'deny', '/tmp/**': 'allow' },
      ...((generated.permission as Record<string, unknown> | undefined) ?? {}),
    },
    provider: {
      [providerId]: {
        npm: '@ai-sdk/openai-compatible',
        name: providerId,
        options: {
          baseURL,
          apiKey: `{env:${apiKeyEnv}}`,
          ...(clientName === undefined ? {} : { headers: { [ROUTER_CLIENT_HEADER]: clientName } }),
        },
        models: { [modelId]: { name: modelId } },
      },
    },
  }
  // The invocation table owns the opencode argv, including the reasoning variant and the
  // unattended permission flag; the profile prompt is already in the configuration above.
  const invocation = harnessInvocation(HARNESS, invocationProfile(profile), task, {
    dangerouslySkipPermissions: true,
  })
  const model = `${providerId}/${modelId}`
  return {
    args: [invocation.command, ...invocation.args, '--format', 'json', '-m', model],
    config: JSON.stringify(config),
    model,
  }
}

/**
 * Save the harness's own record of the session where the transcript capture reads it.
 *
 * Current opencode keeps sessions in a SQLite database, which the capture cannot carry as text.
 * `opencode export` writes the same session as JSON.
 */
async function exportSession(
  run: (args: readonly string[], timeoutMs: number) => Promise<SharedBoxProcess>,
  collect: (process: SharedBoxProcess) => Promise<{ exitCode: number; stderr: string }>,
  paths: WorkerPaths,
  sessionId: string,
): Promise<void> {
  if (!SESSION_ID.test(sessionId)) return
  const target = `${paths.home}/.local/share/opencode/export/${sessionId}.json`
  const process = await run(
    [
      '/bin/sh',
      '-c',
      'mkdir -p "$(dirname "$2")" && exec opencode export "$1" > "$2"',
      'export-session',
      sessionId,
      target,
    ],
    DEFAULT_EXEC_TIMEOUT_MS,
  )
  await collect(process)
}

const SESSION_ID = /^[A-Za-z0-9_-]+$/u

/** A subagent's session id in a `task` result (`<task id="ses_…">`) or failure (`task_id: ses_…`). */
const TASK_SESSION = /(?:<task id="|task_id: )(ses_[A-Za-z0-9]+)/u

/**
 * The session a harness subagent ran in, named by its parent's `task` tool part.
 *
 * opencode starts each subagent in a child session and refuses a nested one unless the
 * configuration raises `subagent_depth` above 1, so under the default the parent's parts name
 * every subagent session. A running part carries the id in `state.metadata.sessionId`; a finished
 * one also carries it in its output, and a failed one in its error.
 */
function subagentSessionOf(part: Record<string, unknown>): string | undefined {
  if (part.type !== 'tool' || part.tool !== 'task') return undefined
  const state = part.state
  if (state === undefined || state === null || typeof state !== 'object') return undefined
  const { metadata, output, error } = state as Record<string, unknown>
  const named =
    metadata !== null && typeof metadata === 'object'
      ? (metadata as Record<string, unknown>).sessionId
      : undefined
  if (typeof named === 'string' && SESSION_ID.test(named)) return named
  for (const text of [output, error]) {
    const match = typeof text === 'string' ? TASK_SESSION.exec(text) : null
    if (match !== null) return match[1]
  }
  return undefined
}

// ── opencode `run --format json` to the Sandbox event wire ──────────────────────────────────

interface OpencodeLine {
  readonly type?: string
  readonly sessionID?: string
  readonly part?: Record<string, unknown>
  readonly error?: unknown
}

/**
 * Translate opencode's JSON event lines into the Sandbox event wire the provider executor reads.
 *
 * Every part becomes `message.part.updated`, which is how the sidecar forwards opencode parts, so
 * the existing trace and progress readers decode them unchanged. Each `step-finish` part also
 * becomes one canonical `llm_call` receipt with its token counts. opencode reports no dollar
 * receipt for a custom provider, so every receipt says the cost is unknown and Runtime prices the
 * tokens as an estimate instead of a bill.
 */
function createOpencodeEventParser(model: string) {
  let sessionId: string | undefined
  let finalMessageId: string | undefined
  const textByMessage = new Map<string, string[]>()
  const subagentSessions = new Set<string>()
  const errors: string[] = []
  let malformed = 0
  return {
    sessionId: () => sessionId,
    subagentSessionIds: (): readonly string[] => [...subagentSessions],
    *line(raw: string): Generator<SandboxEvent> {
      let event: OpencodeLine
      try {
        event = JSON.parse(raw) as OpencodeLine
      } catch {
        malformed += 1
        return
      }
      if (typeof event.sessionID === 'string') sessionId ??= event.sessionID
      if (event.type === 'error') {
        const message = errorMessage(event.error)
        errors.push(message)
        yield { type: 'error', data: { message } } as unknown as SandboxEvent
        return
      }
      const part = event.part
      if (part === undefined || part === null || typeof part !== 'object') return
      const subagent = subagentSessionOf(part)
      if (subagent !== undefined) subagentSessions.add(subagent)
      yield { type: 'message.part.updated', data: { part } } as unknown as SandboxEvent
      const messageId = typeof part.messageID === 'string' ? part.messageID : undefined
      if (part.type === 'text' && messageId !== undefined && typeof part.text === 'string') {
        const texts = textByMessage.get(messageId) ?? []
        texts.push(part.text)
        textByMessage.set(messageId, texts)
      }
      if (part.type === 'step-finish') {
        if (messageId !== undefined) finalMessageId = messageId
        const receipt = stepReceipt(part, model)
        if (receipt !== undefined) yield receipt
      }
    },
    *finish(exitCode: number, stderr: string): Generator<SandboxEvent> {
      const finalText =
        (finalMessageId === undefined ? undefined : textByMessage.get(finalMessageId)?.join('')) ??
        ''
      const failure =
        exitCode !== 0
          ? `opencode exited ${exitCode}${stderr.trim() ? `: ${stderr.trim().slice(-1_000)}` : ''}`
          : errors.length > 0 && finalMessageId === undefined
            ? errors.join('; ')
            : undefined
      if (failure !== undefined) {
        yield {
          type: 'result',
          data: {
            success: false,
            status: 'failed',
            error: failure,
            finalText,
            ...(malformed > 0 ? { malformedLines: malformed } : {}),
          },
        } as unknown as SandboxEvent
        yield { type: 'done', data: { outcome: { type: 'failed' } } } as unknown as SandboxEvent
        return
      }
      yield {
        type: 'result',
        data: { success: true, finalText, ...(malformed > 0 ? { malformedLines: malformed } : {}) },
      } as unknown as SandboxEvent
      yield { type: 'done', data: { outcome: { type: 'completed' } } } as unknown as SandboxEvent
    },
  }
}

function stepReceipt(part: Record<string, unknown>, model: string): SandboxEvent | undefined {
  const tokens = part.tokens as Record<string, unknown> | undefined
  if (tokens === undefined || tokens === null || typeof tokens !== 'object') return undefined
  const count = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
  const cache = (tokens.cache ?? {}) as Record<string, unknown>
  const input = count(tokens.input)
  const output = count(tokens.output)
  const reasoning = count(tokens.reasoning) ?? 0
  const cacheRead = count(cache.read) ?? 0
  const cacheWrite = count(cache.write) ?? 0
  const known = input !== undefined && output !== undefined
  return {
    type: 'llm_call',
    ...(typeof part.id === 'string' ? { id: part.id } : {}),
    data: {
      usageMode: 'delta',
      model,
      ...(known
        ? {
            // Runtime counts cached prompt tokens inside the prompt total; opencode reports
            // them apart, and reports reasoning apart from the visible output.
            tokensIn: input + cacheRead + cacheWrite,
            tokensOut: output + reasoning,
            ...(reasoning > 0 ? { reasoningTokens: reasoning } : {}),
          }
        : { tokensKnown: false }),
      costKnown: false,
    },
  } as unknown as SandboxEvent
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error !== null && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const data = record.data as Record<string, unknown> | undefined
    if (typeof data?.message === 'string') return data.message
    if (typeof record.message === 'string') return record.message
    if (typeof record.name === 'string') return record.name
  }
  return 'opencode reported an error'
}
