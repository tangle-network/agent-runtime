[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [platform](../README.md) / PlatformCatalogProvider

# Interface: PlatformCatalogProvider

Defined in: [platform/integrations.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L39)

A connectable provider in the catalog (`/v1/hub/providers`).

## Indexable

> \[`k`: `string`\]: `unknown`

## Properties

### providerId

> **providerId**: `string`

Defined in: [platform/integrations.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L40)

***

### title?

> `optional` **title?**: `string`

Defined in: [platform/integrations.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L41)

***

### authKind?

> `optional` **authKind?**: `string`

Defined in: [platform/integrations.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L42)

***

### category?

> `optional` **category?**: `string`

Defined in: [platform/integrations.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L43)

***

### scopes?

> `optional` **scopes?**: `string`[]

Defined in: [platform/integrations.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L44)

***

### capabilityCount?

> `optional` **capabilityCount?**: `number`

Defined in: [platform/integrations.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L45)

***

### native?

> `optional` **native?**: `boolean`

Defined in: [platform/integrations.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L46)

***

### configured?

> `optional` **configured?**: `boolean`

Defined in: [platform/integrations.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L49)

Whether the OAuth app's credentials are wired — the UI offers Connect
 only when true.
