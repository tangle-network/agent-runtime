[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / SandboxRun

# Interface: SandboxRun\<Out\>

Defined in: [runtime/sandbox-run.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L68)

**`Experimental`**

A live run over ONE persistent artifact (box + session). Close it
 when done — `close()` tears the box down.

## Type Parameters

### Out

`Out`

## Properties

### box

> `readonly` **box**: `SandboxInstance`

Defined in: [runtime/sandbox-run.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L69)

**`Experimental`**

***

### sessionId

> `readonly` **sessionId**: `string`

Defined in: [runtime/sandbox-run.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L70)

**`Experimental`**

## Methods

### start()

> **start**(`prompt`): `Promise`\<[`TurnResult`](TurnResult.md)\<`Out`\>\>

Defined in: [runtime/sandbox-run.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L72)

**`Experimental`**

First turn over the fresh box (mints the session). Throws if already started.

#### Parameters

##### prompt

`string`

#### Returns

`Promise`\<[`TurnResult`](TurnResult.md)\<`Out`\>\>

***

### resume()

> **resume**(`prompt`): `Promise`\<[`TurnResult`](TurnResult.md)\<`Out`\>\>

Defined in: [runtime/sandbox-run.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L74)

**`Experimental`**

Continue THE SAME session over THE SAME artifact — a resumed turn/rollout.

#### Parameters

##### prompt

`string`

#### Returns

`Promise`\<[`TurnResult`](TurnResult.md)\<`Out`\>\>

***

### close()

> **close**(): `Promise`\<`void`\>

Defined in: [runtime/sandbox-run.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L75)

**`Experimental`**

#### Returns

`Promise`\<`void`\>
