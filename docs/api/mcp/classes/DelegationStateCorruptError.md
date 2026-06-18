[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegationStateCorruptError

# Class: DelegationStateCorruptError

Defined in: [mcp/delegation-store.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L54)

**`Experimental`**

The persisted delegation state exists but cannot be parsed into
records. Fail loud: silently starting empty over a corrupt journal
would erase delegation history and re-run idempotent work. Opt into
recovery explicitly via `FileDelegationStoreOptions.recoverCorrupt`
(the bin maps `AGENT_RUNTIME_DELEGATION_STATE_RECOVER=1` onto it),
which archives the corrupt file and starts fresh.

## Extends

- `AgentEvalError`

## Constructors

### Constructor

> **new DelegationStateCorruptError**(`message`, `options?`): `DelegationStateCorruptError`

Defined in: [mcp/delegation-store.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L55)

**`Experimental`**

#### Parameters

##### message

`string`

##### options?

###### cause?

`unknown`

#### Returns

`DelegationStateCorruptError`

#### Overrides

`AgentEvalError.constructor`
