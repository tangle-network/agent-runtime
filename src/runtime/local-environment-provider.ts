import {
  type AgentProfile,
  type AgentProfileSecurityPolicy,
  type AgentProfileValidationResult,
  canonicalCandidateDigest,
  renderInputPartsAsText,
  validateAgentProfileSecurity,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentEnvironmentStatus,
  AgentTurnInput,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import { ValidationError } from '../errors'
import type { KeyProvider } from './key-provider'
import { routerBrain } from './router-client'
import { materializeLocalMcp } from './stdio-mcp-client'
import { runBrainLoop, type ToolLoopChat } from './tool-loop'
import { throwAbort, throwIfAborted } from './util'

export interface LocalEnvironmentProviderOptions {
  /** Router model used by the same-host tool loop. */
  router: { baseUrl: string; key: string; model: string }
  /** Tool-loop turns per request. Default 8. */
  maxTurns?: number
  /** Router sampling temperature. */
  temperature?: number
  /** Fixed profile whose exact bytes may receive local-process trust. */
  trustedProfile?: AgentProfile
  /** Resolves profile-declared MCP secrets when child processes start. */
  keys?: KeyProvider
  /** Local-process policy for the exact `trustedProfile` bytes. */
  profileSecurityPolicy?: AgentProfileSecurityPolicy
  /** Provider name reported by environments. Default `local`. */
  name?: string
}

/**
 * Run trusted stdio MCP tools and a router model on the current host.
 *
 * This provider offers no process isolation. A policy that permits local MCP
 * requires an exact constructor-time profile; different profile bytes fail.
 */
export function localEnvironmentProvider(
  options: LocalEnvironmentProviderOptions,
): AgentEnvironmentProvider {
  const providerName = options.name ?? 'local'
  if (providerName.trim().length === 0) {
    throw new ValidationError('local environment provider name must be non-empty')
  }
  validateLocalOptions(providerName, options)
  if (options.profileSecurityPolicy?.allowLocalMcp && options.trustedProfile === undefined) {
    throw new ValidationError(
      `${providerName}: allowLocalMcp requires a fixed author-controlled trustedProfile`,
    )
  }
  const trustedProfileDigest =
    options.profileSecurityPolicy?.allowLocalMcp && options.trustedProfile !== undefined
      ? canonicalCandidateDigest(options.trustedProfile)
      : undefined
  const maxTurns = options.maxTurns ?? 8
  let sequence = 0

  const validateProfile = (profile: AgentProfile | string): AgentProfileValidationResult => {
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
    const security = validateAgentProfileSecurity(
      profile,
      policyForProfile(profile, options.profileSecurityPolicy, trustedProfileDigest),
    )
    const unsupportedRemoteMcp = Object.entries(profile.mcp ?? {})
      .filter(([, server]) => server.enabled !== false && (server.transport ?? 'stdio') !== 'stdio')
      .map(([name, server]) => ({
        level: 'error' as const,
        code: 'remote_mcp_unsupported',
        message: `${providerName}: MCP server "${name}" uses unsupported ${server.transport} transport`,
        path: `mcp.${name}.transport`,
      }))
    const issues = [...security.issues, ...unsupportedRemoteMcp]
    return {
      ok: !issues.some((issue) => issue.level === 'error'),
      issues,
      normalizedProfile: profile,
    }
  }

  return {
    name: providerName,
    capabilities: localCapabilities,
    validateProfile,
    async create(input: CreateAgentEnvironmentInput): Promise<AgentEnvironment> {
      throwIfAborted(input.signal)
      const validation = validateProfile(input.profile)
      const profile = validatedProfile(providerName, input.profile, validation)
      const policy = policyForProfile(profile, options.profileSecurityPolicy, trustedProfileDigest)
      const mcp = await materializeLocalMcp(profile, {
        ...(options.keys ? { keys: options.keys } : {}),
        ...(policy ? { profileSecurityPolicy: policy } : {}),
      })
      if (input.signal?.aborted) {
        await mcp.close()
        throwAbort()
      }

      const brain: ToolLoopChat = routerBrain(
        {
          routerBaseUrl: options.router.baseUrl,
          routerKey: options.router.key,
          model: options.router.model,
        },
        options.temperature !== undefined ? { temperature: options.temperature } : {},
      )
      const system = [profile.prompt?.systemPrompt, ...(profile.prompt?.instructions ?? [])]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join('\n\n')
      const id = `local-${sequence++}`
      const environmentController = new AbortController()
      let destroyed = false
      let destroyPromise: Promise<void> | undefined

      const destroy = (): Promise<void> => {
        if (destroyPromise) return destroyPromise
        destroyed = true
        environmentController.abort()
        destroyPromise = Promise.resolve().then(() => mcp.close())
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
          if (destroyed) {
            throw new ValidationError(`${providerName}: environment has been destroyed`)
          }
          const signal = combinedSignal(environmentController.signal, turn.signal)
          throwIfAborted(signal)
          let costUsd = 0
          let costKnown = true
          const meteredBrain: ToolLoopChat = async (messages, tools) => {
            throwIfAborted(signal)
            const result = await brain(messages, tools)
            if (result.costUsd === undefined) costKnown = false
            else costUsd += result.costUsd
            throwIfAborted(signal)
            return result
          }
          try {
            const result = await runBrainLoop({
              chat: meteredBrain,
              tools: mcp.tools,
              execute: (name, args) => mcp.call(name, args),
              initialMessages: [
                ...(system ? [{ role: 'system', content: system }] : []),
                { role: 'user', content: turnText(turn) },
              ],
              maxTurns,
              hooks: { stopBefore: () => signal.aborted },
            })
            throwIfAborted(signal)
            yield {
              type: 'llm_call',
              data: {
                tokensIn: result.usage.input,
                tokensOut: result.usage.output,
                ...(costKnown ? { costUsd } : {}),
              },
              usage: {
                inputTokens: result.usage.input,
                outputTokens: result.usage.output,
                ...(costKnown ? { cost: costUsd } : {}),
              },
            }
            yield {
              type: 'result',
              data: {
                finalText: result.final,
                tokenUsage: {
                  inputTokens: result.usage.input,
                  outputTokens: result.usage.output,
                },
                ...(costKnown ? { costUsd } : {}),
              },
            }
          } catch (error) {
            if (signal.aborted) throwAbort()
            throw error
          }
        },
        async placement() {
          return { kind: 'local' }
        },
        destroy,
      }

      return environment
    },
  }
}

function localCapabilities(): AgentEnvironmentCapabilities {
  return {
    profile: {
      namedProfiles: false,
      systemPrompt: true,
      instructions: true,
      tools: false,
      permissions: false,
      mcp: true,
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
    streaming: { live: false, replay: false, detach: false, turnIdempotency: false },
    sessions: { continue: false, list: false, messages: false },
    workspace: {
      read: false,
      write: false,
      exec: false,
      git: false,
      upload: false,
      download: false,
    },
    branching: { checkpoint: false, fork: false },
    placement: true,
    usage: true,
    confidential: false,
  }
}

function policyForProfile(
  profile: AgentProfile,
  policy: AgentProfileSecurityPolicy | undefined,
  trustedProfileDigest: string | undefined,
): AgentProfileSecurityPolicy | undefined {
  if (!policy?.allowLocalMcp) return policy
  if (
    trustedProfileDigest !== undefined &&
    canonicalCandidateDigest(profile) === trustedProfileDigest
  ) {
    return policy
  }
  return { ...policy, allowLocalMcp: false }
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

function turnText(input: AgentTurnInput): string {
  if (input.prompt !== undefined) return input.prompt
  return input.parts ? renderInputPartsAsText(input.parts) : ''
}

function combinedSignal(parent: AbortSignal, child?: AbortSignal): AbortSignal {
  return child ? AbortSignal.any([parent, child]) : parent
}

function validateLocalOptions(
  providerName: string,
  options: LocalEnvironmentProviderOptions,
): void {
  if (
    !options.router.baseUrl.trim() ||
    !options.router.key.trim() ||
    !options.router.model.trim()
  ) {
    throw new ValidationError(
      `${providerName}: router.baseUrl, router.key, and router.model are required`,
    )
  }
  if (
    options.maxTurns !== undefined &&
    (!Number.isInteger(options.maxTurns) || options.maxTurns <= 0)
  ) {
    throw new ValidationError(`${providerName}: maxTurns must be a positive integer`)
  }
  if (options.temperature !== undefined && !Number.isFinite(options.temperature)) {
    throw new ValidationError(`${providerName}: temperature must be finite`)
  }
}
