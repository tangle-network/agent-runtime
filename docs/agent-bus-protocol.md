# Agent-Bus Protocol

The wire-level contract that makes agent-to-agent communication composable across organizational and cloud boundaries. agent-runtime emits these headers on every outbound participant call; agent-gateway reads them on inbound and enforces the depth limit. Any third party can publish a gateway-fronted agent and participate, billed correctly, traced consistently, recursion-bounded.

This document is **normative**. agent-runtime + agent-gateway implementations MUST honor every section; downstream agent endpoints MAY rely on the contract.

## Headers

All header names are lowercased on the wire. Implementations MUST be case-insensitive on read.

| Header | Direction | Purpose |
|---|---|---|
| `x-tangle-forwarded-authorization` | inbound+outbound | The original user's `Bearer sk-tan-<user>` (or `Bearer <x402-token>`). Forwarded verbatim through every hop so the final billed party is always the human/agent that initiated the request, not whichever intermediate agent made the call. |
| `x-tangle-forwarded-depth` | inbound+outbound | Hop counter. Origin caller MUST omit or set to `0`. Every gateway / runtime MUST increment by 1 before forwarding. Recipients MUST refuse with HTTP `429 Too Many Requests` + body code `bridge_depth_exceeded` when the inbound depth ≥ `DEFAULT_MAX_DEPTH` (4 unless overridden via the `CLI_BRIDGE_MAX_DEPTH` env var). |
| `x-tangle-runid` | inbound+outbound | The top-level conversation's run identifier. Propagated unchanged through all nested calls so all hops correlate to one run. |
| `x-tangle-turnid` | outbound | This specific call's deterministic turn identifier. Format: `<runId>.t<index>.<speakerSlug>`. Stable across retries of the same logical turn; caching gateways MAY treat repeated turn ids as idempotency keys and return cached results. |
| `x-tangle-parent-turnid` | outbound (recursion) | When the call is *inside* another turn (i.e. the caller is itself a participant in a higher-order conversation), the enclosing turn's id. Used for trace stitching. Omit when at the top level. |
| `x-tangle-speaker` | outbound | The logical conversation-peer label at the sending side (e.g. `researcher`, `critic`). Cosmetic but useful for trace tagging and dashboard filtering. |

## Invariants

1. **Depth monotonicity.** A receiving runtime MUST NOT decrement, reset, or omit the depth counter on outbound calls. A misbehaving intermediate that resets depth breaks the recursion bound for everyone downstream.
2. **Authorization preservation.** A receiving runtime MUST forward `x-tangle-forwarded-authorization` verbatim on any outbound call it makes on behalf of the original caller. Substituting its own credentials silently re-bills the user incorrectly.
3. **runId immutability.** A nested conversation invoked via `createConversationBackend` does NOT mint a new `x-tangle-runid` — it inherits the parent's. (It does mint new `turnId`s, which include its own run scope.)
4. **Idempotency contract (advisory).** Gateways MAY dedupe by `(runId, turnId)`. If they do, they MUST return the cached response unchanged. If they don't, retries cost N× credits — that's the caller's choice.
5. **Refusal granularity.** Depth-limit refusal MUST be HTTP `429 Too Many Requests` with body code `bridge_depth_exceeded` and a message describing the observed inbound depth + configured limit, so the caller can route around (or accept) the limit instead of treating it as a generic rate-limit error. `tangle-router` implements this today; `agent-gateway` middleware is a follow-up (see *Implementation status* below).

## Worked example

User triggers conversation. The driver runs on machine M.

```
USER → router.tangle.tools (POST /v1/chat/completions, bridge/sandbox/researcher)
  ↓ Authorization: Bearer sk-tan-user-123
  ↓ X-Tangle-Forwarded-Depth: 0 (origin)
router → researcher-sandbox-A (us-east)
  ↓ X-Tangle-Forwarded-Authorization: Bearer sk-tan-user-123
  ↓ X-Tangle-Forwarded-Depth: 1
  ↓ X-Tangle-RunId: conv_abc
  ↓ X-Tangle-TurnId: conv_abc.t0.researcher
sandbox-A's agent decides to call agent-runtime conversation for critic-review
  ↓ runConversation({ participants: [..., bridge/sandbox/critic], inboundDepth: 1 })
agent-runtime → critic-sandbox-B (eu-west)
  ↓ X-Tangle-Forwarded-Authorization: Bearer sk-tan-user-123
  ↓ X-Tangle-Forwarded-Depth: 2
  ↓ X-Tangle-RunId: conv_abc                  (preserved through hops)
  ↓ X-Tangle-TurnId: conv_abc.t0.critic       (new, scoped to nested run)
  ↓ X-Tangle-Parent-TurnId: conv_abc.t0.researcher   (recursion link)
```

At depth 4, a gateway refuses with 429 — the chain stops there, sk-tan-user-123 is billed for hops 1–4 only, the trace shows the refusal point.

## Implementation contract for endpoint authors

A `@tangle-network/agent-gateway`-fronted endpoint:
- MUST read `x-tangle-forwarded-depth` on inbound, default 0, refuse with 429 when ≥ `DEFAULT_MAX_DEPTH`.
- MUST honor `x-tangle-forwarded-authorization` if present, using it as the effective billing identity instead of the direct caller's auth (when the direct caller is whitelisted as an inter-agent caller).
- SHOULD propagate `x-tangle-runid`, `x-tangle-turnid`, `x-tangle-parent-turnid` into its own trace records.
- MAY use `(runId, turnId)` as an idempotency key to dedupe retries.

A `@tangle-network/agent-runtime` consumer (driver code):
- Passes `propagatedHeaders` + `inboundDepth` + `parentTurnId` to `runConversation` / `runConversationStream` from its inbound request context.
- The runtime derives `buildForwardHeaders(...)` and exposes the result as `AgentBackendContext.propagatedHeaders` on every participant backend call.
- A caller-owned HTTP backend MUST merge `context.propagatedHeaders` into its outbound request; Runtime does not issue provider HTTP on its behalf.

## Reference

- `@tangle-network/agent-runtime` (root) — `buildForwardHeaders`, `turnId`, depth parsing, the call-policy
  primitives, and the durable conversation journal all export from the package root (`src/index.ts`);
  there are no protocol-specific subpaths.
- `@tangle-network/agent-gateway` — Hono middleware for inbound enforcement.

## Implementation status

The spec describes the *conformant* behavior of every layer. The live adoption state (per the package's current exports) is:

| Layer | Header emit | Header read | Depth refusal (429) | Authorization preservation |
|---|---|---|---|---|
| `agent-runtime` (`runConversation`) | ✅ all six on every backend call | n/a (caller-supplied) | n/a (no inbound) | ✅ forwarded verbatim |
| `tangle-router` | ✅ depth + authorization on outbound bridge dispatch | ✅ reads inbound depth | ✅ HTTP 429 `bridge_depth_exceeded` at `CLI_BRIDGE_MAX_DEPTH` (default 4) | ✅ forwards into cli-bridge |
| `cli-bridge` | ❌ (inherits via router) | ✅ reads `x-tangle-forwarded-authorization`, threads to sandbox backend | ⚠️ not enforced locally; relies on tangle-router upstream | ✅ propagates as `forwardedAuthorization` metadata |
| `agent-gateway` (Hono middleware) | n/a | ❌ does not yet read forwarded headers | ❌ not yet implemented | ❌ does not yet use forwarded auth as effective billing identity |

Practical implication today: any agent-to-agent recursion that touches `tangle-router` (the common case — `bridge/sandbox/*` dispatches) is depth-bounded. A direct call from one `agent-gateway`-fronted endpoint to another, bypassing the router, currently has no depth guard — but no production agent does this yet. The agent-gateway middleware is tracked but not built; first real consumer drives the work.

## Versioning

This protocol is currently `v0`. Breaking changes will bump to `v1` and add a `x-tangle-protocol-version` header; until then there is no version header (implicit `v0`). Additive headers do not require a version bump.
