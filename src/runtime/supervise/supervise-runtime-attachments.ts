import type { AgentProfile, AgentProfileMcpServer } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type { WorkerSpawnContext } from '../../mcp/tools/coordination-contracts'
import { resolveAgentEnvironmentProvider } from '../environment-provider/provider-registry'
import { bridgeRuntimeAttachmentsKey, type ExecutorConfig } from './runtime'

/**
 * The reserved MCP alias one worker's PEER MAIL capability endpoint mounts under.
 *
 * Distinct from the driver's coordination alias on purpose: the two servers carry different
 * authority. Coordination mounts spawn_worker / steer_agent / stop; mail mounts send_mail and
 * read_mail and nothing else, on a per-worker secret path bound to that worker's identity.
 */
export const peerMailMcpAlias = 'agent-runtime-peer-mail'

/**
 * The Runtime-owned MCP attachment that carries this spawn's peer-mail endpoint into the worker,
 * or `undefined` when this backend runs no MCP client at all.
 *
 * The endpoint rides the SAME out-of-band channel the driver's coordination MCP rides
 * (`runtime_attachments` on the bridge wire), for the same reason: the capability path carries
 * fresh random bytes per process, so writing it into `AgentProfile.mcp` would move the canonical
 * profile digest a durable session is bound to, and a keyed re-spawn would then fail its identity
 * check against the journal. Nothing in the authored profile changes, and this runs inside the
 * leaf factory — after `authorizeSpawn` has already decided the profile — so the authorization
 * chain is unchanged.
 *
 * Three backend classes, three honest answers:
 *
 *  - `bridge` MOUNTS it. cli-bridge advertises `capabilities.runtimeAttachments.mcp` and mounts
 *    the named servers for the run without binding them into the session profile.
 *  - `provider` mounts the same capability through runtimeAttachments.mcp and uses the existing
 *    steerable session inbox so peer delivery can be acknowledged.
 *  - `router` and `router-tools` mount NOTHING. Those workers are in-process tool
 *    loops with no MCP client; their tool surface is the caller's own array, and
 *    `WorkerSpawnContext.peerMailUrl` is the deliverable a caller uses directly.
 *  - Every other backend REFUSES the spawn. A sandbox box or a local CLI harness receives tools
 *    only through its materialized `AgentProfile`, and the runtime has no channel that reaches it
 *    out of band, so minting a capability it can never call would ledger a channel that does not
 *    exist. This is the same rule `bridgeResumeSessionId` applies to `continuity: 'resume'`.
 */
export function peerMailRuntimeAttachment(
  profile: AgentProfile,
  backend: ExecutorConfig,
  spawnContext: Pick<WorkerSpawnContext, 'peerMailUrl'> | undefined,
): Readonly<Record<string, AgentProfileMcpServer>> | undefined {
  const url = spawnContext?.peerMailUrl
  if (url === undefined) return undefined
  if (backend.backend === 'provider' && backend.shared) {
    throw new ValidationError(
      'provider peer mail requires a dedicated steerable session; shared placement is not supported',
    )
  }
  switch (backend.backend) {
    case 'router':
    case 'router-tools':
      return undefined
    case 'provider':
    case 'bridge':
      break
    default:
      throw new ValidationError(
        `workerFromBackend: the '${backend.backend}' backend seam cannot mount a peer-mail ` +
          'endpoint — it materializes tools only through the AgentProfile, and writing a ' +
          'per-process capability URL there would move the canonical profile digest. Run peer-mail ' +
          "workers on the 'bridge' backend, mount the endpoint yourself from " +
          'WorkerSpawnContext.peerMailUrl through makeLeafAgent or makeWorkerAgent, or drop ' +
          'peerMail for this run',
      )
  }
  if (profile.mcp?.[peerMailMcpAlias] !== undefined) {
    throw new ValidationError(
      `workerFromBackend: profile MCP alias ${JSON.stringify(peerMailMcpAlias)} is reserved`,
    )
  }
  return Object.freeze({
    [peerMailMcpAlias]: Object.freeze({ transport: 'http', url }) as AgentProfileMcpServer,
  })
}

/**
 * Runtime attachments a caller already put on the child's `ExecutorContext`, so mounting peer mail
 * ADDS one server rather than replacing the map. An absent or malformed value contributes nothing;
 * the executor that reads the seam owns its validation and refuses a malformed map there.
 */
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
  const capabilities = await resolveAgentEnvironmentProvider(
    backend.provider,
    backend.registry,
  ).capabilities()
  const create = capabilities.create
  if (!create || !('runtimeAttachments' in create)) return false
  const attachments = create.runtimeAttachments
  return Boolean(
    attachments &&
      typeof attachments === 'object' &&
      'mcp' in attachments &&
      attachments.mcp === true,
  )
}

/**
 * A manager waits between turns, and a wake can come much later than five minutes after its last
 * turn. Claude Code 2.1.289 writes its prompt cache with a five-minute lifetime unless this variable
 * is set; a wake after the cache expired re-writes the manager's whole context, about 140K tokens
 * per turn on a Discovery root measured 2026-10-05. That root ran on a subscription and already
 * wrote one-hour entries; the variable makes the hour hold for every claude-code manager, whatever
 * its credential. A value the caller set wins.
 */
export const CLAUDE_CODE_ONE_HOUR_CACHE = 'ENABLE_PROMPT_CACHING_1H'
