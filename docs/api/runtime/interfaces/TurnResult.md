[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / TurnResult

# Interface: TurnResult\<Out\>

Defined in: [runtime/sandbox-run.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L60)

**`Experimental`**

One finished turn over the artifact. A failed FS read is surfaced in `readError`
(never masked as an empty deliverable) so a caller distinguishes "agent produced
nothing" from a transport/FS fault.

## Type Parameters

### Out

`Out`

## Properties

### out

> **out**: `Out`

Defined in: [runtime/sandbox-run.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L61)

**`Experimental`**

***

### events

> **events**: `SandboxEvent`[]

Defined in: [runtime/sandbox-run.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L62)

**`Experimental`**

***

### readError?

> `optional` **readError?**: `string`

Defined in: [runtime/sandbox-run.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L63)

**`Experimental`**
