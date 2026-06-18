[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / HaltReason

# Type Alias: HaltReason

> **HaltReason** = \{ `kind`: `"max_turns"`; `turns`: `number`; \} \| \{ `kind`: `"max_credits"`; `spentCents`: `number`; `capCents`: `number`; \} \| \{ `kind`: `"predicate"`; `reason`: `string`; \} \| \{ `kind`: `"abort"`; \} \| \{ `kind`: `"participant_error"`; `participant`: `string`; `message`: `string`; \}

Defined in: [conversation/types.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L99)

## Stable
