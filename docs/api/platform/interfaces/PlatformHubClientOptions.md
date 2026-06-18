[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [platform](../README.md) / PlatformHubClientOptions

# Interface: PlatformHubClientOptions

Defined in: [platform/integrations.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L15)

Server-side client for the Tangle platform's integration hub
(`/v1/hub/*`). Consumer apps use this instead of rolling their own
OAuth + connection tables.

Auth: the caller supplies a bearer (either the user's API key from
cross-site exchange, or a platform service token) on construction.

Endpoint contract (authoritative): the platform's `src/lib/hub-contract.ts`
+ `src/routes/hub.ts`. The platform wraps every response in
`{ success, data }`; non-2xx or `success:false` surfaces as `PlatformHubError`
carrying the real upstream status.

## Properties

### baseUrl

> **baseUrl**: `string`

Defined in: [platform/integrations.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L17)

Platform base URL, e.g. `https://id.tangle.tools`.

***

### bearer

> **bearer**: `string`

Defined in: [platform/integrations.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L19)

Bearer credential — user API key or service token.

***

### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: [platform/integrations.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L21)

Override fetch (tests + edge runtimes).

#### Parameters

##### input

`string` \| `URL` \| `Request`

##### init?

`RequestInit`

#### Returns

`Promise`\<`Response`\>
