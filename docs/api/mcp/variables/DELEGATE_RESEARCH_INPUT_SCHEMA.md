[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DELEGATE\_RESEARCH\_INPUT\_SCHEMA

# Variable: DELEGATE\_RESEARCH\_INPUT\_SCHEMA

> `const` **DELEGATE\_RESEARCH\_INPUT\_SCHEMA**: `object`

Defined in: [mcp/tools/delegate-research.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate-research.ts#L52)

**`Experimental`**

## Type Declaration

### type

> `readonly` **type**: `"object"` = `'object'`

### properties

> `readonly` **properties**: `object`

#### properties.question

> `readonly` **question**: `object`

#### properties.question.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.question.description

> `readonly` **description**: `"The research question to answer."` = `'The research question to answer.'`

#### properties.namespace

> `readonly` **namespace**: `object`

#### properties.namespace.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.namespace.description

> `readonly` **description**: `"Multi-tenant scope (customer-id, workspace-id). REQUIRED."` = `'Multi-tenant scope (customer-id, workspace-id). REQUIRED.'`

#### properties.scope

> `readonly` **scope**: `object`

#### properties.scope.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.scope.description

> `readonly` **description**: "Bound, e.g. \"audience for cpg-founder ICP\"." = `'Bound, e.g. "audience for cpg-founder ICP".'`

#### properties.sources

> `readonly` **sources**: `object`

#### properties.sources.type

> `readonly` **type**: `"array"` = `'array'`

#### properties.sources.items

> `readonly` **items**: `object`

#### properties.sources.items.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.sources.items.enum

> `readonly` **enum**: readonly [`ResearchSource`](../type-aliases/ResearchSource.md)[]

#### properties.variants

> `readonly` **variants**: `object`

#### properties.variants.type

> `readonly` **type**: `"integer"` = `'integer'`

#### properties.variants.minimum

> `readonly` **minimum**: `1` = `1`

#### properties.variants.maximum

> `readonly` **maximum**: `8` = `8`

#### properties.config

> `readonly` **config**: `object`

#### properties.config.type

> `readonly` **type**: `"object"` = `'object'`

#### properties.config.properties

> `readonly` **properties**: `object`

#### properties.config.properties.recencyWindow

> `readonly` **recencyWindow**: `object`

#### properties.config.properties.recencyWindow.type

> `readonly` **type**: `"object"` = `'object'`

#### properties.config.properties.recencyWindow.properties

> `readonly` **properties**: `object`

#### properties.config.properties.recencyWindow.properties.since

> `readonly` **since**: `object`

#### properties.config.properties.recencyWindow.properties.since.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.config.properties.recencyWindow.properties.since.description

> `readonly` **description**: `"ISO datetime"` = `'ISO datetime'`

#### properties.config.properties.recencyWindow.properties.until

> `readonly` **until**: `object`

#### properties.config.properties.recencyWindow.properties.until.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.config.properties.recencyWindow.properties.until.description

> `readonly` **description**: `"ISO datetime"` = `'ISO datetime'`

#### properties.config.properties.recencyWindow.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

#### properties.config.properties.maxItems

> `readonly` **maxItems**: `object`

#### properties.config.properties.maxItems.type

> `readonly` **type**: `"integer"` = `'integer'`

#### properties.config.properties.maxItems.minimum

> `readonly` **minimum**: `1` = `1`

#### properties.config.properties.minConfidence

> `readonly` **minConfidence**: `object`

#### properties.config.properties.minConfidence.type

> `readonly` **type**: `"number"` = `'number'`

#### properties.config.properties.minConfidence.minimum

> `readonly` **minimum**: `0` = `0`

#### properties.config.properties.minConfidence.maximum

> `readonly` **maximum**: `1` = `1`

#### properties.config.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

### required

> `readonly` **required**: readonly \[`"question"`, `"namespace"`\]

### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`
