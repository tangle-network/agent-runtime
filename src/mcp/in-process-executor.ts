import { randomUUID } from 'node:crypto'
import type { AgentProfile, InputPart } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentTurnInput,
} from '@tangle-network/agent-interface/environment-provider'
import type { DelegationExecutor } from './executor'
import type { LocalHarness } from './local-harness'
import type { GitRunner, WorktreeHandle } from './worktree'
import { runWorktreeHarness } from './worktree-harness'

export interface InProcessExecutorOptions {
  repoRoot: string
  harnesses?: ReadonlyArray<LocalHarness>
  testCmd?: string
  typecheckCmd?: string
  harnessTimeoutMs?: number
  postCheckTimeoutMs?: number
  runGit?: GitRunner
  runHarness?: typeof import('./local-harness').runLocalHarness
  runPostCheck?: (
    command: string,
    cwd: string,
    signal?: AbortSignal,
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>
}

const DEFAULT_HARNESS_TIMEOUT_MS = 5 * 60 * 1_000
const DEFAULT_POSTCHECK_TIMEOUT_MS = 2 * 60 * 1_000

/** Run delegated coding workers as local processes in isolated git worktrees. */
export function createInProcessExecutor(options: InProcessExecutorOptions): DelegationExecutor {
  const harnesses =
    options.harnesses && options.harnesses.length > 0
      ? [...options.harnesses]
      : (['claude-code'] as const)
  const runPostCheck = options.runPostCheck ?? defaultRunPostCheck
  let callIndex = 0

  const provider: AgentEnvironmentProvider = {
    name: 'worktree-process',
    capabilities: () => inProcessCapabilities(),
    async create(input): Promise<AgentEnvironment> {
      const runId = randomUUID()
      const worker = harnesses[callIndex % harnesses.length] as LocalHarness
      callIndex += 1
      const profile = inlineProfile(input.profile, worker)
      let worktree: WorktreeHandle | undefined

      return {
        id: `worktree-${runId}`,
        provider: 'worktree-process',
        status: async () => 'running',
        async *stream(turn: AgentTurnInput): AsyncIterable<AgentEnvironmentEvent> {
          const result = await runWorktreeHarness({
            repoRoot: options.repoRoot,
            profile,
            harness: worker,
            taskPrompt: promptFromTurn(turn),
            runId,
            harnessTimeoutMs: options.harnessTimeoutMs ?? DEFAULT_HARNESS_TIMEOUT_MS,
            checkTimeoutMs: options.postCheckTimeoutMs ?? DEFAULT_POSTCHECK_TIMEOUT_MS,
            ...(options.testCmd !== undefined ? { testCmd: options.testCmd } : {}),
            ...(options.typecheckCmd !== undefined ? { typecheckCmd: options.typecheckCmd } : {}),
            ...(options.runGit ? { runGit: options.runGit } : {}),
            ...(options.runHarness ? { runHarness: options.runHarness } : {}),
            runCommand: async ({ command, cwd, signal }) => {
              try {
                const check = await runPostCheck(command, cwd, signal)
                return {
                  exitCode: check.exitCode,
                  output: check.stderr || check.stdout,
                }
              } catch (error) {
                return {
                  exitCode: -1,
                  output: error instanceof Error ? error.message : String(error),
                }
              }
            },
            ...(turn.signal ? { signal: turn.signal } : {}),
          })
          worktree = result.worktree

          try {
            yield {
              type: 'worktree.worker.started',
              data: {
                runId,
                worker,
                worktreePath: result.worktree.path,
              },
            }
            const process = result.result.harness
            yield {
              type: 'worktree.worker.completed',
              data: {
                runId,
                exitCode: process.exitCode,
                durationMs: process.durationMs,
                killedBySignal: process.killedBySignal,
                timedOut: process.timedOut,
                stdoutBytes: process.stdout.length,
                stderrBytes: process.stderr.length,
              },
            }
            yield {
              type: 'result',
              data: {
                result: result.result,
                source: 'worktree-process',
                worker,
                runId,
              },
            }
          } finally {
            await result.cleanup()
          }
        },
        placement: async () => ({
          kind: 'local',
          providerMetadata: {
            worker,
            ...(worktree ? { worktreePath: worktree.path } : {}),
          },
        }),
        destroy: async () => {},
      }
    },
  }

  return {
    provider,
    placement: 'local',
    describe(): string {
      return `local worktrees (repo=${options.repoRoot}, workers=[${harnesses.join(',')}])`
    },
  }
}

function inlineProfile(profile: AgentProfile | string, worker: LocalHarness): AgentProfile {
  if (typeof profile !== 'string') return profile
  throw new Error(
    `worktree-process provider requires an inline profile; received catalog id "${profile}" for ${worker}`,
  )
}

function promptFromTurn(input: AgentTurnInput): string {
  if (input.prompt !== undefined) return input.prompt
  return (input.parts ?? [])
    .map((part: InputPart) =>
      typeof part === 'object' && part && 'text' in part ? String(part.text) : '',
    )
    .join('\n')
}

function inProcessCapabilities(): AgentEnvironmentCapabilities {
  return {
    profile: {
      namedProfiles: false,
      systemPrompt: true,
      instructions: true,
      tools: true,
      permissions: true,
      mcp: true,
      subagents: true,
      resources: {
        files: true,
        instructions: true,
        tools: true,
        skills: true,
        agents: true,
        commands: true,
      },
      hooks: true,
      modes: true,
      runtimeUpdate: false,
      validation: false,
    },
    streaming: {
      live: true,
      replay: false,
      detach: false,
      turnIdempotency: false,
    },
    sessions: { continue: false, list: false, messages: false },
    workspace: {
      read: false,
      write: false,
      exec: false,
      git: true,
      upload: false,
      download: false,
    },
    branching: { checkpoint: false, fork: false },
    placement: true,
    usage: false,
    confidential: false,
  }
}

async function defaultRunPostCheck(
  command: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { spawn } = await import('node:child_process')
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', command], { cwd, stdio: 'pipe' })
    let stdout = ''
    let stderr = ''
    let onAbort: (() => void) | undefined
    const timeout = setTimeout(() => child.kill('SIGTERM'), DEFAULT_POSTCHECK_TIMEOUT_MS)
    timeout.unref()

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    if (signal) {
      onAbort = () => child.kill('SIGTERM')
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    child.on('error', (error) => {
      clearTimeout(timeout)
      if (onAbort) signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (onAbort) signal?.removeEventListener('abort', onAbort)
      resolve({ exitCode: code ?? -1, stdout, stderr })
    })
  })
}
