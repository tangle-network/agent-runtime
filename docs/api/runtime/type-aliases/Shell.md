[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / Shell

# Type Alias: Shell

> **Shell** = (`args`, `cwd?`) => `Promise`\<\{ `stdout`: `string`; `stderr`: `string`; `code`: `number`; \}\>

Defined in: [runtime/workspace.ts:2](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L2)

Command runner seam. Host code can use `localShell`; sandbox code can wrap `box.exec`.

## Parameters

### args

`ReadonlyArray`\<`string`\>

### cwd?

`string`

## Returns

`Promise`\<\{ `stdout`: `string`; `stderr`: `string`; `code`: `number`; \}\>
