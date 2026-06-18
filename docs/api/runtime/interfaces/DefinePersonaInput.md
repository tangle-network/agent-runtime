[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / DefinePersonaInput

# Interface: DefinePersonaInput\<D\>

Defined in: [runtime/personify/types.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L129)

The minimal input to build a `Persona`. Mirrors `Persona` but lets the builder default
 the executors-supplied invariant check and freeze the record.

## Type Parameters

### D

`D` = `unknown`

## Properties

### name

> `readonly` **name**: `string`

Defined in: [runtime/personify/types.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L130)

***

### root

> `readonly` **root**: [`AgentSpec`](AgentSpec.md)

Defined in: [runtime/personify/types.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L131)

***

### directive

> `readonly` **directive**: `string`

Defined in: [runtime/personify/types.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L132)

***

### context

> `readonly` **context**: [`PersonaContext`](PersonaContext.md)

Defined in: [runtime/personify/types.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L133)

***

### executors

> `readonly` **executors**: [`PersonaExecutors`](PersonaExecutors.md)

Defined in: [runtime/personify/types.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L134)

***

### extensions?

> `readonly` `optional` **extensions?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [runtime/personify/types.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L135)

***

### \_\_deliverable?

> `readonly` `optional` **\_\_deliverable?**: `D`

Defined in: [runtime/personify/types.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L138)

Phantom: pins the input's deliverable type so `definePersona<D>` returns a `Persona<D>`
 the caller's shape must agree with. Type-only — never supplied at a call site.
