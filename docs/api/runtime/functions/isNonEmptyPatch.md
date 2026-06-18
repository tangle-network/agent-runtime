[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / isNonEmptyPatch

# Function: isNonEmptyPatch()

> **isNonEmptyPatch**(`patch`): `boolean`

Defined in: [runtime/supervise/patch-checks.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-checks.ts#L75)

True when the patch actually changes something — at least one touched path AND non-blank body.
 An empty patch can trivially "pass" tests/typecheck (nothing changed) yet does no work.

## Parameters

### patch

`string`

## Returns

`boolean`
