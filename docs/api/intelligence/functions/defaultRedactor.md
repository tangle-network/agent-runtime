[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / defaultRedactor

# Function: defaultRedactor()

> **defaultRedactor**(`value`): `unknown`

Defined in: [intelligence/redact.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/redact.ts#L56)

The built-in redactor. Walks objects and arrays; replaces values under
secret-bearing keys wholesale; scrubs in-value patterns from every string.
Cycle-safe (a seen-set short-circuits self-referential payloads to
`'[circular]'`), depth-bounded, and total — never throws on customer input.

## Parameters

### value

`unknown`

## Returns

`unknown`
