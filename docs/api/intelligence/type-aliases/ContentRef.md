[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / ContentRef

# Type Alias: ContentRef

> **ContentRef** = \{ `kind`: `"inline"`; `content`: `string`; \} \| \{ `kind`: `"github"`; `repository?`: `string`; `path`: `string`; `ref?`: `string`; \} \| \{ `kind`: `"blob"`; `uri`: `string`; `sha256`: `string`; `bytes?`: `number`; \}

Defined in: [intelligence/capability.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L65)

Where a capability's bytes live. A leaked manifest carries no live secret and
no inlined blob: `github`/`blob` are pointers resolved at provision time.
