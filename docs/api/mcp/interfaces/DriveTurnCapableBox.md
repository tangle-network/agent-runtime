[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DriveTurnCapableBox

# Interface: DriveTurnCapableBox

Defined in: [mcp/detached-turn.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L67)

**`Experimental`**

The box surface detached turns need. `SandboxInstance`
(`@tangle-network/sandbox` >= 0.6) satisfies it structurally; tests pass
in-memory fakes. `_sessionCancel` is the SDK's remote-cancellation surface —
optional here because older SDKs / fakes may not expose it; when present it
is invoked on abort so the remote run actually stops.

## Methods

### driveTurn()

> **driveTurn**(`message`, `opts`): `Promise`\<[`DriveTurnTick`](../type-aliases/DriveTurnTick.md)\>

Defined in: [mcp/detached-turn.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L68)

**`Experimental`**

#### Parameters

##### message

`string`

##### opts

###### sessionId

`string`

###### turnId?

`string`

###### wallCapMs?

`number`

#### Returns

`Promise`\<[`DriveTurnTick`](../type-aliases/DriveTurnTick.md)\>

***

### \_sessionCancel()?

> `optional` **\_sessionCancel**(`id`): `Promise`\<`void`\>

Defined in: [mcp/detached-turn.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L72)

**`Experimental`**

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`void`\>
