[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / AuthoredProfile

# Interface: AuthoredProfile

Defined in: [runtime/supervise/authoring.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L23)

What the supervisor AUTHORS per sub-task — a worker recipe (a partial `AgentProfile`).

## Properties

### name

> **name**: `string`

Defined in: [runtime/supervise/authoring.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L24)

***

### systemPrompt

> **systemPrompt**: `string`

Defined in: [runtime/supervise/authoring.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L26)

The rich, task-specific instructions the supervisor wrote for THIS worker.

***

### model?

> `optional` **model?**: `string`

Defined in: [runtime/supervise/authoring.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L28)

The model the supervisor chose for this sub-task (falls back to the run default).
