[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / resolveChatModel

# Function: resolveChatModel()

> **resolveChatModel**(`candidates`, `fallback`): [`ResolvedChatModel`](../interfaces/ResolvedChatModel.md)

Defined in: [model-resolution.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L89)

Resolve a chat model by precedence: the first candidate carrying a
non-blank model wins, else `fallback`. The caller owns the precedence
order, so each product keeps its own policy (request → workspace → env,
etc.) while the first-non-blank logic and the telemetry shape stay shared.

## Parameters

### candidates

`ChatModelCandidate`[]

### fallback

[`ResolvedChatModel`](../interfaces/ResolvedChatModel.md)

## Returns

[`ResolvedChatModel`](../interfaces/ResolvedChatModel.md)
