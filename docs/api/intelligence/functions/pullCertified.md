[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / pullCertified

# Function: pullCertified()

> **pullCertified**(`opts`): `Promise`\<[`PullOutcome`](../type-aliases/PullOutcome.md)\>

Defined in: [intelligence/delivery.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L106)

Pull the certified composed profile for a target. Fail-closed: a network
error or a non-2xx returns a typed `succeeded: false` (never throws), so a
caller can run on its base surface when Intelligence is unreachable. A 404 is
the normal "nothing promoted yet" signal, carried as `status: 404`.

## Parameters

### opts

[`PullCertifiedOptions`](../interfaces/PullCertifiedOptions.md)

## Returns

`Promise`\<[`PullOutcome`](../type-aliases/PullOutcome.md)\>
