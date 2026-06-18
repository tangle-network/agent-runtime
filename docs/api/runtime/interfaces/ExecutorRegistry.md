[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / ExecutorRegistry

# Interface: ExecutorRegistry

Defined in: [runtime/supervise/types.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L182)

The OPEN resolver: maps an `AgentSpec` to a `ExecutorFactory`. The default
registry resolves the three built-ins AND accepts a BYO `executor`/factory; callers
register more runtimes by name. NOT a closed switch — registration is the extension
point, mirroring the open `Executor` interface.

## Methods

### register()

> **register**\<`Out`\>(`runtime`, `factory`): `void`

Defined in: [runtime/supervise/types.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L184)

Register a factory for a named runtime. Throws on a duplicate name (fail loud).

#### Type Parameters

##### Out

`Out`

#### Parameters

##### runtime

[`Runtime`](../type-aliases/Runtime.md)

##### factory

[`ExecutorFactory`](../type-aliases/ExecutorFactory.md)\<`Out`\>

#### Returns

`void`

***

### resolve()

> **resolve**\<`Out`\>(`spec`): \{ `succeeded`: `true`; `value`: [`ExecutorFactory`](../type-aliases/ExecutorFactory.md)\<`Out`\>; \} \| \{ `succeeded`: `false`; `error`: `string`; \}

Defined in: [runtime/supervise/types.ts:191](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L191)

Resolve a spec to a factory. Precedence: a BYO `spec.executor` → a trivial factory
returning it; else `harness === null` → the `'router'` factory; else a registered
factory for the harness-derived runtime. Returns a typed outcome — the caller
inspects `succeeded` before `value` (no silent fallback).

#### Type Parameters

##### Out

`Out`

#### Parameters

##### spec

[`AgentSpec`](AgentSpec.md)

#### Returns

\{ `succeeded`: `true`; `value`: [`ExecutorFactory`](../type-aliases/ExecutorFactory.md)\<`Out`\>; \} \| \{ `succeeded`: `false`; `error`: `string`; \}
