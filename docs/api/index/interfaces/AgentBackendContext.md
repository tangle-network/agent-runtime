[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / AgentBackendContext

# Interface: AgentBackendContext

Defined in: [types.ts:460](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L460)

## Stable

## Properties

### task

> **task**: [`AgentTaskSpec`](AgentTaskSpec.md)

Defined in: [types.ts:461](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L461)

***

### knowledge

> **knowledge**: `KnowledgeReadinessReport`

Defined in: [types.ts:462](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L462)

***

### session

> **session**: `RuntimeSession`

Defined in: [types.ts:463](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L463)

***

### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [types.ts:464](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L464)

***

### runId?

> `optional` **runId?**: `string`

Defined in: [types.ts:470](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L470)

Conversation/run identifier when this call is part of a multi-agent run.
Backends should stamp it into any trace/log emission so cross-participant
events correlate. Absent when the call is a stand-alone `runAgentTask`.

***

### turnId?

> `optional` **turnId?**: `string`

Defined in: [types.ts:475](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L475)

Deterministic turn id for this single call. Stable across retries of the
same logical turn so a caching gateway / idempotent backend can dedupe.

***

### parentTurnId?

> `optional` **parentTurnId?**: `string`

Defined in: [types.ts:481](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L481)

If this call is itself nested inside a higher-order conversation
(recursion via `createConversationBackend`), the enclosing turn's id.
Used for trace stitching across nested orchestration.

***

### propagatedHeaders?

> `optional` **propagatedHeaders?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [types.ts:488](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L488)

Headers to forward verbatim to any outbound HTTP the backend issues:
`X-Tangle-Forwarded-Authorization`, `X-Tangle-Forwarded-Depth`,
run/turn correlation. Backends that issue HTTP MUST merge these into
the outbound request; backends that don't issue HTTP may ignore them.
