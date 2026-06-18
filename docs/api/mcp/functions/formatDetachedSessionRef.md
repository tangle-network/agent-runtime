[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / formatDetachedSessionRef

# Function: formatDetachedSessionRef()

> **formatDetachedSessionRef**(`parts`): `string`

Defined in: [mcp/detached-turn.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L95)

**`Experimental`**

Encode ref parts into the JSON-safe string stored on the record:
`session=<id>` before the box exists, `sandbox=<id>;session=<id>` once
bound. Ids must not contain the `;`/`=` delimiters.

## Parameters

### parts

[`DetachedSessionRefParts`](../interfaces/DetachedSessionRefParts.md)

## Returns

`string`
