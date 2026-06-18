[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / RuntimeHooks

# Interface: RuntimeHooks

Defined in: [runtime-hooks.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L87)

The observation seam attached to a running loop (never to the portable genome).
Implement the optional hooks to receive lifecycle events, semantic decision points,
and hook errors. Author with [defineRuntimeHooks](../functions/defineRuntimeHooks.md) for inference, and attach N
observers at once with [composeRuntimeHooks](../functions/composeRuntimeHooks.md) — there is ONE event stream, not a
callback-prop zoo.

## Properties

### onEvent?

> `optional` **onEvent?**: (`event`, `context`) => `void` \| `Promise`\<`void`\>

Defined in: [runtime-hooks.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L93)

General before/after/event hook. Use this for telemetry, memory capture,
policy wrapping, child lifecycle observers, or product-specific extension
points.

#### Parameters

##### event

[`RuntimeHookEvent`](RuntimeHookEvent.md)

##### context

[`RuntimeHookContext`](RuntimeHookContext.md)

#### Returns

`void` \| `Promise`\<`void`\>

***

### onDecisionPoint?

> `optional` **onDecisionPoint?**: (`point`, `context`) => `void` \| `Promise`\<`void`\>

Defined in: [runtime-hooks.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L98)

Semantic decision hook. Belief-state evaluation consumes this, but runtime
code should keep emitting ordinary lifecycle events as the base layer.

#### Parameters

##### point

[`RuntimeDecisionPoint`](RuntimeDecisionPoint.md)

##### context

[`RuntimeHookContext`](RuntimeHookContext.md)

#### Returns

`void` \| `Promise`\<`void`\>

***

### onHookError?

> `optional` **onHookError?**: (`error`, `context`) => `void` \| `Promise`\<`void`\>

Defined in: [runtime-hooks.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L102)

#### Parameters

##### error

`Error`

##### context

[`RuntimeHookErrorContext`](RuntimeHookErrorContext.md)

#### Returns

`void` \| `Promise`\<`void`\>
