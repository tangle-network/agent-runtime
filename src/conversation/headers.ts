/**
 * @stable
 *
 * Cross-gateway forwarding headers — the wire-level contract that makes
 * agent-to-agent communication composable across organizational boundaries.
 * Every header here is read on inbound and re-emitted on outbound, so a chain
 * `caller → A's gateway → A's runtime → B's gateway → B's runtime` ends with
 * B billing the original user, the depth counter monotonically incremented,
 * and the run/turn correlation IDs preserved end-to-end.
 *
 * The actual depth refusal (HTTP 413 at MAX_DEPTH) is enforced by
 * `agent-gateway`'s middleware; this module owns the names + the propagation
 * rules so both sides agree.
 *
 * Full protocol: `docs/agent-bus-protocol.md`.
 */

/** Standard names — lowercased so Headers maps interop on every runtime. */
export const FORWARD_HEADERS = {
  /** Forwarded original-user identity (`Bearer sk-tan-<user>`); downstream gateways bill against this. */
  authorization: 'x-tangle-forwarded-authorization',
  /** Monotonically incremented on every gateway hop. Refused at MAX_DEPTH. */
  depth: 'x-tangle-forwarded-depth',
  /** Top-level conversation run identifier, propagated through every nested call. */
  runId: 'x-tangle-runid',
  /** This call's turn within the run; deterministic + stable across retries. */
  turnId: 'x-tangle-turnid',
  /** When the call is *inside* another turn (recursion), the parent turn's id. */
  parentTurnId: 'x-tangle-parent-turnid',
  /** Logical conversation peer label at the sending side, for trace stitching. */
  speaker: 'x-tangle-speaker',
} as const

export type ForwardHeaderName = (typeof FORWARD_HEADERS)[keyof typeof FORWARD_HEADERS]

/** Hard cap on chained gateway hops; refused beyond this. Default keeps recursion bounded. */
export const DEFAULT_MAX_DEPTH = 4

/**
 * Lowercase a header lookup so we read the same key regardless of source
 * casing (Hono, fetch's `Headers`, raw Node IncomingMessage, …).
 */
function lc(name: string): string {
  return name.toLowerCase()
}

/**
 * Read the depth counter off an inbound request. Missing → 0 (caller is the
 * origin). Non-integer → throws — silent coercion would let a bad caller
 * reset depth and bypass the limit.
 */
export function readDepth(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): number {
  const raw = pickHeader(headers, FORWARD_HEADERS.depth)
  if (raw === undefined || raw === '') return 0
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(
      `invalid ${FORWARD_HEADERS.depth} header value '${raw}' — must be a non-negative integer`,
    )
  }
  return n
}

/**
 * Refuse further forwarding when the inbound depth has reached the limit.
 * Callers (the gateway middleware) translate the boolean to an HTTP 413.
 */
export function isDepthExceeded(inboundDepth: number, max: number = DEFAULT_MAX_DEPTH): boolean {
  return inboundDepth >= max
}

/**
 * Build the headers to emit on an outbound participant call, given the
 * conversation's propagation context. Depth is incremented from the inbound
 * value; runId / turnId / speaker stamp the current hop; the user's
 * `Authorization` is preserved verbatim so the downstream gateway bills the
 * right wallet.
 */
export function buildForwardHeaders(input: {
  inboundDepth: number
  forwardedAuthorization?: string
  runId: string
  turnId: string
  parentTurnId?: string
  speaker: string
}): Record<string, string> {
  const out: Record<string, string> = {
    [FORWARD_HEADERS.depth]: String(input.inboundDepth + 1),
    [FORWARD_HEADERS.runId]: input.runId,
    [FORWARD_HEADERS.turnId]: input.turnId,
    [FORWARD_HEADERS.speaker]: input.speaker,
  }
  if (input.forwardedAuthorization !== undefined) {
    out[FORWARD_HEADERS.authorization] = input.forwardedAuthorization
  }
  if (input.parentTurnId !== undefined) {
    out[FORWARD_HEADERS.parentTurnId] = input.parentTurnId
  }
  return out
}

/**
 * Header bag carried through `AgentBackendContext.propagatedHeaders` so
 * backends that opt in can merge them into their outbound HTTP requests.
 * Distinct from `buildForwardHeaders` so callers can attach extra
 * non-protocol headers (e.g. tracing) without colliding.
 */
export type PropagatedHeaders = Readonly<Record<string, string>>

function pickHeader(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | undefined {
  const target = lc(name)
  for (const key of Object.keys(headers)) {
    if (lc(key) === target) {
      const value = headers[key]
      if (Array.isArray(value)) return value[0]
      return value
    }
  }
  return undefined
}
