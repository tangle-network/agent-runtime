[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / inlineSandboxClient

# Function: inlineSandboxClient()

> **inlineSandboxClient**(`factory`): [`SandboxClient`](../interfaces/SandboxClient.md)

Defined in: [runtime/inline-sandbox-client.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/inline-sandbox-client.ts#L44)

Adapt an `ExecutorFactory` into a `SandboxClient` for `runLoop`. The factory is
instantiated fresh per `streamPrompt` (mirrors the per-spawn executor lifecycle):
run once on the prompt, emit the terminal result event, tear down.

## Parameters

### factory

[`ExecutorFactory`](../type-aliases/ExecutorFactory.md)\<`unknown`\>

## Returns

[`SandboxClient`](../interfaces/SandboxClient.md)
