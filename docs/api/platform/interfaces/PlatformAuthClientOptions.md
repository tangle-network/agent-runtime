[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [platform](../README.md) / PlatformAuthClientOptions

# Interface: PlatformAuthClientOptions

Defined in: [platform/auth.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L15)

Server-side client for the Tangle platform's cross-site SSO bridge.

Consumer apps (gtm-agent, tax-agent, legal-agent, creative-agent, …)
use this to:
  1. Build an /authorize URL that lands the user on id.tangle.tools
     and brings them back with a single-use code.
  2. Exchange that code for an API key + the user's identity.

The platform endpoint contract is documented in
`products/platform/api/src/routes/cross-site.ts`. This client only
speaks HTTP — no SDK weight, no transitive deps.

## Properties

### baseUrl

> **baseUrl**: `string`

Defined in: [platform/auth.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L17)

Platform base URL, e.g. `https://id.tangle.tools`.

***

### appId

> **appId**: `string`

Defined in: [platform/auth.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L19)

App id as registered in the platform's TRUSTED_APPS registry.

***

### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: [platform/auth.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L21)

Override the global fetch (useful for tests + edge runtimes).

#### Parameters

##### input

`string` \| `URL` \| `Request`

##### init?

`RequestInit`

#### Returns

`Promise`\<`Response`\>
