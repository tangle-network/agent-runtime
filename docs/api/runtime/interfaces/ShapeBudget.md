[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / ShapeBudget

# Interface: ShapeBudget

Defined in: [runtime/personify/types.ts:153](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L153)

Budget knobs a shape reads to size its fanout/children WITHOUT owning the conserved pool.
The root budget lives on `SupervisorOpts.budget`; the shape only needs the per-child
sizing hints + the fanout width it is allowed to open. All ceilings — the pool reserves
against them and fails closed, so an over-eager shape can never overspend.

## Properties

### perChild

> `readonly` **perChild**: [`Budget`](Budget.md)

Defined in: [runtime/personify/types.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L155)

Per-child spawn budget the shape reserves for each leaf/sub-loop it opens.

***

### fanout

> `readonly` **fanout**: `number`

Defined in: [runtime/personify/types.ts:157](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L157)

Max children a fanout step may open in one round (the shape's structural width).
