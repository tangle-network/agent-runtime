[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / PullOutcome

# Type Alias: PullOutcome

> **PullOutcome** = \{ `succeeded`: `true`; `value`: [`CertifiedProfile`](../interfaces/CertifiedProfile.md); \} \| \{ `succeeded`: `false`; `error`: `string`; `status?`: `number`; \}

Defined in: [intelligence/delivery.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L63)

Typed outcome for the pull — inspect `succeeded` before `value`. A 404
 (nothing promoted yet) is a normal, non-error `succeeded: false`.
