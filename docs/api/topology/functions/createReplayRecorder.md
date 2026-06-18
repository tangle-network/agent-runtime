[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [topology](../README.md) / createReplayRecorder

# Function: createReplayRecorder()

> **createReplayRecorder**(): `object`

Defined in: [topology/replay.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L58)

**`Experimental`**

A `RuntimeHooks` sink that records every lifecycle event in arrival order as `ReplayEvent`s.
Attach it to `SupervisorOpts.hooks` (or merge with another hooks object) and read `timeline()`
after the run. Pure capture — no I/O, no throwing; an unrecognized event is ignored.

## Returns

`object`

### hooks

> **hooks**: [`RuntimeHooks`](../../index/interfaces/RuntimeHooks.md)

### events

> **events**: [`ReplayEvent`](../interfaces/ReplayEvent.md)[]

### timeline()

> **timeline**(`runId?`): [`ReplayTimeline`](../interfaces/ReplayTimeline.md)

#### Parameters

##### runId?

`string`

#### Returns

[`ReplayTimeline`](../interfaces/ReplayTimeline.md)
