[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DELEGATION\_HISTORY\_INPUT\_SCHEMA

# Variable: DELEGATION\_HISTORY\_INPUT\_SCHEMA

> `const` **DELEGATION\_HISTORY\_INPUT\_SCHEMA**: `object`

Defined in: [mcp/tools/delegation-history.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegation-history.ts#L41)

**`Experimental`**

## Type Declaration

### type

> `readonly` **type**: `"object"` = `'object'`

### properties

> `readonly` **properties**: `object`

#### properties.namespace

> `readonly` **namespace**: `object`

#### properties.namespace.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.profile

> `readonly` **profile**: `object`

#### properties.profile.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.profile.enum

> `readonly` **enum**: readonly \[`"coder"`, `"researcher"`\]

#### properties.since

> `readonly` **since**: `object`

#### properties.since.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.since.description

> `readonly` **description**: `"ISO datetime — earliest startedAt to include."` = `'ISO datetime — earliest startedAt to include.'`

#### properties.limit

> `readonly` **limit**: `object`

#### properties.limit.type

> `readonly` **type**: `"integer"` = `'integer'`

#### properties.limit.minimum

> `readonly` **minimum**: `1` = `1`

#### properties.limit.maximum

> `readonly` **maximum**: `500` = `500`

### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`
