import {
  type AgentProfile,
  type AgentProfileMcpServer,
  canonicalCandidateDigest,
  ProxySecretsSchema,
} from '@tangle-network/agent-interface'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { ValidationError } from '../../errors'
import type { WorkerSpawnContext } from '../../mcp/tools/coordination-contracts'
import { COORDINATION_CLIENT_TOOL_TIMEOUT_MS } from '../../mcp/tools/coordination-request-context'
import type { CoordinationMcpHandle } from './coordination-mcp'
import { errorHttpStatus } from './error-message'
import type { ExecutorConfig } from './runtime'
import type { DriverSessionState } from './supervise-driver-session'

export const peerMailMcpAlias = 'agent-runtime-peer-mail'

export function peerMailRuntimeAttachment(
  profile: AgentProfile,
  backend: ExecutorConfig,
  spawnContext: Pick<WorkerSpawnContext, 'peerMailUrl'> | undefined,
): Readonly<Record<string, AgentProfileMcpServer>> | undefined {
  const url = spawnContext?.peerMailUrl
  if (url === undefined || ['router', 'router-tools'].includes(backend.backend)) return undefined
  if (backend.backend === 'provider' && backend.shared)
    throw new ValidationError('provider peer mail requires a dedicated session')
  if (backend.backend !== 'provider' && backend.backend !== 'bridge')
    throw new ValidationError('peer mail requires a provider or bridge runtime attachment')
  if (profile.mcp?.[peerMailMcpAlias] !== undefined)
    throw new ValidationError('profile MCP alias agent-runtime-peer-mail is reserved')
  return Object.freeze({
    [peerMailMcpAlias]: Object.freeze({ transport: 'http', url }) as AgentProfileMcpServer,
  })
}

export const CLAUDE_CODE_ONE_HOUR_CACHE = 'ENABLE_PROMPT_CACHING_1H'

export async function storeCoordinationSecret(
  provider: AgentEnvironmentProvider,
  secrets: NonNullable<DriverSessionState['coordinationSecrets']>,
  name: string,
  bind: CoordinationMcpHandle['bindCredential'],
  policy: Pick<AgentProfile, 'proxySecrets'>,
): Promise<Pick<AgentProfile, 'proxySecrets'>> {
  const store = provider.secrets
  if (!store?.update || !store.list || !bind)
    throw new ValidationError('provider coordination requires acknowledged fenced secret renewal')
  const stamp = (receipt: unknown): string => {
    const date = (receipt as { updatedAt?: Date } | null)?.updatedAt
    if (!(date instanceof Date) || !Number.isFinite(date.getTime()))
      throw new ValidationError('provider secret receipt has no valid updatedAt')
    return date.toISOString()
  }
  let revision: string | undefined
  const prior = secrets.get(name)
  if (prior?.binding === bind && prior.ready) return prior.policy
  if (prior?.binding === bind) throw new ValidationError('coordination binding is not ready')
  await prior?.stop()
  const entry = {
    policy,
    ready: false,
    binding: bind,
    stop: async () => {},
    release: async () => {
      const [stopped] = await Promise.allSettled([entry.stop()])
      try {
        if (revision) await store.delete(name, { expectedUpdatedAt: revision })
        else if ((await store.list!()).some((secret) => secret.name === name))
          throw new ValidationError('coordination custody has no acknowledged owned revision')
      } catch (error) {
        if (!(error instanceof Error) || errorHttpStatus(error) !== 404) throw error
      }
      secrets.delete(name)
      if (stopped.status === 'rejected') throw stopped.reason
    },
  }
  secrets.set(name, entry)
  try {
    entry.stop = await bind(async (headers) => {
      const value = headers.Authorization!.slice(7)
      let expectedUpdatedAt = revision
      if (!expectedUpdatedAt) {
        try {
          revision = stamp(await store.create(name, value, entry.policy))
          return
        } catch (error) {
          if (!(error instanceof Error) || errorHttpStatus(error) !== 409) throw error
          const stored = (await store.list!()).find((s) => s.name === name)
          expectedUpdatedAt = stamp(stored)
          if (stored?.proxySecrets !== undefined) {
            const recovered = ProxySecretsSchema.parse(stored.proxySecrets)
            const authority = (bindings: AgentProfile['proxySecrets']) =>
              canonicalCandidateDigest(bindings?.map(({ ttlSeconds: _, ...binding }) => binding))
            if (authority(recovered) !== authority(policy.proxySecrets))
              throw new ValidationError('stored coordination policy has different authority')
            entry.policy = { proxySecrets: recovered }
          }
        }
      }
      revision = stamp(await store.update!(name, value, { ...entry.policy, expectedUpdatedAt }))
    })
    entry.ready = true
    return entry.policy
  } catch (cause) {
    await entry.release().catch((cleanup) => {
      throw new AggregateError([cause, cleanup], 'coordination binding and cleanup failed')
    })
    throw cause
  }
}

export function coordinationRuntimeAttachment(url: string, key: string) {
  return {
    transport: 'http' as const,
    url,
    headers: { Authorization: { kind: 'secret-ref' as const, key, format: 'bearer' as const } },
    metadata: { toolTimeoutMs: COORDINATION_CLIENT_TOOL_TIMEOUT_MS },
  }
}
