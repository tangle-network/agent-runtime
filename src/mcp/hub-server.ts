/**
 * Hub integration MCP server — the user's connected databases and vector
 * stores as agent tools, mid-turn.
 *
 * The Tangle Platform Hub (`PlatformHubClient`, platform/integrations.ts)
 * already turns a provider credential into a per-user, per-action-policy'd,
 * approved, audited access surface: the user connects Pinecone/Qdrant/
 * Weaviate/Neon/Supabase/… once, and every later call goes through
 * `POST /v1/hub/exec`. This module is the thin bridge from that surface to
 * the agent's tool loop: for every ACTIVE connection to a data provider it
 * serves ONE router tool (`hub_<provider>`) whose `action` + `input`
 * arguments are dispatched to the provider's Hub adapter.
 *
 * Why one router tool per connection instead of one tool per adapter action:
 * the Hub catalog publishes capability counts, not capability schemas, so a
 * per-action tool surface would have to bundle the whole adapter registry.
 * The router tool keeps the layer thin — the Hub adapter IS the tool, the
 * Hub exec endpoint IS the invocation, and the Hub policy IS the permission.
 * Every call is policy-gated server-side; a denial surfaces to the agent as
 * the Hub's own error message. When the platform grows a capabilities
 * endpoint, per-action tools can be generated from it without changing this
 * module's contract.
 *
 * Tool lists are resolved at construction (session-scoped, like the memory
 * server): connections the user adds later appear after the server restarts.
 *
 * @experimental
 */

import { ValidationError } from '../errors'
import { type PlatformConnection, PlatformHubError } from '../platform/integrations'
import { createStdioToolServer, type McpToolDescriptor, type StdioToolServer } from './tool-server'

/** The substrate data providers whose Hub adapters become agent tools. */
export const HUB_DATA_PROVIDER_KINDS: readonly string[] = [
  'pinecone',
  'qdrant',
  'weaviate',
  'neon',
  'supabase',
  'mongodb',
  'postgres',
  'mysql',
  'redis',
]

/** The subset of `PlatformHubClient` this module needs — mocks plug in here. */
export interface HubIntegrationClient {
  listConnections(): Promise<PlatformConnection[]>
  exec(input: { path: string; input?: unknown; connectionId?: string }): Promise<unknown>
}

interface HubIntegrationToolsOptions {
  client: HubIntegrationClient
  /** Provider kinds to expose. Defaults to `HUB_DATA_PROVIDER_KINDS`. */
  providers?: readonly string[]
  /** Also serve connections whose last health probe failed. Default false. */
  includeUnhealthy?: boolean
}

/** An action name: dot-separated identifiers — `vectors.query`, `branches.list`. */
const ACTION_NAME_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/
const MCP_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

function toolNameFor(providerId: string, connectionId: string, taken: Set<string>): string {
  const base = `hub_${providerId}`.replace(/[^A-Za-z0-9_-]/g, '-')
  const candidates = [
    base,
    `${base}-${connectionId.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64 - base.length - 1)}`,
  ]
  for (const candidate of candidates) {
    if (MCP_TOOL_NAME_PATTERN.test(candidate) && !taken.has(candidate)) {
      taken.add(candidate)
      return candidate
    }
  }
  throw new ValidationError(
    `hubIntegrationTools: cannot derive a unique tool name for connection '${connectionId}' of provider '${providerId}'`,
  )
}

function connectionLabel(connection: PlatformConnection): string {
  const account = connection.accountDisplay ? ` (${connection.accountDisplay})` : ''
  return `${connection.displayName || connection.providerId}${account}`
}

/**
 * One router tool per active Hub connection to a data provider. The tool
 * handler never holds provider credentials — it execs through the Hub, which
 * enforces the per-user action policy and writes the audit record.
 */
export async function hubIntegrationTools(
  options: HubIntegrationToolsOptions,
): Promise<McpToolDescriptor[]> {
  const providers = new Set(options.providers ?? HUB_DATA_PROVIDER_KINDS)
  const connections = await options.client.listConnections()
  const eligible = connections.filter(
    (connection) =>
      providers.has(connection.providerId) &&
      connection.status === 'active' &&
      (options.includeUnhealthy === true || connection.health !== 'unhealthy'),
  )
  const taken = new Set<string>()
  return eligible.map((connection) => {
    const providerId = connection.providerId
    const name = toolNameFor(providerId, connection.id, taken)
    const label = connectionLabel(connection)
    const description = `Execute a ${providerId} action on the user's Hub connection '${label}' (connection ${connection.id}). Pass action (e.g. "vectors.query", "branches.list", "collections.list") and its input object. Every call is policy-gated and audited by the Tangle Hub; a denied action returns the Hub's error message. Read actions list data; mutations may require prior approval.`
    return {
      name,
      description,
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: `The ${providerId} adapter action name, e.g. "vectors.query".`,
          },
          input: {
            type: 'object',
            description: 'Arguments object for the action.',
            additionalProperties: true,
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
      handler: async (raw: unknown) => {
        const args = (raw ?? {}) as { action?: unknown; input?: unknown }
        if (typeof args.action !== 'string' || !ACTION_NAME_PATTERN.test(args.action)) {
          throw new TypeError(
            `${name}: action must be a provider action name like "vectors.query" (dot-separated, no path or spaces)`,
          )
        }
        if (
          args.input !== undefined &&
          (typeof args.input !== 'object' || args.input === null || Array.isArray(args.input))
        ) {
          throw new TypeError(`${name}: input must be an object of action arguments`)
        }
        const path = `${providerId}.${args.action}`
        try {
          return await options.client.exec({
            path,
            input: (args.input as Record<string, unknown>) ?? {},
            connectionId: connection.id,
          })
        } catch (error) {
          if (error instanceof PlatformHubError) {
            throw new Error(
              `${name}: hub exec '${path}' failed (${error.status}${error.code ? ` ${error.code}` : ''}): ${error.message}`,
            )
          }
          throw error
        }
      },
    }
  })
}

interface CreateHubIntegrationToolServerOptions extends HubIntegrationToolsOptions {
  /** Server display name surfaced via `initialize`. Default 'agent-hub-integrations'. */
  serverName?: string
  /** Server version surfaced via `initialize`. Default '0'. */
  serverVersion?: string
}

/**
 * Build the hub integration MCP server on the shared stdio JSON-RPC core —
 * the same wire protocol every in-repo MCP server speaks. Serves zero tools
 * when the caller has no active data-provider connections (a session without
 * connections simply gets no database tools, mirroring the memory server's
 * "no artifact, no server" discipline).
 */
export async function createHubIntegrationToolServer(
  options: CreateHubIntegrationToolServerOptions,
): Promise<StdioToolServer> {
  return createStdioToolServer({
    serverName: options.serverName ?? 'agent-hub-integrations',
    serverVersion: options.serverVersion ?? '0',
    tools: await hubIntegrationTools(options),
  })
}
