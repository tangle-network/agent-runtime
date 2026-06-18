[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / RuntimeRunStateError

# Class: RuntimeRunStateError

Defined in: [errors.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L94)

## Stable

A runtime-run lifecycle method was called in an order the state machine does
not allow: `persist()` before `complete()`, `complete()` twice, etc.

## Extends

- `AgentEvalError`

## Constructors

### Constructor

> **new RuntimeRunStateError**(`message`, `options?`): `RuntimeRunStateError`

Defined in: [errors.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L95)

#### Parameters

##### message

`string`

##### options?

###### cause?

`unknown`

#### Returns

`RuntimeRunStateError`

#### Overrides

`AgentEvalError.constructor`
