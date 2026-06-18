[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / compileEffort

# Function: compileEffort()

> **compileEffort**(`settings`): [`EffortOverridesCompiled`](../interfaces/EffortOverridesCompiled.md)

Defined in: [intelligence/effort.ts:178](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L178)

Compile resolved `EffortSettings` into the orchestration overrides above. Pure: same
input → same object, no I/O, no execution, no construction. It is the single place that
maps the effort axes onto the run-config knobs, so no `if (effort)` leaks into the
supervise kernel — the kernel stays effort-blind, the caller reads these flags once.

`off`/`eco` (`analysts: false`) compile to `withAnalyst: false` ⇒ the caller omits the
analyst and the run degrades to the dormant base agent rather than throwing. `fanout: 1`
(no breadth) at `off`; `withLoops: false` no-ops the improvement cycle. `standard`+
compile to `withAnalyst: true`, the tier's `fanout`, and `withLoops: true`.

## Parameters

### settings

[`EffortSettings`](../interfaces/EffortSettings.md)

## Returns

[`EffortOverridesCompiled`](../interfaces/EffortOverridesCompiled.md)
