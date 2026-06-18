[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / createBudgetPool

# Function: createBudgetPool()

> **createBudgetPool**(`root`, `now?`): [`BudgetPool`](../interfaces/BudgetPool.md)

Defined in: [runtime/supervise/budget.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L135)

Create a conserved reservation pool from a root `Budget`. `now()` is injected so the
deadline readout is deterministic; defaults to `Date.now` for non-test callers. The
absolute deadline is fixed at construction (`now() + budget.deadlineMs`) so the
readout's `deadlineMs` is a stable wall-clock instant, not a shrinking remainder.

## Parameters

### root

[`Budget`](../interfaces/Budget.md)

### now?

() => `number`

## Returns

[`BudgetPool`](../interfaces/BudgetPool.md)
