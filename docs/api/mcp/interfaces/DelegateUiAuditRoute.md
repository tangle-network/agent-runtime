[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegateUiAuditRoute

# Interface: DelegateUiAuditRoute

Defined in: [mcp/types.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L182)

Optional per-route capture spec the agent surfaces over the wire.

## Properties

### name

> **name**: `string`

Defined in: [mcp/types.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L184)

Stable route name (used in screenshot filenames + finding metadata).

***

### url

> **url**: `string`

Defined in: [mcp/types.ts:186](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L186)

Fully-qualified URL.

***

### viewports?

> `optional` **viewports?**: readonly `object`[]

Defined in: [mcp/types.ts:188](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L188)

Viewports to capture at. Defaults to `[{ width: 1280, height: 800 }]`.

***

### fullPage?

> `optional` **fullPage?**: `boolean`

Defined in: [mcp/types.ts:190](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L190)

Default false. Full-page captures for the broad lenses.

***

### waitFor?

> `optional` **waitFor?**: `string`

Defined in: [mcp/types.ts:192](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L192)

Selector to wait for before capture.
