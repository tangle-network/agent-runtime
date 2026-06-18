[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / EffortOverridesCompiled

# Interface: EffortOverridesCompiled

Defined in: [intelligence/effort.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L156)

The run-config overrides an `EffortSettings` compiles to — the bridge between the
pure effort policy and the orchestration entrypoints (`runPersonified` / the
improvement cycle). This is ONLY data: it never constructs an analyst or runs a
loop. The caller reads these flags to decide WHAT to pass:

 - `withAnalyst: false` ⇒ DO NOT construct/pass a `ScopeAnalyst` to `runPersonified`
   (the dormant empty-findings path runs; the base agent still works). This is the
   PRODUCT fail-closed at `off`/`eco` — "don't construct the analyst" — distinct from
   the EXPERIMENT fail-closed inside `createScopeAnalyst` ("hard abort"), which stays
   untouched. Degrade, never throw.
 - `fanout` ⇒ the `ShapeBudget.fanout` width to pass (`1` at `off`, the tier's breadth
   otherwise). Overrides the personify default fanout.
 - `withLoops: false` ⇒ the improvement cycle is a no-op for this run (no refine /
   fanout-vote multi-step loop spawns).
 - `intelligenceBudgetUsd` ⇒ the intelligence-class spend ceiling carried through for
   the billing clamp (passed verbatim; `0` refuses every intelligence spawn).

## Properties

### withAnalyst

> **withAnalyst**: `boolean`

Defined in: [intelligence/effort.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L158)

Construct + pass a `ScopeAnalyst`? `false` ⇒ omit it (degrade to the base agent).

***

### fanout

> **fanout**: `number`

Defined in: [intelligence/effort.ts:160](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L160)

`ShapeBudget.fanout` width to pass to `runPersonified`.

***

### withLoops

> **withLoops**: `boolean`

Defined in: [intelligence/effort.ts:162](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L162)

Run the multi-step improvement cycle, or no-op it for this run?

***

### intelligenceBudgetUsd

> **intelligenceBudgetUsd**: `number` \| `null`

Defined in: [intelligence/effort.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L164)

Intelligence-class spend ceiling. `0` refuses every intelligence spawn; `null` uncapped.
