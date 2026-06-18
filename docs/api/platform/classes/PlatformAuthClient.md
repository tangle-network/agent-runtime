[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [platform](../README.md) / PlatformAuthClient

# Class: PlatformAuthClient

Defined in: [platform/auth.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L61)

`@tangle-network/agent-runtime/platform` — typed server-side clients
for the Tangle platform's cross-site SSO bridge and integrations
hub. Apps consume these to avoid rolling their own OAuth, session,
and connection storage.

See:
  - PlatformAuthClient for "Login with Tangle"
  - [PlatformHubClient](PlatformHubClient.md) for the `/v1/hub/*` surface

## Constructors

### Constructor

> **new PlatformAuthClient**(`options`): `PlatformAuthClient`

Defined in: [platform/auth.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L66)

#### Parameters

##### options

[`PlatformAuthClientOptions`](../interfaces/PlatformAuthClientOptions.md)

#### Returns

`PlatformAuthClient`

## Methods

### authorizeUrl()

> **authorizeUrl**(`options`): `string`

Defined in: [platform/auth.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L81)

Build the URL the user is redirected to in order to start SSO.
The platform redirects back to one of `appId`'s registered
`redirectUris` with `?code=...&app=...&state=...`.

#### Parameters

##### options

[`AuthorizeUrlOptions`](../interfaces/AuthorizeUrlOptions.md)

#### Returns

`string`

***

### exchange()

> **exchange**(`code`): `Promise`\<[`ExchangeCodeResult`](../interfaces/ExchangeCodeResult.md)\>

Defined in: [platform/auth.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L99)

Exchange a single-use auth code (delivered to the consumer's
callback by the platform) for an API key + the user's identity.
Codes are single-use and expire ~5 minutes after issue.

#### Parameters

##### code

`string`

#### Returns

`Promise`\<[`ExchangeCodeResult`](../interfaces/ExchangeCodeResult.md)\>
