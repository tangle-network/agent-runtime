[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [workflow](../README.md) / WorkflowBudget

# Class: WorkflowBudget

Defined in: [workflow/budget.ts:11](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/budget.ts#L11)

## Implements

- [`WorkflowBudgetView`](../interfaces/WorkflowBudgetView.md)

## Constructors

### Constructor

> **new WorkflowBudget**(`total`, `now`): `WorkflowBudget`

Defined in: [workflow/budget.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/budget.ts#L20)

#### Parameters

##### total

[`WorkflowBudgetCaps`](../interfaces/WorkflowBudgetCaps.md)

##### now

() => `number`

#### Returns

`WorkflowBudget`

## Properties

### total

> `readonly` **total**: [`WorkflowBudgetCaps`](../interfaces/WorkflowBudgetCaps.md)

Defined in: [workflow/budget.ts:12](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/budget.ts#L12)

#### Implementation of

[`WorkflowBudgetView`](../interfaces/WorkflowBudgetView.md).[`total`](../interfaces/WorkflowBudgetView.md#total)

## Methods

### spent()

> **spent**(): [`WorkflowBudgetSnapshot`](../interfaces/WorkflowBudgetSnapshot.md)

Defined in: [workflow/budget.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/budget.ts#L26)

#### Returns

[`WorkflowBudgetSnapshot`](../interfaces/WorkflowBudgetSnapshot.md)

#### Implementation of

[`WorkflowBudgetView`](../interfaces/WorkflowBudgetView.md).[`spent`](../interfaces/WorkflowBudgetView.md#spent)

***

### remaining()

> **remaining**(): [`WorkflowBudgetRemaining`](../interfaces/WorkflowBudgetRemaining.md)

Defined in: [workflow/budget.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/budget.ts#L36)

#### Returns

[`WorkflowBudgetRemaining`](../interfaces/WorkflowBudgetRemaining.md)

#### Implementation of

[`WorkflowBudgetView`](../interfaces/WorkflowBudgetView.md).[`remaining`](../interfaces/WorkflowBudgetView.md#remaining)

***

### nextAgentIndex()

> **nextAgentIndex**(): `number`

Defined in: [workflow/budget.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/budget.ts#L52)

#### Returns

`number`

***

### nextLoopIndex()

> **nextLoopIndex**(): `number`

Defined in: [workflow/budget.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/budget.ts#L64)

#### Returns

`number`

***

### assertFanout()

> **assertFanout**(`count`): `void`

Defined in: [workflow/budget.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/budget.ts#L76)

#### Parameters

##### count

`number`

#### Returns

`void`

***

### observe()

> **observe**(`result`): `object`

Defined in: [workflow/budget.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/budget.ts#L89)

#### Parameters

##### result

[`WorkflowDelegateResult`](../interfaces/WorkflowDelegateResult.md)

#### Returns

`object`

##### costUsd

> **costUsd**: `number`

##### tokenUsage

> **tokenUsage**: [`WorkflowTokenUsage`](../interfaces/WorkflowTokenUsage.md)

***

### assertWall()

> **assertWall**(): `void`

Defined in: [workflow/budget.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/budget.ts#L106)

#### Returns

`void`

***

### remainingWallMs()

> **remainingWallMs**(): `number` \| `undefined`

Defined in: [workflow/budget.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/budget.ts#L112)

#### Returns

`number` \| `undefined`
