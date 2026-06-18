[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / ExecutorContext

# Interface: ExecutorContext

Defined in: [runtime/supervise/types.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L170)

Construction context handed to a `ExecutorFactory` — the seams a built-in needs
 (sandbox client for the sandbox executor, router config for router/inline) without
 the factory reaching into module globals.

## Properties

### signal

> `readonly` **signal**: `AbortSignal`

Defined in: [runtime/supervise/types.ts:171](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L171)

***

### seams

> `readonly` **seams**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [runtime/supervise/types.ts:173](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L173)

Opaque seams the registry threads through; a built-in narrows what it needs.
