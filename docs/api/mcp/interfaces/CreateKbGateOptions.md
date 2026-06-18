[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / CreateKbGateOptions

# Interface: CreateKbGateOptions

Defined in: [mcp/kb-gate.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L59)

**`Experimental`**

## Properties

### judges?

> `optional` **judges?**: [`FactJudge`](FactJudge.md)[]

Defined in: [mcp/kb-gate.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L61)

**`Experimental`**

Extra judges appended after the built-in floor (e.g. an LLM judge).

***

### minPassageChars?

> `optional` **minPassageChars?**: `number`

Defined in: [mcp/kb-gate.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L63)

**`Experimental`**

Minimum verbatim-passage length. Default 12 — kills empty/stub passages.

***

### selfArtifactKinds?

> `optional` **selfArtifactKinds?**: `string`[]

Defined in: [mcp/kb-gate.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L70)

**`Experimental`**

Citation tokens that denote a SELF-generated artifact (e.g. `'spec'`,
`'cad_params'`, `'requirements'`). A citation naming one is circular
(laundering) — the fact cites a derived artifact, not a real source.
Default `[]` (no circular check unless the consumer declares its kinds).
