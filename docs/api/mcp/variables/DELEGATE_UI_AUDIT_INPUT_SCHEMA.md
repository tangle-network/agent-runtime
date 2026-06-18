[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DELEGATE\_UI\_AUDIT\_INPUT\_SCHEMA

# Variable: DELEGATE\_UI\_AUDIT\_INPUT\_SCHEMA

> `const` **DELEGATE\_UI\_AUDIT\_INPUT\_SCHEMA**: `object`

Defined in: [mcp/tools/delegate-ui-audit.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate-ui-audit.ts#L86)

**`Experimental`**

## Type Declaration

### type

> `readonly` **type**: `"object"` = `'object'`

### properties

> `readonly` **properties**: `object`

#### properties.workspaceDir

> `readonly` **workspaceDir**: `object`

#### properties.workspaceDir.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.workspaceDir.description

> `readonly` **description**: `"Absolute path for the audit workspace."` = `'Absolute path for the audit workspace.'`

#### properties.routes

> `readonly` **routes**: `object`

#### properties.routes.type

> `readonly` **type**: `"array"` = `'array'`

#### properties.routes.items

> `readonly` **items**: `object` = `ROUTE_SCHEMA`

#### properties.routes.items.type

> `readonly` **type**: `"object"` = `'object'`

#### properties.routes.items.properties

> `readonly` **properties**: `object`

#### properties.routes.items.properties.name

> `readonly` **name**: `object`

#### properties.routes.items.properties.name.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.routes.items.properties.name.description

> `readonly` **description**: `"Stable route name (used in screenshot filenames)."` = `'Stable route name (used in screenshot filenames).'`

#### properties.routes.items.properties.url

> `readonly` **url**: `object`

#### properties.routes.items.properties.url.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.routes.items.properties.url.description

> `readonly` **description**: `"Fully-qualified URL."` = `'Fully-qualified URL.'`

#### properties.routes.items.properties.viewports

> `readonly` **viewports**: `object`

#### properties.routes.items.properties.viewports.type

> `readonly` **type**: `"array"` = `'array'`

#### properties.routes.items.properties.viewports.items

> `readonly` **items**: `object` = `VIEWPORT_SCHEMA`

#### properties.routes.items.properties.viewports.items.type

> `readonly` **type**: `"object"` = `'object'`

#### properties.routes.items.properties.viewports.items.properties

> `readonly` **properties**: `object`

#### properties.routes.items.properties.viewports.items.properties.width

> `readonly` **width**: `object`

#### properties.routes.items.properties.viewports.items.properties.width.type

> `readonly` **type**: `"integer"` = `'integer'`

#### properties.routes.items.properties.viewports.items.properties.width.minimum

> `readonly` **minimum**: `1` = `1`

#### properties.routes.items.properties.viewports.items.properties.height

> `readonly` **height**: `object`

#### properties.routes.items.properties.viewports.items.properties.height.type

> `readonly` **type**: `"integer"` = `'integer'`

#### properties.routes.items.properties.viewports.items.properties.height.minimum

> `readonly` **minimum**: `1` = `1`

#### properties.routes.items.properties.viewports.items.required

> `readonly` **required**: readonly \[`"width"`, `"height"`\]

#### properties.routes.items.properties.viewports.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

#### properties.routes.items.properties.viewports.description

> `readonly` **description**: `"Viewports to capture at. Default [{1280, 800}]."` = `'Viewports to capture at. Default [{1280, 800}].'`

#### properties.routes.items.properties.fullPage

> `readonly` **fullPage**: `object`

#### properties.routes.items.properties.fullPage.type

> `readonly` **type**: `"boolean"` = `'boolean'`

#### properties.routes.items.properties.waitFor

> `readonly` **waitFor**: `object`

#### properties.routes.items.properties.waitFor.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.routes.items.properties.waitFor.description

> `readonly` **description**: `"CSS selector to wait for before capturing."` = `'CSS selector to wait for before capturing.'`

#### properties.routes.items.required

> `readonly` **required**: readonly \[`"name"`, `"url"`\]

#### properties.routes.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

#### properties.routes.minItems

> `readonly` **minItems**: `1` = `1`

#### properties.namespace

> `readonly` **namespace**: `object`

#### properties.namespace.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.namespace.description

> `readonly` **description**: `"Multi-tenant scope."` = `'Multi-tenant scope.'`

#### properties.config

> `readonly` **config**: `object`

#### properties.config.type

> `readonly` **type**: `"object"` = `'object'`

#### properties.config.properties

> `readonly` **properties**: `object`

#### properties.config.properties.lenses

> `readonly` **lenses**: `object`

#### properties.config.properties.lenses.type

> `readonly` **type**: `"array"` = `'array'`

#### properties.config.properties.lenses.items

> `readonly` **items**: `object`

#### properties.config.properties.lenses.items.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.config.properties.lenses.items.enum

> `readonly` **enum**: readonly [`UiLens`](../../profiles/type-aliases/UiLens.md)[]

#### properties.config.properties.lenses.description

> `readonly` **description**: "Lenses to iterate. Default: every lens except \"other\"." = `'Lenses to iterate. Default: every lens except "other".'`

#### properties.config.properties.maxIterations

> `readonly` **maxIterations**: `object`

#### properties.config.properties.maxIterations.type

> `readonly` **type**: `"integer"` = `'integer'`

#### properties.config.properties.maxIterations.minimum

> `readonly` **minimum**: `1` = `1`

#### properties.config.properties.maxConcurrency

> `readonly` **maxConcurrency**: `object`

#### properties.config.properties.maxConcurrency.type

> `readonly` **type**: `"integer"` = `'integer'`

#### properties.config.properties.maxConcurrency.minimum

> `readonly` **minimum**: `1` = `1`

#### properties.config.properties.productContext

> `readonly` **productContext**: `object`

#### properties.config.properties.productContext.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.config.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

### required

> `readonly` **required**: readonly \[`"workspaceDir"`, `"routes"`\]

### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`
