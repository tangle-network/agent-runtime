[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / DefinePersona

# Type Alias: DefinePersona

> **DefinePersona** = \<`D`\>(`input`) => [`Persona`](../interfaces/Persona.md)\<`D`\>

Defined in: [runtime/personify/types.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L143)

Builds a frozen `Persona`, failing loud on the executors-supplied invariant (neither a
 registry nor seams = an unresolvable persona). Pure — no I/O, no engine.

## Type Parameters

### D

`D` = `unknown`

## Parameters

### input

[`DefinePersonaInput`](../interfaces/DefinePersonaInput.md)\<`D`\>

## Returns

[`Persona`](../interfaces/Persona.md)\<`D`\>
