[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DetectExecutorArgs

# Interface: DetectExecutorArgs

Defined in: [mcp/bin-helpers.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/bin-helpers.ts#L20)

**`Experimental`**

## Properties

### sandboxClient

> **sandboxClient**: [`SandboxClient`](../../runtime/interfaces/SandboxClient.md)

Defined in: [mcp/bin-helpers.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/bin-helpers.ts#L21)

**`Experimental`**

***

### env?

> `optional` **env?**: `Record`\<`string`, `string` \| `undefined`\>

Defined in: [mcp/bin-helpers.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/bin-helpers.ts#L23)

**`Experimental`**

Raw env (defaults to `process.env`). Pass an explicit map for tests.

***

### resolveFleet?

> `optional` **resolveFleet?**: (`client`, `fleetId`) => `Promise`\<[`FleetHandle`](FleetHandle.md)\>

Defined in: [mcp/bin-helpers.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/bin-helpers.ts#L29)

**`Experimental`**

Override how a fleet handle is resolved from the client + fleet id. The
default reads `client.fleets.get(fleetId)` and validates the returned
shape against the structural `FleetHandle` contract.

#### Parameters

##### client

[`SandboxClient`](../../runtime/interfaces/SandboxClient.md)

##### fleetId

`string`

#### Returns

`Promise`\<[`FleetHandle`](FleetHandle.md)\>
