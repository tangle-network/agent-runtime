[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [platform](../README.md) / PlatformHubClient

# Class: PlatformHubClient

Defined in: [platform/integrations.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L150)

## Constructors

### Constructor

> **new PlatformHubClient**(`options`): `PlatformHubClient`

Defined in: [platform/integrations.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L155)

#### Parameters

##### options

[`PlatformHubClientOptions`](../interfaces/PlatformHubClientOptions.md)

#### Returns

`PlatformHubClient`

## Methods

### catalog()

> **catalog**(): `Promise`\<[`CatalogResult`](../interfaces/CatalogResult.md)\>

Defined in: [platform/integrations.ts:166](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L166)

GET /v1/hub/providers — the connectable provider catalog.

#### Returns

`Promise`\<[`CatalogResult`](../interfaces/CatalogResult.md)\>

***

### listConnections()

> **listConnections**(): `Promise`\<[`PlatformConnection`](../interfaces/PlatformConnection.md)[]\>

Defined in: [platform/integrations.ts:171](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L171)

GET /v1/hub/connections — the calling user's live connections.

#### Returns

`Promise`\<[`PlatformConnection`](../interfaces/PlatformConnection.md)[]\>

***

### revokeConnection()

> **revokeConnection**(`connectionId`): `Promise`\<\{ `connection`: [`PlatformConnection`](../interfaces/PlatformConnection.md); \}\>

Defined in: [platform/integrations.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L180)

DELETE /v1/hub/connections/:connectionId — revoke + disable a connection.

#### Parameters

##### connectionId

`string`

#### Returns

`Promise`\<\{ `connection`: [`PlatformConnection`](../interfaces/PlatformConnection.md); \}\>

***

### startAuth()

> **startAuth**(`input`): `Promise`\<[`StartAuthResult`](../interfaces/StartAuthResult.md)\>

Defined in: [platform/integrations.ts:190](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L190)

POST /v1/hub/connections/:provider/start — begin OAuth/grant. The provider
is taken from the URL; the body carries `returnUrl` (+ `cli`). The platform's
two start branches name the URL field differently (github → `authorizationUrl`,
substrate → `redirectUrl`); this normalizes to `authorizationUrl`.

#### Parameters

##### input

[`StartAuthInput`](../interfaces/StartAuthInput.md)

#### Returns

`Promise`\<[`StartAuthResult`](../interfaces/StartAuthResult.md)\>

***

### listHealthchecks()

> **listHealthchecks**(): `Promise`\<[`HealthCheck`](../interfaces/HealthCheck.md)[]\>

Defined in: [platform/integrations.ts:217](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L217)

Last-known health for every connection. The platform has no global
healthcheck listing — health rides on each connection row — so this derives
the list from `listConnections()` (one request, no extra round-trips).

#### Returns

`Promise`\<[`HealthCheck`](../interfaces/HealthCheck.md)[]\>

***

### checkConnectionHealth()

> **checkConnectionHealth**(`connectionId`): `Promise`\<[`ConnectionHealthResult`](../interfaces/ConnectionHealthResult.md)\>

Defined in: [platform/integrations.ts:231](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L231)

POST /v1/hub/connections/:connectionId/health — trigger a fresh health
probe for one connection and return its updated state.

#### Parameters

##### connectionId

`string`

#### Returns

`Promise`\<[`ConnectionHealthResult`](../interfaces/ConnectionHealthResult.md)\>

***

### runHealthchecks()

> **runHealthchecks**(): `Promise`\<\{ `scheduled`: `number`; \}\>

Defined in: [platform/integrations.ts:240](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L240)

Trigger a fresh health probe across all of the user's connections. The
platform exposes health per-connection only, so this fans out over
`listConnections()`. `scheduled` is the number of probes dispatched.

#### Returns

`Promise`\<\{ `scheduled`: `number`; \}\>

***

### status()

> **status**(): `Promise`\<[`PlatformHubStatus`](../interfaces/PlatformHubStatus.md)\>

Defined in: [platform/integrations.ts:247](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L247)

GET /v1/hub/status — principal + aggregate connection counts.

#### Returns

`Promise`\<[`PlatformHubStatus`](../interfaces/PlatformHubStatus.md)\>

***

### mintToken()

> **mintToken**(`input`): `Promise`\<[`MintTokenResult`](../interfaces/MintTokenResult.md)\>

Defined in: [platform/integrations.ts:256](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L256)

POST /v1/hub/tokens — mint a short-lived, action-scoped capability token a
sandbox can use to invoke one hub action on the user's behalf without
seeing the underlying provider credential.

#### Parameters

##### input

[`MintTokenInput`](../interfaces/MintTokenInput.md)

#### Returns

`Promise`\<[`MintTokenResult`](../interfaces/MintTokenResult.md)\>

***

### exec()

> **exec**(`input`): `Promise`\<`unknown`\>

Defined in: [platform/integrations.ts:261](https://github.com/tangle-network/agent-runtime/blob/main/src/platform/integrations.ts#L261)

POST /v1/hub/exec — execute a hub action and return its result.

#### Parameters

##### input

[`ExecInput`](../interfaces/ExecInput.md)

#### Returns

`Promise`\<`unknown`\>
