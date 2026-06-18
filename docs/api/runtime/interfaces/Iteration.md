[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / Iteration

# Interface: Iteration\<Task, Output\>

Defined in: [runtime/types.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L119)

**`Experimental`**

## Type Parameters

### Task

`Task`

### Output

`Output`

## Properties

### index

> **index**: `number`

Defined in: [runtime/types.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L121)

**`Experimental`**

0-based iteration index assigned by the kernel.

***

### task

> **task**: `Task`

Defined in: [runtime/types.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L122)

**`Experimental`**

***

### agentRunName

> **agentRunName**: `string`

Defined in: [runtime/types.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L124)

**`Experimental`**

Stable name of the `AgentRunSpec` that produced this iteration.

***

### output?

> `optional` **output?**: `Output`

Defined in: [runtime/types.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L125)

**`Experimental`**

***

### verdict?

> `optional` **verdict?**: `DefaultVerdict`

Defined in: [runtime/types.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L126)

**`Experimental`**

***

### error?

> `optional` **error?**: `Error`

Defined in: [runtime/types.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L127)

**`Experimental`**

***

### events

> **events**: `SandboxEvent`[]

Defined in: [runtime/types.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L129)

**`Experimental`**

Raw sandbox event stream collected for this iteration.

***

### startedAt

> **startedAt**: `number`

Defined in: [runtime/types.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L130)

**`Experimental`**

***

### endedAt

> **endedAt**: `number`

Defined in: [runtime/types.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L131)

**`Experimental`**

***

### costUsd

> **costUsd**: `number`

Defined in: [runtime/types.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L132)

**`Experimental`**

***

### tokenUsage

> **tokenUsage**: [`LoopTokenUsage`](LoopTokenUsage.md)

Defined in: [runtime/types.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L134)

**`Experimental`**

Summed LLM token usage across every `llm_call` event in this iteration.
