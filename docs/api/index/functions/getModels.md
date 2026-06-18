[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / getModels

# Function: getModels()

> **getModels**(`routerBaseUrl?`): `Promise`\<[`ModelInfo`](../interfaces/ModelInfo.md)[]\>

Defined in: [model-resolution.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L54)

Fetch the model catalog from the router's `/v1/models`. Throws on a non-2xx
response — callers decide whether to fail open (empty catalog) or closed.

## Parameters

### routerBaseUrl?

`string` = `DEFAULT_ROUTER_BASE_URL`

## Returns

`Promise`\<[`ModelInfo`](../interfaces/ModelInfo.md)[]\>
