[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / SupervisedResult

# Type Alias: SupervisedResult\<Out\>

> **SupervisedResult**\<`Out`\> = \{ `kind`: `"winner"`; `out`: `Out`; `outRef`: `string`; `verdict?`: `DefaultVerdict`; `tree`: [`TreeView`](../interfaces/TreeView.md); `spentTotal`: [`Spend`](../interfaces/Spend.md); `spentBreakdown?`: \{ `driverInference`: [`Spend`](../interfaces/Spend.md); `childWork`: [`Spend`](../interfaces/Spend.md); \}; \} \| \{ `kind`: `"no-winner"`; `reason`: `"all-children-down"` \| `"budget-exhausted"` \| `"aborted"`; `tree`: [`TreeView`](../interfaces/TreeView.md); `downCount`: `number`; \}

Defined in: [runtime/supervise/types.ts:459](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L459)

Typed terminal result (M2) — a no-winner is NEVER coerced to a best-effort output.

## Type Parameters

### Out

`Out`

## Union Members

### Type Literal

\{ `kind`: `"winner"`; `out`: `Out`; `outRef`: `string`; `verdict?`: `DefaultVerdict`; `tree`: [`TreeView`](../interfaces/TreeView.md); `spentTotal`: [`Spend`](../interfaces/Spend.md); `spentBreakdown?`: \{ `driverInference`: [`Spend`](../interfaces/Spend.md); `childWork`: [`Spend`](../interfaces/Spend.md); \}; \}

#### kind

> **kind**: `"winner"`

#### out

> **out**: `Out`

#### outRef

> **outRef**: `string`

#### verdict?

> `optional` **verdict?**: `DefaultVerdict`

#### tree

> **tree**: [`TreeView`](../interfaces/TreeView.md)

#### spentTotal

> **spentTotal**: [`Spend`](../interfaces/Spend.md)

#### spentBreakdown?

> `optional` **spentBreakdown?**: `object`

Where `spentTotal` went: `driverInference` = the drivers' own chat turns (metered via
 `Scope.meter`); `childWork` = every spawned child's reconciled spend (the journal sum).
 `driverInference + childWork === spentTotal`. Present whenever any driver metered.

##### spentBreakdown.driverInference

> **driverInference**: [`Spend`](../interfaces/Spend.md)

##### spentBreakdown.childWork

> **childWork**: [`Spend`](../interfaces/Spend.md)

***

### Type Literal

\{ `kind`: `"no-winner"`; `reason`: `"all-children-down"` \| `"budget-exhausted"` \| `"aborted"`; `tree`: [`TreeView`](../interfaces/TreeView.md); `downCount`: `number`; \}
