[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / CoderCheckConstraints

# Interface: CoderCheckConstraints

Defined in: [runtime/supervise/patch-checks.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-checks.ts#L36)

**`Experimental`**

The per-task constraints the mechanical gate enforces.

## Extended by

- [`PatchDeliverableOptions`](PatchDeliverableOptions.md)

## Properties

### maxDiffLines?

> `optional` **maxDiffLines?**: `number`

Defined in: [runtime/supervise/patch-checks.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-checks.ts#L38)

**`Experimental`**

Default 400. Hard cap; gate fails when exceeded.

***

### forbiddenPaths?

> `optional` **forbiddenPaths?**: `string`[]

Defined in: [runtime/supervise/patch-checks.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-checks.ts#L40)

**`Experimental`**

Literal path prefixes the patch must not touch.
