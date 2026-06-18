[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegationPersistenceError

# Class: DelegationPersistenceError

Defined in: [mcp/delegation-store.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L68)

**`Experimental`**

A delegation-store read or write failed (filesystem error, store
called before `loadAll`, ...). Once the queue observes one, it stops
accepting new submissions — accepting work it cannot journal would
silently demote durable mode to in-memory mode.

## Extends

- `AgentEvalError`

## Constructors

### Constructor

> **new DelegationPersistenceError**(`message`, `options?`): `DelegationPersistenceError`

Defined in: [mcp/delegation-store.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L69)

**`Experimental`**

#### Parameters

##### message

`string`

##### options?

###### cause?

`unknown`

#### Returns

`DelegationPersistenceError`

#### Overrides

`AgentEvalError.constructor`
