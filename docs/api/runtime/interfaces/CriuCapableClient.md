[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / CriuCapableClient

# Interface: CriuCapableClient

Defined in: [runtime/sandbox-capabilities.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-capabilities.ts#L73)

**`Experimental`**

Narrowed view of the optional CRIU probe. The loop-side `SandboxClient`
does not require `criuStatus`; this widens it optionally so the probe can be
read without importing sandbox-backend specifics.

## Properties

### criuStatus?

> `optional` **criuStatus?**: () => `Promise`\<\{ `available`: `boolean`; `criuVersion?`: `string`; `reason?`: `string`; \}\>

Defined in: [runtime/sandbox-capabilities.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-capabilities.ts#L74)

**`Experimental`**

#### Returns

`Promise`\<\{ `available`: `boolean`; `criuVersion?`: `string`; `reason?`: `string`; \}\>
