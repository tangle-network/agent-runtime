[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / DelegatedLoopResult

# Interface: DelegatedLoopResult\<T\>

Defined in: [loop-runner.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L75)

**`Experimental`**

Uniform result — never throws from a registered runner; a
 thrown engine becomes `{ ok: false, error }` so a routine can record + move on.

## Type Parameters

### T

`T` = `unknown`

## Properties

### mode

> **mode**: `"code"` \| `"review"` \| `"research"` \| `"audit"` \| `"self-improve"`

Defined in: [loop-runner.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L76)

**`Experimental`**

***

### ok

> **ok**: `boolean`

Defined in: [loop-runner.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L77)

**`Experimental`**

***

### output?

> `optional` **output?**: `T`

Defined in: [loop-runner.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L78)

**`Experimental`**

***

### error?

> `optional` **error?**: `string`

Defined in: [loop-runner.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L79)

**`Experimental`**

***

### durationMs

> **durationMs**: `number`

Defined in: [loop-runner.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L80)

**`Experimental`**
