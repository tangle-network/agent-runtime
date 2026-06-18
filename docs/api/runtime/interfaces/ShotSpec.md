[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / ShotSpec

# Interface: ShotSpec

Defined in: [runtime/strategy.ts:690](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L690)

## Properties

### handle?

> `optional` **handle?**: [`ArtifactHandle`](ArtifactHandle.md)

Defined in: [runtime/strategy.ts:692](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L692)

present ⇒ continue this artifact (depth); absent ⇒ the shot opens a fresh one (sample/restart).

***

### messages?

> `optional` **messages?**: `Msg`[]

Defined in: [runtime/strategy.ts:693](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L693)

***

### steer?

> `optional` **steer?**: `string`

Defined in: [runtime/strategy.ts:694](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L694)

***

### persona?

> `optional` **persona?**: [`ShotPersona`](ShotPersona.md)

Defined in: [runtime/strategy.ts:695](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L695)

***

### tools?

> `optional` **tools?**: `string`[]

Defined in: [runtime/strategy.ts:698](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L698)

Restrict THIS shot to a subset of the domain's tools (by name) — focus a shot on
 the relevant capabilities. Restriction-only; unknown names throw. Omitted ⇒ all.
