[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / NodeStatus

# Type Alias: NodeStatus

> **NodeStatus** = `"pending"` \| `"acquiring"` \| `"running"` \| `"done"` \| `"failed"` \| `"cancelled"`

Defined in: [runtime/supervise/types.ts:222](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L222)

`'acquiring'` is first-class (M1): a node spends real time + reaps an orphan box
 during sandbox acquire BEFORE it is `running`, so abort must be defined over it.
