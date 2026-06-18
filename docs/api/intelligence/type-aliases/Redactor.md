[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / Redactor

# Type Alias: Redactor

> **Redactor** = (`value`) => `unknown`

Defined in: [intelligence/redact.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/redact.ts#L17)

A redactor maps an arbitrary trace value to a safe-to-export value. Pure;
 must not throw on cyclic input (the default tolerates cycles).

## Parameters

### value

`unknown`

## Returns

`unknown`
