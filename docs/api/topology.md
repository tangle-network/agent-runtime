[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / topology

# topology

## Interfaces

### ReplayEvent

Defined in: [topology/replay.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L18)

One normalized animation frame — a node appearing, settling, or stepping, at a wall-clock ms.

#### Properties

##### t

> **t**: `number`

Defined in: [topology/replay.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L19)

##### kind

> **kind**: `"root"` \| `"spawn"` \| `"settle"` \| `"step"`

Defined in: [topology/replay.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L20)

##### id

> **id**: `string`

Defined in: [topology/replay.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L21)

##### parentId?

> `optional` **parentId?**: `string`

Defined in: [topology/replay.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L22)

##### label?

> `optional` **label?**: `string`

Defined in: [topology/replay.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L23)

##### runtime?

> `optional` **runtime?**: `string`

Defined in: [topology/replay.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L24)

##### depth?

> `optional` **depth?**: `number`

Defined in: [topology/replay.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L25)

##### status?

> `optional` **status?**: `"running"` \| `"done"` \| `"down"`

Defined in: [topology/replay.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L26)

##### valid?

> `optional` **valid?**: `boolean`

Defined in: [topology/replay.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L28)

The completion-oracle signal: delivered ⟺ a deployable check passed (not self-report).

##### score?

> `optional` **score?**: `number`

Defined in: [topology/replay.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L29)

##### reason?

> `optional` **reason?**: `string`

Defined in: [topology/replay.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L30)

##### tokens?

> `optional` **tokens?**: `number`

Defined in: [topology/replay.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L31)

##### usd?

> `optional` **usd?**: `number`

Defined in: [topology/replay.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L32)

***

### ReplayTimeline

Defined in: [topology/replay.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L35)

**`Experimental`**

`@tangle-network/agent-runtime/topology` — the live recursive-agent-tree projection over the
lifecycle hook stream. Attach `createTopologyView().hooks` to a `Supervisor`/`runLoop` and read
`.render()` for the agent tree; or fold a journal replay with `renderTopologyTree`.

#### Properties

##### runId

> **runId**: `string`

Defined in: [topology/replay.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L36)

**`Experimental`**

##### events

> **events**: [`ReplayEvent`](#replayevent)[]

Defined in: [topology/replay.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L37)

**`Experimental`**

##### t0

> **t0**: `number`

Defined in: [topology/replay.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L39)

**`Experimental`**

Wall-clock window [t0, t1] the player scrubs over.

##### t1

> **t1**: `number`

Defined in: [topology/replay.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L40)

**`Experimental`**

***

### TopologyNode

Defined in: [topology/tree.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L24)

One agent in the tree. A leaf never spawns; a driver's `childIds` is non-empty.

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: [topology/tree.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L25)

##### label

> **label**: `string`

Defined in: [topology/tree.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L27)

Display label (spawn `label`, or the driver name on the root).

##### runtime?

> `optional` **runtime?**: `string`

Defined in: [topology/tree.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L29)

Leaf runtime (`router`/`sandbox`/`cli`) when known.

##### parentId?

> `optional` **parentId?**: `string`

Defined in: [topology/tree.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L31)

Parent agent id; undefined ⇒ a root.

##### depth

> **depth**: `number`

Defined in: [topology/tree.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L33)

Recursion depth (root = 0).

##### status

> **status**: [`TopologyStatus`](#topologystatus)

Defined in: [topology/tree.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L34)

##### steps

> **steps**: `number`

Defined in: [topology/tree.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L36)

Count of in-agent steps (turns + tool calls + plan/decision rounds) folded so far.

##### score?

> `optional` **score?**: `number`

Defined in: [topology/tree.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L38)

Deployable score in [0,1] once settled `done`.

##### reason?

> `optional` **reason?**: `string`

Defined in: [topology/tree.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L40)

Failure reason once settled `down`.

##### childIds

> `readonly` **childIds**: `string`[]

Defined in: [topology/tree.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L42)

Children in spawn order.

***

### RenderOptions

Defined in: [topology/tree.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L45)

#### Properties

##### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

Defined in: [topology/tree.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L47)

Cap the rendered depth (deeper nodes collapse to a `… N more` line). Default: no cap.

##### compact?

> `readonly` `optional` **compact?**: `boolean`

Defined in: [topology/tree.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L49)

Drop the per-node detail suffix (steps/children/score) — labels only. Default: false.

***

### TopologyView

Defined in: [topology/tree.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L52)

#### Properties

##### hooks

> `readonly` **hooks**: [`RuntimeHooks`](index.md#runtimehooks)

Defined in: [topology/tree.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L54)

The `RuntimeHooks` sink — attach to `SupervisorOpts.hooks` / `runLoop` options.

#### Methods

##### ingest()

> **ingest**(`event`): `void`

Defined in: [topology/tree.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L56)

Fold one event into the tree (the same call `hooks.onEvent` makes — exposed for replay).

###### Parameters

###### event

[`RuntimeHookEvent`](index.md#runtimehookevent)

###### Returns

`void`

##### nodes()

> **nodes**(): [`TopologyNode`](#topologynode)[]

Defined in: [topology/tree.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L58)

Every node, insertion order.

###### Returns

[`TopologyNode`](#topologynode)[]

##### roots()

> **roots**(): [`TopologyNode`](#topologynode)[]

Defined in: [topology/tree.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L60)

Nodes with no in-tree parent (the run roots).

###### Returns

[`TopologyNode`](#topologynode)[]

##### node()

> **node**(`id`): [`TopologyNode`](#topologynode) \| `undefined`

Defined in: [topology/tree.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L62)

One node by id.

###### Parameters

###### id

`string`

###### Returns

[`TopologyNode`](#topologynode) \| `undefined`

##### render()

> **render**(`opts?`): `string`

Defined in: [topology/tree.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L64)

Render the tree as an aligned ASCII forest.

###### Parameters

###### opts?

[`RenderOptions`](#renderoptions)

###### Returns

`string`

## Type Aliases

### TopologyStatus

> **TopologyStatus** = `"running"` \| `"done"` \| `"down"`

Defined in: [topology/tree.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L21)

## Functions

### createReplayRecorder()

> **createReplayRecorder**(): `object`

Defined in: [topology/replay.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L58)

**`Experimental`**

A `RuntimeHooks` sink that records every lifecycle event in arrival order as `ReplayEvent`s.
Attach it to `SupervisorOpts.hooks` (or merge with another hooks object) and read `timeline()`
after the run. Pure capture — no I/O, no throwing; an unrecognized event is ignored.

#### Returns

`object`

##### hooks

> **hooks**: [`RuntimeHooks`](index.md#runtimehooks)

##### events

> **events**: [`ReplayEvent`](#replayevent)[]

##### timeline()

> **timeline**(`runId?`): [`ReplayTimeline`](#replaytimeline)

###### Parameters

###### runId?

`string`

###### Returns

[`ReplayTimeline`](#replaytimeline)

***

### renderReplayHtml()

> **renderReplayHtml**(`timeline`, `opts?`): `string`

Defined in: [topology/replay.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L159)

**`Experimental`**

Render a self-contained animated HTML replay player for a timeline. Open the file in a browser.

#### Parameters

##### timeline

[`ReplayTimeline`](#replaytimeline)

##### opts?

###### title?

`string`

#### Returns

`string`

***

### createTopologyView()

> **createTopologyView**(): [`TopologyView`](#topologyview)

Defined in: [topology/tree.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L70)

Build a live topology view. Stateful — one per run (or per replay).

#### Returns

[`TopologyView`](#topologyview)

***

### renderTopologyTree()

> **renderTopologyTree**(`tree`, `opts?`): `string`

Defined in: [topology/tree.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L161)

Render a forest of `TopologyNode`s to an aligned ASCII tree. Pure — given the same roots +
 node lookup it returns the same string. Exposed so a caller can render a tree it folded
 itself (e.g. from a journal replay) without the live view.

#### Parameters

##### tree

###### roots

[`TopologyNode`](#topologynode)[]

###### node

(`id`) => [`TopologyNode`](#topologynode) \| `undefined`

##### opts?

[`RenderOptions`](#renderoptions) = `{}`

#### Returns

`string`
