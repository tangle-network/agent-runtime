[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / createIntelligenceClient

# Function: createIntelligenceClient()

> **createIntelligenceClient**(`config`): [`IntelligenceClient`](../interfaces/IntelligenceClient.md)

Defined in: [intelligence/index.ts:323](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L323)

Create an Observe-mode Intelligence client. Resolves effort, endpoint, and
redactor up front; the exporter is built lazily and is `undefined` when no
endpoint is configured (export becomes a no-op — best-effort by
construction).

## Parameters

### config

[`IntelligenceConfig`](../interfaces/IntelligenceConfig.md)

## Returns

[`IntelligenceClient`](../interfaces/IntelligenceClient.md)
