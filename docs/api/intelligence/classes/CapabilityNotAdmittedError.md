[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / CapabilityNotAdmittedError

# Class: CapabilityNotAdmittedError

Defined in: [intelligence/capability.ts:245](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L245)

A binding kind whose resolver case is typed but not yet admitted (rag-index,
memory-store, wasm, a2a). Thrown by the resolver — NEVER faked into a working
surface. The TYPE arms exist so the union is closed against the spec; the
resolver grows them later behind their lifecycle + admission gate.

## Extends

- `Error`

## Constructors

### Constructor

> **new CapabilityNotAdmittedError**(`kind`, `capabilityId`, `reason`): `CapabilityNotAdmittedError`

Defined in: [intelligence/capability.ts:248](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L248)

#### Parameters

##### kind

`"inline"` \| `"file"` \| `"http"` \| `"sandbox-code"` \| `"mcp-stdio"` \| `"mcp-remote"` \| `"process-on-infra"` \| `"rag-index"` \| `"memory-store"` \| `"wasm"` \| `"a2a"`

##### capabilityId

`string`

##### reason

`string`

#### Returns

`CapabilityNotAdmittedError`

#### Overrides

`Error.constructor`

## Properties

### kind

> `readonly` **kind**: `"inline"` \| `"file"` \| `"http"` \| `"sandbox-code"` \| `"mcp-stdio"` \| `"mcp-remote"` \| `"process-on-infra"` \| `"rag-index"` \| `"memory-store"` \| `"wasm"` \| `"a2a"`

Defined in: [intelligence/capability.ts:246](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L246)

***

### capabilityId

> `readonly` **capabilityId**: `string`

Defined in: [intelligence/capability.ts:247](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L247)
