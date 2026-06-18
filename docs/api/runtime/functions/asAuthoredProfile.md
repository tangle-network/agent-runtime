[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / asAuthoredProfile

# Function: asAuthoredProfile()

> **asAuthoredProfile**(`raw`): [`AuthoredProfile`](../interfaces/AuthoredProfile.md) \| `null`

Defined in: [runtime/supervise/authoring.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L33)

Narrow an untyped `spawn_worker` profile argument to an `AuthoredProfile`, or null if the
 supervisor failed to author one (empty/placeholder profile — a skill violation worth catching).

## Parameters

### raw

`unknown`

## Returns

[`AuthoredProfile`](../interfaces/AuthoredProfile.md) \| `null`
