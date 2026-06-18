[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [workflow](../README.md) / JsonSchema

# Type Alias: JsonSchema

> **JsonSchema** = \{ `type`: `"string"`; `minLength?`: `number`; `maxLength?`: `number`; `enum?`: `string`[]; \} \| \{ `type`: `"number"`; `minimum?`: `number`; `maximum?`: `number`; `enum?`: `number`[]; \} \| \{ `type`: `"integer"`; `minimum?`: `number`; `maximum?`: `number`; `enum?`: `number`[]; \} \| \{ `type`: `"boolean"`; `enum?`: `boolean`[]; \} \| \{ `type`: `"null"`; \} \| \{ `type`: `"array"`; `items?`: `JsonSchema`; `minItems?`: `number`; `maxItems?`: `number`; \} \| \{ `type`: `"object"`; `properties?`: `Record`\<`string`, `JsonSchema`\>; `required?`: `string`[]; `additionalProperties?`: `boolean`; \}

Defined in: [workflow/types.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L23)
