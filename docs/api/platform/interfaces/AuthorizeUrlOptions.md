[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [platform](../README.md) / AuthorizeUrlOptions

# Interface: AuthorizeUrlOptions

Defined in: [platform/auth.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L24)

`@tangle-network/agent-runtime/platform` — typed server-side clients
for the Tangle platform's cross-site SSO bridge and integrations
hub. Apps consume these to avoid rolling their own OAuth, session,
and connection storage.

See:
  - [PlatformAuthClient](../classes/PlatformAuthClient.md) for "Login with Tangle"
  - [PlatformHubClient](../classes/PlatformHubClient.md) for the `/v1/hub/*` surface

## Properties

### state

> **state**: `string`

Defined in: [platform/auth.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L26)

Required CSRF token; the consumer verifies it on the callback.

***

### redirectUri?

> `optional` **redirectUri?**: `string`

Defined in: [platform/auth.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L31)

Final redirect URI. Must be one of the URIs registered for `appId`
on the platform. Omit to use the first registered URI.

***

### prompt?

> `optional` **prompt?**: `"login"`

Defined in: [platform/auth.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L33)

Force the login screen even if a session is already active.

***

### email?

> `optional` **email?**: `string`

Defined in: [platform/auth.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L35)

Pre-fill the email field on the login screen.
