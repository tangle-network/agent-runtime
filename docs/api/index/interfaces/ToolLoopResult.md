[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / ToolLoopResult

# Interface: ToolLoopResult

Defined in: [tool-loop.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L120)

## Properties

### finalText

> **finalText**: `string`

Defined in: [tool-loop.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L121)

***

### toolResults

> **toolResults**: `object`[]

Defined in: [tool-loop.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L122)

#### call

> **call**: [`ToolLoopCall`](ToolLoopCall.md)

#### label

> **label**: `string`

#### outcome

> **outcome**: [`ToolCallOutcome`](../type-aliases/ToolCallOutcome.md)

***

### turns

> **turns**: `number`

Defined in: [tool-loop.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L123)

***

### stopReason

> **stopReason**: [`ToolLoopStopReason`](../type-aliases/ToolLoopStopReason.md)

Defined in: [tool-loop.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L124)

***

### ~~cappedOut~~

> **cappedOut**: `boolean`

Defined in: [tool-loop.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L126)

#### Deprecated

Use `stopReason !== 'completed'` instead.
