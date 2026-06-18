[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / BudgetReadout

# Type Alias: BudgetReadout

> **BudgetReadout** = `Readonly`\<\{ `tokensLeft`: `number`; `usdLeft`: `number`; `usdCapped`: `boolean`; `deadlineMs`: `number`; `reservedTokens`: `number`; \}\>

Defined in: [runtime/supervise/budget.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L43)

Post-reservation pool readout — the shape `Scope.budget` exposes. `tokensLeft`,
 `usdLeft`, and `reservedTokens` reflect committed-but-unsettled reservations;
 `deadlineMs` is the ABSOLUTE wall-clock deadline (0 when the root set none).
 `usdCapped` distinguishes a real `usdLeft <= 0` exhaustion from an uncapped pool (which always
 reads `usdLeft: 0`) — the in-loop guard needs it to bound a usd-capped driver.
