[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / Outcome

# Type Alias: Outcome\<D\>

> **Outcome**\<`D`\> = \{ `kind`: `"done"`; `deliverable`: `D`; \} \| \{ `kind`: `"blocked"`; `blockers`: `string`[]; \}

Defined in: [runtime/personify/types.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L54)

The terminal contract Drew wants: a loop returns a FINISHED deliverable, or the concrete
list of blockers that stopped it — never a half-done best-effort coercion. A `blocked`
outcome with an empty `blockers` list is a contract violation (a shape that can't finish
MUST name why); impls fail loud on it rather than emitting a vacuous block.

`Outcome` is the `Out` type a personified `Agent`/`Supervisor` is parameterized by, so the
keystone's typed `SupervisedResult<Outcome<D>>` carries it end to end with no coercion.

## Type Parameters

### D

`D`
