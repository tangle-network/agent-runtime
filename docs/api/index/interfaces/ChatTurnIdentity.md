[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / ChatTurnIdentity

# Interface: ChatTurnIdentity

Defined in: [durable/chat-engine.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L35)

Identity of a chat turn. `tenantId` is the workspace id for workspace-
 scoped products and the user id for session-scoped products.

## Properties

### tenantId

> **tenantId**: `string`

Defined in: [durable/chat-engine.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L36)

***

### sessionId

> **sessionId**: `string`

Defined in: [durable/chat-engine.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L38)

Thread / session id.

***

### userId

> **userId**: `string`

Defined in: [durable/chat-engine.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L39)

***

### turnIndex

> **turnIndex**: `number`

Defined in: [durable/chat-engine.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L41)

Monotonic 0-based turn index within the session.
