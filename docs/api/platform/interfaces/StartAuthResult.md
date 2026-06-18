[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [platform](../README.md) / StartAuthResult

# Interface: StartAuthResult

Defined in: [platform/integrations.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L74)

## Properties

### authorizationUrl

> **authorizationUrl**: `string`

Defined in: [platform/integrations.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L78)

The URL to send the user to. Normalized across the platform's two start
 branches: github returns `authorizationUrl`, substrate returns
 `redirectUrl`.

***

### state

> **state**: `string`

Defined in: [platform/integrations.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L79)

***

### expiresAt?

> `optional` **expiresAt?**: `string`

Defined in: [platform/integrations.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L80)

***

### scopes?

> `optional` **scopes?**: `string`[]

Defined in: [platform/integrations.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L81)
