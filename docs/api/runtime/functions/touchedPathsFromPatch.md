[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / touchedPathsFromPatch

# Function: touchedPathsFromPatch()

> **touchedPathsFromPatch**(`patch`): `string`[]

Defined in: [runtime/supervise/patch-checks.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-checks.ts#L45)

The unified-diff paths the patch touches — the `+++`/`---` headers, de-`a/`/`b/`-prefixed,
 with `/dev/null` (a delete's other side) dropped.

## Parameters

### patch

`string`

## Returns

`string`[]
