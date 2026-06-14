/**
 * Researcher delegate provisioning — resolves the worker harness, model, and router
 * credentials for `delegate_research`, and injects the OpenAI-compatible router creds
 * into a sandbox agent-run spec.
 *
 * Why this exists: the agent-knowledge researcher profile defaults to a harness
 * (`opencode/zai-coding-plan/glm-5.1`) that isn't broadly provisionable, and the sandbox
 * SDK does not wire `backend.model.apiKey` into the in-box agent's OpenAI-compatible
 * provider. So the MCP server picks a provisionable harness + model and passes the router
 * creds as box env. Everything is env-overridable and reuses the repo's router resolution.
 */
import { type RouterEnv, resolveRouterBaseUrl } from '../model-resolution.js'

export interface ResearcherProvisioning {
  harness: string
  /** Worker model id (router-served). */
  model: string
  /** OpenAI-compatible router key for the in-box provider; undefined disables injection. */
  routerKey?: string
  /** OpenAI-compatible router base, always ending in a `/vN` segment. */
  routerBaseUrl: string
  /** Explicit fanout harness list (MCP_RESEARCHER_FANOUT_HARNESSES); undefined ⇒ caller defaults. */
  fanoutHarnesses?: string[]
  /** Per-harness fanout model overrides (MCP_RESEARCHER_FANOUT_MODELS), index-aligned. */
  fanoutModels?: string[]
}

/** A sandbox agent-run spec whose box env can be overridden. */
export interface ProvisionableSpec {
  sandboxOverrides?: { env?: Record<string, string> } & Record<string, unknown>
}

const DEFAULT_HARNESS = 'opencode'
const DEFAULT_MODEL = 'moonshotai/kimi-k2.6'

function trimmed(value: string | undefined): string | undefined {
  const t = value?.trim()
  return t ? t : undefined
}

function csv(value: string | undefined): string[] | undefined {
  const list = value
    ?.split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  return list && list.length > 0 ? list : undefined
}

/**
 * Resolve harness/model/router from env. Model falls back through the repo's
 * `WORKER_MODEL` convention; router base reuses `resolveRouterBaseUrl` (TANGLE_ROUTER_URL
 * / TANGLE_ROUTER_BASE_URL) and is normalized to an OpenAI-compatible `/v1` endpoint.
 */
export function resolveResearcherProvisioning(
  env: NodeJS.ProcessEnv = process.env,
): ResearcherProvisioning {
  const harness = trimmed(env.MCP_RESEARCHER_HARNESS) ?? DEFAULT_HARNESS
  const model =
    trimmed(env.MCP_RESEARCHER_MODEL) ??
    trimmed(env.MCP_WORKER_MODEL) ??
    trimmed(env.WORKER_MODEL) ??
    DEFAULT_MODEL
  const routerKey = trimmed(env.MCP_RESEARCHER_ROUTER_KEY) ?? trimmed(env.TANGLE_API_KEY)
  const base = trimmed(env.MCP_RESEARCHER_ROUTER_BASE_URL) ?? resolveRouterBaseUrl(env as RouterEnv)
  const routerBaseUrl = /\/v\d+\/?$/.test(base) ? base.replace(/\/$/, '') : `${base.replace(/\/$/, '')}/v1`
  const fanoutHarnesses = csv(env.MCP_RESEARCHER_FANOUT_HARNESSES)
  const fanoutModels = csv(env.MCP_RESEARCHER_FANOUT_MODELS)
  return {
    harness,
    model,
    ...(routerKey ? { routerKey } : {}),
    routerBaseUrl,
    ...(fanoutHarnesses ? { fanoutHarnesses } : {}),
    ...(fanoutModels ? { fanoutModels } : {}),
  }
}

/**
 * Merge the router creds into a spec's box env (in place). Merges — never replaces — any
 * env the preset already supplied. No-op when there is no router key.
 */
export function applyRouterEnv(
  spec: ProvisionableSpec,
  routerKey: string | undefined,
  routerBaseUrl: string,
): void {
  if (!routerKey) return
  spec.sandboxOverrides = {
    ...(spec.sandboxOverrides ?? {}),
    env: {
      ...(spec.sandboxOverrides?.env ?? {}),
      OPENAI_API_KEY: routerKey,
      OPENAI_BASE_URL: routerBaseUrl,
    },
  }
}
