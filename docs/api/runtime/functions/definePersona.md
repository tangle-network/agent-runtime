[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / definePersona

# Function: definePersona()

> **definePersona**\<`D`\>(`input`): [`Persona`](../interfaces/Persona.md)\<`D`\>

Defined in: [runtime/personify/persona.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/persona.ts#L56)

Build a frozen `Persona`. Fails loud on the executors-supplied invariant: a persona with
neither a pre-built registry nor a seam bag cannot resolve its built-in runtimes, so it is
unrunnable — refuse it at definition time, not at the first spawn. Pure; no I/O.

## Type Parameters

### D

`D` = `unknown`

## Parameters

### input

[`DefinePersonaInput`](../interfaces/DefinePersonaInput.md)\<`D`\>

## Returns

[`Persona`](../interfaces/Persona.md)\<`D`\>
