[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / EqualKOnCostOptions

# Interface: EqualKOnCostOptions

Defined in: [runtime/personify/wave-types.ts:599](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L599)

`equalKOnCost(arms, { tolerance? })` — assert arms are comparable at EQUAL conserved COST
(tokens + usd), NOT raw iteration count. The conserved-pool guarantees `Σk` equal by
construction WITHIN one supervised run; this checks it ACROSS arms (separate runs) where the
pool cannot, so a cross-arm gate comparison can prove equal compute before claiming a win. The
impl lives in `trajectory.ts`. Pure over the reports — no I/O.

## Properties

### tolerance?

> `readonly` `optional` **tolerance?**: `number`

Defined in: [runtime/personify/wave-types.ts:602](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L602)

Max fractional spread (spread/median) per channel for arms to count as equal-k. Default in
 the impl (e.g. 0.05). A tighter tolerance = a stricter equal-compute claim.
