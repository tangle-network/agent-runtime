[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / LoopIterationDispatchPayload

# Interface: LoopIterationDispatchPayload

Defined in: [runtime/types.ts:410](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L410)

**`Experimental`**

Where the iteration's worker was placed. `sibling` = a fresh sandbox the
kernel created via `sandboxClient.create`. `fleet` = an existing machine in
a shared-workspace fleet — workers see the caller's filesystem and any diff
they write lands on it directly.

## Properties

### iterationIndex

> **iterationIndex**: `number`

Defined in: [runtime/types.ts:411](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L411)

**`Experimental`**

***

### agentRunName

> **agentRunName**: `string`

Defined in: [runtime/types.ts:412](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L412)

**`Experimental`**

***

### placement

> **placement**: `"sibling"` \| `"fleet"`

Defined in: [runtime/types.ts:413](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L413)

**`Experimental`**

***

### sandboxId?

> `optional` **sandboxId?**: `string`

Defined in: [runtime/types.ts:415](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L415)

**`Experimental`**

Set on every placement. Lets analyst loops correlate per-iteration logs.

***

### fleetId?

> `optional` **fleetId?**: `string`

Defined in: [runtime/types.ts:417](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L417)

**`Experimental`**

Set only when `placement === 'fleet'`.

***

### machineId?

> `optional` **machineId?**: `string`

Defined in: [runtime/types.ts:419](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L419)

**`Experimental`**

Set only when `placement === 'fleet'`.

***

### groupId?

> `optional` **groupId?**: `number`

Defined in: [runtime/types.ts:421](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L421)

**`Experimental`**

Plan round this iteration belongs to.

***

### parentIndex?

> `optional` **parentIndex?**: `number`

Defined in: [runtime/types.ts:423](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L423)

**`Experimental`**

Iteration this one was planned from; `undefined` ⇒ root.
