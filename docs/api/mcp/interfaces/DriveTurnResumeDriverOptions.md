[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DriveTurnResumeDriverOptions

# Interface: DriveTurnResumeDriverOptions

Defined in: [mcp/detached-turn.ts:365](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L365)

**`Experimental`**

## Properties

### intervalMs?

> `optional` **intervalMs?**: `number`

Defined in: [mcp/detached-turn.ts:390](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L390)

**`Experimental`**

Delay between `running` ticks (ms). Default 5000.

***

### wallCapMs?

> `optional` **wallCapMs?**: `number`

Defined in: [mcp/detached-turn.ts:392](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L392)

**`Experimental`**

Wall-clock cap forwarded to `driveTurn` on every tick.

## Methods

### resolveSandbox()

> **resolveSandbox**(`sandboxId`): `Promise`\<[`DriveTurnCapableBox`](DriveTurnCapableBox.md)\>

Defined in: [mcp/detached-turn.ts:371](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L371)

**`Experimental`**

Resolve the live box owning a detached session. The bin wires this to the
sandbox client's `get(sandboxId)`; throw when the box no longer exists —
a thrown tick settles the record as failed, which is the truth.

#### Parameters

##### sandboxId

`string`

#### Returns

`Promise`\<[`DriveTurnCapableBox`](DriveTurnCapableBox.md)\>

***

### buildMessage()

> **buildMessage**(`record`): `string`

Defined in: [mcp/detached-turn.ts:378](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L378)

**`Experimental`**

Rebuild the turn prompt from the persisted record. Only consumed by
`driveTurn`'s dispatch leg — i.e. when the previous process died after
binding the box but before the session was dispatched. Must reproduce the
prompt the delegate would have sent.

#### Parameters

##### record

[`DelegationRecord`](DelegationRecord.md)

#### Returns

`string`

***

### settleOutput()

> **settleOutput**(`turn`, `record`, `ctx`): `CoderOutput` \| [`ResearchOutputShape`](ResearchOutputShape.md) \| [`UiAuditorDelegationOutput`](UiAuditorDelegationOutput.md) \| `Promise`\<`CoderOutput` \| [`ResearchOutputShape`](ResearchOutputShape.md) \| [`UiAuditorDelegationOutput`](UiAuditorDelegationOutput.md)\>

Defined in: [mcp/detached-turn.ts:384](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L384)

**`Experimental`**

Map a completed turn onto the delegation's typed output payload (parse +
validate per profile). Throw when the resumed result does not pass the
profile's gate — the queue settles the record as failed with that error.

#### Parameters

##### turn

[`DetachedTurn`](DetachedTurn.md)

##### record

[`DelegationRecord`](DelegationRecord.md)

##### ctx

###### signal

`AbortSignal`

#### Returns

`CoderOutput` \| [`ResearchOutputShape`](ResearchOutputShape.md) \| [`UiAuditorDelegationOutput`](UiAuditorDelegationOutput.md) \| `Promise`\<`CoderOutput` \| [`ResearchOutputShape`](ResearchOutputShape.md) \| [`UiAuditorDelegationOutput`](UiAuditorDelegationOutput.md)\>
