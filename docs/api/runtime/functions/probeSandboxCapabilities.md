[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / probeSandboxCapabilities

# Function: probeSandboxCapabilities()

> **probeSandboxCapabilities**(`client`): `Promise`\<[`SandboxCapabilities`](../interfaces/SandboxCapabilities.md)\>

Defined in: [runtime/sandbox-capabilities.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-capabilities.ts#L45)

**`Experimental`**

Probe (and memoize per client) what the loop may rely on. A client without a
`criuStatus` method, or whose probe rejects, yields `canFork = false` — a
failed probe must never claim a capability the platform may not have. The
promise is cached so concurrent fanout branches share one round-trip.

## Parameters

### client

[`SandboxClient`](../interfaces/SandboxClient.md)

## Returns

`Promise`\<[`SandboxCapabilities`](../interfaces/SandboxCapabilities.md)\>
