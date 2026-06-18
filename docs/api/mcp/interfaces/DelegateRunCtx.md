[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegateRunCtx

# Interface: DelegateRunCtx

Defined in: [mcp/delegates.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L65)

**`Experimental`**

## Properties

### signal

> **signal**: `AbortSignal`

Defined in: [mcp/delegates.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L66)

**`Experimental`**

***

### detachedSessionRef?

> `optional` **detachedSessionRef?**: `string`

Defined in: [mcp/delegates.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L74)

**`Experimental`**

Detached-run resume key recorded on the queue record at submit time
(`formatDetachedSessionRef`). Present only when the submit path requested
detached dispatch — its presence is what routes a session-backed delegate
onto the `driveTurn` tick path instead of holding a stream.

***

### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](../../runtime/interfaces/LoopTraceEmitter.md)

Defined in: [mcp/delegates.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L83)

**`Experimental`**

Per-delegation trace sink supplied by the queue — loop events emitted
here land on the delegation record as a compact span tree. Delegates
compose it with their configured OTEL emitter so both sinks observe
the same stream.

## Methods

### report()

> **report**(`progress`): `void`

Defined in: [mcp/delegates.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L67)

**`Experimental`**

#### Parameters

##### progress

[`DelegationProgress`](DelegationProgress.md)

#### Returns

`void`

***

### updateDetachedSessionRef()?

> `optional` **updateDetachedSessionRef**(`ref`): `void`

Defined in: [mcp/delegates.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L76)

**`Experimental`**

Rebind the record's resume key (e.g. once the sandbox id is known).

#### Parameters

##### ref

`string`

#### Returns

`void`
