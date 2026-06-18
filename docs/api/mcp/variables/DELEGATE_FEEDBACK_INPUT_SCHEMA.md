[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DELEGATE\_FEEDBACK\_INPUT\_SCHEMA

# Variable: DELEGATE\_FEEDBACK\_INPUT\_SCHEMA

> `const` **DELEGATE\_FEEDBACK\_INPUT\_SCHEMA**: `object`

Defined in: [mcp/tools/delegate-feedback.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate-feedback.ts#L51)

**`Experimental`**

## Type Declaration

### type

> `readonly` **type**: `"object"` = `'object'`

### properties

> `readonly` **properties**: `object`

#### properties.refersTo

> `readonly` **refersTo**: `object`

#### properties.refersTo.type

> `readonly` **type**: `"object"` = `'object'`

#### properties.refersTo.properties

> `readonly` **properties**: `object`

#### properties.refersTo.properties.kind

> `readonly` **kind**: `object`

#### properties.refersTo.properties.kind.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.refersTo.properties.kind.enum

> `readonly` **enum**: readonly \[`"delegation"`, `"artifact"`, `"outcome"`\]

#### properties.refersTo.properties.ref

> `readonly` **ref**: `object`

#### properties.refersTo.properties.ref.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.refersTo.required

> `readonly` **required**: readonly \[`"kind"`, `"ref"`\]

#### properties.refersTo.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

#### properties.rating

> `readonly` **rating**: `object`

#### properties.rating.type

> `readonly` **type**: `"object"` = `'object'`

#### properties.rating.properties

> `readonly` **properties**: `object`

#### properties.rating.properties.score

> `readonly` **score**: `object`

#### properties.rating.properties.score.type

> `readonly` **type**: `"number"` = `'number'`

#### properties.rating.properties.score.minimum

> `readonly` **minimum**: `0` = `0`

#### properties.rating.properties.score.maximum

> `readonly` **maximum**: `1` = `1`

#### properties.rating.properties.label

> `readonly` **label**: `object`

#### properties.rating.properties.label.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.rating.properties.label.enum

> `readonly` **enum**: readonly \[`"good"`, `"bad"`, `"neutral"`, `"mixed"`\]

#### properties.rating.properties.notes

> `readonly` **notes**: `object`

#### properties.rating.properties.notes.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.rating.required

> `readonly` **required**: readonly \[`"score"`, `"notes"`\]

#### properties.rating.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

#### properties.by

> `readonly` **by**: `object`

#### properties.by.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.by.enum

> `readonly` **enum**: readonly \[`"agent"`, `"user"`, `"downstream-judge"`\]

#### properties.capturedAt

> `readonly` **capturedAt**: `object`

#### properties.capturedAt.type

> `readonly` **type**: `"string"` = `'string'`

#### properties.namespace

> `readonly` **namespace**: `object`

#### properties.namespace.type

> `readonly` **type**: `"string"` = `'string'`

### required

> `readonly` **required**: readonly \[`"refersTo"`, `"rating"`, `"by"`\]

### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`
