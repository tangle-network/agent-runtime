[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / platform

# platform

## Classes

### PlatformAuthError

Defined in: [src/platform/auth.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L51)

Thrown when a `PlatformAuthClient` request returns a non-success status.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new PlatformAuthError**(`message`, `status`, `body`): [`PlatformAuthError`](#platformautherror)

Defined in: [src/platform/auth.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L52)

###### Parameters

###### message

`string`

###### status

`number`

###### body

`unknown`

###### Returns

[`PlatformAuthError`](#platformautherror)

###### Overrides

`Error.constructor`

#### Properties

##### status

> `readonly` **status**: `number`

Defined in: [src/platform/auth.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L54)

##### body

> `readonly` **body**: `unknown`

Defined in: [src/platform/auth.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L55)

***

### PlatformAuthClient

Defined in: [src/platform/auth.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L63)

HTTP client for the Tangle Platform SSO: builds authorize URLs and exchanges auth codes for API keys.

#### Constructors

##### Constructor

> **new PlatformAuthClient**(`options`): [`PlatformAuthClient`](#platformauthclient)

Defined in: [src/platform/auth.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L68)

###### Parameters

###### options

[`PlatformAuthClientOptions`](#platformauthclientoptions)

###### Returns

[`PlatformAuthClient`](#platformauthclient)

#### Methods

##### authorizeUrl()

> **authorizeUrl**(`options`): `string`

Defined in: [src/platform/auth.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L83)

Build the URL the user is redirected to in order to start SSO.
The platform redirects back to one of `appId`'s registered
`redirectUris` with `?code=...&app=...&state=...`.

###### Parameters

###### options

[`AuthorizeUrlOptions`](#authorizeurloptions)

###### Returns

`string`

##### exchange()

> **exchange**(`code`): `Promise`\<[`ExchangeCodeResult`](#exchangecoderesult)\>

Defined in: [src/platform/auth.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L101)

Exchange a single-use auth code (delivered to the consumer's
callback by the platform) for an API key + the user's identity.
Codes are single-use and expire ~5 minutes after issue.

###### Parameters

###### code

`string`

###### Returns

`Promise`\<[`ExchangeCodeResult`](#exchangecoderesult)\>

***

### PlatformHubError

Defined in: [src/platform/integrations.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L133)

Thrown when a `PlatformHubClient` request returns a non-success status.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new PlatformHubError**(`message`, `status`, `code`, `body`): [`PlatformHubError`](#platformhuberror)

Defined in: [src/platform/integrations.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L134)

###### Parameters

###### message

`string`

###### status

`number`

###### code

`string` \| `undefined`

###### body

`unknown`

###### Returns

[`PlatformHubError`](#platformhuberror)

###### Overrides

`Error.constructor`

#### Properties

##### status

> `readonly` **status**: `number`

Defined in: [src/platform/integrations.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L136)

##### code

> `readonly` **code**: `string` \| `undefined`

Defined in: [src/platform/integrations.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L137)

##### body

> `readonly` **body**: `unknown`

Defined in: [src/platform/integrations.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L138)

***

### PlatformHubClient

Defined in: [src/platform/integrations.ts:152](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L152)

HTTP client for the Tangle Platform Hub API: provider catalog, connection flow, and status.

#### Constructors

##### Constructor

> **new PlatformHubClient**(`options`): [`PlatformHubClient`](#platformhubclient)

Defined in: [src/platform/integrations.ts:157](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L157)

###### Parameters

###### options

[`PlatformHubClientOptions`](#platformhubclientoptions)

###### Returns

[`PlatformHubClient`](#platformhubclient)

#### Methods

##### catalog()

> **catalog**(): `Promise`\<[`CatalogResult`](#catalogresult)\>

Defined in: [src/platform/integrations.ts:168](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L168)

GET /v1/hub/providers — the connectable provider catalog.

###### Returns

`Promise`\<[`CatalogResult`](#catalogresult)\>

##### listConnections()

> **listConnections**(): `Promise`\<[`PlatformConnection`](#platformconnection)[]\>

Defined in: [src/platform/integrations.ts:173](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L173)

GET /v1/hub/connections — the calling user's live connections.

###### Returns

`Promise`\<[`PlatformConnection`](#platformconnection)[]\>

##### revokeConnection()

> **revokeConnection**(`connectionId`): `Promise`\<\{ `connection`: [`PlatformConnection`](#platformconnection); \}\>

Defined in: [src/platform/integrations.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L182)

DELETE /v1/hub/connections/:connectionId — revoke + disable a connection.

###### Parameters

###### connectionId

`string`

###### Returns

`Promise`\<\{ `connection`: [`PlatformConnection`](#platformconnection); \}\>

##### startAuth()

> **startAuth**(`input`): `Promise`\<[`StartAuthResult`](#startauthresult)\>

Defined in: [src/platform/integrations.ts:192](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L192)

POST /v1/hub/connections/:provider/start — begin OAuth/grant. The provider
is taken from the URL; the body carries `returnUrl` (+ `cli`). The platform's
two start branches name the URL field differently (github → `authorizationUrl`,
substrate → `redirectUrl`); this normalizes to `authorizationUrl`.

###### Parameters

###### input

[`StartAuthInput`](#startauthinput)

###### Returns

`Promise`\<[`StartAuthResult`](#startauthresult)\>

##### listHealthchecks()

> **listHealthchecks**(): `Promise`\<[`HealthCheck`](#healthcheck)[]\>

Defined in: [src/platform/integrations.ts:219](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L219)

Last-known health for every connection. The platform has no global
healthcheck listing — health rides on each connection row — so this derives
the list from `listConnections()` (one request, no extra round-trips).

###### Returns

`Promise`\<[`HealthCheck`](#healthcheck)[]\>

##### checkConnectionHealth()

> **checkConnectionHealth**(`connectionId`): `Promise`\<[`ConnectionHealthResult`](#connectionhealthresult)\>

Defined in: [src/platform/integrations.ts:233](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L233)

POST /v1/hub/connections/:connectionId/health — trigger a fresh health
probe for one connection and return its updated state.

###### Parameters

###### connectionId

`string`

###### Returns

`Promise`\<[`ConnectionHealthResult`](#connectionhealthresult)\>

##### runHealthchecks()

> **runHealthchecks**(): `Promise`\<\{ `scheduled`: `number`; \}\>

Defined in: [src/platform/integrations.ts:242](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L242)

Trigger a fresh health probe across all of the user's connections. The
platform exposes health per-connection only, so this fans out over
`listConnections()`. `scheduled` is the number of probes dispatched.

###### Returns

`Promise`\<\{ `scheduled`: `number`; \}\>

##### status()

> **status**(): `Promise`\<[`PlatformHubStatus`](#platformhubstatus)\>

Defined in: [src/platform/integrations.ts:249](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L249)

GET /v1/hub/status — principal + aggregate connection counts.

###### Returns

`Promise`\<[`PlatformHubStatus`](#platformhubstatus)\>

##### mintToken()

> **mintToken**(`input`): `Promise`\<[`MintTokenResult`](#minttokenresult)\>

Defined in: [src/platform/integrations.ts:258](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L258)

POST /v1/hub/tokens — mint a short-lived, action-scoped capability token a
sandbox can use to invoke one hub action on the user's behalf without
seeing the underlying provider credential.

###### Parameters

###### input

[`MintTokenInput`](#minttokeninput)

###### Returns

`Promise`\<[`MintTokenResult`](#minttokenresult)\>

##### exec()

> **exec**(`input`): `Promise`\<`unknown`\>

Defined in: [src/platform/integrations.ts:263](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L263)

POST /v1/hub/exec — execute a hub action and return its result.

###### Parameters

###### input

[`ExecInput`](#execinput)

###### Returns

`Promise`\<`unknown`\>

## Interfaces

### PlatformAuthClientOptions

Defined in: [src/platform/auth.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L15)

Server-side client for the Tangle platform's cross-site SSO bridge.

Consumer apps (gtm-agent, tax-agent, legal-agent, creative-agent, …)
use this to:
  1. Build an /authorize URL that lands the user on id.tangle.tools
     and brings them back with a single-use code.
  2. Exchange that code for an API key + the user's identity.

The platform endpoint contract is documented in
`products/platform/api/src/routes/cross-site.ts`. This client only
speaks HTTP — no SDK weight, no transitive deps.

#### Properties

##### baseUrl

> **baseUrl**: `string`

Defined in: [src/platform/auth.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L17)

Platform base URL, e.g. `https://id.tangle.tools`.

##### appId

> **appId**: `string`

Defined in: [src/platform/auth.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L19)

App id as registered in the platform's TRUSTED_APPS registry.

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: [src/platform/auth.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L21)

Override the global fetch (useful for tests + edge runtimes).

###### Parameters

###### input

`string` \| `URL` \| `Request`

###### init?

`RequestInit`

###### Returns

`Promise`\<`Response`\>

***

### AuthorizeUrlOptions

Defined in: [src/platform/auth.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L24)

`@tangle-network/agent-runtime/platform` — typed server-side clients
for the Tangle platform's cross-site SSO bridge and integrations
hub. Apps consume these to avoid rolling their own OAuth, session,
and connection storage.

See:
  - [PlatformAuthClient](#platformauthclient) for "Login with Tangle"
  - [PlatformHubClient](#platformhubclient) for the `/v1/hub/*` surface

#### Properties

##### state

> **state**: `string`

Defined in: [src/platform/auth.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L26)

Required CSRF token; the consumer verifies it on the callback.

##### redirectUri?

> `optional` **redirectUri?**: `string`

Defined in: [src/platform/auth.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L31)

Final redirect URI. Must be one of the URIs registered for `appId`
on the platform. Omit to use the first registered URI.

##### prompt?

> `optional` **prompt?**: `"login"`

Defined in: [src/platform/auth.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L33)

Force the login screen even if a session is already active.

##### email?

> `optional` **email?**: `string`

Defined in: [src/platform/auth.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L35)

Pre-fill the email field on the login screen.

***

### ExchangeCodeResult

Defined in: [src/platform/auth.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L38)

`@tangle-network/agent-runtime/platform` — typed server-side clients
for the Tangle platform's cross-site SSO bridge and integrations
hub. Apps consume these to avoid rolling their own OAuth, session,
and connection storage.

See:
  - [PlatformAuthClient](#platformauthclient) for "Login with Tangle"
  - [PlatformHubClient](#platformhubclient) for the `/v1/hub/*` surface

#### Properties

##### apiKey

> **apiKey**: `string`

Defined in: [src/platform/auth.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L39)

##### user

> **user**: `object`

Defined in: [src/platform/auth.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L40)

###### id

> **id**: `string`

###### email

> **email**: `string`

###### name?

> `optional` **name?**: `string`

##### plan

> **plan**: `object`

Defined in: [src/platform/auth.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/auth.ts#L45)

###### tier

> **tier**: `string`

***

### PlatformHubClientOptions

Defined in: [src/platform/integrations.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L15)

Server-side client for the Tangle platform's integration hub
(`/v1/hub/*`). Consumer apps use this instead of rolling their own
OAuth + connection tables.

Auth: the caller supplies a bearer (either the user's API key from
cross-site exchange, or a platform service token) on construction.

Endpoint contract (authoritative): the platform's `src/lib/hub-contract.ts`
+ `src/routes/hub.ts`. The platform wraps every response in
`{ success, data }`; non-2xx or `success:false` surfaces as `PlatformHubError`
carrying the real upstream status.

#### Properties

##### baseUrl

> **baseUrl**: `string`

Defined in: [src/platform/integrations.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L17)

Platform base URL, e.g. `https://id.tangle.tools`.

##### bearer

> **bearer**: `string`

Defined in: [src/platform/integrations.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L19)

Bearer credential — user API key or service token.

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: [src/platform/integrations.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L21)

Override fetch (tests + edge runtimes).

###### Parameters

###### input

`string` \| `URL` \| `Request`

###### init?

`RequestInit`

###### Returns

`Promise`\<`Response`\>

***

### PlatformConnection

Defined in: [src/platform/integrations.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L25)

A live integration connection, as returned by `/v1/hub/connections`.

#### Properties

##### id

> **id**: `string`

Defined in: [src/platform/integrations.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L26)

##### providerId

> **providerId**: `string`

Defined in: [src/platform/integrations.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L27)

##### displayName

> **displayName**: `string`

Defined in: [src/platform/integrations.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L28)

##### accountDisplay

> **accountDisplay**: `string` \| `null`

Defined in: [src/platform/integrations.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L29)

##### scopes

> **scopes**: `string`[]

Defined in: [src/platform/integrations.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L30)

##### status

> **status**: `string` & `object` \| `"unhealthy"` \| `"active"` \| `"revoked"` \| `"reconnect_required"`

Defined in: [src/platform/integrations.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L31)

##### health

> **health**: `string` & `object` \| `"unknown"` \| `"healthy"` \| `"unhealthy"` \| `"rate_limited"`

Defined in: [src/platform/integrations.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L32)

##### createdAt

> **createdAt**: `string`

Defined in: [src/platform/integrations.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L33)

##### updatedAt

> **updatedAt**: `string`

Defined in: [src/platform/integrations.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L34)

##### lastUsedAt

> **lastUsedAt**: `string` \| `null`

Defined in: [src/platform/integrations.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L35)

***

### PlatformCatalogProvider

Defined in: [src/platform/integrations.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L39)

A connectable provider in the catalog (`/v1/hub/providers`).

#### Indexable

> \[`k`: `string`\]: `unknown`

#### Properties

##### providerId

> **providerId**: `string`

Defined in: [src/platform/integrations.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L40)

##### title?

> `optional` **title?**: `string`

Defined in: [src/platform/integrations.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L41)

##### authKind?

> `optional` **authKind?**: `string`

Defined in: [src/platform/integrations.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L42)

##### category?

> `optional` **category?**: `string`

Defined in: [src/platform/integrations.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L43)

##### scopes?

> `optional` **scopes?**: `string`[]

Defined in: [src/platform/integrations.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L44)

##### capabilityCount?

> `optional` **capabilityCount?**: `number`

Defined in: [src/platform/integrations.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L45)

##### native?

> `optional` **native?**: `boolean`

Defined in: [src/platform/integrations.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L46)

##### configured?

> `optional` **configured?**: `boolean`

Defined in: [src/platform/integrations.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L49)

Whether the OAuth app's credentials are wired — the UI offers Connect
 only when true.

***

### CatalogResult

Defined in: [src/platform/integrations.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L53)

#### Indexable

> \[`k`: `string`\]: `unknown`

#### Properties

##### providers

> **providers**: [`PlatformCatalogProvider`](#platformcatalogprovider)[]

Defined in: [src/platform/integrations.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L54)

##### substrateBundled?

> `optional` **substrateBundled?**: `number`

Defined in: [src/platform/integrations.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L56)

Count of substrate-bundled connectors behind the catalog.

***

### StartAuthInput

Defined in: [src/platform/integrations.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L60)

#### Properties

##### providerId

> **providerId**: `string`

Defined in: [src/platform/integrations.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L62)

The provider to connect (goes in the URL path).

##### connectorId?

> `optional` **connectorId?**: `string`

Defined in: [src/platform/integrations.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L65)

Accepted for interface compatibility; the platform's start endpoint is
 provider-level and does not consume a connector id.

##### returnUrl

> **returnUrl**: `string`

Defined in: [src/platform/integrations.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L67)

Where the platform redirects the user back to after OAuth.

##### requestedScopes?

> `optional` **requestedScopes?**: `string`[]

Defined in: [src/platform/integrations.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L69)

Accepted for interface compatibility; not consumed by the start endpoint.

##### cli?

> `optional` **cli?**: `boolean`

Defined in: [src/platform/integrations.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L71)

CLI flow flag — affects the platform's post-auth redirect handling.

***

### StartAuthResult

Defined in: [src/platform/integrations.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L74)

#### Properties

##### authorizationUrl

> **authorizationUrl**: `string`

Defined in: [src/platform/integrations.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L78)

The URL to send the user to. Normalized across the platform's two start
 branches: github returns `authorizationUrl`, substrate returns
 `redirectUrl`.

##### state

> **state**: `string`

Defined in: [src/platform/integrations.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L79)

##### expiresAt?

> `optional` **expiresAt?**: `string`

Defined in: [src/platform/integrations.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L80)

##### scopes?

> `optional` **scopes?**: `string`[]

Defined in: [src/platform/integrations.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L81)

***

### ConnectionHealth

Defined in: [src/platform/integrations.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L84)

#### Properties

##### status

> **status**: `string` & `object` \| `"unknown"` \| `"healthy"` \| `"unhealthy"` \| `"rate_limited"`

Defined in: [src/platform/integrations.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L85)

##### checkedAt

> **checkedAt**: `string`

Defined in: [src/platform/integrations.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L86)

##### error?

> `optional` **error?**: `object`

Defined in: [src/platform/integrations.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L87)

###### code

> **code**: `string`

###### message

> **message**: `string`

***

### ConnectionHealthResult

Defined in: [src/platform/integrations.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L90)

#### Properties

##### connection

> **connection**: [`PlatformConnection`](#platformconnection)

Defined in: [src/platform/integrations.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L91)

##### health

> **health**: [`ConnectionHealth`](#connectionhealth)

Defined in: [src/platform/integrations.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L92)

***

### HealthCheck

Defined in: [src/platform/integrations.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L96)

Last-known health for a connection, derived from the connection row.

#### Properties

##### connectionId

> **connectionId**: `string`

Defined in: [src/platform/integrations.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L97)

##### providerId

> **providerId**: `string`

Defined in: [src/platform/integrations.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L98)

##### status

> **status**: `string` & `object` \| `"unknown"` \| `"healthy"` \| `"unhealthy"` \| `"rate_limited"`

Defined in: [src/platform/integrations.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L100)

Mirrors `PlatformConnection.health`.

##### checkedAt?

> `optional` **checkedAt?**: `string`

Defined in: [src/platform/integrations.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L101)

***

### MintTokenInput

Defined in: [src/platform/integrations.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L104)

#### Properties

##### actionPath

> **actionPath**: `string`

Defined in: [src/platform/integrations.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L106)

The hub action the token authorizes (e.g. `slack.chat.postMessage`).

##### connectionId?

> `optional` **connectionId?**: `string`

Defined in: [src/platform/integrations.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L108)

Bind to a specific connection, or …

##### provider?

> `optional` **provider?**: `string`

Defined in: [src/platform/integrations.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L110)

… resolve the connection by provider for the calling user.

***

### MintTokenResult

Defined in: [src/platform/integrations.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L113)

#### Properties

##### tokenId

> **tokenId**: `string`

Defined in: [src/platform/integrations.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L114)

##### token

> **token**: `string`

Defined in: [src/platform/integrations.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L115)

##### expiresAt

> **expiresAt**: `string`

Defined in: [src/platform/integrations.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L116)

***

### ExecInput

Defined in: [src/platform/integrations.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L119)

#### Properties

##### path

> **path**: `string`

Defined in: [src/platform/integrations.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L121)

The hub action path to execute.

##### input?

> `optional` **input?**: `unknown`

Defined in: [src/platform/integrations.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L122)

##### connectionId?

> `optional` **connectionId?**: `string`

Defined in: [src/platform/integrations.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L123)

***

### PlatformHubStatus

Defined in: [src/platform/integrations.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L126)

#### Properties

##### contract?

> `optional` **contract?**: `unknown`

Defined in: [src/platform/integrations.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L127)

##### principal

> **principal**: `object`

Defined in: [src/platform/integrations.ts:128](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L128)

###### Index Signature

\[`k`: `string`\]: `unknown`

###### kind

> **kind**: `string`

###### userId

> **userId**: `string`

##### connections

> **connections**: `object`

Defined in: [src/platform/integrations.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L129)

###### connectedProviderCount

> **connectedProviderCount**: `number`

###### unhealthyProviderCount

> **unhealthyProviderCount**: `number`
