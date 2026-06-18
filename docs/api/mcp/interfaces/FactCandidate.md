[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / FactCandidate

# Interface: FactCandidate

Defined in: [mcp/kb-gate.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L24)

**`Experimental`**

A fact proposed for the KB, with its grounding.

## Properties

### claim

> **claim**: `string`

Defined in: [mcp/kb-gate.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L26)

**`Experimental`**

The atomic claim text.

***

### value?

> `optional` **value?**: `string` \| `number`

Defined in: [mcp/kb-gate.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L28)

**`Experimental`**

Optional extracted value (number or string) the claim asserts.

***

### verbatimPassage

> **verbatimPassage**: `string`

Defined in: [mcp/kb-gate.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L30)

**`Experimental`**

Verbatim span lifted from the source that backs the claim.

***

### sourceText

> **sourceText**: `string`

Defined in: [mcp/kb-gate.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L32)

**`Experimental`**

The raw source text the passage must be grounded in.

***

### citation?

> `optional` **citation?**: `string`

Defined in: [mcp/kb-gate.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L34)

**`Experimental`**

Where the fact claims to come from — checked for circular/self citations.
