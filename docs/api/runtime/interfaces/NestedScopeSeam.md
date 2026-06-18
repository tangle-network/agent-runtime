[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / NestedScopeSeam

# Interface: NestedScopeSeam

Defined in: [runtime/supervise/scope.ts:151](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/scope.ts#L151)

The recursion seam value: mount a nested `Scope` for a driver child. `parentId` is the
driver child's own node id (so its children get `${nodeId}:s${ordinal}` ids and its
nested journal tree is namespaced under it); `root` is the journal tree key for the
nested tree (distinct from the parent's so cursor seqs never collide in the per-tree
guard). `depth` is `parent.depth + 1`. The nested scope shares the parent's `pool`
(conserved budget across depth), `journal`/`blobs` (one record), and `executors` (a
nested child resolves to leaf-or-driver through the same open registry).

## Properties

### depth

> `readonly` **depth**: `number`

Defined in: [runtime/supervise/scope.ts:153](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/scope.ts#L153)

This scope's recursion depth — a nested scope runs at `depth + 1`.

***

### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

Defined in: [runtime/supervise/scope.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/scope.ts#L155)

The runtime recursion-depth ceiling, paired with the conserved pool (R3).

***

### journalRoot

> `readonly` **journalRoot**: `string`

Defined in: [runtime/supervise/scope.ts:157](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/scope.ts#L157)

The journal tree key the parent scope writes to (used to namespace nested trees).

## Methods

### mount()

> **mount**(`nestedRoot`, `signal`): [`Scope`](Scope.md)\<`unknown`\>

Defined in: [runtime/supervise/scope.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/scope.ts#L159)

Mount a nested scope rooted at `nestedRoot`, parented at this driver child's node id.

#### Parameters

##### nestedRoot

`string`

##### signal

`AbortSignal`

#### Returns

[`Scope`](Scope.md)\<`unknown`\>
