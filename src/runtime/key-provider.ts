/**
 * `KeyProvider` — API-key provisioning for adopted external MCP servers.
 *
 * An adopted server (a `connection` artifact, or a `buildableGenerator` remote
 * emit) usually needs a credential. The credential must never ride the profile
 * or the artifact — both are logged, diffed, and stored as audit records — so
 * the profile carries only a DECLARATIVE reference, on either channel:
 *
 *   - interface ≥0.40 canonical: `profile.mcp[key].env.ENV_VAR_NAME`
 *     = `{ kind: 'secret-ref', key: 'PROVIDER_KEY_NAME', format? }`
 *   - legacy metadata channel: `profile.mcp[key].metadata[mcpSecretEnvMetadataKey]`
 *     = { ENV_VAR_NAME: 'PROVIDER_KEY_NAME', … }
 *
 * and the VALUE is resolved at materialize time (`materializeLocalMcp`'s
 * `keys` option) and injected straight into the spawned server child's env.
 * Values exist only in the child process env — never in the profile, the
 * artifact registry, an error message, or a log line (errors name the KEY
 * NAME only).
 *
 * Fail-closed at every hop: a declared secret with no provider, or a provider
 * that does not hold the named key, THROWS — booting an external server
 * keyless would fail opaquely mid-eval or silently score a broken candidate.
 *
 * `envKeyProvider` is the same-host default: it reads the process env, which
 * the operator loads via dotenvx (the secrets files never touch the repo).
 *
 * >>> REAL SECRET STORES PLUG IN HERE (flagged): the sandbox SDK's
 * `client.secrets` (`SecretsManager.get(name)`) and the platform hub's
 * short-lived capability tokens (`PlatformHubClient.mintToken` →
 * `{ ENV: token }`) both satisfy `KeyProvider` with a one-line adapter; both
 * need a live service, so neither is constructed here.
 */

import type {
  AgentProfileConfigValue,
  AgentProfileMcpServer,
  AgentProfileSecretRef,
} from '@tangle-network/agent-interface'
import { ValidationError } from '../errors'

/** Resolve named secrets. The ONE seam every secret store adapts to. */
export interface KeyProvider {
  /** The value for `name`, or `undefined` when this provider does not hold it. */
  get(name: string): Promise<string | undefined>
}

/** The env-backed provider: reads the (dotenvx-loaded) process env. Empty /
 *  whitespace-only values count as absent — fail loud, not with a blank key. */
export function envKeyProvider(env: Record<string, string | undefined> = process.env): KeyProvider {
  return {
    async get(name: string): Promise<string | undefined> {
      const value = env[name]
      return value !== undefined && value.trim().length > 0 ? value : undefined
    },
  }
}

/** The `AgentProfileMcpServer.metadata` key the declarative secret-env map
 *  rides under: `{ ENV_VAR_NAME: 'PROVIDER_KEY_NAME' }`. Names only — values
 *  are resolved at materialize time and never stored. */
export const mcpSecretEnvMetadataKey = 'secretEnv'

/** Read (and validate) a server entry's declared secret-env map, if any.
 *  Malformed metadata throws — a half-declared secret must never half-boot. */
export function secretEnvOfMcpServer(
  server: AgentProfileMcpServer,
): Record<string, string> | undefined {
  const raw = server.metadata?.[mcpSecretEnvMetadataKey]
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError(
      `secretEnvOfMcpServer: metadata.${mcpSecretEnvMetadataKey} must be an object mapping env var name -> key name`,
    )
  }
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length === 0) return undefined
  for (const [envName, keyName] of entries) {
    if (!envName.trim() || typeof keyName !== 'string' || !keyName.trim()) {
      throw new ValidationError(
        `secretEnvOfMcpServer: metadata.${mcpSecretEnvMetadataKey}['${envName}'] must name a non-empty provider key`,
      )
    }
  }
  return raw as Record<string, string>
}

/**
 * Resolve a declared secret-env map into the real env entries for a server
 * spawn. Fail-closed: no provider or a missing key throws, naming the KEY
 * NAME only (the value never appears in any message). `label` names the
 * server for the error (e.g. `profile.mcp['exa']`).
 */
export async function resolveSecretEnv(
  secretEnv: Record<string, string>,
  keys: KeyProvider | undefined,
  label: string,
): Promise<Record<string, string>> {
  const entries = Object.entries(secretEnv)
  if (entries.length === 0) return {}
  if (!keys) {
    throw new ValidationError(
      `${label} declares secret env (${entries.map(([e]) => e).join(', ')}) but no KeyProvider was supplied — refusing to boot an external server keyless`,
    )
  }
  const resolved: Record<string, string> = {}
  for (const [envName, keyName] of entries) {
    const value = await keys.get(keyName)
    if (value === undefined) {
      throw new ValidationError(
        `${label}: the KeyProvider holds no value for '${keyName}' (wanted for env ${envName}) — provision the key or drop the grant`,
      )
    }
    resolved[envName] = value
  }
  return resolved
}

/** Apply a secret-ref's declared decoration to its resolved raw value. */
function formatSecretValue(value: string, format: AgentProfileSecretRef['format']): string {
  return format === 'bearer' ? `Bearer ${value}` : value
}

/** The spawn-ready strings for one stdio MCP server: profile config values
 *  resolved, secrets separated so the client can redact them. */
export interface ResolvedMcpServerLaunch {
  args?: string[]
  /** Public env, safe to appear in diagnostics. */
  env?: Record<string, string>
  /** Resolved secret env. Reaches only the child process; redacted everywhere else. */
  protectedEnv?: Record<string, string>
}

/**
 * Resolve a profile MCP server's `args`/`env` config values (interface ≥0.40
 * `AgentProfileConfigValue`) plus the legacy `metadata.secretEnv` channel into
 * the plain strings a spawn needs.
 *
 * Rules, all fail-closed:
 * - `args` must be public values. A secret-ref in argv is refused: argv is
 *   readable by every host process (/proc/PID/cmdline) and outside the
 *   protected-value redaction channel, so a secret there cannot be contained.
 * - `env` secret-refs resolve through the KeyProvider (missing provider or key
 *   throws, naming the KEY NAME only) and land in `protectedEnv`.
 * - An env var declared secret on BOTH channels (env secret-ref and
 *   metadata.secretEnv) is ambiguous configuration and throws.
 * - A public `env` entry shadowed by a legacy metadata secret keeps the
 *   pre-0.40 spawn precedence: the secret value wins in the child env.
 */
export async function resolveMcpServerLaunch(
  server: AgentProfileMcpServer,
  keys: KeyProvider | undefined,
  label: string,
): Promise<ResolvedMcpServerLaunch> {
  const args = server.args?.map((value: AgentProfileConfigValue, index: number): string => {
    if (value.kind !== 'public') {
      throw new ValidationError(
        `${label}.args[${index}] is a secret-ref ('${value.key}') — argv is readable by every host process and exempt from redaction; declare the secret in env instead`,
      )
    }
    return value.value
  })

  const publicEnv: Record<string, string> = {}
  const envSecretRefs: Record<string, string> = {}
  const envSecretFormats: Record<string, AgentProfileSecretRef['format']> = {}
  for (const [envName, value] of Object.entries(server.env ?? {})) {
    if (value.kind === 'public') {
      publicEnv[envName] = value.value
    } else {
      envSecretRefs[envName] = value.key
      envSecretFormats[envName] = value.format
    }
  }

  const legacySecretEnv = secretEnvOfMcpServer(server)
  for (const envName of Object.keys(legacySecretEnv ?? {})) {
    if (envName in envSecretRefs) {
      throw new ValidationError(
        `${label}: env ${envName} is declared secret twice — once as an env secret-ref and once in metadata.${mcpSecretEnvMetadataKey}; keep exactly one declaration`,
      )
    }
  }

  const resolvedRefs = await resolveSecretEnv(envSecretRefs, keys, label)
  const protectedEnv: Record<string, string> = {
    ...(legacySecretEnv ? await resolveSecretEnv(legacySecretEnv, keys, label) : {}),
    ...Object.fromEntries(
      Object.entries(resolvedRefs).map(([envName, raw]) => [
        envName,
        formatSecretValue(raw, envSecretFormats[envName]),
      ]),
    ),
  }

  return {
    ...(args ? { args } : {}),
    ...(server.env ? { env: publicEnv } : {}),
    ...(Object.keys(protectedEnv).length > 0 ? { protectedEnv } : {}),
  }
}
