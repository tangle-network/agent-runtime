[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegationRecord

# Interface: DelegationRecord

Defined in: [mcp/task-queue.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L65)

**`Experimental`**

Must be JSON-safe end to end (`args`, `result`, `error`, `feedback`) —
persistent stores round-trip records through `JSON.stringify`.

## Properties

### taskId

> **taskId**: `string`

Defined in: [mcp/task-queue.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L66)

**`Experimental`**

***

### profile

> **profile**: [`DelegationProfile`](../type-aliases/DelegationProfile.md)

Defined in: [mcp/task-queue.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L67)

**`Experimental`**

***

### namespace?

> `optional` **namespace?**: `string`

Defined in: [mcp/task-queue.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L68)

**`Experimental`**

***

### args

> **args**: `AnyDelegateArgs`

Defined in: [mcp/task-queue.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L69)

**`Experimental`**

***

### status

> **status**: [`DelegationStatus`](../type-aliases/DelegationStatus.md)

Defined in: [mcp/task-queue.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L70)

**`Experimental`**

***

### progress?

> `optional` **progress?**: [`DelegationProgress`](DelegationProgress.md)

Defined in: [mcp/task-queue.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L71)

**`Experimental`**

***

### result?

> `optional` **result?**: [`DelegationResultPayload`](../type-aliases/DelegationResultPayload.md)

Defined in: [mcp/task-queue.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L72)

**`Experimental`**

***

### error?

> `optional` **error?**: [`DelegationError`](DelegationError.md)

Defined in: [mcp/task-queue.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L73)

**`Experimental`**

***

### costUsd?

> `optional` **costUsd?**: `number`

Defined in: [mcp/task-queue.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L74)

**`Experimental`**

***

### startedAt

> **startedAt**: `string`

Defined in: [mcp/task-queue.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L75)

**`Experimental`**

***

### completedAt?

> `optional` **completedAt?**: `string`

Defined in: [mcp/task-queue.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L76)

**`Experimental`**

***

### idempotencyKey?

> `optional` **idempotencyKey?**: `string`

Defined in: [mcp/task-queue.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L78)

**`Experimental`**

Sha-prefix hash of the canonical input — used for idempotency lookup.

***

### detachedSessionRef?

> `optional` **detachedSessionRef?**: `string`

Defined in: [mcp/task-queue.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L85)

**`Experimental`**

Caller-generated deterministic id of a detached run (e.g. the sandbox
session id a single-tick driver resumes by). Presence is what makes a
restored in-flight record resumable via `resumeDelegate`; without it a
restart settles the record as failed.

***

### feedback

> **feedback**: [`DelegationFeedbackSnapshot`](DelegationFeedbackSnapshot.md)[]

Defined in: [mcp/task-queue.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L87)

**`Experimental`**

Feedback events keyed by this delegation's taskId.

***

### trace?

> `optional` **trace?**: [`DelegationTraceSpan`](DelegationTraceSpan.md)[]

Defined in: [mcp/task-queue.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L94)

**`Experimental`**

Compact loop-trace span tree teed from the delegation's run, oldest
spans first. Appended when a delegated loop reaches `loop.ended` and
settled (partial buffers included) at the terminal transition. Capped
via `capDelegationTrace` — see `traceTruncated`.

***

### traceTruncated?

> `optional` **traceTruncated?**: `true`

Defined in: [mcp/task-queue.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L96)

**`Experimental`**

Present when oldest trace spans were dropped to honor the trace caps.

***

### traceId?

> `optional` **traceId?**: `string`

Defined in: [mcp/task-queue.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L103)

**`Experimental`**

Inherited trace identity (the queue's `traceContext` at submit time —
typically `readTraceContextFromEnv()`), distinct from the span payload:
a journal consumer joins records into the parent trace by these ids
without parsing spans. Restored records keep their persisted identity.

***

### parentSpanId?

> `optional` **parentSpanId?**: `string`

Defined in: [mcp/task-queue.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L105)

**`Experimental`**

Caller span that dispatched the delegation, when one was inherited.
