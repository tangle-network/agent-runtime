[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [platform](../README.md) / ExchangeCodeResult

# Interface: ExchangeCodeResult

Defined in: [platform/auth.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L38)

`@tangle-network/agent-runtime/platform` — typed server-side clients
for the Tangle platform's cross-site SSO bridge and integrations
hub. Apps consume these to avoid rolling their own OAuth, session,
and connection storage.

See:
  - [PlatformAuthClient](../classes/PlatformAuthClient.md) for "Login with Tangle"
  - [PlatformHubClient](../classes/PlatformHubClient.md) for the `/v1/hub/*` surface

## Properties

### apiKey

> **apiKey**: `string`

Defined in: [platform/auth.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L39)

***

### user

> **user**: `object`

Defined in: [platform/auth.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L40)

#### id

> **id**: `string`

#### email

> **email**: `string`

#### name?

> `optional` **name?**: `string`

***

### plan

> **plan**: `object`

Defined in: [platform/auth.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L45)

#### tier

> **tier**: `string`
