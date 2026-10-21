import { randomUUID } from 'node:crypto'
import {
  type AgentProfile,
  agentProfileSchema,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentEvent,
  AgentTurnInput,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import { harnessSystemPromptIntents } from '@tangle-network/agent-interface/harness-capabilities'
import { materializeProfile } from '@tangle-network/agent-profile-materialize'
import type { CreateSandboxOptions, Process, PromptOptions } from '@tangle-network/sandbox'
import { ValidationError } from '../errors'
import { harnessInvocation } from '../mcp/local-harness-invocation'
import { LEAF_CONTINUATION_TASK } from './environment-provider/provider-executor-lifecycle'
import type { BoxLease } from './shared-box'
import { resilientBox } from './shared-box-retry'
import { concreteProfileModel, profileProviderModel } from './supervise/model-policy'
import {
  type UnavailablePausePolicy,
  unavailablePauseMs,
  unavailableSignalOfFailure,
} from './supervise/upstream-unavailable'
import { promptFromAgentTurnInput, promptOptionsFromAgentTurnInput } from './turn-input'
import { sleep } from './util'

/** The SDK's per-turn model routing config (`PromptOptions['backend']['model']`), whose
 *  package-root export name varies across sandbox releases — derived here instead. */
type TurnModelRouting = NonNullable<PromptOptions['backend']>['model']

export const HARNESS = 'opencode'

export const SHARED_PROVIDER_NAME = 'tangle-shared-box'

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
export interface SharedBoxProcess extends Pick<Process, 'pid' | 'wait' | 'stdout' | 'stderr'> {
  kill(signal?: 'SIGTERM' | 'SIGKILL', options?: { tree?: boolean }): Promise<void>
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
  if (profile.model?.metadata?.credentialSource !== undefined) {
    return 'model.metadata.credentialSource requires a dedicated provider'
  }
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

export function isUnsafeRelativePath(path: string): boolean {
  return (
    path.length === 0 ||
    path.startsWith('/') ||
    path.split('/').some((segment) => segment === '..' || segment === '')
  )
}

export function sharedBoxCapabilities(): AgentEnvironmentCapabilities {
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

export function workerProfile(input: CreateAgentEnvironmentInput): AgentProfile {
  const parsed = agentProfileSchema.safeParse(input.profile)
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
export function assertWorkerCreateInput(input: CreateAgentEnvironmentInput): void {
  for (const key of [
    'idempotencyKey',
    'workspace',
    'resources',
    'runtimeAttachments',
    'requestedId',
    'egress',
    'billingOwner',
  ] as const) {
    if (input[key] !== undefined) {
      throw new ValidationError(`sharedBoxPlacement: a shared worker cannot set ${key}`)
    }
  }
  if (input.env !== undefined && Object.keys(input.env).length > 0) {
    throw new ValidationError('sharedBoxPlacement: a shared worker cannot set env')
  }
  if (input.secrets !== undefined && Object.keys(input.secrets).length > 0) {
    throw new ValidationError('sharedBoxPlacement: a shared worker cannot request secrets')
  }
  if (input.backend !== undefined && input.backend !== HARNESS) {
    throw new ValidationError(`sharedBoxPlacement: backend ${input.backend} is not ${HARNESS}`)
  }
  for (const key of Object.keys(input.providerOptions ?? {})) {
    if (key !== 'sandboxCreateOptions') {
      throw new ValidationError(
        `sharedBoxPlacement: a shared worker cannot set providerOptions.${key}`,
      )
    }
  }
  // The round engine projects only its profile and annotations through this input.
  // Every physical or security control must stay on the owning box placement.
  const box = input.providerOptions?.sandboxCreateOptions
  if (box === undefined) return
  if (box === null || typeof box !== 'object' || Array.isArray(box)) {
    throw new ValidationError('sharedBoxPlacement: sandboxCreateOptions must be an object')
  }
  for (const key of Object.keys(box)) {
    if (!['backend', 'metadata', 'name'].includes(key)) {
      throw new ValidationError(`sharedBoxPlacement: a shared worker cannot set ${key}`)
    }
  }
  const projected = box as Pick<CreateSandboxOptions, 'backend' | 'metadata' | 'name'>
  if (projected.name !== undefined && projected.name !== input.name) {
    throw new ValidationError('sharedBoxPlacement: projected name must match the worker name')
  }
  if (
    projected.metadata !== undefined &&
    (input.metadata === undefined ||
      canonicalCandidateDigest(projected.metadata) !== canonicalCandidateDigest(input.metadata))
  ) {
    throw new ValidationError('sharedBoxPlacement: projected metadata must match worker metadata')
  }
  const backend = projected.backend
  if (backend?.type !== undefined && backend.type !== HARNESS) {
    throw new ValidationError(`sharedBoxPlacement: backend ${backend.type} is not ${HARNESS}`)
  }
  for (const key of Object.keys(backend ?? {})) {
    if (key !== 'type' && key !== 'profile') {
      throw new ValidationError(`sharedBoxPlacement: a shared worker cannot set backend.${key}`)
    }
  }
  if (
    backend?.profile !== undefined &&
    canonicalAgentProfileDigest(agentProfileSchema.parse(backend.profile)) !==
      canonicalAgentProfileDigest(workerProfile(input))
  ) {
    throw new ValidationError(
      'sharedBoxPlacement: projected profile must match the exact worker profile',
    )
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

export async function createWorker(
  lease: BoxLease,
  root: string,
  createProfile: AgentProfile,
  placement: {
    readonly retryDelayMs: number
    readonly clientName: string | undefined
    readonly name?: string
    readonly metadata?: Record<string, unknown>
    readonly unavailablePause: UnavailablePausePolicy | false
  },
): Promise<AgentEnvironment> {
  const { clientName, unavailablePause } = placement
  const box = resilientBox(lease.box, placement.retryDelayMs)
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
  // A turn stays active through a pause, when no process runs.
  let turnActive = false
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

  /**
   * One turn: one or more opencode runs of the same session. The first runs `message`; a later run
   * continues the session after the model provider refused a run for capacity.
   */
  async function* turn(
    message: string,
    turnProfile: AgentProfile,
    /** The SDK's per-turn options (the 0.60.41 PromptOptions: signal, timeoutMs,
     *  backend, per-turn model, secret-profile receipts). The turn reads only the
     *  fields it has always read; the wider type is what `machine.prompt` takes. */
    options: PromptOptions | undefined,
  ): AsyncGenerator<AgentEnvironmentEvent> {
    const signal = options?.signal
    const timeoutMs = options?.timeoutMs ?? 0
    const turnDeadline = timeoutMs > 0 ? Date.now() + timeoutMs : undefined
    let sessionId: string | undefined
    // Every harness subagent any run of this turn started, a run the provider refused included.
    const subagents = new Set<string>()
    let refusalsInARow = 0
    let prompt = message
    for (let invocation = 1; ; invocation += 1) {
      const launch = await materializeWorker(
        box,
        paths,
        turnProfile,
        prompt,
        options?.backend?.model,
        clientName,
        sessionId,
      )
      signal?.throwIfAborted()
      const remainingMs = turnDeadline === undefined ? 0 : Math.max(1, turnDeadline - Date.now())
      const process = await run(launch.args, remainingMs, {
        OPENCODE_CONFIG_CONTENT: launch.config,
      })
      running = process
      const onAbort = () => {
        void process.kill('SIGKILL', { tree: true }).catch(() => undefined)
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      const stderr = drain(box.output(process, 'stderr'))
      const lines = lineReader()
      const parsed = createOpencodeEventParser(launch.model)
      let exitCode: number
      let errorText: string
      try {
        for await (const chunk of box.output(process, 'stdout')) {
          for (const line of lines.push(chunk)) yield* parsed.line(line)
        }
        for (const line of lines.end()) yield* parsed.line(line)
        exitCode = await box.wait(process)
        errorText = (await stderr).slice(-4_000)
      } finally {
        signal?.removeEventListener('abort', onAbort)
        running = undefined
      }
      sessionId = parsed.sessionId() ?? sessionId
      for (const child of parsed.subagentSessionIds()) subagents.add(child)
      const failure = parsed.failure(exitCode, errorText)
      const refusal =
        failure === undefined || unavailablePause === false || signal?.aborted
          ? undefined
          : unavailableSignalOfFailure({ error: failure })
      // The same rule a driver and a dedicated leaf follow: doubling per refusal in a row,
      // restarting after a refused run that still did work.
      refusalsInARow = parsed.madeProgress() ? 1 : refusalsInARow + 1
      const pauseMs =
        refusal === undefined || unavailablePause === false
          ? 0
          : unavailablePauseMs(refusalsInARow, unavailablePause)
      if (
        refusal === undefined ||
        (turnDeadline !== undefined && Date.now() + pauseMs >= turnDeadline)
      ) {
        if (sessionId !== undefined) await exportSession(run, collect, paths, sessionId)
        // Each harness subagent ran in a session of its own, which the parent's export does not
        // hold: without these, its steps are in no record (#1264).
        for (const child of subagents) {
          if (child !== sessionId) await exportSession(run, collect, paths, child)
        }
        signal?.throwIfAborted()
        yield* parsed.finish(exitCode, errorText, invocation)
        return
      }
      await sleep(pauseMs, signal)
      signal?.throwIfAborted()
      if (released) throw new ValidationError('sharedBoxPlacement: this worker was released')
      // A run that never opened a session did no work, so its task runs again whole.
      prompt = sessionId === undefined ? message : LEAF_CONTINUATION_TASK
    }
  }

  const worker: AgentEnvironment = {
    id: `${box.id}/${workerId}`,
    provider: SHARED_PROVIDER_NAME,
    name: placement.name ?? workerId,
    creation: 'created',
    capabilities: sharedBoxCapabilities(),
    async status() {
      return released ? 'stopped' : 'running'
    },
    metadata: { ...placement.metadata, sharedBoxId: box.id, workerId, workerDir: paths.dir },
    async *stream(input: AgentTurnInput): AsyncGenerator<AgentEnvironmentEvent> {
      const message = promptFromAgentTurnInput(input)
      if (typeof message !== 'string') {
        throw new ValidationError('sharedBoxPlacement: a shared worker requires a text prompt')
      }
      const options = promptOptionsFromAgentTurnInput(input)
      if (released) throw new ValidationError('sharedBoxPlacement: this worker was released')
      if (turnActive) {
        throw new ValidationError('sharedBoxPlacement: a worker runs one turn at a time')
      }
      const turnProfile =
        options?.backend?.profile === undefined
          ? createProfile
          : agentProfileSchema.parse(options.backend.profile)
      if (
        canonicalAgentProfileDigest(turnProfile) !== canonicalAgentProfileDigest(createProfile) &&
        sharedBoxRefusal(turnProfile) !== undefined
      ) {
        throw new ValidationError(`sharedBoxPlacement: ${sharedBoxRefusal(turnProfile)}`)
      }
      if (options?.backend?.type !== undefined && options.backend.type !== HARNESS) {
        throw new ValidationError(
          `sharedBoxPlacement: backend ${options.backend.type} is not ${HARNESS}`,
        )
      }
      turnActive = true
      try {
        yield* turn(message, turnProfile, options)
      } finally {
        turnActive = false
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
    async placement() {
      return { kind: 'sandbox', sandboxId: box.id }
    },
    async refresh(): Promise<void> {},
    async destroy(): Promise<void> {
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
  turnModel: TurnModelRouting | undefined,
  clientName: string | undefined,
  continueSession?: string,
): Promise<{ args: string[]; config: string; model: string }> {
  const refusal = sharedBoxRefusal(profile)
  if (refusal !== undefined) throw new ValidationError(`sharedBoxPlacement: ${refusal}`)
  if (
    turnModel?.cliAuth !== undefined ||
    turnModel?.authFiles !== undefined ||
    turnModel?.authMode === 'oauth'
  ) {
    throw new ValidationError('sharedBoxPlacement: a shared worker cannot carry native credentials')
  }
  const plan = materializeProfile(profile, HARNESS)
  let generated: Record<string, unknown> = {}
  for (const file of plan.files) {
    if (file.relPath === 'opencode.json' && file.source === 'generated') {
      generated = JSON.parse(file.content) as Record<string, unknown>
      continue
    }
    // A continued session keeps the directory as the worker left it.
    if (continueSession === undefined) {
      await box.fs.write(`${paths.dir}/${file.relPath}`, file.content)
    }
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
  if (continueSession !== undefined && !/^[A-Za-z0-9_-]+$/u.test(continueSession)) {
    throw new ValidationError(`sharedBoxPlacement: session id ${continueSession} is not opencode's`)
  }
  return {
    args: [
      invocation.command,
      ...invocation.args,
      ...(continueSession === undefined ? [] : ['--session', continueSession]),
      '--format',
      'json',
      '-m',
      model,
    ],
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

// ── opencode `run --format json` to environment events ──────────────────────────────────

interface OpencodeLine {
  readonly type?: string
  readonly sessionID?: string
  readonly part?: Record<string, unknown>
  readonly error?: unknown
}

/**
 * Translate opencode's JSON event lines into events the provider executor reads.
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
  let spentTokens = false
  const failureOf = (exitCode: number, stderr: string): string | undefined => {
    if (exitCode !== 0) {
      // opencode prints the provider's refusal as a JSON error line and exits 1, so the line's
      // text is the reason; stderr adds what the process itself said.
      const said = [...errors, stderr.trim().slice(-1_000)].filter((text) => text.length > 0)
      return `opencode exited ${exitCode}${said.length > 0 ? `: ${said.join('; ')}` : ''}`
    }
    return errors.length > 0 && finalMessageId === undefined ? errors.join('; ') : undefined
  }
  return {
    sessionId: () => sessionId,
    subagentSessionIds: (): readonly string[] => [...subagentSessions],
    /** Why this run failed, or `undefined` when it answered. */
    failure: failureOf,
    /** Whether this run spent any model tokens before it ended. */
    madeProgress: () => spentTokens,
    *line(raw: string): Generator<AgentEnvironmentEvent> {
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
        yield { type: 'error', data: { message } }
        return
      }
      const part = event.part
      if (part === undefined || part === null || typeof part !== 'object') return
      const subagent = subagentSessionOf(part)
      if (subagent !== undefined) subagentSessions.add(subagent)
      yield { type: 'message.part.updated', data: { part } }
      const messageId = typeof part.messageID === 'string' ? part.messageID : undefined
      if (part.type === 'text' && messageId !== undefined && typeof part.text === 'string') {
        const texts = textByMessage.get(messageId) ?? []
        texts.push(part.text)
        textByMessage.set(messageId, texts)
      }
      if (part.type === 'step-finish') {
        if (messageId !== undefined) finalMessageId = messageId
        const receipt = stepReceipt(part, model)
        if (receipt !== undefined) {
          const data = (receipt as { data?: { tokensIn?: number; tokensOut?: number } }).data
          if ((data?.tokensIn ?? 0) > 0 || (data?.tokensOut ?? 0) > 0) spentTokens = true
          yield receipt
        }
      }
    },
    /** The turn's terminal frames, from its last run. `runs` counts the runs of the session. */
    *finish(exitCode: number, stderr: string, runs = 1): Generator<AgentEnvironmentEvent> {
      const finalText =
        (finalMessageId === undefined ? undefined : textByMessage.get(finalMessageId)?.join('')) ??
        ''
      const failure = failureOf(exitCode, stderr)
      const counted = {
        ...(malformed > 0 ? { malformedLines: malformed } : {}),
        ...(runs > 1 ? { sessionRuns: runs } : {}),
      }
      if (failure !== undefined) {
        yield {
          type: 'result',
          data: { success: false, status: 'failed', error: failure, finalText, ...counted },
        }
        yield { type: 'done', data: { outcome: { type: 'failed' } } }
        return
      }
      yield {
        type: 'result',
        data: { success: true, finalText, ...counted },
      }
      yield { type: 'done', data: { outcome: { type: 'completed' } } }
    },
  }
}

function stepReceipt(
  part: Record<string, unknown>,
  model: string,
): AgentEnvironmentEvent | undefined {
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
    usageMode: 'delta',
    ...(known
      ? {
          usage: {
            inputTokens: input + cacheRead + cacheWrite,
            outputTokens: output + reasoning,
            ...(reasoning > 0 ? { reasoningTokens: reasoning } : {}),
          },
        }
      : {}),
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
  }
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error !== null && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const data = record.data as Record<string, unknown> | undefined
    const text =
      typeof data?.message === 'string'
        ? data.message
        : typeof record.message === 'string'
          ? record.message
          : typeof record.name === 'string'
            ? record.name
            : 'opencode reported an error'
    // opencode reports a provider's HTTP refusal with its status and a prose message; the router's
    // own code does not survive into that message ("Inference temporarily unavailable" for a
    // refused flash on 2026-09-24). The status, in the `status code <n>` framing, is what tells a
    // capacity refusal (429, 503, 529) from a wrong request.
    const status = data?.statusCode
    return typeof status === 'number' && Number.isSafeInteger(status)
      ? `${text} (status code ${status})`
      : text
  }
  return 'opencode reported an error'
}
