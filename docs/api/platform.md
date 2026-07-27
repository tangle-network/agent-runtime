[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / platform

# platform

## Classes

### PlatformAuthError

Defined in: src/platform/auth.ts:51

Thrown when a `PlatformAuthClient` request returns a non-success status.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new PlatformAuthError**(`message`, `status`, `body`): [`PlatformAuthError`](#platformautherror)

Defined in: src/platform/auth.ts:52

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

Defined in: src/platform/auth.ts:54

##### body

> `readonly` **body**: `unknown`

Defined in: src/platform/auth.ts:55

***

### PlatformAuthClient

Defined in: src/platform/auth.ts:63

HTTP client for the Tangle Platform SSO: builds authorize URLs and exchanges auth codes for API keys.

#### Constructors

##### Constructor

> **new PlatformAuthClient**(`options`): [`PlatformAuthClient`](#platformauthclient)

Defined in: src/platform/auth.ts:68

###### Parameters

###### options

[`PlatformAuthClientOptions`](#platformauthclientoptions)

###### Returns

[`PlatformAuthClient`](#platformauthclient)

#### Methods

##### authorizeUrl()

> **authorizeUrl**(`options`): `string`

Defined in: src/platform/auth.ts:83

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

Defined in: src/platform/auth.ts:101

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

Defined in: src/platform/integrations.ts:133

Thrown when a `PlatformHubClient` request returns a non-success status.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new PlatformHubError**(`message`, `status`, `code`, `body`): [`PlatformHubError`](#platformhuberror)

Defined in: src/platform/integrations.ts:134

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

Defined in: src/platform/integrations.ts:136

##### code

> `readonly` **code**: `string` \| `undefined`

Defined in: src/platform/integrations.ts:137

##### body

> `readonly` **body**: `unknown`

Defined in: src/platform/integrations.ts:138

***

### PlatformHubClient

Defined in: src/platform/integrations.ts:152

HTTP client for the Tangle Platform Hub API: provider catalog, connection flow, and status.

#### Constructors

##### Constructor

> **new PlatformHubClient**(`options`): [`PlatformHubClient`](#platformhubclient)

Defined in: src/platform/integrations.ts:157

###### Parameters

###### options

[`PlatformHubClientOptions`](#platformhubclientoptions)

###### Returns

[`PlatformHubClient`](#platformhubclient)

#### Methods

##### catalog()

> **catalog**(): `Promise`\<[`CatalogResult`](#catalogresult)\>

Defined in: src/platform/integrations.ts:168

GET /v1/hub/providers — the connectable provider catalog.

###### Returns

`Promise`\<[`CatalogResult`](#catalogresult)\>

##### listConnections()

> **listConnections**(): `Promise`\<[`PlatformConnection`](#platformconnection)[]\>

Defined in: src/platform/integrations.ts:173

GET /v1/hub/connections — the calling user's live connections.

###### Returns

`Promise`\<[`PlatformConnection`](#platformconnection)[]\>

##### revokeConnection()

> **revokeConnection**(`connectionId`): `Promise`\<\{ `connection`: [`PlatformConnection`](#platformconnection); \}\>

Defined in: src/platform/integrations.ts:182

DELETE /v1/hub/connections/:connectionId — revoke + disable a connection.

###### Parameters

###### connectionId

`string`

###### Returns

`Promise`\<\{ `connection`: [`PlatformConnection`](#platformconnection); \}\>

##### startAuth()

> **startAuth**(`input`): `Promise`\<[`StartAuthResult`](#startauthresult)\>

Defined in: src/platform/integrations.ts:192

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

Defined in: src/platform/integrations.ts:219

Last-known health for every connection. The platform has no global
healthcheck listing — health rides on each connection row — so this derives
the list from `listConnections()` (one request, no extra round-trips).

###### Returns

`Promise`\<[`HealthCheck`](#healthcheck)[]\>

##### checkConnectionHealth()

> **checkConnectionHealth**(`connectionId`): `Promise`\<[`ConnectionHealthResult`](#connectionhealthresult)\>

Defined in: src/platform/integrations.ts:233

POST /v1/hub/connections/:connectionId/health — trigger a fresh health
probe for one connection and return its updated state.

###### Parameters

###### connectionId

`string`

###### Returns

`Promise`\<[`ConnectionHealthResult`](#connectionhealthresult)\>

##### runHealthchecks()

> **runHealthchecks**(): `Promise`\<\{ `scheduled`: `number`; \}\>

Defined in: src/platform/integrations.ts:242

Trigger a fresh health probe across all of the user's connections. The
platform exposes health per-connection only, so this fans out over
`listConnections()`. `scheduled` is the number of probes dispatched.

###### Returns

`Promise`\<\{ `scheduled`: `number`; \}\>

##### status()

> **status**(): `Promise`\<[`PlatformHubStatus`](#platformhubstatus)\>

Defined in: src/platform/integrations.ts:249

GET /v1/hub/status — principal + aggregate connection counts.

###### Returns

`Promise`\<[`PlatformHubStatus`](#platformhubstatus)\>

##### mintToken()

> **mintToken**(`input`): `Promise`\<[`MintTokenResult`](#minttokenresult)\>

Defined in: src/platform/integrations.ts:258

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

Defined in: src/platform/integrations.ts:263

POST /v1/hub/exec — execute a hub action and return its result.

###### Parameters

###### input

[`ExecInput`](#execinput)

###### Returns

`Promise`\<`unknown`\>

## Interfaces

### PlatformAuthClientOptions

Defined in: src/platform/auth.ts:15

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

Defined in: src/platform/auth.ts:17

Platform base URL, e.g. `https://id.tangle.tools`.

##### appId

> **appId**: `string`

Defined in: src/platform/auth.ts:19

App id as registered in the platform's TRUSTED_APPS registry.

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: src/platform/auth.ts:21

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

Defined in: src/platform/auth.ts:24

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

Defined in: src/platform/auth.ts:26

Required CSRF token; the consumer verifies it on the callback.

##### redirectUri?

> `optional` **redirectUri?**: `string`

Defined in: src/platform/auth.ts:31

Final redirect URI. Must be one of the URIs registered for `appId`
on the platform. Omit to use the first registered URI.

##### prompt?

> `optional` **prompt?**: `"login"`

Defined in: src/platform/auth.ts:33

Force the login screen even if a session is already active.

##### email?

> `optional` **email?**: `string`

Defined in: src/platform/auth.ts:35

Pre-fill the email field on the login screen.

***

### ExchangeCodeResult

Defined in: src/platform/auth.ts:38

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

Defined in: src/platform/auth.ts:39

##### user

> **user**: `object`

Defined in: src/platform/auth.ts:40

###### id

> **id**: `string`

###### email

> **email**: `string`

###### name?

> `optional` **name?**: `string`

##### plan

> **plan**: `object`

Defined in: src/platform/auth.ts:45

###### tier

> **tier**: `string`

***

### PlatformHubClientOptions

Defined in: src/platform/integrations.ts:15

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

Defined in: src/platform/integrations.ts:17

Platform base URL, e.g. `https://id.tangle.tools`.

##### bearer

> **bearer**: `string`

Defined in: src/platform/integrations.ts:19

Bearer credential — user API key or service token.

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: src/platform/integrations.ts:21

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

Defined in: src/platform/integrations.ts:25

A live integration connection, as returned by `/v1/hub/connections`.

#### Properties

##### id

> **id**: `string`

Defined in: src/platform/integrations.ts:26

##### providerId

> **providerId**: `string`

Defined in: src/platform/integrations.ts:27

##### displayName

> **displayName**: `string`

Defined in: src/platform/integrations.ts:28

##### accountDisplay

> **accountDisplay**: `string` \| `null`

Defined in: src/platform/integrations.ts:29

##### scopes

> **scopes**: `string`[]

Defined in: src/platform/integrations.ts:30

##### status

> **status**: `string` & `object` \| `"active"` \| `"unhealthy"` \| `"revoked"` \| `"reconnect_required"`

Defined in: src/platform/integrations.ts:31

##### health

> **health**: `string` & `object` \| `"unknown"` \| `"healthy"` \| `"unhealthy"` \| `"rate_limited"`

Defined in: src/platform/integrations.ts:32

##### createdAt

> **createdAt**: `string`

Defined in: src/platform/integrations.ts:33

##### updatedAt

> **updatedAt**: `string`

Defined in: src/platform/integrations.ts:34

##### lastUsedAt

> **lastUsedAt**: `string` \| `null`

Defined in: src/platform/integrations.ts:35

***

### PlatformCatalogProvider

Defined in: src/platform/integrations.ts:39

A connectable provider in the catalog (`/v1/hub/providers`).

#### Indexable

> \[`k`: `string`\]: `unknown`

#### Properties

##### providerId

> **providerId**: `string`

Defined in: src/platform/integrations.ts:40

##### title?

> `optional` **title?**: `string`

Defined in: src/platform/integrations.ts:41

##### authKind?

> `optional` **authKind?**: `string`

Defined in: src/platform/integrations.ts:42

##### category?

> `optional` **category?**: `string`

Defined in: src/platform/integrations.ts:43

##### scopes?

> `optional` **scopes?**: `string`[]

Defined in: src/platform/integrations.ts:44

##### capabilityCount?

> `optional` **capabilityCount?**: `number`

Defined in: src/platform/integrations.ts:45

##### native?

> `optional` **native?**: `boolean`

Defined in: src/platform/integrations.ts:46

##### configured?

> `optional` **configured?**: `boolean`

Defined in: src/platform/integrations.ts:49

Whether the OAuth app's credentials are wired — the UI offers Connect
 only when true.

***

### CatalogResult

Defined in: src/platform/integrations.ts:53

#### Indexable

> \[`k`: `string`\]: `unknown`

#### Properties

##### providers

> **providers**: [`PlatformCatalogProvider`](#platformcatalogprovider)[]

Defined in: src/platform/integrations.ts:54

##### substrateBundled?

> `optional` **substrateBundled?**: `number`

Defined in: src/platform/integrations.ts:56

Count of substrate-bundled connectors behind the catalog.

***

### StartAuthInput

Defined in: src/platform/integrations.ts:60

#### Properties

##### providerId

> **providerId**: `string`

Defined in: src/platform/integrations.ts:62

The provider to connect (goes in the URL path).

##### connectorId?

> `optional` **connectorId?**: `string`

Defined in: src/platform/integrations.ts:65

Accepted for interface compatibility; the platform's start endpoint is
 provider-level and does not consume a connector id.

##### returnUrl

> **returnUrl**: `string`

Defined in: src/platform/integrations.ts:67

Where the platform redirects the user back to after OAuth.

##### requestedScopes?

> `optional` **requestedScopes?**: `string`[]

Defined in: src/platform/integrations.ts:69

Accepted for interface compatibility; not consumed by the start endpoint.

##### cli?

> `optional` **cli?**: `boolean`

Defined in: src/platform/integrations.ts:71

CLI flow flag — affects the platform's post-auth redirect handling.

***

### StartAuthResult

Defined in: src/platform/integrations.ts:74

#### Properties

##### authorizationUrl

> **authorizationUrl**: `string`

Defined in: src/platform/integrations.ts:78

The URL to send the user to. Normalized across the platform's two start
 branches: github returns `authorizationUrl`, substrate returns
 `redirectUrl`.

##### state

> **state**: `string`

Defined in: src/platform/integrations.ts:79

##### expiresAt?

> `optional` **expiresAt?**: `string`

Defined in: src/platform/integrations.ts:80

##### scopes?

> `optional` **scopes?**: `string`[]

Defined in: src/platform/integrations.ts:81

***

### ConnectionHealth

Defined in: src/platform/integrations.ts:84

#### Properties

##### status

> **status**: `string` & `object` \| `"unknown"` \| `"healthy"` \| `"unhealthy"` \| `"rate_limited"`

Defined in: src/platform/integrations.ts:85

##### checkedAt

> **checkedAt**: `string`

Defined in: src/platform/integrations.ts:86

##### error?

> `optional` **error?**: `object`

Defined in: src/platform/integrations.ts:87

###### code

> **code**: `string`

###### message

> **message**: `string`

***

### ConnectionHealthResult

Defined in: src/platform/integrations.ts:90

#### Properties

##### connection

> **connection**: [`PlatformConnection`](#platformconnection)

Defined in: src/platform/integrations.ts:91

##### health

> **health**: [`ConnectionHealth`](#connectionhealth)

Defined in: src/platform/integrations.ts:92

***

### HealthCheck

Defined in: src/platform/integrations.ts:96

Last-known health for a connection, derived from the connection row.

#### Properties

##### connectionId

> **connectionId**: `string`

Defined in: src/platform/integrations.ts:97

##### providerId

> **providerId**: `string`

Defined in: src/platform/integrations.ts:98

##### status

> **status**: `string` & `object` \| `"unknown"` \| `"healthy"` \| `"unhealthy"` \| `"rate_limited"`

Defined in: src/platform/integrations.ts:100

Mirrors `PlatformConnection.health`.

##### checkedAt?

> `optional` **checkedAt?**: `string`

Defined in: src/platform/integrations.ts:101

***

### MintTokenInput

Defined in: src/platform/integrations.ts:104

#### Properties

##### actionPath

> **actionPath**: `string`

Defined in: src/platform/integrations.ts:106

The hub action the token authorizes (e.g. `slack.chat.postMessage`).

##### connectionId?

> `optional` **connectionId?**: `string`

Defined in: src/platform/integrations.ts:108

Bind to a specific connection, or …

##### provider?

> `optional` **provider?**: `string`

Defined in: src/platform/integrations.ts:110

… resolve the connection by provider for the calling user.

***

### MintTokenResult

Defined in: src/platform/integrations.ts:113

#### Properties

##### tokenId

> **tokenId**: `string`

Defined in: src/platform/integrations.ts:114

##### token

> **token**: `string`

Defined in: src/platform/integrations.ts:115

##### expiresAt

> **expiresAt**: `string`

Defined in: src/platform/integrations.ts:116

***

### ExecInput

Defined in: src/platform/integrations.ts:119

#### Properties

##### path

> **path**: `string`

Defined in: src/platform/integrations.ts:121

The hub action path to execute.

##### input?

> `optional` **input?**: `unknown`

Defined in: src/platform/integrations.ts:122

##### connectionId?

> `optional` **connectionId?**: `string`

Defined in: src/platform/integrations.ts:123

***

### PlatformHubStatus

Defined in: src/platform/integrations.ts:126

#### Properties

##### contract?

> `optional` **contract?**: `unknown`

Defined in: src/platform/integrations.ts:127

##### principal

> **principal**: `object`

Defined in: src/platform/integrations.ts:128

###### Index Signature

\[`k`: `string`\]: `unknown`

###### kind

> **kind**: `string`

###### userId

> **userId**: `string`

##### connections

> **connections**: `object`

Defined in: src/platform/integrations.ts:129

###### connectedProviderCount

> **connectedProviderCount**: `number`

###### unhealthyProviderCount

> **unhealthyProviderCount**: `number`
