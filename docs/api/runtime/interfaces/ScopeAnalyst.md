[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / ScopeAnalyst

# Interface: ScopeAnalyst\<D\>

Defined in: [runtime/personify/wave-types.ts:358](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L358)

The reactive analyst seam — the PORT of the round-synchronous driver's `analyze` hook
(dynamic.ts) onto the reactive `Scope`. The old driver wired the analyst at round
boundaries (`plan` ran the analyst over `history` BEFORE the planner); the reactive `Scope` has
no rounds, so this carries the wire across: a combinator's `act` asks the `ScopeAnalyst` to turn
the settled children SO FAR into `AnalystFinding[]`, and steers from THOSE findings.

The firewall is preserved (selector≠judge): `analyze` runs the trace-derived analyst and the
impl asserts `assertTraceDerivedFindings` semantics — a finding citing judge/verdict/score
`metric` evidence aborts the round. The steer decision reads `findings`, NEVER the children's
raw `verdict`. Fail loud — a throwing or non-array analyst aborts (no silent empty findings).

## Type Parameters

### D

`D`

## Methods

### analyze()

> **analyze**(`input`): `Promise`\<readonly `AnalystFinding`[]\>

Defined in: [runtime/personify/wave-types.ts:365](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L365)

Turn the children settled so far into trace-derived findings. `settledSoFar` is the cursor-
ordered settlement list a combinator has drained (the reactive analogue of the old driver's
`history`). The impl runs the analyst, then enforces the trace-derived firewall before
returning — a judge-derived finding is rejected, not filtered.

#### Parameters

##### input

[`ScopeAnalyzeInput`](ScopeAnalyzeInput.md)\<`D`\>

#### Returns

`Promise`\<readonly `AnalystFinding`[]\>
