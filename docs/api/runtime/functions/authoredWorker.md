[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / authoredWorker

# Function: authoredWorker()

> **authoredWorker**(`profile`, `opts`): [`Agent`](../interfaces/Agent.md)\<`unknown`, `unknown`\>

Defined in: [runtime/supervise/authoring.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L65)

Build a worker AGENT from a profile the supervisor authored: the authored `systemPrompt` +
 `model` shape the worker's one model call; the deliverable gates settlement (valid ⟺ delivered).

## Parameters

### profile

[`AuthoredProfile`](../interfaces/AuthoredProfile.md)

### opts

#### cfg

[`RouterConfig`](../interfaces/RouterConfig.md)

#### taskPrompt

`string`

#### deliverable

[`DeliverableSpec`](../interfaces/DeliverableSpec.md)

#### temperature?

`number`

## Returns

[`Agent`](../interfaces/Agent.md)\<`unknown`, `unknown`\>
