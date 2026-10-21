/**
 *
 * Chat-model resolution + catalog validation — the shared primitive every
 * product chat handler needs and was, until now, hand-rolling. Lifts the
 * router `/v1/models` fetch, the fail-closed id validation, and the
 * precedence resolver out of four near-identical per-repo copies.
 *
 * Policy-free by design: callers pass their own precedence order
 * (`resolveChatModel`) and their own known-good `allowlist`
 * (`validateChatModelId`), so each product keeps its resolution policy while
 * sharing the catalog fetch, the malformed-id guard, and the fail-closed
 * admission rule. No React, no `process.env` assumption — `env` is an
 * explicit narrow record so this runs unchanged in Node and in Workers.
 *
 * @stable
 */

/**
 * A model entry as returned by the Tangle Router `/v1/models` endpoint.
 * Intentionally minimal — only the fields resolution + validation read.
 */
export interface ModelInfo {
  id: string
  name?: string
  description?: string
  /** Provider slug, when the router exposes it (`provider` or `_provider`). */
  provider?: string
  _provider?: string
  architecture?: {
    modality?: string
    input_modalities?: string[]
    output_modalities?: string[]
  }
}

/** Env keys the router base URL is resolved from. */
export interface RouterEnv {
  TANGLE_ROUTER_URL?: string
  TANGLE_ROUTER_BASE_URL?: string
}

/** Default Tangle Router base URL used when no env override is set. */
export const DEFAULT_ROUTER_BASE_URL = 'https://router.tangle.tools'

/** Resolve the router base URL from env, normalised — no trailing `/v1` or `/`. */
export function resolveRouterBaseUrl(env: RouterEnv = {}): string {
  return (env.TANGLE_ROUTER_URL ?? env.TANGLE_ROUTER_BASE_URL ?? DEFAULT_ROUTER_BASE_URL)
    .replace(/\/v1\/?$/, '')
    .replace(/\/$/, '')
}

/**
 * Fetch the model catalog from the router's `/v1/models`. Throws on a non-2xx
 * response — callers decide whether to fail open (empty catalog) or closed.
 */
export async function getModels(
  routerBaseUrl: string = DEFAULT_ROUTER_BASE_URL,
): Promise<ModelInfo[]> {
  const res = await fetch(`${routerBaseUrl}/v1/models`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`router /v1/models ${res.status}`)
  const body = (await res.json()) as { data?: ModelInfo[] }
  return Array.isArray(body.data) ? body.data : []
}

/** Trim a candidate model id; `undefined` for non-strings and blanks. */
export function cleanModelId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export interface ChatModelCandidate {
  /** Stable label for telemetry — e.g. `request`, `workspace`, `env`. */
  source: string
  model: string | undefined
}

export interface ResolvedChatModel {
  source: string
  model: string
}

/**
 * Resolve a chat model by precedence: the first candidate carrying a
 * non-blank model wins, else `fallback`. The caller owns the precedence
 * order, so each product keeps its own policy (request → workspace → env,
 * etc.) while the first-non-blank logic and the telemetry shape stay shared.
 */
export function resolveChatModel(
  candidates: ChatModelCandidate[],
  fallback: ResolvedChatModel,
): ResolvedChatModel {
  for (const candidate of candidates) {
    const model = cleanModelId(candidate.model)
    if (model) return { source: candidate.source, model }
  }
  return fallback
}

export type ChatModelValidation =
  | { succeeded: true; value: string }
  | { succeeded: false; error: string }

const WELL_FORMED_MODEL_ID = /^[A-Za-z0-9._/@:-]+$/

function isWellFormedModelId(modelId: string): boolean {
  return modelId.length <= 200 && WELL_FORMED_MODEL_ID.test(modelId)
}

/**
 * Every id a catalog entry can be addressed by — its bare id, plus a
 * `provider/id` form when the router exposes a separate provider slug.
 */
function catalogIdsForModel(model: ModelInfo): string[] {
  const ids = new Set<string>()
  const id = cleanModelId(model.id)
  if (id) ids.add(id)
  const provider = cleanModelId(model._provider) ?? cleanModelId(model.provider)
  if (provider && id && !id.includes('/')) ids.add(`${provider}/${id}`)
  return [...ids]
}

/**
 * Validate a caller-supplied chat-model id. Rejects non-strings, malformed
 * ids, and ids absent from both the caller's `allowlist` and the live router
 * catalog. Fails closed: when the catalog cannot be fetched, an unverifiable
 * id is rejected rather than admitted — a bad model never reaches the agent.
 */
export async function validateChatModelId(
  modelId: unknown,
  options: {
    /**
     * Known-good ids that skip the catalog round trip — e.g. the product's
     * default model plus any env-configured ids.
     */
    allowlist?: string[]
    routerBaseUrl?: string
    /** Injectable catalog loader — overridden in tests. */
    loadModels?: (routerBaseUrl: string) => Promise<ModelInfo[]>
  } = {},
): Promise<ChatModelValidation> {
  const {
    allowlist = [],
    routerBaseUrl = DEFAULT_ROUTER_BASE_URL,
    loadModels = getModels,
  } = options

  const cleaned = cleanModelId(modelId)
  if (!cleaned) return { succeeded: false, error: 'Model id must be a non-empty string.' }
  if (!isWellFormedModelId(cleaned)) {
    return { succeeded: false, error: `Model id is malformed: ${cleaned}` }
  }
  if (allowlist.some((id) => cleanModelId(id) === cleaned)) {
    return { succeeded: true, value: cleaned }
  }

  let catalog: ModelInfo[]
  try {
    catalog = await loadModels(routerBaseUrl)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { succeeded: false, error: `Could not validate model catalog: ${message}` }
  }

  const ids = new Set(catalog.flatMap(catalogIdsForModel))
  if (!ids.has(cleaned)) return { succeeded: false, error: `Model is not available: ${cleaned}` }
  return { succeeded: true, value: cleaned }
}
