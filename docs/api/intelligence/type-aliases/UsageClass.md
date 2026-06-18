[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / UsageClass

# Type Alias: UsageClass

> **UsageClass** = `"inference"` \| `"intelligence"`

Defined in: [intelligence/index.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L96)

Usage class for billing. Base-stream tokens bill `'inference'`; every
 intelligence spawn (analyst, corpus, loop) bills `'intelligence'`. The
 billing line falls on the spawn line.
