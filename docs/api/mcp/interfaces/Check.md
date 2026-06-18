[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / Check

# Interface: Check

Defined in: [mcp/tools/checks.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L82)

One lens — a composable analyst kind. Identity fields mirror `TraceAnalystKindSpec` so a kind is
 upgradeable to the full agentic factory; `lookFor` is the lens question the actor applies.

## Properties

### id

> `readonly` **id**: `string`

Defined in: [mcp/tools/checks.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L83)

***

### description

> `readonly` **description**: `string`

Defined in: [mcp/tools/checks.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L84)

***

### area

> `readonly` **area**: `string`

Defined in: [mcp/tools/checks.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L86)

Coarse classification stamped on every finding this kind emits (the renderer groups by it).

***

### version

> `readonly` **version**: `string`

Defined in: [mcp/tools/checks.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L87)

***

### lookFor

> `readonly` **lookFor**: `string`

Defined in: [mcp/tools/checks.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L89)

The lens — what this analyst looks for in the trace.
