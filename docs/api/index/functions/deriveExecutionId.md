[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / deriveExecutionId

# Function: deriveExecutionId()

> **deriveExecutionId**(`input`): `string`

Defined in: [durable/execution-handle.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/execution-handle.ts#L17)

Derive a stable executionId from the run identity. The same
`(projectId, sessionId, turnIndex)` tuple yields the same id — so a
client retry of the same turn lands on the same substrate execution
and the orchestrator's buffer replays instead of starting a second
prompt.

Format is readable, not hashed: operators grepping orchestrator logs
for `gtm-agent:thread-abc:3` find the run without translating an
opaque id. Substrate executionIds are not a secrecy boundary.

Wire integration:
  - Sandbox PromptOptions accepts `executionId` and `lastEventId`.
    Products pass this id to make cross-process reconnect land on the
    same substrate execution instead of spawning a duplicate run.

## Parameters

### input

#### projectId

`string`

#### sessionId

`string`

#### turnIndex

`number`

## Returns

`string`
