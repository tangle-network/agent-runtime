[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / DeliveryBinding

# Type Alias: DeliveryBinding

> **DeliveryBinding** = \{ `kind`: `"inline"`; `content`: [`ContentRef`](ContentRef.md); \} \| \{ `kind`: `"file"`; `path`: `string`; `content`: [`ContentRef`](ContentRef.md); `executable?`: `boolean`; \} \| \{ `kind`: `"http"`; `url`: `string`; `method?`: `string`; `auth?`: [`CapabilityAuth`](CapabilityAuth.md); \} \| \{ `kind`: `"sandbox-code"`; `entry`: `string`; `code`: [`ContentRef`](ContentRef.md); `runtime?`: `string`; `harness?`: `string`; \} \| \{ `kind`: `"mcp-stdio"`; `command`: `string`; `args?`: `string`[]; `env?`: `Record`\<`string`, `string`\>; `cwd?`: `string`; \} \| \{ `kind`: `"mcp-remote"`; `url`: `string`; `transport`: `"http"` \| `"sse"`; `headers?`: `Record`\<`string`, `string`\>; \} \| \{ `kind`: `"process-on-infra"`; `host`: [`HostSpec`](../interfaces/HostSpec.md); `inner`: `DeliveryBinding`; \} \| \{ `kind`: `"rag-index"`; `index`: [`ContentRef`](ContentRef.md); `embedModel`: `string`; `topK?`: `number`; \} \| \{ `kind`: `"memory-store"`; `provision`: `"sqlite"` \| `"neo4j"` \| `"vector"`; `seed?`: [`ContentRef`](ContentRef.md); \} \| \{ `kind`: `"wasm"`; `module`: [`ContentRef`](ContentRef.md); `exports`: `string`[]; \} \| \{ `kind`: `"a2a"`; `endpoint`: `string`; `card`: [`ContentRef`](ContentRef.md); `auth?`: [`CapabilityAuth`](CapabilityAuth.md); \}

Defined in: [intelligence/capability.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L108)

How a capability is backed. OPEN tagged union — THE extension point. All arms
are typed even when the resolver does not yet admit them; an un-admitted arm
throws [CapabilityNotAdmittedError](../classes/CapabilityNotAdmittedError.md) at resolve, never silently no-ops.
