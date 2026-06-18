[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DELEGATE\_CODE\_INPUT\_SCHEMA

# Variable: DELEGATE\_CODE\_INPUT\_SCHEMA

> `const` **DELEGATE\_CODE\_INPUT\_SCHEMA**: `object`

Defined in: [mcp/tools/delegate-code.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate-code.ts#L46)

**`Experimental`**

## Type Declaration

### type

> `readonly` **type**: `"object"` = `'object'`

### properties

> `readonly` **properties**: `object`

#### properties.goal

> `readonly` **goal**: `object`

#### properties.goal.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.goal.description

> `readonly` **description**: `"Natural-language description of what the coder must accomplish."` = `'Natural-language description of what the coder must accomplish.'`

#### properties.repoRoot

> `readonly` **repoRoot**: `object`

#### properties.repoRoot.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.repoRoot.description

> `readonly` **description**: `"Absolute path inside the sandbox where the repo lives."` = `'Absolute path inside the sandbox where the repo lives.'`

#### properties.contextHint

> `readonly` **contextHint**: `object`

#### properties.contextHint.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.contextHint.description

> `readonly` **description**: `"Optional free-form context the coder sees in the prompt prelude."` = `'Optional free-form context the coder sees in the prompt prelude.'`

#### properties.variants

> `readonly` **variants**: `object`

#### properties.variants.type

> `readonly` **type**: `"integer"` = `'integer'`

#### properties.variants.minimum

> `readonly` **minimum**: `1` = `1`

#### properties.variants.maximum

> `readonly` **maximum**: `8` = `8`

#### properties.variants.description

> `readonly` **description**: `"Number of parallel coder harnesses. Default 1."` = `'Number of parallel coder harnesses. Default 1.'`

#### properties.config

> `readonly` **config**: `object`

#### properties.config.type

> `readonly` **type**: `"object"` = `'object'`

#### properties.config.properties

> `readonly` **properties**: `object`

#### properties.config.properties.testCmd

> `readonly` **testCmd**: `object`

#### properties.config.properties.testCmd.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.config.properties.typecheckCmd

> `readonly` **typecheckCmd**: `object`

#### properties.config.properties.typecheckCmd.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.config.properties.forbiddenPaths

> `readonly` **forbiddenPaths**: `object`

#### properties.config.properties.forbiddenPaths.type

> `readonly` **type**: `"array"` = `'array'`

#### properties.config.properties.forbiddenPaths.items

> `readonly` **items**: `object`

#### properties.config.properties.forbiddenPaths.items.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.config.properties.maxDiffLines

> `readonly` **maxDiffLines**: `object`

#### properties.config.properties.maxDiffLines.type

> `readonly` **type**: `"integer"` = `'integer'`

#### properties.config.properties.maxDiffLines.minimum

> `readonly` **minimum**: `1` = `1`

#### properties.config.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

#### properties.namespace

> `readonly` **namespace**: `object`

#### properties.namespace.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.namespace.description

> `readonly` **description**: `"Multi-tenant scope (customer-id, workspace-id)."` = `'Multi-tenant scope (customer-id, workspace-id).'`

### required

> `readonly` **required**: readonly \[`"goal"`, `"repoRoot"`\]

### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`
