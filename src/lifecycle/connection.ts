/**
 * PHASE 6 — the `connection` artifact: ADOPT an existing external MCP server
 * (instead of building one) as a promotable, measurable profile artifact.
 *
 * A `connection` candidate carries an `ExternalMcpGrant` — the address of a
 * server that already exists (a remote `http` endpoint, or an installed
 * `stdio` launch) plus the credential it needs BY NAME. `applyArtifact`
 * promotes the grant onto the profile through fields the published
 * `AgentProfile` already has:
 *
 *   - `profile.mcp[key]`     — the server entry (`connectionMcpServer`), so the
 *     EXISTING materialization paths mount it: `materializeLocalMcp` spawns a
 *     stdio grant same-host during a scored run; an http grant is representable
 *     today and materializes in the sandbox backend (the same-host client has
 *     no http MCP client yet — it fails loud, never silently skips).
 *   - `profile.connections`  — the optional Tangle Hub grant
 *     (`AgentProfileConnection`: connectionId + capabilities), when the adopted
 *     capability is hub-managed rather than a raw server.
 *
 * SECRETS: `grant.secretEnv` maps env var name → provider KEY NAME. Only the
 * names ride the artifact/profile (as `mcp[key].metadata.secretEnv`); the
 * VALUE is resolved by a `KeyProvider` at materialize time and injected into
 * the spawned server's env only (see runtime/key-provider.ts — fail-closed,
 * never logged). So a promoted grant is auditable and replayable without ever
 * storing a credential.
 *
 * Measuring an adopted server is the SAME ablation as every other surface:
 *
 *   measureMarginalLift({
 *     baseline,
 *     candidate: registry.register(connectionArtifact(grant)),
 *     evalRunner: sweEvalRunner({ ...opts, materializeMcp: true, keys }),
 *   })
 *
 * — the candidate arm runs with the external server live, the baseline
 * without, and only a real held-out lift promotes the adoption.
 */

import type { AgentProfileConnection, AgentProfileMcpServer } from '@tangle-network/agent-interface'
import { ValidationError } from '../errors'
import { mcpSecretEnvMetadataKey } from '../runtime/key-provider'
import type { ArtifactInput } from './types'

/**
 * An external MCP grant — the ADOPT-not-build candidate payload. `http` names
 * a remote endpoint (`url`, literal `headers`); `stdio` names an installed
 * launch (`command`/`args`). `env` is literal (non-secret) server env;
 * `secretEnv` declares credentials by provider key name, resolved at
 * materialize time — a secret VALUE must never appear in a grant.
 */
export interface ExternalMcpGrant {
  transport: 'http' | 'stdio'
  /** `http`: the remote MCP endpoint. */
  url?: string
  /** `stdio`: the launch command of an installed external server. */
  command?: string
  args?: string[]
  /** Literal request headers (`http` only). Secret headers do not exist here —
   *  route credentials through `secretEnv` so values never ride the profile. */
  headers?: Record<string, string>
  /** Literal (non-secret) env for the server. */
  env?: Record<string, string>
  /** Declarative secrets: env var name → `KeyProvider` key name. Names only. */
  secretEnv?: Record<string, string>
  /** Optional Tangle Hub grant promoted alongside onto `profile.connections`. */
  hub?: AgentProfileConnection
}

/** Assert an `ExternalMcpGrant` is well-formed. Fail-closed: a malformed grant
 *  must never become a promotable artifact. */
export function validateExternalMcpGrant(grant: ExternalMcpGrant): void {
  if (grant.transport !== 'http' && grant.transport !== 'stdio') {
    throw new ValidationError(
      `external MCP grant: transport must be 'http' or 'stdio' (got '${String(
        (grant as { transport?: unknown }).transport,
      )}')`,
    )
  }
  if (grant.transport === 'http') {
    if (!grant.url || !/^https?:\/\//.test(grant.url)) {
      throw new ValidationError("external MCP grant: transport 'http' requires an http(s) `url`")
    }
    if (grant.command) {
      throw new ValidationError(
        "external MCP grant: transport 'http' must not carry a `command` (ambiguous grant)",
      )
    }
  } else {
    if (!grant.command || grant.command.trim().length === 0) {
      throw new ValidationError("external MCP grant: transport 'stdio' requires a `command`")
    }
    if (grant.url) {
      throw new ValidationError(
        "external MCP grant: transport 'stdio' must not carry a `url` (ambiguous grant)",
      )
    }
    if (grant.headers && Object.keys(grant.headers).length > 0) {
      throw new ValidationError(
        'external MCP grant: `headers` are http-only — a stdio server takes env, not headers',
      )
    }
  }
  for (const [envName, keyName] of Object.entries(grant.secretEnv ?? {})) {
    if (!envName.trim() || !keyName.trim()) {
      throw new ValidationError(
        'external MCP grant: every secretEnv entry needs a non-empty env var name and provider key name',
      )
    }
  }
  if (grant.hub) {
    if (!grant.hub.connectionId?.trim()) {
      throw new ValidationError('external MCP grant: a hub grant requires a connectionId')
    }
    if (!Array.isArray(grant.hub.capabilities) || grant.hub.capabilities.length === 0) {
      throw new ValidationError(
        'external MCP grant: a hub grant requires at least one capability path',
      )
    }
  }
}

/**
 * The `AgentProfileMcpServer` entry a grant promotes into `profile.mcp` — the
 * profile shape both materialization paths already read. Secret references
 * ride `metadata[mcpSecretEnvMetadataKey]` (names only); the value is injected
 * at materialize time by the `KeyProvider`.
 */
export function connectionMcpServer(grant: ExternalMcpGrant): AgentProfileMcpServer {
  validateExternalMcpGrant(grant)
  const secretMeta =
    grant.secretEnv && Object.keys(grant.secretEnv).length > 0
      ? { metadata: { [mcpSecretEnvMetadataKey]: { ...grant.secretEnv } } }
      : {}
  if (grant.transport === 'http') {
    return {
      transport: 'http',
      url: grant.url as string,
      ...(grant.headers ? { headers: grant.headers } : {}),
      ...(grant.env ? { env: grant.env } : {}),
      ...secretMeta,
      enabled: true,
    }
  }
  return {
    transport: 'stdio',
    command: grant.command as string,
    ...(grant.args ? { args: grant.args } : {}),
    ...(grant.env ? { env: grant.env } : {}),
    ...secretMeta,
    enabled: true,
  }
}

export interface ConnectionArtifactOptions {
  /** The `profile.mcp` key / artifact key the grant mounts under.
   *  Default: derived from the endpoint host (http) or command basename (stdio). */
  key?: string
  /** Artifact display name. Default = key. */
  name?: string
  description?: string
}

/**
 * Build a `connection` `ArtifactInput` from a grant — the one-step adapter for
 * the adopt path (a research driver's verdict, a hub catalog row, an operator
 * decision). Metadata records the transport and the secret KEY NAMES for the
 * audit trail; values never appear.
 */
export function connectionArtifact(
  grant: ExternalMcpGrant,
  opts: ConnectionArtifactOptions = {},
): ArtifactInput<'connection'> {
  validateExternalMcpGrant(grant)
  const key = opts.key ?? defaultGrantKey(grant)
  return {
    kind: 'connection',
    key,
    name: opts.name ?? key,
    description:
      opts.description ??
      `adopted external MCP (${grant.transport}: ${grant.transport === 'http' ? grant.url : grant.command})`,
    payload: { grant },
    metadata: {
      transport: grant.transport,
      ...(grant.secretEnv ? { secretKeys: Object.values(grant.secretEnv) } : {}),
      ...(grant.hub ? { hubConnectionId: grant.hub.connectionId } : {}),
    },
  }
}

/** A stable default mount key: the endpoint host (http) or the command
 *  basename (stdio), sanitized to the profile-key alphabet. */
function defaultGrantKey(grant: ExternalMcpGrant): string {
  const raw =
    grant.transport === 'http'
      ? new URL(grant.url as string).hostname
      : ((grant.command as string).split('/').pop() ?? (grant.command as string))
  const key = raw.replace(/[^a-zA-Z0-9_-]/g, '_')
  if (!key) throw new ValidationError('connectionArtifact: cannot derive a key — pass opts.key')
  return key
}
