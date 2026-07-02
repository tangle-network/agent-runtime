/**
 * @experimental
 *
 * Tangle Intelligence — the DELIVERY half of the loop (pull-by-default).
 *
 * The sibling Observe layer (`./index`) sends traces UP to the plane. This
 * module pulls certified artifacts DOWN: it reads the tenant's promoted,
 * gate-certified profile from the deployed Intelligence plane and folds it into
 * the running agent's prompt — so an approved improvement actually reaches the
 * agent. This is "shipping intelligence to people's agents", pull-by-default;
 * the push/Gated-PR opt-in composes on top of this.
 *
 * Pull contract (deployed plane): GET /v1/profiles/:target/composed →
 *   { target, generatedAt, promptSurface: {surface,surfaceHash,version,lift}|null,
 *     artifacts: { <artifactType>: [{path,content,contentHash,version,lift,promotedAt}] } }
 * Auth: Bearer <apiKey> (the one TANGLE_API_KEY shared by router + sandbox +
 * intelligence), resolved to a tenant by platform-api's key-verify S2S contract.
 *
 *   import { withCertifiedDelivery } from '@tangle-network/agent-runtime/intelligence'
 *
 *   export const agent = withCertifiedDelivery(
 *     async (input, applied) => myAgent(input, { systemPrompt: applied.composePrompt(BASE) }),
 *     { project: 'support-agent', target: 'support-agent' },
 *   )
 */

import { createIntelligenceClient, type IntelligenceConfig } from './index'

const defaultPlaneBaseUrl = 'https://intelligence.tangle.tools'
const defaultRefreshMs = 300_000

/** A promoted, certified artifact (one entry in the composed profile). */
export interface CertifiedArtifact {
  path: string | null
  content: string
  contentHash: string
  version: number | null
  /** Held-out gate lift attached at certification, e.g. "+3.1pp" — never a
   *  within-run claim. `null` when the promotion carried no lift record. */
  lift: string | null
  promotedAt: string
}

/** The active promoted prompt surface for a target. */
export interface CertifiedPromptSurface {
  surface: string
  surfaceHash: string
  version: number | null
  lift: string | null
}

/** The composed certified profile — exactly the shape the plane's
 *  `GET /v1/profiles/:target/composed` returns. */
export interface CertifiedProfile {
  target: string
  generatedAt: string
  promptSurface: CertifiedPromptSurface | null
  artifacts: Record<string, CertifiedArtifact[]>
}

/** Typed outcome for the pull — inspect `succeeded` before `value`. A 404
 *  (nothing promoted yet) is a normal, non-error `succeeded: false`. */
export type PullOutcome =
  | { succeeded: true; value: CertifiedProfile }
  | { succeeded: false; error: string; status?: number }

export interface PullCertifiedOptions {
  /** The agent target certified artifacts are promoted under. */
  target: string
  /** Bearer key. Defaults to `process.env.TANGLE_API_KEY`. */
  apiKey?: string
  /** Plane base URL. Defaults to `process.env.TANGLE_INTELLIGENCE_URL` then
   *  `https://intelligence.tangle.tools`. */
  baseUrl?: string
  /** fetch impl (tests / non-global-fetch runtimes). Defaults to global fetch. */
  fetchImpl?: typeof fetch
  /** Abort the pull after this many ms so a hung plane never blocks the caller.
   *  Default 10000. The timeout surfaces as a normal fail-closed `succeeded:
   *  false` (the agent runs on its base surface). */
  timeoutMs?: number
}

const defaultPullTimeoutMs = 10_000

function resolvePlaneBaseUrl(baseUrl: string | undefined): string {
  if (baseUrl) return baseUrl.replace(/\/+$/, '')
  if (typeof process !== 'undefined' && process.env.TANGLE_INTELLIGENCE_URL) {
    return process.env.TANGLE_INTELLIGENCE_URL.replace(/\/+$/, '')
  }
  return defaultPlaneBaseUrl
}

function resolveApiKey(apiKey: string | undefined): string {
  if (apiKey) return apiKey
  if (typeof process !== 'undefined' && process.env.TANGLE_API_KEY)
    return process.env.TANGLE_API_KEY
  return ''
}

/**
 * Pull the certified composed profile for a target. Fail-closed: a network
 * error or a non-2xx returns a typed `succeeded: false` (never throws), so a
 * caller can run on its base surface when Intelligence is unreachable. A 404 is
 * the normal "nothing promoted yet" signal, carried as `status: 404`.
 */
export async function pullCertified(opts: PullCertifiedOptions): Promise<PullOutcome> {
  const doFetch = opts.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined)
  if (!doFetch) return { succeeded: false, error: 'no fetch implementation available' }
  const apiKey = resolveApiKey(opts.apiKey)
  if (!apiKey) return { succeeded: false, error: 'no apiKey (set TANGLE_API_KEY or opts.apiKey)' }
  const baseUrl = resolvePlaneBaseUrl(opts.baseUrl)
  const url = `${baseUrl}/v1/profiles/${encodeURIComponent(opts.target)}/composed`
  let res: Response
  try {
    res = await doFetch(url, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(opts.timeoutMs ?? defaultPullTimeoutMs),
    })
  } catch (err) {
    return {
      succeeded: false,
      error: `pull request failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  if (res.status === 404) {
    return {
      succeeded: false,
      error: 'no certified artifacts promoted for target yet',
      status: 404,
    }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return {
      succeeded: false,
      error: `pull ${res.status}: ${body.slice(0, 200)}`,
      status: res.status,
    }
  }
  try {
    return { succeeded: true, value: (await res.json()) as CertifiedProfile }
  } catch (err) {
    return {
      succeeded: false,
      error: `pull response parse failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/** Artifact-type buckets that fold into the system prompt, in fold order. A
 *  certified `context` capability whose content is free text (`instructions`)
 *  is delivered here so it actually reaches the agent — never bucketed into a
 *  type the fold then silently skips. The resolver reuses this exact set so its
 *  `promptAdditions` slot matches the folded prompt byte-for-byte. */
export const promptFoldTypes = ['prompt-surface', 'skill', 'instructions'] as const

/**
 * Fold the certified prompt surface (and any certified prompt-folding artifacts:
 * `prompt-surface` / `skill` / `instructions`) into a base system prompt under a
 * marked section, so the deployed agent prompt == base + the gate-certified
 * additions. Order is stable (prompt surface first, then artifact buckets in
 * `promptFoldTypes` order, then by path within a bucket) so the same profile
 * renders byte-identically each call. Returns `base` unchanged when there is no
 * usable certified content.
 */
export function composeCertifiedPrompt(base: string, certified: CertifiedProfile | null): string {
  if (!certified) return base
  const parts: string[] = []
  if (certified.promptSurface?.surface.trim()) parts.push(certified.promptSurface.surface.trim())
  for (const type of promptFoldTypes) {
    const bucket = certified.artifacts[type] ?? []
    for (const a of [...bucket].sort((x, y) => (x.path ?? '').localeCompare(y.path ?? ''))) {
      if (a.content.trim()) parts.push(a.content.trim())
    }
  }
  if (parts.length === 0) return base
  return `${base.trim()}\n\n## Certified guidance (Tangle Intelligence)\n\n${parts.join('\n\n')}`
}

/** A cached, self-refreshing source of a target's certified prompt additions —
 *  the prompt-only delivery lane for callers that assemble their OWN system
 *  prompt (product chat routes) rather than wrapping an agent fn. Same
 *  fail-closed semantics as {@link withCertifiedDelivery}: pulls at most every
 *  `refreshMs`, coalesces concurrent pulls, keeps the last-known profile on a
 *  failed/404 pull, never throws, never blocks past the pull timeout. */
export interface CertifiedPromptSource {
  /** Refresh (window-respecting) then fold the certified additions into a
   *  base system prompt. Returns `base` unchanged when nothing is promoted. */
  compose(base: string): Promise<string>
  /** The certified profile currently in effect (`null` = none pulled yet). */
  current(): CertifiedProfile | null
  /** Pull now if the refresh window has elapsed; coalesced and fail-closed. */
  refresh(): Promise<void>
}

/** Options for {@link createCertifiedPromptSource} — the pull coordinates plus
 *  the refresh cadence. */
export interface CertifiedPromptSourceOptions extends PullCertifiedOptions {
  /** Min interval between certified-profile pulls. Default 5m. */
  refreshMs?: number
}

/**
 * Create the cached certified-prompt source — the ONE module-scope-cache +
 * coalesced-refresh + keep-last-known implementation. Product wiring uses this
 * rather than hand-rolling the same lines around `pullCertified`, and
 * {@link withCertifiedDelivery} is built on it.
 */
export function createCertifiedPromptSource(
  opts: CertifiedPromptSourceOptions,
): CertifiedPromptSource {
  const refreshMs = opts.refreshMs ?? defaultRefreshMs
  let certified: CertifiedProfile | null = null
  let lastPullAt = 0
  let inflight: Promise<void> | null = null

  async function refresh(): Promise<void> {
    if (Date.now() - lastPullAt < refreshMs) return
    if (inflight) return inflight
    inflight = (async () => {
      const outcome = await pullCertified(opts)
      lastPullAt = Date.now()
      // Only replace the cache on a real pull; a 404/error keeps the last-known
      // certified profile (or null) — fail-closed, never wipe a good surface.
      if (outcome.succeeded) certified = outcome.value
    })()
    try {
      await inflight
    } finally {
      inflight = null
    }
  }

  return {
    refresh,
    current: () => certified,
    async compose(base: string): Promise<string> {
      await refresh()
      return composeCertifiedPrompt(base, certified)
    },
  }
}

/** What the delivery wrapper hands the agent each run. */
export interface AppliedIntelligence {
  /** The certified profile in effect (null when none promoted / pull failed —
   *  fail-closed: the agent runs on its base surface). */
  certified: CertifiedProfile | null
  /** Fold the certified prompt surface into a base system prompt. */
  composePrompt(base: string): string
}

/** An agent wrapped by {@link withCertifiedDelivery}: receives the input plus
 *  the certified intelligence delivered for this run. */
export type DeliveredAgent<I, O> = (input: I, applied: AppliedIntelligence) => Promise<O>

/** Delivery config = the Observe config plus the pull target + refresh cadence. */
export interface DeliveryConfig extends IntelligenceConfig {
  /** Pull target. Defaults to `project`. */
  target?: string
  /** Plane base URL for the pull (NOT the OTLP `endpoint`). Defaults to
   *  `TANGLE_INTELLIGENCE_URL` then `https://intelligence.tangle.tools`. */
  baseUrl?: string
  /** Min interval between certified-profile pulls. Default 5m. */
  refreshMs?: number
  /** Per-pull timeout in ms (fail-closed on a hung plane). Default 10000. */
  timeoutMs?: number
  /** fetch impl for the pull (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch
}

/**
 * Wrap an agent so it (a) Observes each run via the shipped Observe client and
 * (b) RECEIVES the tenant's certified artifacts pulled from the deployed plane.
 * The certified profile is cached and refreshed at most every `refreshMs`; a
 * failed pull is fail-closed — the agent runs on its base surface and never
 * breaks because Intelligence is unreachable. When the plane promotes a new
 * gate-certified surface, the next refresh delivers it to the running agent.
 */
export function withCertifiedDelivery<I, O>(
  agent: DeliveredAgent<I, O>,
  config: DeliveryConfig,
): ((input: I) => Promise<O>) & { refresh(): Promise<void> } {
  const client = createIntelligenceClient(config)
  const source = createCertifiedPromptSource({
    target: config.target ?? config.project,
    ...(config.apiKey !== undefined ? { apiKey: config.apiKey } : {}),
    ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
    ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
    ...(config.fetchImpl !== undefined ? { fetchImpl: config.fetchImpl } : {}),
    ...(config.refreshMs !== undefined ? { refreshMs: config.refreshMs } : {}),
  })

  const wrapped = (async (input: I): Promise<O> => {
    await source.refresh()
    const certified = source.current()
    const applied: AppliedIntelligence = {
      certified,
      composePrompt: (base: string) => composeCertifiedPrompt(base, certified),
    }
    return client.traceRun(
      { input, labels: { 'tangle.certified_version': certified?.promptSurface?.version ?? -1 } },
      async (trace) => {
        const out = await agent(input, applied)
        trace.recordOutput(out)
        return out
      },
    )
  }) as ((input: I) => Promise<O>) & { refresh(): Promise<void> }
  wrapped.refresh = source.refresh
  return wrapped
}
