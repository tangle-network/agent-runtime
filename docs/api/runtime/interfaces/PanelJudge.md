[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / PanelJudge

# Interface: PanelJudge

Defined in: [runtime/personify/wave-types.ts:225](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L225)

One judge in a panel — a labeled persona-derived judge child. Content (the rubric) lives in
 the judge's profile; this carries only the label + the optional weight the merge may read.

## Properties

### label

> `readonly` **label**: `string`

Defined in: [runtime/personify/wave-types.ts:226](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L226)

***

### weight?

> `readonly` `optional` **weight?**: `number`

Defined in: [runtime/personify/wave-types.ts:228](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L228)

Optional merge weight (a write-only hint the `merge` fold may use; default-equal in the impl).
