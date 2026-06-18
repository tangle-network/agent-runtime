[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [topology](../README.md) / ReplayTimeline

# Interface: ReplayTimeline

Defined in: [topology/replay.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L35)

**`Experimental`**

`@tangle-network/agent-runtime/topology` — the live recursive-agent-tree projection over the
lifecycle hook stream. Attach `createTopologyView().hooks` to a `Supervisor`/`runLoop` and read
`.render()` for the agent tree; or fold a journal replay with `renderTopologyTree`.

## Properties

### runId

> **runId**: `string`

Defined in: [topology/replay.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L36)

**`Experimental`**

***

### events

> **events**: [`ReplayEvent`](ReplayEvent.md)[]

Defined in: [topology/replay.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L37)

**`Experimental`**

***

### t0

> **t0**: `number`

Defined in: [topology/replay.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L39)

**`Experimental`**

Wall-clock window [t0, t1] the player scrubs over.

***

### t1

> **t1**: `number`

Defined in: [topology/replay.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L40)

**`Experimental`**
