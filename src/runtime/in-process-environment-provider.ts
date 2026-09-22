import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  type AgentProfile,
  type AgentProfileValidationResult,
  renderInputPartsAsText,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentEnvironmentStatus,
  AgentTurnInput,
  CreateAgentEnvironmentInput,
  ExecRequest,
  ExecResult,
} from '@tangle-network/agent-interface/environment-provider'
import { ValidationError } from '../errors'
import { throwAbort, throwIfAborted } from './util'

/** Context passed to an in-process turn callback. */
export interface InProcessTurnContext {
  /** Zero-based turn index within one environment. */
  round: number
  /** Temporary workspace path when `workspacePrefix` is configured. */
  workdir?: string
  /** Combined environment and turn cancellation signal. */
  signal: AbortSignal
  /** Full portable turn input. */
  input: Readonly<AgentTurnInput>
  /** Validated inline profile used to create the environment. */
  profile: Readonly<AgentProfile>
}

export type InProcessTurnEvents =
  | readonly AgentEnvironmentEvent[]
  | AsyncIterable<AgentEnvironmentEvent>

/** Produces one environment event stream without network access. */
export type InProcessOnTurn = (
  prompt: string,
  context: InProcessTurnContext,
) => InProcessTurnEvents | Promise<InProcessTurnEvents>

export interface InProcessEnvironmentProviderOptions {
  onTurn: InProcessOnTurn
  /** Create one temporary workspace per environment with this prefix. */
  workspacePrefix?: string
  /** Override generated environment ids. */
  id?: string | ((sequence: number) => string)
  /** Provider name reported by environments. Default `in-process`. */
  name?: string
  /** Additional inline-profile validation for test-specific constraints. */
  validateProfile?: (
    profile: AgentProfile,
  ) => AgentProfileValidationResult | Promise<AgentProfileValidationResult>
}

/**
 * Create a deterministic provider backed by one callback.
 *
 * Each environment owns its turn counter and optional temporary workspace.
 * Named profiles fail because this provider has no profile catalog.
 * Callbacks and commands run on the current host without isolation.
 */
export function inProcessEnvironmentProvider(
  options: InProcessEnvironmentProviderOptions,
): AgentEnvironmentProvider {
  const providerName = options.name ?? 'in-process'
  validateName('provider', providerName)
  validateWorkspacePrefix(providerName, options.workspacePrefix)
  let sequence = 0
  const environments = new Map<string, AgentEnvironment>()

  const validateProfile = async (
    profile: AgentProfile | string,
  ): Promise<AgentProfileValidationResult> => {
    if (typeof profile === 'string') {
      return {
        ok: false,
        issues: [
          {
            level: 'error',
            code: 'named_profile_unsupported',
            message: `${providerName}: named profiles require a provider catalog`,
          },
        ],
      }
    }
    return (
      (await options.validateProfile?.(profile)) ?? {
        ok: true,
        issues: [],
        normalizedProfile: profile,
      }
    )
  }

  return {
    name: providerName,
    capabilities: () => inProcessCapabilities(options.workspacePrefix !== undefined),
    validateProfile,
    async create(input: CreateAgentEnvironmentInput): Promise<AgentEnvironment> {
      throwIfAborted(input.signal)
      const validation = await validateProfile(input.profile)
      const profile = validatedProfile(providerName, input.profile, validation)
      throwIfAborted(input.signal)

      const current = sequence++
      const id =
        typeof options.id === 'function'
          ? options.id(current)
          : (options.id ?? `in-process-${current}`)
      validateName(`${providerName} environment`, id)

      const workdir =
        options.workspacePrefix !== undefined
          ? mkdtempSync(join(tmpdir(), `${options.workspacePrefix}-`))
          : undefined
      const environmentController = new AbortController()
      let destroyed = false
      let destroyPromise: Promise<void> | undefined
      let round = 0

      const destroy = (): Promise<void> => {
        if (destroyPromise) return destroyPromise
        destroyed = true
        environmentController.abort()
        environments.delete(id)
        destroyPromise = Promise.resolve().then(() => {
          if (workdir !== undefined) rmSync(workdir, { recursive: true, force: true })
        })
        return destroyPromise
      }

      const environment: AgentEnvironment = {
        id,
        provider: providerName,
        ...(input.name ? { name: input.name } : {}),
        async status(): Promise<AgentEnvironmentStatus> {
          return destroyed ? 'stopped' : 'running'
        },
        async *stream(turn: AgentTurnInput): AsyncIterable<AgentEnvironmentEvent> {
          assertRunning(providerName, destroyed)
          const signal = combinedSignal(environmentController.signal, turn.signal)
          throwIfAborted(signal)
          const turnInput = { ...turn, signal }
          const context: InProcessTurnContext = {
            round,
            ...(workdir ? { workdir } : {}),
            signal,
            input: turnInput,
            profile,
          }
          round += 1

          try {
            const produced = await options.onTurn(turnText(turn), context)
            throwIfAborted(signal)
            if (isAsyncIterable(produced)) {
              for await (const event of produced) {
                throwIfAborted(signal)
                yield event
              }
            } else {
              for (const event of produced) {
                throwIfAborted(signal)
                yield event
              }
            }
          } catch (error) {
            if (signal.aborted) throwAbort()
            throw error
          }
        },
        ...(workdir
          ? {
              async read(path: string): Promise<string> {
                assertRunning(providerName, destroyed)
                return readFile(workspacePath(providerName, workdir, path), 'utf8')
              },
              async write(path: string, content: string): Promise<void> {
                assertRunning(providerName, destroyed)
                const absolutePath = workspacePath(providerName, workdir, path)
                await mkdir(dirname(absolutePath), { recursive: true })
                await writeFile(absolutePath, content, 'utf8')
              },
              async exec(command: string, request: ExecRequest = {}): Promise<ExecResult> {
                assertRunning(providerName, destroyed)
                const signal = combinedSignal(environmentController.signal, request.signal)
                throwIfAborted(signal)
                const cwd = request.cwd
                  ? workspacePath(providerName, workdir, request.cwd)
                  : workdir
                const { exec } = await import('node:child_process')
                const { promisify } = await import('node:util')
                const execAsync = promisify(exec)
                try {
                  const { stdout, stderr } = await execAsync(command, {
                    cwd,
                    env: { ...process.env, ...request.env },
                    timeout: request.timeoutMs ?? 30_000,
                    signal,
                    encoding: 'utf8',
                  })
                  return { exitCode: 0, stdout, stderr }
                } catch (error) {
                  if (signal.aborted) throwAbort()
                  const failure = error as {
                    code?: number
                    stdout?: string
                    stderr?: string
                    message?: string
                  }
                  return {
                    exitCode: typeof failure.code === 'number' ? failure.code : 1,
                    stdout: failure.stdout ?? '',
                    stderr: failure.stderr ?? failure.message ?? '',
                  }
                }
              },
            }
          : {}),
        async placement() {
          return {
            kind: 'local',
            ...(workdir ? { providerMetadata: { workdir } } : {}),
          }
        },
        destroy,
      }

      environments.set(id, environment)
      return environment
    },
    async get(id) {
      return environments.get(id) ?? null
    },
  }
}

function inProcessCapabilities(hasWorkspace: boolean): AgentEnvironmentCapabilities {
  return {
    profile: {
      namedProfiles: false,
      systemPrompt: false,
      instructions: false,
      tools: false,
      permissions: false,
      mcp: false,
      subagents: false,
      resources: {
        files: false,
        instructions: false,
        tools: false,
        skills: false,
        agents: false,
        commands: false,
      },
      hooks: false,
      modes: false,
      runtimeUpdate: false,
      validation: true,
    },
    streaming: { live: true, replay: false, detach: false, turnIdempotency: false },
    sessions: { continue: true, list: false, messages: false },
    workspace: {
      read: hasWorkspace,
      write: hasWorkspace,
      exec: hasWorkspace,
      git: false,
      upload: false,
      download: false,
    },
    branching: { checkpoint: false, fork: false },
    placement: true,
    usage: false,
    confidential: false,
  }
}

function validatedProfile(
  providerName: string,
  profile: AgentProfile | string,
  validation: AgentProfileValidationResult,
): AgentProfile {
  if (!validation.ok || typeof profile === 'string') {
    const reasons = validation.issues
      .filter((issue) => issue.level === 'error')
      .map((issue) => issue.message)
      .join('; ')
    throw new ValidationError(`${providerName}: profile validation failed: ${reasons}`)
  }
  return validation.normalizedProfile ?? profile
}

function isAsyncIterable(
  value: InProcessTurnEvents,
): value is AsyncIterable<AgentEnvironmentEvent> {
  return typeof value === 'object' && value !== null && Symbol.asyncIterator in value
}

function turnText(input: AgentTurnInput): string {
  if (input.prompt !== undefined) return input.prompt
  return input.parts ? renderInputPartsAsText(input.parts) : ''
}

function combinedSignal(parent: AbortSignal, child?: AbortSignal): AbortSignal {
  return child ? AbortSignal.any([parent, child]) : parent
}

function assertRunning(providerName: string, destroyed: boolean): void {
  if (destroyed) {
    throw new ValidationError(`${providerName}: environment has been destroyed`)
  }
}

function workspacePath(providerName: string, workdir: string, path: string): string {
  const absolutePath = resolve(workdir, path)
  const relativePath = relative(workdir, absolutePath)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new ValidationError(`${providerName}: path escapes workspace: ${path}`)
  }
  return absolutePath
}

function validateWorkspacePrefix(providerName: string, prefix: string | undefined): void {
  if (
    prefix !== undefined &&
    (prefix.trim().length === 0 || prefix === '.' || prefix === '..' || /[/\\]/.test(prefix))
  ) {
    throw new ValidationError(`${providerName}: workspacePrefix must be a plain non-empty name`)
  }
}

function validateName(kind: string, value: string): void {
  if (value.trim().length === 0) {
    throw new ValidationError(`${kind} name must be non-empty`)
  }
}
