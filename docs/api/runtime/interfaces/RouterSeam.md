[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / RouterSeam

# Interface: RouterSeam

Defined in: [runtime/supervise/runtime.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L66)

Router/inline connection seam. A direct OpenAI-compatible Router endpoint —
the cheapest leaf, no box, no tools. `model` overrides the profile's model
hint when present; otherwise the profile's `model.default` is required.

## Properties

### routerBaseUrl

> **routerBaseUrl**: `string`

Defined in: [runtime/supervise/runtime.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L67)

***

### routerKey

> **routerKey**: `string`

Defined in: [runtime/supervise/runtime.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L68)

***

### model?

> `optional` **model?**: `string`

Defined in: [runtime/supervise/runtime.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L69)
