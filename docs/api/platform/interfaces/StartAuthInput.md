[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [platform](../README.md) / StartAuthInput

# Interface: StartAuthInput

Defined in: [platform/integrations.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L60)

## Properties

### providerId

> **providerId**: `string`

Defined in: [platform/integrations.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L62)

The provider to connect (goes in the URL path).

***

### connectorId?

> `optional` **connectorId?**: `string`

Defined in: [platform/integrations.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L65)

Accepted for interface compatibility; the platform's start endpoint is
 provider-level and does not consume a connector id.

***

### returnUrl

> **returnUrl**: `string`

Defined in: [platform/integrations.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L67)

Where the platform redirects the user back to after OAuth.

***

### requestedScopes?

> `optional` **requestedScopes?**: `string`[]

Defined in: [platform/integrations.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L69)

Accepted for interface compatibility; not consumed by the start endpoint.

***

### cli?

> `optional` **cli?**: `boolean`

Defined in: [platform/integrations.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L71)

CLI flow flag — affects the platform's post-auth redirect handling.
