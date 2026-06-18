[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / PatchDeliverableOptions

# Interface: PatchDeliverableOptions

Defined in: [runtime/supervise/patch-deliverable.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-deliverable.ts#L27)

**`Experimental`**

## Extends

- [`CoderCheckConstraints`](CoderCheckConstraints.md)

## Extended by

- [`WorktreeFanoutOptions`](WorktreeFanoutOptions.md)

## Properties

### maxDiffLines?

> `optional` **maxDiffLines?**: `number`

Defined in: [runtime/supervise/patch-checks.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-checks.ts#L38)

**`Experimental`**

Default 400. Hard cap; gate fails when exceeded.

#### Inherited from

[`CoderCheckConstraints`](CoderCheckConstraints.md).[`maxDiffLines`](CoderCheckConstraints.md#maxdifflines)

***

### forbiddenPaths?

> `optional` **forbiddenPaths?**: `string`[]

Defined in: [runtime/supervise/patch-checks.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-checks.ts#L40)

**`Experimental`**

Literal path prefixes the patch must not touch.

#### Inherited from

[`CoderCheckConstraints`](CoderCheckConstraints.md).[`forbiddenPaths`](CoderCheckConstraints.md#forbiddenpaths)

***

### require?

> `optional` **require?**: readonly (`"tests"` \| `"typecheck"`)[]

Defined in: [runtime/supervise/patch-deliverable.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-deliverable.ts#L34)

**`Experimental`**

Which verification signals the gate REQUIRES to be present-and-passing. A required signal
that the artifact never derived (the command was not configured on the executor) fails the
gate closed. Unlisted signals default to passed-when-absent (the executor simply didn't run
that command). Default `[]` — gate on no-op / secret / forbidden / diff-size only.
