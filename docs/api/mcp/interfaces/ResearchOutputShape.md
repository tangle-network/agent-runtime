[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / ResearchOutputShape

# Interface: ResearchOutputShape

Defined in: [mcp/types.ts:234](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L234)

**`Experimental`**

Loose shape of a research output over the wire — the substrate cannot
import the `ResearchOutput` type from agent-knowledge without inducing
a dependency cycle, so the MCP layer treats it structurally.

## Indexable

> \[`key`: `string`\]: `unknown`
**`Experimental`**

## Properties

### items

> **items**: `unknown`[]

Defined in: [mcp/types.ts:235](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L235)

**`Experimental`**

***

### citations

> **citations**: `unknown`[]

Defined in: [mcp/types.ts:236](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L236)

**`Experimental`**

***

### proposedWrites

> **proposedWrites**: `unknown`[]

Defined in: [mcp/types.ts:237](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L237)

**`Experimental`**

***

### gaps?

> `optional` **gaps?**: `string`[]

Defined in: [mcp/types.ts:238](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L238)

**`Experimental`**

***

### notes?

> `optional` **notes?**: `string`

Defined in: [mcp/types.ts:239](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L239)

**`Experimental`**
