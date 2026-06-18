[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [platform](../README.md) / PlatformAuthError

# Class: PlatformAuthError

Defined in: [platform/auth.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L50)

`@tangle-network/agent-runtime/platform` — typed server-side clients
for the Tangle platform's cross-site SSO bridge and integrations
hub. Apps consume these to avoid rolling their own OAuth, session,
and connection storage.

See:
  - [PlatformAuthClient](PlatformAuthClient.md) for "Login with Tangle"
  - [PlatformHubClient](PlatformHubClient.md) for the `/v1/hub/*` surface

## Extends

- `Error`

## Constructors

### Constructor

> **new PlatformAuthError**(`message`, `status`, `body`): `PlatformAuthError`

Defined in: [platform/auth.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L51)

#### Parameters

##### message

`string`

##### status

`number`

##### body

`unknown`

#### Returns

`PlatformAuthError`

#### Overrides

`Error.constructor`

## Properties

### status

> `readonly` **status**: `number`

Defined in: [platform/auth.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L53)

***

### body

> `readonly` **body**: `unknown`

Defined in: [platform/auth.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L54)
