[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / PersonaContext

# Interface: PersonaContext

Defined in: [runtime/personify/types.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L104)

The persona context blob — who the loop is acting as. Open by intent: a persona names its
 own role/audience/constraints; the framework treats it as opaque content.

## Indexable

> \[`key`: `string`\]: `unknown`

Open content bag — persona-specific fields a shape's child tasks may carry.

## Properties

### role

> `readonly` **role**: `string`

Defined in: [runtime/personify/types.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L106)

The role the loop embodies ("senior staff engineer", "equity research analyst", …).

***

### notes?

> `readonly` `optional` **notes?**: `string`

Defined in: [runtime/personify/types.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L108)

Optional freeform framing the persona's prompts/profiles consume.
