[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [platform](../README.md) / MintTokenInput

# Interface: MintTokenInput

Defined in: [platform/integrations.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L104)

## Properties

### actionPath

> **actionPath**: `string`

Defined in: [platform/integrations.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L106)

The hub action the token authorizes (e.g. `slack.chat.postMessage`).

***

### connectionId?

> `optional` **connectionId?**: `string`

Defined in: [platform/integrations.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L108)

Bind to a specific connection, or …

***

### provider?

> `optional` **provider?**: `string`

Defined in: [platform/integrations.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L110)

… resolve the connection by provider for the calling user.
