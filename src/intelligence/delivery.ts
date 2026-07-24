/**
 *
 * Tangle Intelligence — the RECEIVE half of the loop (pull-by-default).
 *
 * The sibling Observe path (`./index`) sends run records UP to the plane. This
 * module pulls certified artifacts DOWN: it reads the tenant's promoted,
 * gate-certified profile from the deployed Intelligence plane so an approved
 * improvement actually reaches the running agent. The pull carries three things
 * the plane already composes:
 *   - the certified PROMPT surface + prompt-folding artifacts (delivered into the
 *     system prompt via {@link composeCertifiedPrompt} — the promoted prompt);
 *   - the typed profile DIFFS the plane has promoted, each with its held-out
 *     provenance (surfaced as PROPOSALS — never auto-applied at runtime);
 *   - the composed `agentProfile` those diffs fold to, for inspection.
 *
 * Pull contract (deployed plane): GET /v1/profiles/:target/composed →
 *   { target, generatedAt,
 *     promptSurface: {surface,surfaceHash,version,lift}|null,
 *     artifacts: { <artifactType>: [{path,content,contentHash,version,lift,promotedAt}] },
 *     capabilities: [{id,iface:{surface},binding:{path,content},provenance}],
 *     agentProfileDiffs: [{diff, provenance:{version,lift,contentHash,promotedAt}}],
 *     agentProfile: AgentProfile|null }
 * Auth: Bearer <apiKey> (the one TANGLE_API_KEY shared by router + sandbox +
 * intelligence), resolved to a tenant by platform-api's key-verify S2S contract.
 *
 * @experimental
 */

import type {
  AgentImprovementProposal,
  AgentProfile,
  AgentProfileDiff,
} from '@tangle-network/agent-interface'
import { verifyAgentImprovementProposal } from './improvement-cycle'

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

/** The held-out provenance the plane's certify step stamps on a promoted diff.
 *  `lift` is the held-out gate lift (e.g. "+3.1pp"), never a within-run claim. */
export interface DiffProvenance {
  version: number | null
  lift: string | null
  contentHash: string
  promotedAt: string
}

/**
 * A gate-certified profile diff the plane has already promoted, plus the
 * held-out provenance it carries. This is the previously-DROPPED typed diff the
 * composed endpoint returns; `withIntelligence` deserializes it and surfaces it
 * as a PROPOSAL — a human, or the gated local `improve()` loop, turns a proposal
 * into a shipped profile. It is NEVER auto-applied at runtime.
 */
export interface ProposedProfileDiff {
  diff: AgentProfileDiff
  provenance: DiffProvenance
}

/** The composed endpoint's per-capability summary — the narrow shape on the
 *  wire (id + surface + path/content + provenance). Distinct from the richer
 *  `CertifiedCapability` the capability resolver lowers a manifest into. */
export interface CertifiedCapabilitySummary {
  id: string
  iface: { surface: string }
  binding: { path: string | null; content: string }
  provenance: DiffProvenance
}

/** The composed certified profile — exactly the shape the plane's
 *  `GET /v1/profiles/:target/composed` returns. */
export interface CertifiedProfile {
  target: string
  generatedAt: string
  promptSurface: CertifiedPromptSurface | null
  artifacts: Record<string, CertifiedArtifact[]>
  /** The typed profile diffs the plane has promoted, each with held-out
   *  provenance. Surfaced as proposals; never auto-applied. Empty when none. */
  agentProfileDiffs: ProposedProfileDiff[]
  /** The composed capability summaries the plane returns. Empty when none. */
  capabilities: CertifiedCapabilitySummary[]
  /** The composed profile the promoted diffs fold to, for inspection. `null`
   *  when no diffs are promoted. */
  agentProfile: AgentProfile | null
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
  /** Abort the request after this many ms. Default 10000. */
  timeoutMs?: number
}

/** What Runtime knows about an attempted proposal submission. Only an exact
 * returned proposal confirms storage; every attempted request without one is
 * `unconfirmed`, so retry the same immutable proposal rather than creating another. */
export type AgentImprovementProposalSubmissionState = 'not-sent' | 'unconfirmed'

/** Submit a completed measured proposal for product-side review. */
export interface SubmitAgentImprovementProposalOptions {
  proposal: AgentImprovementProposal
  /** Bearer key. Defaults to `process.env.TANGLE_API_KEY`. */
  apiKey?: string
  /** Plane base URL. Defaults to `process.env.TANGLE_INTELLIGENCE_URL` then
   * `https://intelligence.tangle.tools`. */
  baseUrl?: string
  /** fetch impl (tests / non-global-fetch runtimes). Defaults to global fetch. */
  fetchImpl?: typeof fetch
  /** Abort the request after this many ms. Default 10000. */
  timeoutMs?: number
}

/** Typed result for proposal submission. A successful result contains the
 * exact immutable proposal Intelligence recorded. */
export type SubmitAgentImprovementProposalOutcome =
  | { succeeded: true; value: AgentImprovementProposal; status: number }
  | {
      succeeded: false
      submission: AgentImprovementProposalSubmissionState
      error: string
      status?: number
      code?: string
    }

const defaultPlaneRequestTimeoutMs = 10_000

/** Resolve the ONE Intelligence base URL — the single knob both the send and
 *  receive paths derive from. Env fallback: `TANGLE_INTELLIGENCE_URL`. */
export function resolveIntelligenceBaseUrl(baseUrl: string | undefined): string {
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function toDiffProvenance(value: unknown): DiffProvenance {
  const p = asRecord(value)
  return {
    version: typeof p.version === 'number' ? p.version : null,
    lift: typeof p.lift === 'string' ? p.lift : null,
    contentHash: typeof p.contentHash === 'string' ? p.contentHash : '',
    promotedAt: typeof p.promotedAt === 'string' ? p.promotedAt : '',
  }
}

/**
 * Deserialize the composed-endpoint response into a `CertifiedProfile`. The
 * previously-dropped `agentProfileDiffs`/`capabilities`/`agentProfile` are read
 * here so they round-trip to the consumer; a plane that has not yet promoted any
 * diffs simply yields empty arrays / a null profile (fail-closed, never a crash).
 */
export function normalizeCertifiedProfile(raw: unknown): CertifiedProfile {
  const r = asRecord(raw)
  const promptSurface = r.promptSurface ? (r.promptSurface as CertifiedPromptSurface) : null
  const artifacts = (r.artifacts as Record<string, CertifiedArtifact[]> | undefined) ?? {}
  const agentProfileDiffs: ProposedProfileDiff[] = Array.isArray(r.agentProfileDiffs)
    ? r.agentProfileDiffs.map((entry) => {
        const e = asRecord(entry)
        return { diff: e.diff as AgentProfileDiff, provenance: toDiffProvenance(e.provenance) }
      })
    : []
  const capabilities: CertifiedCapabilitySummary[] = Array.isArray(r.capabilities)
    ? (r.capabilities as CertifiedCapabilitySummary[])
    : []
  return {
    target: typeof r.target === 'string' ? r.target : '',
    generatedAt: typeof r.generatedAt === 'string' ? r.generatedAt : '',
    promptSurface,
    artifacts,
    agentProfileDiffs,
    capabilities,
    agentProfile: (r.agentProfile as AgentProfile | null | undefined) ?? null,
  }
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
  const baseUrl = resolveIntelligenceBaseUrl(opts.baseUrl)
  const url = `${baseUrl}/v1/profiles/${encodeURIComponent(opts.target)}/composed`
  let res: Response
  try {
    res = await doFetch(url, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(opts.timeoutMs ?? defaultPlaneRequestTimeoutMs),
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
    return { succeeded: true, value: normalizeCertifiedProfile(await res.json()) }
  } catch (err) {
    return {
      succeeded: false,
      error: `pull response parse failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/**
 * Submit a completed Runtime proposal to Intelligence for product-side review.
 * This never runs an experiment, approves a proposal, or applies a candidate.
 * Any attempted request without an exact returned proposal is `unconfirmed`:
 * callers can retry the same digest because Intelligence stores proposals idempotently.
 */
export async function submitAgentImprovementProposal(
  opts: SubmitAgentImprovementProposalOptions,
): Promise<SubmitAgentImprovementProposalOutcome> {
  let proposal: AgentImprovementProposal
  try {
    proposal = verifyAgentImprovementProposal(opts.proposal)
  } catch (err) {
    return {
      succeeded: false,
      submission: 'not-sent',
      error: `proposal validation failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const doFetch = opts.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined)
  if (!doFetch) {
    return {
      succeeded: false,
      submission: 'not-sent',
      error: 'no fetch implementation available',
    }
  }
  const apiKey = resolveApiKey(opts.apiKey)
  if (!apiKey) {
    return {
      succeeded: false,
      submission: 'not-sent',
      error: 'no apiKey (set TANGLE_API_KEY or opts.apiKey)',
    }
  }

  let res: Response
  try {
    res = await doFetch(`${resolveIntelligenceBaseUrl(opts.baseUrl)}/v1/improvements/proposals`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ proposal }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? defaultPlaneRequestTimeoutMs),
    })
  } catch (err) {
    return {
      succeeded: false,
      submission: 'unconfirmed',
      error: `proposal submission request failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let code: string | undefined
    let message = body.slice(0, 200)
    try {
      const parsed = asRecord(JSON.parse(body))
      if (typeof parsed.error === 'string') code = parsed.error
      if (typeof parsed.message === 'string') message = parsed.message
    } catch {
      // The response body is optional; the attempted request remains unconfirmed either way.
    }
    return {
      succeeded: false,
      // HTTP status explains the response but does not prove the write did not happen.
      submission: 'unconfirmed',
      error: `proposal submission ${res.status}: ${message}`,
      status: res.status,
      ...(code === undefined ? {} : { code }),
    }
  }

  try {
    const response = asRecord(await res.json())
    const recorded = verifyAgentImprovementProposal(response.proposal)
    if (recorded.digest !== proposal.digest) {
      return {
        succeeded: false,
        submission: 'unconfirmed',
        error: 'proposal submission returned a different proposal digest',
        status: res.status,
      }
    }
    return { succeeded: true, value: recorded, status: res.status }
  } catch (err) {
    return {
      succeeded: false,
      submission: 'unconfirmed',
      error: `proposal submission response parse failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
      status: res.status,
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
 * usable certified content. Reads only the prompt-folding slice of a profile.
 */
export function composeCertifiedPrompt(
  base: string,
  certified: Pick<CertifiedProfile, 'promptSurface' | 'artifacts'> | null,
): string {
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
 *  fail-closed semantics as {@link pullCertified}: pulls at most every
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
 * rather than hand-rolling the same lines around `pullCertified`. The
 * `withIntelligence` hook rides this same source for its prompt delivery.
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
