[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / registryScopeAnalyst

# Function: registryScopeAnalyst()

> **registryScopeAnalyst**\<`D`\>(`registry`, `buildInputs`): [`ScopeAnalyst`](../interfaces/ScopeAnalyst.md)\<`D`\>

Defined in: [runtime/personify/analyst.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L202)

A `ScopeAnalyst` backed by an `AnalystRegistry` — the panel-of-analysts seam. The registry merges
N analyst KINDS into one `AnalystRunResult.findings`; `analyze` runs it over the caller-projected
`{ runId, inputs }` and pipes the merged findings through the SAME `assertTraceDerivedFindings`
firewall `createScopeAnalyst` uses (single-sourced selector≠judge). Distinct from `panel()`
(judges-vs-one-artifact) — this is analysts-over-a-trace, the diagnosis side of the wire.

Fail loud: a registry that throws propagates; a judge-derived finding aborts via the firewall.
The projection is the caller's (`buildInputs`) — if the scope settlements do not cleanly map to
the registry's `AnalystRunInputs`, that is a caller-side contract gap, surfaced there, not papered
over with a fabricated input here.

## Type Parameters

### D

`D`

## Parameters

### registry

[`AnalystRegistryLike`](../../analyst-loop/interfaces/AnalystRegistryLike.md)

### buildInputs

(`input`) => [`RegistryAnalyzeProjection`](../interfaces/RegistryAnalyzeProjection.md)

## Returns

[`ScopeAnalyst`](../interfaces/ScopeAnalyst.md)\<`D`\>
