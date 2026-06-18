[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / SteerContext

# Interface: SteerContext\<D\>

Defined in: [runtime/personify/wave-types.ts:386](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L386)

How a combinator's `act` consumes findings to steer — the SINGLE firewalled steer surface a
reactive combinator reads. `loopUntil.until`, `widen` gate, and any future steer all funnel
through a `SteerContext` so the firewall is enforced in one place: `findings` is trace-derived
(the analyst already asserted it), and a combinator MUST NOT reach back to `settled.verdict`
for the steer decision. `lastValidScore` is provided for OBSERVABILITY only (rendering/traces),
explicitly NOT for steering — reading it to steer is the coupling the architecture forbids.

## Type Parameters

### D

`D`

## Properties

### findings

> `readonly` **findings**: readonly `AnalystFinding`[]

Defined in: [runtime/personify/wave-types.ts:387](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L387)

***

### settledSoFar

> `readonly` **settledSoFar**: readonly [`Settled`](../type-aliases/Settled.md)\<[`Outcome`](../type-aliases/Outcome.md)\<`D`\>\>[]

Defined in: [runtime/personify/wave-types.ts:388](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L388)

***

### lastValidScore?

> `readonly` `optional` **lastValidScore?**: `number`

Defined in: [runtime/personify/wave-types.ts:391](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L391)

Observability-only: the best valid score seen so far. Rendering/trace use ONLY — steering
 off this re-introduces selector=judge. Marked so a reviewer catches a misuse.
