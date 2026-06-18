[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / ConversationJournalEntry

# Interface: ConversationJournalEntry

Defined in: [conversation/journal.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L19)

## Properties

### runId

> **runId**: `string`

Defined in: [conversation/journal.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L20)

***

### startedAt

> **startedAt**: `string`

Defined in: [conversation/journal.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L21)

***

### halted?

> `optional` **halted?**: [`HaltReason`](../type-aliases/HaltReason.md)

Defined in: [conversation/journal.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L23)

Set when the run reaches a terminal state.

***

### endedAt?

> `optional` **endedAt?**: `string`

Defined in: [conversation/journal.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L24)

***

### turns

> **turns**: [`ConversationTurn`](ConversationTurn.md)[]

Defined in: [conversation/journal.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L25)
