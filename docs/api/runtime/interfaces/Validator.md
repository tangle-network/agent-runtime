[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / Validator

# Interface: Validator\<Output, Verdict\>

Defined in: [runtime/types.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L52)

**`Experimental`**

## Type Parameters

### Output

`Output`

### Verdict

`Verdict` = `DefaultVerdict`

## Methods

### validate()

> **validate**(`output`, `ctx`): `Promise`\<`Verdict`\>

Defined in: [runtime/types.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L53)

**`Experimental`**

#### Parameters

##### output

`Output`

##### ctx

[`ValidationCtx`](ValidationCtx.md)

#### Returns

`Promise`\<`Verdict`\>
