[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [platform](../README.md) / HealthCheck

# Interface: HealthCheck

Defined in: [platform/integrations.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L96)

Last-known health for a connection, derived from the connection row.

## Properties

### connectionId

> **connectionId**: `string`

Defined in: [platform/integrations.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L97)

***

### providerId

> **providerId**: `string`

Defined in: [platform/integrations.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L98)

***

### status

> **status**: `string` & `object` \| `"unknown"` \| `"healthy"` \| `"unhealthy"` \| `"rate_limited"`

Defined in: [platform/integrations.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L100)

Mirrors `PlatformConnection.health`.

***

### checkedAt?

> `optional` **checkedAt?**: `string`

Defined in: [platform/integrations.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L101)
