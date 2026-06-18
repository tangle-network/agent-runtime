[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / SpawnEvent

# Type Alias: SpawnEvent

> **SpawnEvent** = \{ `kind`: `"spawned"`; `id`: [`NodeId`](NodeId.md); `parent?`: [`NodeId`](NodeId.md); `label`: `string`; `budget`: [`Budget`](../interfaces/Budget.md); `runtime`: [`Runtime`](Runtime.md); `seq`: `number`; `at`: `string`; \} \| \{ `kind`: `"settled"`; `id`: [`NodeId`](NodeId.md); `status`: `"done"` \| `"down"`; `outRef?`: `string`; `verdict?`: `DefaultVerdict`; `spent`: [`Spend`](../interfaces/Spend.md); `infra?`: `boolean`; `seq`: `number`; `at`: `string`; \} \| \{ `kind`: `"cancelled"`; `id`: [`NodeId`](NodeId.md); `reason`: `string`; `seq`: `number`; `at`: `string`; \} \| \{ `kind`: `"metered"`; `id`: [`NodeId`](NodeId.md); `spend`: [`Spend`](../interfaces/Spend.md); `seq`: `number`; `at`: `string`; \}

Defined in: [runtime/supervise/types.ts:362](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L362)

Journaled spawn-tree events (B1/B2). `seq` is the cursor order; `at` is an ISO
 timestamp for human inspection only (NOT a replay input).

## Union Members

### Type Literal

\{ `kind`: `"spawned"`; `id`: [`NodeId`](NodeId.md); `parent?`: [`NodeId`](NodeId.md); `label`: `string`; `budget`: [`Budget`](../interfaces/Budget.md); `runtime`: [`Runtime`](Runtime.md); `seq`: `number`; `at`: `string`; \}

***

### Type Literal

\{ `kind`: `"settled"`; `id`: [`NodeId`](NodeId.md); `status`: `"done"` \| `"down"`; `outRef?`: `string`; `verdict?`: `DefaultVerdict`; `spent`: [`Spend`](../interfaces/Spend.md); `infra?`: `boolean`; `seq`: `number`; `at`: `string`; \}

#### kind

> **kind**: `"settled"`

#### id

> **id**: [`NodeId`](NodeId.md)

#### status

> **status**: `"done"` \| `"down"`

#### outRef?

> `optional` **outRef?**: `string`

Content-addressed result pointer; rehydrates `out` from `ResultBlobStore`.

#### verdict?

> `optional` **verdict?**: `DefaultVerdict`

#### spent

> **spent**: [`Spend`](../interfaces/Spend.md)

#### infra?

> `optional` **infra?**: `boolean`

#### seq

> **seq**: `number`

#### at

> **at**: `string`

***

### Type Literal

\{ `kind`: `"cancelled"`; `id`: [`NodeId`](NodeId.md); `reason`: `string`; `seq`: `number`; `at`: `string`; \}

***

### Type Literal

\{ `kind`: `"metered"`; `id`: [`NodeId`](NodeId.md); `spend`: [`Spend`](../interfaces/Spend.md); `seq`: `number`; `at`: `string`; \}

#### kind

> **kind**: `"metered"`

A driver's OWN inference spend, journaled separately from spawned-child work — the journal
 TWIN of `BudgetPool.observe`, exactly as `settled` is the twin of `reconcile`. So every
 journal-based cost reader sums it automatically — the journal is the single cost ledger.
 It carries spend only and is NOT a settlement: replay + `materializeTreeView` skip it for
 structure, and its `seq` lives outside the cursor-uniqueness namespace. A
 driver re-homes its nested subtree's metered total up to its parent (like settled spend),
 so summing any sub-tree root yields that sub-tree's true driver-inference cost.

#### id

> **id**: [`NodeId`](NodeId.md)

#### spend

> **spend**: [`Spend`](../interfaces/Spend.md)

#### seq

> **seq**: `number`

#### at

> **at**: `string`
