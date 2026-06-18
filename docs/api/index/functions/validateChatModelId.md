[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / validateChatModelId

# Function: validateChatModelId()

> **validateChatModelId**(`modelId`, `options?`): `Promise`\<`ChatModelValidation`\>

Defined in: [model-resolution.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L129)

Validate a caller-supplied chat-model id. Rejects non-strings, malformed
ids, and ids absent from both the caller's `allowlist` and the live router
catalog. Fails closed: when the catalog cannot be fetched, an unverifiable
id is rejected rather than admitted — a bad model never reaches the agent.

## Parameters

### modelId

`unknown`

### options?

#### allowlist?

`string`[]

Known-good ids that skip the catalog round trip — e.g. the product's
default model plus any env-configured ids.

#### routerBaseUrl?

`string`

#### loadModels?

(`routerBaseUrl`) => `Promise`\<[`ModelInfo`](../interfaces/ModelInfo.md)[]\>

Injectable catalog loader — overridden in tests.

## Returns

`Promise`\<`ChatModelValidation`\>
