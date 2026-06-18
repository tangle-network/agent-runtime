[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / LoopTeardownFailedPayload

# Interface: LoopTeardownFailedPayload

Defined in: [runtime/types.ts:464](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L464)

**`Experimental`**

Emitted when a box's `delete()` throws or times out during teardown — the
 loop swallows the failure (platform reaps on expiry) but surfaces it here so
 a real leak (e.g. mid-loop auth expiry) is observable.

## Properties

### sandboxId?

> `optional` **sandboxId?**: `string`

Defined in: [runtime/types.ts:465](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L465)

**`Experimental`**

***

### reason

> **reason**: `string`

Defined in: [runtime/types.ts:467](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L467)

**`Experimental`**

`'timeout'` or the delete error message.
