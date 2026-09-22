> **Import:** `@tangle-network/agent-runtime/intelligence`

# Tangle Intelligence

Intelligence records agent runs and delivers approved context to running agents.
It does not deliver tools, credentials, executable files, MCP servers, or AgentProfile changes.
Use AgentProfile and agent-integrations for executable capabilities.

## Choose An Entry Point

| Need | API |
|---|---|
| Record runs and receive context | `withIntelligence(...)` |
| Pull context once | `pullCertifiedContext(...)` |
| Cache and refresh context | `createCertifiedContextSource(...)` |
| Materialize a prompt and safe files | `composeCertifiedContext(...)` |
| Record runs without wrapping an agent | `createIntelligenceClient(...)` |

## Wrap An Agent

```ts
import { withIntelligence } from '@tangle-network/agent-runtime/intelligence'

const agent = withIntelligence(
  async (input, intelligence) => {
    const output = await runProductAgent(input, {
      systemPrompt: intelligence.composePrompt(BASE_SYSTEM_PROMPT),
    })

    intelligence.record({
      success: true,
      usage: { inferenceUsd: 0.002, intelligenceUsd: 0 },
    })
    return output
  },
  {
    tenantId,
    project: 'support-agent',
    target: 'support-agent',
    onCertifiedContext: (context) => auditContextChange(context),
    onCertifiedContextReject: (error) => reportContextRejection(error),
  },
)
```

Each call refreshes context, runs the agent, and queues one typed `RunRecord`.
Agent errors are recorded and rethrown.
Pull and export failures do not fail the agent call.

The callback receives:

| Field | Meaning |
|---|---|
| `runId`, `traceId` | IDs shared by the run and child events |
| `certifiedContext` | Current immutable `CertifiedContext`, or `null`; the accessor returns `null` immediately after expiry |
| `composePrompt(base)` | Append approved inline context in stable order |
| `record(report)` | Add outcome, usage, events, and metadata |

The wrapped function also exposes `refresh()`, `currentCertifiedContext()`, and `flush()`.
`onCertifiedContextReject` reports malformed checkpoints, rollback, equal-revision conflicts, and incompatible endpoints to the wrapper.
Observer exceptions are isolated from context delivery and agent execution.

## Delivery

Runtime requests:

```text
GET {baseUrl}/v1/contexts/:target/certified
Authorization: Bearer <TANGLE_API_KEY>
```

The response contains:

```ts
interface CertifiedContext {
  readonly tenantId: string
  readonly target: string
  readonly state: 'active' | 'revoked'
  readonly revision: string
  readonly generatedAt: string
  readonly expiresAt: string
  readonly entries: readonly CertifiedContextEntry[]
  readonly contentHash: `sha256:${string}`
}
```

Prompts and instructions are inline.
Skills are safe relative files.
The Interface parser rejects unknown fields, unsafe paths, duplicate IDs or paths, stale hashes, responses over 16 MiB, and lifetimes over 15 minutes.
It clones and recursively freezes accepted responses.
Runtime also requires the response tenant and target to match the request.
Each tenant and target has a monotonic revision.
Revocation is a higher revision with `state: 'revoked'`, not a `404`.

The default service origin is trusted automatically.
For another HTTPS service, list its exact origin in `trustedBaseOrigins`.
Local HTTP requires `allowInsecureLoopback: true`.
Runtime rejects unsafe base URLs before sending the API key and never follows redirects.

## Pull And Cache

```ts
import { createCertifiedContextSource } from '@tangle-network/agent-runtime/intelligence'

const source = createCertifiedContextSource({
  tenantId,
  target: 'support-agent',
  refreshMs: 300_000,
  checkpointStore: {
    load: ({ tenantId, target }) => checkpointDb.get({ tenantId, target }),
    save: (checkpoint) => checkpointDb.retainHighest(checkpoint),
  },
})

await source.refresh()
const context = source.current()
const systemPrompt = await source.compose(BASE_SYSTEM_PROMPT)
```

`pullCertifiedContext(...)` returns a typed outcome instead of throwing for HTTP or network failures.
A transient failure keeps the last valid context until it expires.
HTTP 401 and 403 responses clear cached context immediately, even when their response body is oversized or unreadable.
An explicit revoked revision clears context and prevents replay of older active revisions.
A `404` is treated as an incompatible endpoint, not as revocation.
Expired context is never returned and triggers a new pull inside the normal refresh interval.
Concurrent refreshes share one request.

`checkpointStore` persists the highest accepted revision, content hash, and state for one tenant and target.
Runtime validates the loaded checkpoint and saves a higher revision before exposing its context.
Rollback and equal-revision content or state conflicts are rejected.
The store must atomically retain the highest revision and reject rollback or equal-revision conflicts when multiple sources write concurrently.
Without `checkpointStore`, rollback protection lasts only for the lifetime of that `CertifiedContextSource`.

Only inline entries enter the system prompt.
File entries are available through `composeCertifiedContext(...)`.
Runtime never executes delivered content.

## Direct Observation

Use `createIntelligenceClient(config)` when the wrapper does not fit the product entry point.

- `client.traceRun(meta, fn)` records one function call.
- `client.recordTrace(events, meta)` exports a `LoopTraceEvent` tree.
- `client.exportRunRecord(record)` exports an existing typed record.
- `client.flush()` waits for buffered spans and returns delivered, undelivered, and dropped counts.
- `client.doctor()` checks local configuration without a network call.

Set `telemetryExport` to control batching, queue capacity, retry timing, request deadlines, response limits, and the `onDrop` callback.
Normal trace recording remains best effort.
An explicit `flush()` never hides collector failure or queue loss:

```ts
const delivery = await client.flush()
if (!delivery.succeeded) {
  throw new Error(
    delivery.error ??
      `${delivery.undeliveredSpans} spans undelivered; ${delivery.droppedSpans} dropped`,
  )
}
```

Every exported input and output passes through the configured `Redactor`.
The default redactor scrubs common secret fields, tokens, credentials, private keys, and email addresses.
Use a product-specific redactor when the default rules are insufficient.

## Operating Rules

- Pass the authenticated `tenantId`.
- Set `TANGLE_API_KEY` or pass `apiKey`.
- Omit `apiKey` to read `TANGLE_API_KEY`; an explicit empty string disables authentication.
- Trust custom service origins explicitly.
- Call `flush()` before a short-lived process exits and inspect its result.
- Record inference and Intelligence spend separately.
- Enable full payload export only after product-specific redaction.
