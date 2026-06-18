[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [agent](../README.md) / defineAgent

# Function: defineAgent()

> **defineAgent**\<`TPersona`, `TRunOutput`\>(`manifest`): [`AgentManifest`](../interfaces/AgentManifest.md)\<`TPersona`, `TRunOutput`\>

Defined in: [agent/define-agent.ts:296](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L296)

Construct a validated agent manifest. Throws `AgentManifestError`
if any required surface is missing on disk.

Generics: pass your persona / output types if you want narrowed
`runtime.act` signatures:
  `defineAgent<TaxPersona, TaxRunOutput>({ ... })`

Most callers don't need the generics — the substrate operates on
`unknown` payloads internally and the manifest's `score` /
`runtime.act` see the typed shapes via TypeScript inference at
the call site.

## Type Parameters

### TPersona

`TPersona` = `unknown`

### TRunOutput

`TRunOutput` = `unknown`

## Parameters

### manifest

[`AgentManifest`](../interfaces/AgentManifest.md)\<`TPersona`, `TRunOutput`\>

## Returns

[`AgentManifest`](../interfaces/AgentManifest.md)\<`TPersona`, `TRunOutput`\>
