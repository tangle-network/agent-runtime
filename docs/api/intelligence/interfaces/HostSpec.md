[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / HostSpec

# Interface: HostSpec

Defined in: [intelligence/capability.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L94)

The host a `process-on-infra` binding provisions before its inner binding.
Reuses `createExecutor`'s backend-as-data vocabulary — no new runtime invented.
`image` is the sandbox image tag; `warm`/`idleTtlMs`/`costTag` meter standing
cost; `ports` are the inner server's listen ports the host must expose.

## Properties

### backend

> **backend**: `"router"` \| `"sandbox"` \| `"cli"`

Defined in: [intelligence/capability.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L95)

***

### image?

> `optional` **image?**: `string`

Defined in: [intelligence/capability.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L96)

***

### ports?

> `optional` **ports?**: `number`[]

Defined in: [intelligence/capability.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L97)

***

### warm?

> `optional` **warm?**: `boolean`

Defined in: [intelligence/capability.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L98)

***

### idleTtlMs?

> `optional` **idleTtlMs?**: `number`

Defined in: [intelligence/capability.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L99)

***

### costTag?

> `optional` **costTag?**: `string`

Defined in: [intelligence/capability.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L100)
