/**
 * Executor for workers that must mutate the same Terminal-Bench container the grader inspects.
 *
 * The container lifecycle stays owned by Terminal-Bench. This executor only runs a command in the
 * provided container id and reports the captured process artifact back through the runtime.
 */
import { spawn } from 'node:child_process'
import { agentProfileSchema } from '@tangle-network/agent-interface'
import type {
  Agent,
  AgentProfile,
  AgentSpec,
  Executor,
  ExecutorContext,
  ExecutorFactory,
  ExecutorResult,
  MakeWorkerAgent,
  Runtime,
  Spend,
} from '../../src/runtime/index'
import { harnessInvocation, type LocalHarness } from '../../src/mcp/local-harness'
import { assertExecutableAgentProfile } from '../../src/runtime/supervise/model-policy'

export interface TbExecOutput {
  /** Primary artifact consumed by drivers that read `{ content }`. */
  readonly content: string
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
  readonly containerId: string
  readonly command: string
}

export type ParseUsage = (io: {
  stdout: string
  stderr: string
  exitCode: number | null
}) => { input: number; output: number; usd?: number } | undefined

export interface TbContainerConfig {
  readonly containerId?: string
  readonly containerEnvVar?: string
  readonly workdir?: string
  readonly shell?: string
  readonly env?: Readonly<Record<string, string>>
  /** Shell setup required inside the existing task container before the canonical invocation. */
  readonly commandPrefix?: ReadonlyArray<string>
  readonly parseUsage?: ParseUsage
  readonly budgetExempt?: boolean
  readonly dockerBin?: string
  readonly failOnNonZeroExit?: boolean
  readonly runtime?: Runtime
}

const DEFAULT_ENV_VAR = 'TB_TARGET_CONTAINER'

function resolveContainerId(config: TbContainerConfig): string {
  const envVar = config.containerEnvVar ?? DEFAULT_ENV_VAR
  const id = config.containerId ?? process.env[envVar]
  if (!id || id.trim().length === 0) {
    throw new Error(
      `tbContainerExecutor: no target container - set config.containerId or the ${envVar} env var ` +
        `to the id of the terminal-bench container the verifier grades.`,
    )
  }
  return id.trim()
}

function taskToPrompt(task: unknown): string {
  if (typeof task === 'string') return task
  if (task && typeof task === 'object') {
    const obj = task as Record<string, unknown>
    for (const k of ['command', 'prompt', 'content', 'task', 'message']) {
      if (typeof obj[k] === 'string') return obj[k] as string
    }
  }
  return JSON.stringify(task)
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function profileCommand(
  profile: AgentProfile,
  task: unknown,
  prefix: ReadonlyArray<string> = [],
): string {
  const harness = profile.harness
  if (harness !== 'claude-code' && harness !== 'codex' && harness !== 'opencode') {
    throw new Error(
      `tbContainerExecutor: profile harness ${JSON.stringify(harness)} is not available in the task container`,
    )
  }
  const invocation = harnessInvocation(
    harness as LocalHarness,
    profile,
    taskToPrompt(task),
    { dangerouslySkipPermissions: true },
  )
  const run = [invocation.command, ...invocation.args].map(shellQuote).join(' ')
  return [...prefix, `exec ${run}`].join('; ')
}

/**
 * Compose the `docker exec` argv that runs `command` inside `containerId` via `<shell> -c`.
 * Exported so tests can verify the container path without a live Docker daemon.
 */
export function buildTbDockerExecArgs(
  containerId: string,
  command: string,
  opts: { shell?: string; workdir?: string; env?: Readonly<Record<string, string>> } = {},
): string[] {
  const out: string[] = ['exec', '-i']
  if (opts.workdir) out.push('--workdir', opts.workdir)
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      if (typeof v !== 'string' || v.length === 0) continue
      out.push('-e', `${k}=${v}`)
    }
  }
  out.push(containerId, opts.shell ?? '/bin/sh', '-c', command)
  return out
}

function contentRef(prefix: string, value: unknown): string {
  let str: string
  try {
    str = JSON.stringify(value) ?? String(value)
  } catch {
    str = String(value)
  }
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${prefix}:${(h >>> 0).toString(16).padStart(8, '0')}`
}

export function createTbContainerExecutor(
  config: TbContainerConfig = {},
): ExecutorFactory<TbExecOutput> {
  return (_spec: AgentSpec, ctx: ExecutorContext): Executor<TbExecOutput> => {
    const profile = agentProfileSchema.parse(_spec.profile)
    assertExecutableAgentProfile(profile, 'tbContainerExecutor')
    const containerId = resolveContainerId(config)
    const dockerBin = config.dockerBin ?? 'docker'
    const metered = config.parseUsage !== undefined
    const budgetExempt = config.budgetExempt ?? !metered
    const runtime: Runtime = config.runtime ?? 'tb-container'

    const controller = new AbortController()
    const abortIfSignalled = () => {
      if (ctx.signal.aborted) controller.abort()
    }
    abortIfSignalled()
    if (!ctx.signal.aborted) ctx.signal.addEventListener('abort', abortIfSignalled, { once: true })

    let proc: ReturnType<typeof spawn> | undefined
    let artifact: ExecutorResult<TbExecOutput> | undefined

    return {
      runtime,
      budgetExempt,
      execute(task, signal): Promise<ExecutorResult<TbExecOutput>> {
        const command = profileCommand(profile, task, config.commandPrefix)
        const args = buildTbDockerExecArgs(containerId, command, {
          ...(config.shell ? { shell: config.shell } : {}),
          ...(config.workdir ? { workdir: config.workdir } : {}),
          ...(config.env ? { env: config.env } : {}),
        })
        const started = Date.now()

        return new Promise<ExecutorResult<TbExecOutput>>((resolve, reject) => {
          const child = spawn(dockerBin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
          proc = child

          const kill = () => {
            if (child.exitCode === null && !child.killed) child.kill('SIGKILL')
          }
          if (signal.aborted || controller.signal.aborted) kill()
          else {
            signal.addEventListener('abort', kill, { once: true })
            controller.signal.addEventListener('abort', kill, { once: true })
          }

          const outChunks: string[] = []
          const errChunks: string[] = []
          child.stdout?.on('data', (d: Buffer) => outChunks.push(d.toString('utf8')))
          child.stderr?.on('data', (d: Buffer) => errChunks.push(d.toString('utf8')))

          child.once('error', (err) => {
            signal.removeEventListener('abort', kill)
            controller.signal.removeEventListener('abort', kill)
            reject(
              new Error(
                `tbContainerExecutor: failed to spawn '${dockerBin} exec' on ${containerId}: ${err.message}`,
                { cause: err },
              ),
            )
          })

          child.once('close', (code) => {
            signal.removeEventListener('abort', kill)
            controller.signal.removeEventListener('abort', kill)
            const stdout = outChunks.join('')
            const stderr = errChunks.join('')
            const exitCode = code

            if (config.failOnNonZeroExit && exitCode !== 0) {
              reject(
                new Error(
                  `tbContainerExecutor: command exited ${exitCode} in ${containerId}: ${stderr.slice(0, 200)}`,
                ),
              )
              return
            }

            const out: TbExecOutput = { content: stdout, stdout, stderr, exitCode, containerId, command }
            const usage = config.parseUsage?.({ stdout, stderr, exitCode })
            const spent: Spend = metered
              ? {
                  iterations: 1,
                  tokens: { input: usage?.input ?? 0, output: usage?.output ?? 0 },
                  usd: usage?.usd ?? 0,
                  ms: Date.now() - started,
                }
              : // Budget-exempt commands report no conserved token, dollar, or iteration spend.
                { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: Date.now() - started }

            artifact = { outRef: contentRef(String(runtime), out), out, spent }
            resolve(artifact)
          })
        })
      },
      teardown(_grace): Promise<{ destroyed: boolean }> {
        controller.abort()
        if (proc && proc.exitCode === null && !proc.killed) proc.kill('SIGKILL')
        return Promise.resolve({ destroyed: true })
      },
      resultArtifact() {
        if (!artifact) {
          throw new Error('tbContainerExecutor: resultArtifact() read before execute() settled')
        }
        return artifact
      },
    }
  }
}

export function makeTbContainerWorkerAgent(config: TbContainerConfig = {}): MakeWorkerAgent {
  const factory = createTbContainerExecutor(config)
  return (rawProfile) => {
    const profile = agentProfileSchema.parse(rawProfile)
    assertExecutableAgentProfile(profile, 'tbContainerWorkerAgent')
    const name = profile.name ?? 'tb-worker'
    const spec: AgentSpec = { profile, harness: null }
    const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
    const executor = factory(spec, ctx)
    return { name, act: async () => '', executorSpec: { ...spec, executor } } as Agent<
      unknown,
      unknown
    > & { executorSpec: AgentSpec }
  }
}
