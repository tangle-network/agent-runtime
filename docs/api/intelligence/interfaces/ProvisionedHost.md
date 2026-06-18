[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / ProvisionedHost

# Interface: ProvisionedHost

Defined in: [intelligence/resolver.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L49)

A live, provisioned host the resolver tore up for a `process-on-infra` arm.
 `teardown()` runs at `dispose()` in reverse provisioning order.

## Properties

### mcpConnection?

> `optional` **mcpConnection?**: `AgentProfileMcpServer`

Defined in: [intelligence/resolver.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L52)

Lower the inner binding's mcp connection now that the host is up; the URL/
 command points at the host. Absent when the host serves a non-mcp inner.

## Methods

### teardown()

> **teardown**(): `Promise`\<`void`\>

Defined in: [intelligence/resolver.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L53)

#### Returns

`Promise`\<`void`\>
