[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DELEGATION\_STATUS\_INPUT\_SCHEMA

# Variable: DELEGATION\_STATUS\_INPUT\_SCHEMA

> `const` **DELEGATION\_STATUS\_INPUT\_SCHEMA**: `object`

Defined in: [mcp/tools/delegation-status.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegation-status.ts#L41)

**`Experimental`**

## Type Declaration

### type

> `readonly` **type**: `"object"` = `'object'`

### properties

> `readonly` **properties**: `object`

#### properties.taskId

> `readonly` **taskId**: `object`

#### properties.taskId.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.taskId.description

> `readonly` **description**: `"Returned by delegate_code / delegate_research."` = `'Returned by delegate_code / delegate_research.'`

#### properties.includeTrace

> `readonly` **includeTrace**: `object`

#### properties.includeTrace.type

> `readonly` **type**: `"boolean"` = `'boolean'`

#### properties.includeTrace.description

> `readonly` **description**: `"Also return the journaled loop-trace span tree for this delegation. Default false."` = `'Also return the journaled loop-trace span tree for this delegation. Default false.'`

### required

> `readonly` **required**: readonly \[`"taskId"`\]

### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`
