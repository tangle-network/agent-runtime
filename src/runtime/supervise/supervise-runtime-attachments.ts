import { isIP } from 'node:net'
import type { AgentProfile, AgentProfileMcpServer } from '@tangle-network/agent-interface'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { ValidationError } from '../../errors'
import type { WorkerSpawnContext } from '../../mcp/tools/coordination-contracts'
import { COORDINATION_CLIENT_TOOL_TIMEOUT_MS } from '../../mcp/tools/coordination-request-context'
import { resolveAgentEnvironmentProvider } from '../environment-provider/provider-registry'
import { isLoopbackHost } from './coordination-mcp'
import { errorHttpStatus } from './error-message'
import { bridgeRuntimeAttachmentsKey, type ExecutorConfig } from './runtime'
import type { DriverSessionState } from './supervise-driver-session'

export const peerMailMcpAlias = 'agent-runtime-peer-mail'

/** Mount peer mail through runtime attachments without changing authored profile identity. */
export function peerMailRuntimeAttachment(
  profile: AgentProfile,
  backend: ExecutorConfig,
  spawnContext: Pick<WorkerSpawnContext, 'peerMailUrl'> | undefined,
): Readonly<Record<string, AgentProfileMcpServer>> | undefined {
  const url = spawnContext?.peerMailUrl
  if (url === undefined) return undefined
  if (backend.backend === 'provider' && backend.shared)
    throw new ValidationError(
      'provider peer mail requires a dedicated steerable session; shared placement is not supported',
    )
  if (backend.backend === 'router' || backend.backend === 'router-tools') return undefined
  if (backend.backend !== 'provider' && backend.backend !== 'bridge')
    throw new ValidationError(
      'workerFromBackend: peer mail requires a provider or bridge runtime attachment',
    )
  if (profile.mcp?.[peerMailMcpAlias] !== undefined)
    throw new ValidationError(
      `workerFromBackend: profile MCP alias ${JSON.stringify(peerMailMcpAlias)} is reserved`,
    )
  return Object.freeze({
    [peerMailMcpAlias]: Object.freeze({ transport: 'http', url }) as AgentProfileMcpServer,
  })
}

export function readCallerRuntimeAttachments(
  seams: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const existing = seams[bridgeRuntimeAttachmentsKey]
  return existing !== null && typeof existing === 'object' && !Array.isArray(existing)
    ? (existing as Readonly<Record<string, unknown>>)
    : {}
}

export async function providerAcceptsCoordinationAttachments(
  backend: Extract<ExecutorConfig, { backend: 'provider' }>,
): Promise<boolean> {
  const provider = resolveAgentEnvironmentProvider(backend.provider, backend.registry)
  return (await provider.capabilities()).create?.runtimeAttachments?.mcp === true
}

export const CLAUDE_CODE_ONE_HOUR_CACHE = 'ENABLE_PROMPT_CACHING_1H'

/** Register cleanup before creating a host-held secret; retain failed cleanup for settlement. */
export async function storeCoordinationSecret(
  provider: AgentEnvironmentProvider,
  secrets: NonNullable<DriverSessionState['coordinationSecrets']>,
  name: string,
  authorization: string,
): Promise<void> {
  const store = provider.secrets
  if (!store)
    throw new ValidationError('provider coordination requires its host-held secret manager')
  const prior = secrets.get(name)
  if (prior) {
    if (!prior.ready || !prior.matches(authorization))
      throw new ValidationError('retained coordination cannot rotate before live re-key is proven')
    return
  }
  const entry = {
    ready: false,
    matches: (value: string) => value === authorization,
    release: async () => {
      try {
        await store.delete(name)
      } catch (error) {
        if (!(error instanceof Error) || errorHttpStatus(error) !== 404) throw error
      }
      secrets.delete(name)
    },
  }
  secrets.set(name, entry)
  try {
    await store.create(name, authorization.slice(7))
    entry.ready = true
  } catch (cause) {
    try {
      await entry.release()
    } catch (cleanup) {
      throw new AggregateError([cause, cleanup], 'coordination secret creation and cleanup failed')
    }
    throw cause
  }
}

export function coordinationRuntimeAttachment(url: string, key: string) {
  const reference = { kind: 'secret-ref' as const, key, format: 'bearer' as const }
  return {
    transport: 'http' as const,
    url,
    headers: { Authorization: reference },
    metadata: { toolTimeoutMs: COORDINATION_CLIENT_TOOL_TIMEOUT_MS },
  }
}

export function coordinationBindingHost(address: string, harness: AgentProfile['harness']) {
  const url = new URL(address)
  if (isLoopbackHost(url.hostname) || isIP(url.hostname.replace(/^\[|\]$/g, ''))) {
    if (harness !== 'opencode' && harness !== 'codex')
      throw new ValidationError('loopback or IP coordination requires isolated opencode or codex')
    return undefined
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new ValidationError('host-bound coordination requires a public HTTPS FQDN')
  return url.hostname
}
