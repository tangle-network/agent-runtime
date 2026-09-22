/**
 * The caller-facing network declaration, and the two things a declaration is allowed to become:
 * a sandbox egress policy, or a refusal.
 *
 * A policy here is a DECLARATION, never an enforcement. Enforcement lives at exactly one place —
 * the sandbox network boundary. Every execution path that cannot reach that boundary must refuse
 * the run rather than approximate it: an executor that spawns on the host inherits the host's
 * network and the agent's own shell defeats every lever we hold there, so a policy applied to it
 * would read as configured and stop nothing. That failure mode — recorded, never enforced — is
 * what let a benchmark worker clone the repository it was being graded on.
 */

import { ValidationError } from '../../errors'

/**
 * What an agent may reach.
 *
 * `gateway` is the default when no policy is declared: deny everything except the one endpoint
 * the agent needs to exist at all. The permissive case is the one that has to be written down,
 * and it carries a `reason` so an audit can ask why.
 */
export type AgentEgressPolicy =
  | { mode: 'blocked' }
  | { mode: 'gateway' }
  | { mode: 'strict'; allowDomains: ReadonlyArray<string> }
  | { mode: 'open'; reason: string }

/** Applied when a profile declares nothing. Deny-by-default, minus the model endpoint. */
export const DEFAULT_EGRESS_POLICY: AgentEgressPolicy = { mode: 'gateway' }

/**
 * The sandbox SDK's policy shape (`@tangle-network/sandbox` `EgressPolicy`), reproduced
 * structurally so this module does not depend on the SDK at runtime.
 *
 * `includeImplicitDomains` is never `true` here. The SDK's default implicit list carries
 * `github.com`, `codeload.github.com` and `**.githubusercontent.com`, so `mode: 'strict'` alone
 * would not have stopped the leak this work exists to close.
 */
export interface SandboxEgressPolicy {
  mode: 'strict' | 'blocked'
  allowDomains?: string[]
  includeImplicitDomains?: false
}

const RANK: Record<AgentEgressPolicy['mode'], number> = {
  blocked: 0,
  gateway: 1,
  strict: 2,
  open: 3,
}

/** How permissive a policy is. Used to reject any override that would widen a profile's grant. */
export function egressRank(policy: AgentEgressPolicy): number {
  return RANK[policy.mode]
}

/** Human-readable form for error messages and metadata. */
export function describeEgressPolicy(policy: AgentEgressPolicy): string {
  if (policy.mode === 'strict') {
    return policy.allowDomains.length > 0
      ? `strict(${[...policy.allowDomains].join(', ')})`
      : 'strict(model only)'
  }
  return policy.mode
}

/** Validate an untyped declaration (profile metadata, seam input, task config) into a policy. */
export function parseEgressPolicy(value: unknown, source: string): AgentEgressPolicy {
  if (!value || typeof value !== 'object') {
    throw new ValidationError(`${source}: network policy must be an object`)
  }
  const raw = value as { mode?: unknown; allowDomains?: unknown; reason?: unknown }
  switch (raw.mode) {
    case 'blocked':
      return { mode: 'blocked' }
    case 'gateway':
      return { mode: 'gateway' }
    case 'strict': {
      if (!Array.isArray(raw.allowDomains)) {
        // An absent list is not "allow nothing extra" by accident — spell it `[]` or use
        // `gateway`, so the two readings can never diverge.
        throw new ValidationError(
          `${source}: network mode "strict" requires allowDomains (use [] or mode "gateway" for model-only)`,
        )
      }
      const allowDomains = raw.allowDomains.map((domain) => {
        if (typeof domain !== 'string' || !domain.trim()) {
          throw new ValidationError(`${source}: network allowDomains entries must be non-empty`)
        }
        return domain.trim()
      })
      if (new Set(allowDomains).size !== allowDomains.length) {
        throw new ValidationError(`${source}: network allowDomains must not contain duplicates`)
      }
      return { mode: 'strict', allowDomains }
    }
    case 'open': {
      if (typeof raw.reason !== 'string' || !raw.reason.trim()) {
        // Opting out of enforcement is the dangerous case; it costs a sentence.
        throw new ValidationError(
          `${source}: network mode "open" requires a non-empty reason recording why this work is trusted`,
        )
      }
      return { mode: 'open', reason: raw.reason.trim() }
    }
    default:
      throw new ValidationError(
        `${source}: network mode must be one of blocked | gateway | strict | open`,
      )
  }
}

/** A profile that declares a network policy, on either the 0.41 field or today's metadata. */
interface EgressDeclaringProfile {
  name?: string
  network?: unknown
  metadata?: Record<string, unknown> | undefined
}

/**
 * Read a profile's declaration. `profile.network` is the shape agent-interface 0.41 will carry;
 * `metadata.network` is the same declaration on the published 0.40 profile type, so callers can
 * declare a policy today without waiting on the interface bump.
 */
export function readProfileEgressPolicy(profile: EgressDeclaringProfile): AgentEgressPolicy {
  const declared = profile.network ?? profile.metadata?.network
  if (declared === undefined) return DEFAULT_EGRESS_POLICY
  return parseEgressPolicy(declared, `profile "${profile.name ?? 'unnamed'}"`)
}

/**
 * Combine a profile's declaration with a per-run override. An override may only NARROW: a run may
 * decide it needs less than the profile grants, never more. Widening at the call site would make
 * the profile's declaration unreadable as a bound, which is the only property that makes shipping
 * a profile around safe.
 */
export function resolveEgressPolicy(
  profile: EgressDeclaringProfile,
  override?: AgentEgressPolicy,
): AgentEgressPolicy {
  const declared = readProfileEgressPolicy(profile)
  if (!override) return declared
  if (egressRank(override) > egressRank(declared)) {
    throw new ValidationError(
      `network override ${describeEgressPolicy(override)} is more permissive than the profile's ` +
        `${describeEgressPolicy(declared)}; a run may narrow a profile's network grant, never widen it`,
    )
  }
  if (override.mode === 'strict' && declared.mode === 'strict') {
    const allowed = new Set(declared.allowDomains)
    const extra = override.allowDomains.filter((domain) => !allowed.has(domain))
    if (extra.length > 0) {
      throw new ValidationError(
        `network override adds domains the profile does not grant: ${extra.join(', ')}`,
      )
    }
  }
  return override
}

/**
 * Translate a declaration into the sandbox boundary's policy. Returns `undefined` for `open` —
 * the one case with no boundary to configure.
 *
 * `modelHosts` is resolved by the runtime, never typed by the caller: making every caller name
 * the gateway host is how a run either dies (host forgotten) or couples itself to gateway config.
 */
export function toSandboxEgressPolicy(
  policy: AgentEgressPolicy,
  modelHosts: ReadonlyArray<string>,
): SandboxEgressPolicy | undefined {
  switch (policy.mode) {
    case 'open':
      return undefined
    case 'blocked':
      // Deliberately excludes the model host: `blocked` means the process is not expected to
      // perform inference at all.
      return { mode: 'blocked' }
    case 'gateway':
      return strictPolicy(modelHosts, [])
    case 'strict':
      return strictPolicy(modelHosts, policy.allowDomains)
  }
}

function strictPolicy(
  modelHosts: ReadonlyArray<string>,
  extra: ReadonlyArray<string>,
): SandboxEgressPolicy {
  if (modelHosts.length === 0) {
    throw new ValidationError(
      'network policy needs at least one model host to remain reachable; resolve the model base URL before creating the sandbox',
    )
  }
  return {
    mode: 'strict',
    allowDomains: [...new Set([...modelHosts, ...extra])],
    includeImplicitDomains: false,
  }
}

/** Where a model base URL can be read from, most specific first. */
export interface ModelHostSource {
  /** The resolved backend base URL, when the caller already has one. */
  baseUrl?: string | undefined
  /** Environment to fall back to. Defaults to `process.env`. */
  env?: Record<string, string | undefined>
}

const MODEL_BASE_URL_ENV = [
  'TANGLE_ROUTER_URL',
  'OPENCODE_MODEL_BASE_URL',
  'OPENAI_BASE_URL',
  'ANTHROPIC_BASE_URL',
] as const

/** Used when nothing names a base URL. Every Tangle agent routes through this one host. */
export const DEFAULT_MODEL_HOST = 'router.tangle.tools'

/**
 * Resolve the hostnames a policy must keep reachable so the agent can call its own model.
 *
 * A malformed base URL throws rather than falling back to the default host: silently allowlisting
 * the router while the run actually points somewhere else produces a sandbox that looks correctly
 * configured and cannot reach its model.
 */
export function resolveModelHosts(source: ModelHostSource = {}): string[] {
  const env = source.env ?? process.env
  const candidates = [source.baseUrl, ...MODEL_BASE_URL_ENV.map((key) => env[key])]
  for (const candidate of candidates) {
    if (!candidate?.trim()) continue
    let hostname: string
    try {
      hostname = new URL(candidate.trim()).hostname
    } catch {
      throw new ValidationError(
        `model base URL "${candidate}" is not a valid URL; cannot derive the host a network policy must allow`,
      )
    }
    if (!hostname) {
      throw new ValidationError(`model base URL "${candidate}" carries no hostname`)
    }
    return [hostname]
  }
  return [DEFAULT_MODEL_HOST]
}

/**
 * Refuse an execution path that has no network boundary.
 *
 * `piExecutor`, `bridgeExecutor` and `cliExecutor` spawn or call out from the HOST process tree
 * with the host's environment. Proxy environment variables are advisory there — `unset
 * HTTPS_PROXY`, `curl --noproxy '*'`, or a raw socket all ignore them, and a seam's own `args`
 * are appended after the runtime's flags — so no policy stricter than `open` can be honoured.
 * Refusing is the only honest answer; the alternative is a run that reports a policy it never had.
 */
export function assertHostExecutionAllowed(
  policy: AgentEgressPolicy,
  executor: string,
  remedy: string,
): void {
  if (policy.mode === 'open') return
  throw new ValidationError(
    `${executor} runs on the host and cannot enforce network policy (mode=${policy.mode}). ` +
      `${remedy} — or set network:{mode:'open',reason:'...'} on the profile if this work is trusted.`,
  )
}
