[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [platform](../README.md) / PlatformConnection

# Interface: PlatformConnection

Defined in: [platform/integrations.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L25)

A live integration connection, as returned by `/v1/hub/connections`.

## Properties

### id

> **id**: `string`

Defined in: [platform/integrations.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L26)

***

### providerId

> **providerId**: `string`

Defined in: [platform/integrations.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L27)

***

### displayName

> **displayName**: `string`

Defined in: [platform/integrations.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L28)

***

### accountDisplay

> **accountDisplay**: `string` \| `null`

Defined in: [platform/integrations.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L29)

***

### scopes

> **scopes**: `string`[]

Defined in: [platform/integrations.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L30)

***

### status

> **status**: `string` & `object` \| `"unhealthy"` \| `"active"` \| `"revoked"` \| `"reconnect_required"`

Defined in: [platform/integrations.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L31)

***

### health

> **health**: `string` & `object` \| `"unknown"` \| `"healthy"` \| `"unhealthy"` \| `"rate_limited"`

Defined in: [platform/integrations.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L32)

***

### createdAt

> **createdAt**: `string`

Defined in: [platform/integrations.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L33)

***

### updatedAt

> **updatedAt**: `string`

Defined in: [platform/integrations.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L34)

***

### lastUsedAt

> **lastUsedAt**: `string` \| `null`

Defined in: [platform/integrations.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L35)
