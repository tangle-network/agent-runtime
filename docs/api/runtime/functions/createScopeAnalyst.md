[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / createScopeAnalyst

# Function: createScopeAnalyst()

> **createScopeAnalyst**\<`D`\>(`scope`, `options`): [`ScopeAnalyst`](../interfaces/ScopeAnalyst.md)\<`D`\>

Defined in: [runtime/personify/analyst.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L96)

Build a `ScopeAnalyst` that spawns the analyst agent through `Scope.spawn` (so its compute is
metered by the conserved pool), drains its single settlement, and enforces the trace-derived
firewall before returning. The `scope` is the SAME scope the combinator is draining its children
from — the analyst is spawned as a sibling and its result is read off `scope.next()` in cursor
order, replay-safe like any other child.

Fail loud (no silent empty findings):
 - the pool refuses the analyst spawn → `AnalystError` (the steer would otherwise run on nothing)
 - the analyst settles `down` → `AnalystError` (a broken capture path, not a verdict)
 - the analyst returns a non-array → `PlannerError`
 - any finding cites judge-derived metric evidence → `PlannerError` via the firewall

## Type Parameters

### D

`D`

## Parameters

### scope

[`Scope`](../interfaces/Scope.md)\<[`Outcome`](../type-aliases/Outcome.md)\<`D`\>\>

### options

[`CreateScopeAnalystOptions`](../interfaces/CreateScopeAnalystOptions.md)\<`D`\>

## Returns

[`ScopeAnalyst`](../interfaces/ScopeAnalyst.md)\<`D`\>
