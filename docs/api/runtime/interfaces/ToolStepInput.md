[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / ToolStepInput

# Interface: ToolStepInput

Defined in: [runtime/supervise/trace-source.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L23)

## Properties

### toolName

> `readonly` **toolName**: `string`

Defined in: [runtime/supervise/trace-source.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L24)

***

### args

> `readonly` **args**: `unknown`

Defined in: [runtime/supervise/trace-source.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L25)

***

### status?

> `readonly` `optional` **status?**: `"error"` \| `"ok"`

Defined in: [runtime/supervise/trace-source.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L26)

***

### result?

> `readonly` `optional` **result?**: `unknown`

Defined in: [runtime/supervise/trace-source.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L27)

***

### callId?

> `readonly` `optional` **callId?**: `string`

Defined in: [runtime/supervise/trace-source.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L30)

Stable id of the tool call — used to de-duplicate the repeated state transitions a harness
 streams for one call (opencode emits pending→running→completed, plus a `raw`-wrapped copy).
