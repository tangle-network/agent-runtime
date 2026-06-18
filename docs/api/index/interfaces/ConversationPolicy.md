[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / ConversationPolicy

# Interface: ConversationPolicy

Defined in: [conversation/types.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L107)

## Stable

## Properties

### maxTurns

> **maxTurns**: `number`

Defined in: [conversation/types.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L109)

Hard cap on speaker-turns. Each call into a participant's backend counts as 1.

***

### maxCreditsCents?

> `optional` **maxCreditsCents?**: `number`

Defined in: [conversation/types.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L116)

Hard cap on aggregate credit spend across all participants, in cents.
Computed by summing `llm_call.costUsd` from every participant's stream.
Unset (`undefined`) means no credit ceiling — the run is bounded only by
`maxTurns` and `haltOn`.

***

### turnOrder?

> `optional` **turnOrder?**: [`TurnOrder`](../type-aliases/TurnOrder.md)

Defined in: [conversation/types.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L121)

Speaker selection. Defaults to `'alternate'` for two-participant
conversations and `'round-robin'` for any other arity.

***

### haltOn?

> `optional` **haltOn?**: [`HaltPredicate`](../type-aliases/HaltPredicate.md)

Defined in: [conversation/types.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L126)

Optional convergence / content-based halt. Called after every turn ends;
returning truthy stops the loop with `{ kind: 'predicate', ... }`.

***

### defaultCallPolicy?

> `optional` **defaultCallPolicy?**: [`BackendCallPolicy`](BackendCallPolicy.md)

Defined in: [conversation/types.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L132)

Default per-turn resilience policy applied to every participant call
(deadline, retries, circuit breaker). Individual participants may
override via `ConversationParticipant.callPolicy`.
