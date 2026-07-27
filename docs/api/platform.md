[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / platform

# platform

## Classes

### PlatformAuthError

Thrown when a `PlatformAuthClient` request returns a non-success status.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new PlatformAuthError**(`message`, `status`, `body`): [`PlatformAuthError`](#platformautherror)

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

##### body

> `readonly` **body**: `unknown`

***

### PlatformAuthClient

HTTP client for the Tangle Platform SSO: builds authorize URLs and exchanges auth codes for API keys.

#### Constructors

##### Constructor

> **new PlatformAuthClient**(`options`): [`PlatformAuthClient`](#platformauthclient)

###### Parameters

###### options

[`PlatformAuthClientOptions`](#platformauthclientoptions)

###### Returns

[`PlatformAuthClient`](#platformauthclient)

#### Methods

##### authorizeUrl()

> **authorizeUrl**(`options`): `string`

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

Thrown when a `PlatformHubClient` request returns a non-success status.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new PlatformHubError**(`message`, `status`, `code`, `body`): [`PlatformHubError`](#platformhuberror)

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

##### code

> `readonly` **code**: `string` \| `undefined`

##### body

> `readonly` **body**: `unknown`

***

### PlatformHubClient

HTTP client for the Tangle Platform Hub API: provider catalog, connection flow, and status.

#### Constructors

##### Constructor

> **new PlatformHubClient**(`options`): [`PlatformHubClient`](#platformhubclient)

###### Parameters

###### options

[`PlatformHubClientOptions`](#platformhubclientoptions)

###### Returns

[`PlatformHubClient`](#platformhubclient)

#### Methods

##### catalog()

> **catalog**(): `Promise`\<[`CatalogResult`](#catalogresult)\>

GET /v1/hub/providers — the connectable provider catalog.

###### Returns

`Promise`\<[`CatalogResult`](#catalogresult)\>

##### listConnections()

> **listConnections**(): `Promise`\<[`PlatformConnection`](#platformconnection)[]\>

GET /v1/hub/connections — the calling user's live connections.

###### Returns

`Promise`\<[`PlatformConnection`](#platformconnection)[]\>

##### revokeConnection()

> **revokeConnection**(`connectionId`): `Promise`\<\{ `connection`: [`PlatformConnection`](#platformconnection); \}\>

DELETE /v1/hub/connections/:connectionId — revoke + disable a connection.

###### Parameters

###### connectionId

`string`

###### Returns

`Promise`\<\{ `connection`: [`PlatformConnection`](#platformconnection); \}\>

##### startAuth()

> **startAuth**(`input`): `Promise`\<[`StartAuthResult`](#startauthresult)\>

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

Last-known health for every connection. The platform has no global
healthcheck listing — health rides on each connection row — so this derives
the list from `listConnections()` (one request, no extra round-trips).

###### Returns

`Promise`\<[`HealthCheck`](#healthcheck)[]\>

##### checkConnectionHealth()

> **checkConnectionHealth**(`connectionId`): `Promise`\<[`ConnectionHealthResult`](#connectionhealthresult)\>

POST /v1/hub/connections/:connectionId/health — trigger a fresh health
probe for one connection and return its updated state.

###### Parameters

###### connectionId

`string`

###### Returns

`Promise`\<[`ConnectionHealthResult`](#connectionhealthresult)\>

##### runHealthchecks()

> **runHealthchecks**(): `Promise`\<\{ `scheduled`: `number`; \}\>

Trigger a fresh health probe across all of the user's connections. The
platform exposes health per-connection only, so this fans out over
`listConnections()`. `scheduled` is the number of probes dispatched.

###### Returns

`Promise`\<\{ `scheduled`: `number`; \}\>

##### status()

> **status**(): `Promise`\<[`PlatformHubStatus`](#platformhubstatus)\>

GET /v1/hub/status — principal + aggregate connection counts.

###### Returns

`Promise`\<[`PlatformHubStatus`](#platformhubstatus)\>

##### mintToken()

> **mintToken**(`input`): `Promise`\<[`MintTokenResult`](#minttokenresult)\>

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

POST /v1/hub/exec — execute a hub action and return its result.

###### Parameters

###### input

[`ExecInput`](#execinput)

###### Returns

`Promise`\<`unknown`\>

## Interfaces

### PlatformAuthClientOptions

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

Platform base URL, e.g. `https://id.tangle.tools`.

##### appId

> **appId**: `string`

App id as registered in the platform's TRUSTED_APPS registry.

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

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

Required CSRF token; the consumer verifies it on the callback.

##### redirectUri?

> `optional` **redirectUri?**: `string`

Final redirect URI. Must be one of the URIs registered for `appId`
on the platform. Omit to use the first registered URI.

##### prompt?

> `optional` **prompt?**: `"login"`

Force the login screen even if a session is already active.

##### email?

> `optional` **email?**: `string`

Pre-fill the email field on the login screen.

***

### ExchangeCodeResult

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

##### user

> **user**: `object`

###### id

> **id**: `string`

###### email

> **email**: `string`

###### name?

> `optional` **name?**: `string`

##### plan

> **plan**: `object`

###### tier

> **tier**: `string`

***

### PlatformHubClientOptions

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

Platform base URL, e.g. `https://id.tangle.tools`.

##### bearer

> **bearer**: `string`

Bearer credential — user API key or service token.

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

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

A live integration connection, as returned by `/v1/hub/connections`.

#### Properties

##### id

> **id**: `string`

##### providerId

> **providerId**: `string`

##### displayName

> **displayName**: `string`

##### accountDisplay

> **accountDisplay**: `string` \| `null`

##### scopes

> **scopes**: `string`[]

##### status

> **status**: `string` & `object` \| `"active"` \| `"unhealthy"` \| `"revoked"` \| `"reconnect_required"`

##### health

> **health**: `string` & `object` \| `"unknown"` \| `"healthy"` \| `"unhealthy"` \| `"rate_limited"`

##### createdAt

> **createdAt**: `string`

##### updatedAt

> **updatedAt**: `string`

##### lastUsedAt

> **lastUsedAt**: `string` \| `null`

***

### PlatformCatalogProvider

A connectable provider in the catalog (`/v1/hub/providers`).

#### Indexable

> \[`k`: `string`\]: `unknown`

#### Properties

##### providerId

> **providerId**: `string`

##### title?

> `optional` **title?**: `string`

##### authKind?

> `optional` **authKind?**: `string`

##### category?

> `optional` **category?**: `string`

##### scopes?

> `optional` **scopes?**: `string`[]

##### capabilityCount?

> `optional` **capabilityCount?**: `number`

##### native?

> `optional` **native?**: `boolean`

##### configured?

> `optional` **configured?**: `boolean`

Whether the OAuth app's credentials are wired — the UI offers Connect
 only when true.

***

### CatalogResult

#### Indexable

> \[`k`: `string`\]: `unknown`

#### Properties

##### providers

> **providers**: [`PlatformCatalogProvider`](#platformcatalogprovider)[]

##### substrateBundled?

> `optional` **substrateBundled?**: `number`

Count of substrate-bundled connectors behind the catalog.

***

### StartAuthInput

#### Properties

##### providerId

> **providerId**: `string`

The provider to connect (goes in the URL path).

##### connectorId?

> `optional` **connectorId?**: `string`

Accepted for interface compatibility; the platform's start endpoint is
 provider-level and does not consume a connector id.

##### returnUrl

> **returnUrl**: `string`

Where the platform redirects the user back to after OAuth.

##### requestedScopes?

> `optional` **requestedScopes?**: `string`[]

Accepted for interface compatibility; not consumed by the start endpoint.

##### cli?

> `optional` **cli?**: `boolean`

CLI flow flag — affects the platform's post-auth redirect handling.

***

### StartAuthResult

#### Properties

##### authorizationUrl

> **authorizationUrl**: `string`

The URL to send the user to. Normalized across the platform's two start
 branches: github returns `authorizationUrl`, substrate returns
 `redirectUrl`.

##### state

> **state**: `string`

##### expiresAt?

> `optional` **expiresAt?**: `string`

##### scopes?

> `optional` **scopes?**: `string`[]

***

### ConnectionHealth

#### Properties

##### status

> **status**: `string` & `object` \| `"unknown"` \| `"healthy"` \| `"unhealthy"` \| `"rate_limited"`

##### checkedAt

> **checkedAt**: `string`

##### error?

> `optional` **error?**: `object`

###### code

> **code**: `string`

###### message

> **message**: `string`

***

### ConnectionHealthResult

#### Properties

##### connection

> **connection**: [`PlatformConnection`](#platformconnection)

##### health

> **health**: [`ConnectionHealth`](#connectionhealth)

***

### HealthCheck

Last-known health for a connection, derived from the connection row.

#### Properties

##### connectionId

> **connectionId**: `string`

##### providerId

> **providerId**: `string`

##### status

> **status**: `string` & `object` \| `"unknown"` \| `"healthy"` \| `"unhealthy"` \| `"rate_limited"`

Mirrors `PlatformConnection.health`.

##### checkedAt?

> `optional` **checkedAt?**: `string`

***

### MintTokenInput

#### Properties

##### actionPath

> **actionPath**: `string`

The hub action the token authorizes (e.g. `slack.chat.postMessage`).

##### connectionId?

> `optional` **connectionId?**: `string`

Bind to a specific connection, or …

##### provider?

> `optional` **provider?**: `string`

… resolve the connection by provider for the calling user.

***

### MintTokenResult

#### Properties

##### tokenId

> **tokenId**: `string`

##### token

> **token**: `string`

##### expiresAt

> **expiresAt**: `string`

***

### ExecInput

#### Properties

##### path

> **path**: `string`

The hub action path to execute.

##### input?

> `optional` **input?**: `unknown`

##### connectionId?

> `optional` **connectionId?**: `string`

***

### PlatformHubStatus

#### Properties

##### contract?

> `optional` **contract?**: `unknown`

##### principal

> **principal**: `object`

###### Index Signature

\[`k`: `string`\]: `unknown`

###### kind

> **kind**: `string`

###### userId

> **userId**: `string`

##### connections

> **connections**: `object`

###### connectedProviderCount

> **connectedProviderCount**: `number`

###### unhealthyProviderCount

> **unhealthyProviderCount**: `number`
